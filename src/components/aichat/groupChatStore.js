/**
 * groupChatStore.js - 团队群聊状态（模块级单例，模式同 teamStore.js）
 *
 * 「一个人的公司」协作模型，v2 支持多群聊：
 * - chats：多个群聊（每个有自己的 roster + messages），可创建/切换/重命名/删除
 * - roster：群聊内已邀请的子代理 preset id 列表（explorer/researcher/writer/critic）
 * - messages：群聊消息流（user / agent 两类），所有成员共享同一份上下文
 * - running：当前群聊一轮接力是否在跑（UI 禁输入 + 流水线状态）
 * 持久化 localStorage 'agentTeamGroupChat'（v1 单群聊格式自动迁移）；subscribe 供 UI 同步。
 */

const STORAGE_KEY = 'agentTeamGroupChat';
const MAX_MESSAGES = 200;
const MAX_CHATS = 20;

function makeChat(name, roster = [], messages = []) {
  return {
    id: `gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || '').slice(0, 24) || '新团队群聊',
    createdAt: Date.now(),
    roster,
    messages,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    // v2 多群聊格式
    if (Array.isArray(parsed.chats)) {
      const chats = parsed.chats
        .filter(c => c && typeof c === 'object')
        .map(c => ({
          id: String(c.id || `gc_${Date.now().toString(36)}`),
          name: String(c.name || '新团队群聊').slice(0, 24),
          createdAt: Number(c.createdAt) || Date.now(),
          roster: Array.isArray(c.roster) ? c.roster : [],
          messages: Array.isArray(c.messages) ? c.messages : [],
        }));
      if (chats.length) {
        const activeId = chats.some(c => c.id === parsed.activeId) ? parsed.activeId : chats[0].id;
        return { chats, activeId, running: false };
      }
      return null;
    }
    // v1 单群聊格式迁移
    if (Array.isArray(parsed.roster) || Array.isArray(parsed.messages)) {
      const chat = makeChat('团队群聊', parsed.roster || [], parsed.messages || []);
      return { chats: [chat], activeId: chat.id, running: false };
    }
    return null;
  } catch { return null; }
}

const state = (() => {
  const loaded = load();
  if (loaded) return loaded;
  const chat = makeChat('团队群聊');
  return { chats: [chat], activeId: chat.id, running: false };
})();

const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn(state); } catch { /* ignore */ } });
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      chats: state.chats.map(c => ({
        ...c,
        messages: c.messages.slice(-MAX_MESSAGES),
      })),
      activeId: state.activeId,
    }));
  } catch { /* QuotaExceeded 等忽略 */ }
}

/** 当前激活群聊（兜底：activeId 失效回第一个；无群聊自动补一个） */
function activeChat() {
  let chat = state.chats.find(c => c.id === state.activeId);
  if (!chat) {
    chat = state.chats[0] || null;
    if (!chat) {
      chat = makeChat('团队群聊');
      state.chats = [chat];
    }
    state.activeId = chat.id;
  }
  return chat;
}

export function getGroupState() {
  activeChat(); // 惰性兜底
  return state;
}

/** 当前群聊的 {roster, messages}（组件层便捷读取） */
export function getActiveChat() {
  return activeChat();
}

export function subscribeGroup(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ============ 多群聊管理 ============ */

export function createChat(name) {
  if (state.chats.length >= MAX_CHATS) return null;
  const base = String(name || '').trim().slice(0, 24);
  let chatName = base || `团队群聊 ${state.chats.length + 1}`;
  // 同名追加序号
  if (state.chats.some(c => c.name === chatName)) {
    let i = 2;
    while (state.chats.some(c => c.name === `${chatName} ${i}`)) i += 1;
    chatName = `${chatName} ${i}`;
  }
  const chat = makeChat(chatName);
  state.chats = [...state.chats, chat];
  state.activeId = chat.id;
  state.running = false;
  persist();
  notify();
  return chat;
}

export function switchChat(chatId) {
  if (!state.chats.some(c => c.id === chatId)) return false;
  if (state.running) return false; // 接力执行中不允许切换（上下文会串）
  state.activeId = chatId;
  persist();
  notify();
  return true;
}

export function renameChat(chatId, name) {
  const trimmed = String(name || '').trim().slice(0, 24);
  if (!trimmed) return false;
  if (state.chats.some(c => c.id !== chatId && c.name === trimmed)) return false;
  state.chats = state.chats.map(c => (c.id === chatId ? { ...c, name: trimmed } : c));
  persist();
  notify();
  return true;
}

export function deleteChat(chatId) {
  if (state.chats.length <= 1) return false; // 至少保留一个
  if (state.running) {
    const cur = activeChat();
    if (cur?.id === chatId) return false; // 执行中的群聊不可删
  }
  const idx = state.chats.findIndex(c => c.id === chatId);
  if (idx === -1) return false;
  state.chats = state.chats.filter(c => c.id !== chatId);
  if (state.activeId === chatId) state.activeId = state.chats[Math.max(0, idx - 1)].id;
  persist();
  notify();
  return true;
}

/* ============ 当前群聊内容操作（roster / messages / running） ============ */

/** 邀请成员（preset id），去重，上限 6 人。
 *  注意：必须不可变更新（新数组引用）——组件层 useMemo 依赖 roster 引用，
 *  原地 push 会导致 UI 永远不刷新。 */
export function inviteMember(agentId) {
  const chat = activeChat();
  if (!agentId || chat.roster.includes(agentId) || chat.roster.length >= 6) return false;
  chat.roster = [...chat.roster, agentId];
  persist();
  notify();
  return true;
}

export function removeMember(agentId) {
  const chat = activeChat();
  if (!chat.roster.includes(agentId)) return false;
  chat.roster = chat.roster.filter(id => id !== agentId);
  persist();
  notify();
  return true;
}

/** 追加消息 { role:'user'|'agent', agentId?, agentName?, content, at, meta? }
 *  agent 占位消息允许 content 为空（status='running' 的气泡）——此前空 content 被误拒，
 *  导致占位创建返回 null、接力链路在读取 placeholder.id 时崩溃（群聊不回复 bug）。 */
export function addGroupMessage(msg) {
  if (!msg) return null;
  const isAgentPlaceholder = msg.role === 'agent' && msg.status === 'running';
  if (!isAgentPlaceholder && !msg.content && !msg.loading) return null;
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
  const chat = activeChat();
  chat.messages = [...chat.messages, entry];
  if (chat.messages.length > MAX_MESSAGES) chat.messages = chat.messages.slice(-MAX_MESSAGES);
  persist();
  notify();
  return entry;
}

/** 更新消息（流式占位 → 完成内容，不可变替换） */
export function updateGroupMessage(id, patch) {
  const chat = activeChat();
  const idx = chat.messages.findIndex(x => x.id === id);
  if (idx === -1) return null;
  chat.messages = chat.messages.map(m => (m.id === id ? { ...m, ...patch } : m));
  persist();
  notify();
  return chat.messages[idx];
}

/** 移除消息（失败重试占位清理） */
export function removeGroupMessage(id) {
  const chat = activeChat();
  const before = chat.messages.length;
  chat.messages = chat.messages.filter(m => m.id !== id);
  if (chat.messages.length !== before) { persist(); notify(); return true; }
  return false;
}

export function setGroupRunning(v) {
  state.running = Boolean(v);
  notify();
}

export function clearGroupChat() {
  const chat = activeChat();
  chat.messages = [];
  persist();
  notify();
}
