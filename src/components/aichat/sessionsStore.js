function loadSessions() {
  try {
    const raw = localStorage.getItem('aiCopilotSessions');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions) {
  try { localStorage.setItem('aiCopilotSessions', JSON.stringify(sessions)); } catch {}
}

/* v34：持久化节流——此前每个流式 delta 都全量 JSON.stringify(所有会话) + 同步写
 * localStorage，长会话下每秒几十次 MB 级序列化就是"流式一卡一卡"的性能真凶。
 * 改为 trailing 800ms 合帧落盘；页面隐藏/卸载前强制 flush 保证不丢。 */
let saveTimer = null;
let pendingSessionsSnapshot = null;

function saveSessionsThrottled(sessions) {
  pendingSessionsSnapshot = sessions;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pendingSessionsSnapshot) {
      saveSessions(pendingSessionsSnapshot);
      pendingSessionsSnapshot = null;
    }
  }, 800);
}

if (typeof document !== 'undefined') {
  const flushPending = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (pendingSessionsSnapshot) {
      saveSessions(pendingSessionsSnapshot);
      pendingSessionsSnapshot = null;
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
  window.addEventListener('beforeunload', flushPending);
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
    // sessions 变化时持续写回 localStorage（即使组件已卸载）——v34 起走节流
    if (patch.sessions !== undefined) saveSessionsThrottled(patch.sessions);
    this.notify();
  },
};

export { loadSessions, saveSessions, sessionsStore };
