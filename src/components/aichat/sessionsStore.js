function loadSessions() {
  try {
    const raw = localStorage.getItem('aiCopilotSessions');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/* ===== 存储边界治理（2026-09-22）=====
 * 此前持久化是无界的：会话条数、单会话消息量、localStorage 配额全都不设防，
 * 塞爆 5MB 配额后 QuotaExceededError 被 catch 静默吞掉 → 「看起来在存，其实早就不落盘了」。
 * 三层递进（风格对齐 contextManager.packConversation 的兜底链）：
 *  1. 投影裁剪：磁盘快照只保最近 MAX_PERSISTED_SESSIONS 个会话（active 强制保留），
 *     每会话消息只落最近 MAX_PERSISTED_MESSAGES 条 —— state 内存本体不动，
 *     超投影的极旧消息仅刷新后不再恢复（LLM 上下文本就只消费 packConversation 压缩结果，无感）。
 *  2. 配额降级：写入仍失败时逐轮淘汰最旧非活跃会话重试，直到塞得下。
 *  3. 终极兜底：只剩活跃会话仍爆 → 活跃消息截到最近 ACTIVE_FALLBACK_MESSAGES 条再试；
 *     仍失败则放弃本次落盘（内存 state 继续用，不抛错不丢当前会话体验）。 */
const MAX_PERSISTED_SESSIONS = 50;
const MAX_PERSISTED_MESSAGES = 400;
const ACTIVE_FALLBACK_MESSAGES = 100;

/** 纯函数：把 sessions 投影成「可落盘」的形态（不修改入参）。导出仅供单测。 */
export function buildPersistProjection(sessions, activeSessionId = null) {
  if (!Array.isArray(sessions)) return [];
  const ts = (s) => s?.updatedAt || 0;
  const sorted = [...sessions].sort((a, b) => ts(b) - ts(a));
  let keep = sorted.slice(0, MAX_PERSISTED_SESSIONS);
  const active = activeSessionId ? sessions.find(s => s?.id === activeSessionId) : null;
  if (active && !keep.some(s => s?.id === active.id)) {
    keep = [active, ...keep.slice(0, MAX_PERSISTED_SESSIONS - 1)];
  }
  return keep.map(s => (
    Array.isArray(s?.messages) && s.messages.length > MAX_PERSISTED_MESSAGES
      ? { ...s, messages: s.messages.slice(-MAX_PERSISTED_MESSAGES) }
      : s
  ));
}

function saveSessions(sessions, activeSessionId = null) {
  let snapshot = buildPersistProjection(sessions, activeSessionId);
  try {
    localStorage.setItem('aiCopilotSessions', JSON.stringify(snapshot));
    return true;
  } catch { /* 配额爆，进入降级 */ }

  // 降级：逐轮淘汰最旧的非活跃会话重试（rest 按最旧在前）
  const rest = snapshot
    .filter(s => s?.id && s.id !== activeSessionId)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  const activeSession = activeSessionId
    ? snapshot.find(s => s?.id === activeSessionId) || null
    : null;
  for (let dropped = 1; dropped <= rest.length; dropped++) {
    snapshot = activeSession ? [activeSession, ...rest.slice(dropped)] : rest.slice(dropped);
    try {
      localStorage.setItem('aiCopilotSessions', JSON.stringify(snapshot));
      return true;
    } catch { /* 继续淘汰 */ }
  }

  // 终极兜底：只剩活跃会话还爆 → 截断活跃消息再试一次，仍失败则放弃（不抛错）
  if (activeSession) {
    try {
      const minimal = [{
        ...activeSession,
        messages: Array.isArray(activeSession.messages)
          ? activeSession.messages.slice(-ACTIVE_FALLBACK_MESSAGES)
          : activeSession.messages,
      }];
      localStorage.setItem('aiCopilotSessions', JSON.stringify(minimal));
      return true;
    } catch { /* 放弃本次落盘 */ }
  }
  return false;
}

/* v34：持久化节流——此前每个流式 delta 都全量 JSON.stringify(所有会话) + 同步写
 * localStorage，长会话下每秒几十次 MB 级序列化就是"流式一卡一卡"的性能真凶。
 * 改为 trailing 800ms 合帧落盘；页面隐藏/卸载前强制 flush 保证不丢。 */
let saveTimer = null;
let pendingSessionsSnapshot = null;
let pendingActiveSessionId = null;

function saveSessionsThrottled(sessions, activeSessionId) {
  pendingSessionsSnapshot = sessions;
  pendingActiveSessionId = activeSessionId;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pendingSessionsSnapshot) {
      saveSessions(pendingSessionsSnapshot, pendingActiveSessionId);
      pendingSessionsSnapshot = null;
      pendingActiveSessionId = null;
    }
  }, 800);
}

if (typeof document !== 'undefined') {
  const flushPending = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (pendingSessionsSnapshot) {
      saveSessions(pendingSessionsSnapshot, pendingActiveSessionId);
      pendingSessionsSnapshot = null;
      pendingActiveSessionId = null;
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
  window.addEventListener('beforeunload', flushPending);
}

/* ===== 多标签页同步（2026-09-22，治 last-write-wins 的盲区）=====
 * storage 事件只在「其他标签页」写入时触发（规范保证本页写入不通知自己），天然无回声；
 * 但吸收方若再走 setState 的 persist 分支，就会把吸收内容写回磁盘 → 源标签页又收到
 * 事件 → 循环震荡。因此吸收路径必须绕过持久化：只改内存 state + 通知 UI。
 * 吸收门槛（任一成立则忽略外部变更，本地权威）：
 *  - isStreaming：流式中 state 每帧都在变，吸收外部快照会打断进行中的渲染
 *  - 本地有 pending 未落盘写入：说明本地刚有更新即将覆盖磁盘，吸收反而回退 */
const SESSIONS_STORAGE_KEY = 'aiCopilotSessions';

/** 吸收外部标签页写入的快照（导出仅供单测；运行时由 storage 事件驱动）。 */
export function absorbExternalSessions(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue) return;
  if (sessionsStore.state.isStreaming) return;
  if (saveTimer || pendingSessionsSnapshot) return;
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return;
    sessionsStore.state = { ...sessionsStore.state, sessions: parsed };
    sessionsStore.notify();
  } catch { /* 外部数据损坏不传染本地 */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === SESSIONS_STORAGE_KEY) absorbExternalSessions(event.newValue);
  });
}

// ===== 模块级 sessions store：组件 unmount 后流式 fetch 继续，重新 mount 从 store 恢复 =====
const sessionsStore = {
  state: {
    sessions: loadSessions(),
    activeSessionId: null,
    isStreaming: false,
  },
  subscribers: new Set(),
  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); },
  notify() { this.subscribers.forEach(fn => fn(this.state)); },
  setState(patch) {
    this.state = { ...this.state, ...patch };
    // sessions 变化时持续写回 localStorage（即使组件已卸载）——v34 起走节流；
    // 2026-09-22 起带 activeSessionId 做存储投影 + 配额降级
    if (patch.sessions !== undefined) saveSessionsThrottled(patch.sessions, this.state.activeSessionId);
    this.notify();
  },
};

export { loadSessions, saveSessions, sessionsStore };
