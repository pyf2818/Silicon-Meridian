/**
 * groupChatStore.js - 团队群聊状态（模块级单例，模式同 teamStore.js）
 *
 * 「一个人的公司」协作模型，v3 支持多群聊 + 角色灵魂：
 * - chats：多个群聊（每个有自己的 roster + messages + profiles），可创建/切换/重命名/解散
 * - roster：群聊内已邀请的成员 id 列表（内置 preset id 或自定义角色 id）
 * - profiles：成员性格档案（id → { name?, description?, style? }，内置角色的个性化覆盖）
 * - customRoles：自定义角色库（localStorage 持久化，保存即可邀请入群）
 * - messages：群聊消息流（user / agent / system 三类；system 为居中系统行，
 *   承载群生命周期与流水线事件，不进 LLM 白板），所有成员共享同一份上下文
 * - announcement：群公告（团队目标），右侧群信息面板编辑
 * - running：当前群聊一轮流水线是否在跑（UI 禁输入 + 流水线状态）
 * 持久化 localStorage 'agentTeamGroupChat'（v1/v2 格式自动迁移）；subscribe 供 UI 同步。
 */

import { SUBAGENT_PRESETS } from '../../domain/agent/subagentCore.js';

const STORAGE_KEY = 'agentTeamGroupChat';
const CUSTOM_ROLES_KEY = 'agentTeamCustomRoles';
const MAX_MESSAGES = 200;
const MAX_CHATS = 20;
const MAX_CUSTOM_ROLES = 24;

/* ---------- 自定义角色库 ---------- */

/** 自定义角色默认工具白名单（读为主，可写工作空间） */
const DEFAULT_ROLE_TOOLS = [
  'search_news', 'web_search', 'fetch_page', 'read_workspace_file',
  'list_knowledge', 'read_intelligence_focus',
];

function loadCustomRoles() {
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(r => r && typeof r === 'object' && r.id && r.name)
      .slice(0, MAX_CUSTOM_ROLES)
      .map(r => ({
        id: String(r.id),
        name: String(r.name).slice(0, 16),
        description: String(r.description || '').slice(0, 300),
        style: String(r.style || '').slice(0, 500),
        tools: Array.isArray(r.tools) && r.tools.length ? r.tools.slice(0, 16) : null, // null = 用默认白名单
        createdAt: Number(r.createdAt) || Date.now(),
      }));
  } catch { return []; }
}

let customRoles = loadCustomRoles();
const roleListeners = new Set();

function notifyRoles() {
  roleListeners.forEach(fn => { try { fn([...customRoles]); } catch { /* ignore */ } });
}

function persistRoles() {
  try { localStorage.setItem(CUSTOM_ROLES_KEY, JSON.stringify(customRoles)); } catch { /* ignore */ }
}

/** 自定义角色 → 可执行 preset（补全工具白名单/轮次/systemPrompt，注入性格风格） */
export function customRoleToPreset(role) {
  const styleLine = role.style ? `\n【性格与风格】${role.style}` : '';
  return {
    id: role.id,
    name: role.name,
    description: role.description || '团队自定义成员',
    style: role.style || '', // 回传给角色卡回显（保存时不能丢）
    systemPrompt: [
      `你是「${role.name}」，团队群聊中的成员（创始人创建的自定义角色）。`,
      role.description ? `角色职责：${role.description}` : '',
      role.style ? `性格与说话风格：${role.style}。回复必须体现这个性格，让人一眼认出是你。` : '',
      '工作准则：基于群聊共享上下文完成你职责内的事；输出为结构化 Markdown；不越俎代庖，与队友互补而不是重复。',
    ].filter(Boolean).join('\n') + styleLine,
    tools: role.tools || DEFAULT_ROLE_TOOLS,
    maxTurns: 6,
  };
}

export function getCustomRoles() {
  return [...customRoles];
}

/** 创建/更新自定义角色。role.id 存在则更新，否则创建；返回保存后的角色。 */
export function saveCustomRole(role) {
  const name = String(role?.name || '').trim().slice(0, 16);
  if (!name) return null;
  const id = role?.id && customRoles.some(r => r.id === role.id)
    ? role.id
    : `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const saved = {
    id,
    name,
    description: String(role?.description || '').trim().slice(0, 300),
    style: String(role?.style || '').trim().slice(0, 500),
    tools: Array.isArray(role?.tools) && role.tools.length ? role.tools.slice(0, 16) : null,
    createdAt: Date.now(),
  };
  const exists = customRoles.some(r => r.id === id);
  customRoles = exists
    ? customRoles.map(r => (r.id === id ? saved : r))
    : [...customRoles, saved].slice(-MAX_CUSTOM_ROLES);
  persistRoles();
  notifyRoles();
  return saved;
}

/** 删除自定义角色，并从所有群聊 roster 中移除引用 */
export function deleteCustomRole(roleId) {
  if (!customRoles.some(r => r.id === roleId)) return false;
  customRoles = customRoles.filter(r => r.id !== roleId);
  state.chats = state.chats.map(c => (
    c.roster.includes(roleId) ? { ...c, roster: c.roster.filter(x => x !== roleId) } : c
  ));
  persistRoles();
  persist();
  notifyRoles();
  notify();
  return true;
}

export function subscribeCustomRoles(fn) {
  roleListeners.add(fn);
  return () => roleListeners.delete(fn);
}

function makeChat(name, roster = [], messages = []) {
  return {
    id: `gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || '').slice(0, 24) || '新团队群聊',
    createdAt: Date.now(),
    announcement: '', // 群公告（团队目标），右侧群信息面板编辑
    roster,
    profiles: {}, // 成员性格档案：agentId → { name?, description?, style? }
    messages,
  };
}

/** 成员头像色相池；群聊/侧栏共用 */
export const MEMBER_HUES = [190, 150, 40, 280, 20, 330];

/** 稳定字符串哈希（头像色相/群头像派生用） */
export function hashStr(s) {
  const str = String(s || '');
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

/** 成员头像色相：按成员 id 哈希取色 —— 全局稳定（不随入群顺序/群聊不同而漂移） */
export function hueOfMemberId(id) {
  return MEMBER_HUES[hashStr(id) % MEMBER_HUES.length];
}

/** 群聊头像底色：按群 id 哈希 —— 群的视觉身份稳定，不随成员/消息变化 */
export function hueOfChat(id) {
  return MEMBER_HUES[hashStr(`chat_${id}`) % MEMBER_HUES.length];
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
          announcement: String(c.announcement || '').slice(0, 600),
          roster: Array.isArray(c.roster) ? c.roster : [],
          profiles: (c.profiles && typeof c.profiles === 'object' && !Array.isArray(c.profiles)) ? c.profiles : {},
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
  pushEvent(chat.id, `创建了群聊「${chat.name}」`);
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
  const prev = state.chats.find(c => c.id === chatId);
  if (!prev || prev.name === trimmed) return false;
  state.chats = state.chats.map(c => (c.id === chatId ? { ...c, name: trimmed } : c));
  pushEvent(chatId, `群聊「${prev.name}」更名为「${trimmed}」`);
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
  const preset = getAllRolePresets().find(p => p.id === agentId);
  chat.roster = [...chat.roster, agentId];
  pushEvent(chat.id, `邀请了「${preset?.name || agentId}」加入群聊`);
  persist();
  notify();
  return true;
}

export function removeMember(agentId) {
  const chat = activeChat();
  if (!chat.roster.includes(agentId)) return false;
  const preset = getAllRolePresets().find(p => p.id === agentId);
  chat.roster = chat.roster.filter(id => id !== agentId);
  pushEvent(chat.id, `「${preset?.name || agentId}」被请出了群聊`);
  persist();
  notify();
  return true;
}

/* ============ 群公告（团队目标 = 环境设定） ============ */

/** 读写当前群聊的群公告（右侧群信息面板编辑，最长 600 字）。
 *  公告是环境设定：保存后立即以系统行发进群里让成员注意，
 *  且每轮协作注入成员上下文（buildSharedTranscript 的调用方负责带上）。 */
export function setChatAnnouncement(text) {
  const chat = activeChat();
  const next = String(text || '').trim().slice(0, 600);
  if (next === (chat.announcement || '')) return false;
  chat.announcement = next;
  pushEvent(chat.id, next
    ? `📌 更新了群公告，请各位成员注意：\n${next}`
    : '清空了群公告');
  persist();
  notify();
  return true;
}

/* ============ 成员性格档案（灵魂设定） ============ */

/** 读写当前群聊内某成员的性格档案覆盖 { name?, description?, style? } */
export function setMemberProfile(agentId, patch) {
  const chat = activeChat();
  if (!chat.profiles) chat.profiles = {}; // v2 旧数据兜底
  const prev = chat.profiles[agentId] || {};
  const next = { ...prev, ...(patch || {}) };
  // 空档案清除，避免无限膨胀
  if (!next.name && !next.description && !next.style) {
    const { [agentId]: _, ...rest } = chat.profiles;
    chat.profiles = rest;
  } else {
    chat.profiles = { ...chat.profiles, [agentId]: next };
  }
  persist();
  notify();
  return chat.profiles[agentId] || null;
}

export function getMemberProfile(agentId) {
  const chat = activeChat();
  return (chat.profiles && chat.profiles[agentId]) || null;
}

/** 全部可选角色（内置 preset + 自定义角色转 preset），供邀请菜单/渲染使用 */
export function getAllRolePresets() {
  return [...SUBAGENT_PRESETS, ...customRoles.map(customRoleToPreset)];
}

/**
 * 解析某成员的**生效 preset**：内置/自定义本体 + 当前群聊 profile 覆盖。
 * 性格风格注入 systemPrompt（runToolLoop 层），两个阶段都会带上灵魂。
 */
export function resolveMemberPreset(agentId) {
  const custom = customRoles.find(r => r.id === agentId);
  const base = SUBAGENT_PRESETS.find(p => p.id === agentId) || (custom ? customRoleToPreset(custom) : null);
  if (!base) return null;
  const profile = getMemberProfile(agentId) || {};
  const preset = { ...base, maxTurns: base.maxTurns || 6 };
  if (profile.name) preset.name = profile.name;
  if (profile.description) {
    preset.description = profile.description;
    // 内置角色的职责覆盖：替换 systemPrompt 里的自我介绍首段
    if (!custom) {
      preset.systemPrompt = `${base.systemPrompt}\n【职责覆盖（创始人设定）】${profile.description}`;
    }
  }
  if (profile.style) {
    preset.systemPrompt = `${preset.systemPrompt}\n【性格与风格（创始人设定）】${profile.style}。回复必须体现这个性格，让人一眼认出是你。`;
    preset.styleOverride = profile.style; // 角色卡回显用
  }
  return preset;
}

/** 群生命周期事件 → role:'system' 消息（居中灰色系统行，微信"XX加入了群聊"同款）。
 *  落到指定群聊（可非当前激活群），不计入 LLM 共享白板（buildSharedTranscript 过滤）。 */
function pushEvent(chatId, content) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat || !content) return;
  const entry = {
    id: `gm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'system',
    agentId: '',
    agentName: '',
    content: String(content).slice(0, 300),
    at: Date.now(),
    status: 'done',
    meta: null,
  };
  chat.messages = [...chat.messages, entry];
  if (chat.messages.length > MAX_MESSAGES) chat.messages = chat.messages.slice(-MAX_MESSAGES);
}

/** 追加消息 { role:'user'|'agent'|'system', agentId?, agentName?, content, at, meta? }
 *  agent 占位消息允许 content 为空（status='running' 的气泡）——此前空 content 被误拒，
 *  导致占位创建返回 null、接力链路在读取 placeholder.id 时崩溃（群聊不回复 bug）。
 *  system 消息是居中系统行（群生命周期/流水线事件），必须有 content。 */
export function addGroupMessage(msg) {
  if (!msg) return null;
  const isAgentPlaceholder = msg.role === 'agent' && msg.status === 'running';
  if (!isAgentPlaceholder && !msg.content && !msg.loading) return null;
  const entry = {
    id: `gm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    role: msg.role === 'agent' ? 'agent' : msg.role === 'system' ? 'system' : 'user',
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
