/**
 * groupChatStore.js - Agent Team 群聊状态（模块级单例，模式同 teamStore.js）
 *
 * 「一个人的公司」协作模型：
 * - roster：已邀请进群的子代理 preset id 列表（explorer/researcher/writer/critic）
 * - messages：群聊消息流（user / agent 两类），所有成员共享同一份上下文
 * - running：当前一轮接力是否在跑（UI 禁输入 + 流水线状态）
 * 持久化 localStorage 'agentTeamGroupChat'；subscribe 供 UI 同步。
 */

const STORAGE_KEY = 'agentTeamGroupChat';
const MAX_MESSAGES = 200;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object'
      ? { roster: Array.isArray(parsed.roster) ? parsed.roster : [], messages: Array.isArray(parsed.messages) ? parsed.messages : [] }
      : { roster: [], messages: [] };
  } catch { return { roster: [], messages: [] }; }
}

const state = load();
const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn(state); } catch { /* ignore */ } });
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      roster: state.roster,
      messages: state.messages.slice(-MAX_MESSAGES),
    }));
  } catch { /* QuotaExceeded 等忽略 */ }
}

export function getGroupState() {
  return state;
}

export function subscribeGroup(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 邀请成员（preset id），去重，上限 6 人。
 *  注意：必须不可变更新（新数组引用）——组件层 useMemo 依赖 roster 引用，
 *  原地 push 会导致 UI 永远不刷新。 */
export function inviteMember(agentId) {
  if (!agentId || state.roster.includes(agentId) || state.roster.length >= 6) return false;
  state.roster = [...state.roster, agentId];
  persist();
  notify();
  return true;
}

export function removeMember(agentId) {
  if (!state.roster.includes(agentId)) return false;
  state.roster = state.roster.filter(id => id !== agentId);
  persist();
  notify();
  return true;
}

/** 追加消息 { role:'user'|'agent', agentId?, agentName?, content, at, meta? } */
export function addGroupMessage(msg) {
  if (!msg?.content && !msg?.loading) return null;
  const entry = {
    id: `gm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    role: msg.role === 'agent' ? 'agent' : 'user',
    agentId: msg.agentId || '',
    agentName: msg.agentName || '',
    content: String(msg.content || ''),
    at: msg.at || Date.now(),
    status: msg.status || 'done',
    meta: msg.meta || null,
  };
  state.messages = [...state.messages, entry];
  if (state.messages.length > MAX_MESSAGES) state.messages = state.messages.slice(-MAX_MESSAGES);
  persist();
  notify();
  return entry;
}

/** 更新消息（流式占位 → 完成内容，不可变替换） */
export function updateGroupMessage(id, patch) {
  const idx = state.messages.findIndex(x => x.id === id);
  if (idx === -1) return null;
  state.messages = state.messages.map(m => m.id === id ? { ...m, ...patch } : m);
  persist();
  notify();
  return state.messages[idx];
}

/** 移除消息（失败重试占位清理） */
export function removeGroupMessage(id) {
  const before = state.messages.length;
  state.messages = state.messages.filter(m => m.id !== id);
  if (state.messages.length !== before) { persist(); notify(); return true; }
  return false;
}

export function setGroupRunning(v) {
  state.running = Boolean(v);
  notify();
}

export function clearGroupChat() {
  state.messages = [];
  persist();
  notify();
}
