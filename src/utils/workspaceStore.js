/**
 * workspaceStore.js - AI 工作站多工作空间（对标 WorkBuddy「空间」）
 *
 * 会话原来是一整条扁平列表，无法归属项目。本 store 引入「空间」概念：
 * - 每个会话通过 session.spaceId 归属一个空间；侧边栏按空间折叠展示
 * - 空间 CRUD + 激活空间切换；删除空间时会话自动迁回默认空间（不丢数据）
 * - 模块级单例 + localStorage 'aiWorkstationSpaces' 持久化 + subscribe 同步 UI
 *
 * 会话字段扩展（在 sessionsStore 原有结构上增量，向后兼容）：
 * - session.spaceId: string  会话所属空间
 * - session.pinned: boolean  置顶（在所属空间内置顶展示）
 */

const STORAGE_KEY = 'aiWorkstationSpaces';
const DEFAULT_SPACE_ID = 'default';
const MAX_SPACES = 20;

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.spaces) ? parsed : null;
  } catch { return null; }
}

const state = (() => {
  const loaded = loadFromStorage();
  const spaces = loaded?.spaces?.length
    ? loaded.spaces
    : [{ id: DEFAULT_SPACE_ID, name: '默认空间', createdAt: Date.now() }];
  // 兜底：默认空间被外部数据破坏时补回
  if (!spaces.some(s => s.id === DEFAULT_SPACE_ID)) {
    spaces.unshift({ id: DEFAULT_SPACE_ID, name: '默认空间', createdAt: Date.now() });
  }
  return {
    spaces,
    activeSpaceId: loaded?.activeSpaceId && spaces.some(s => s.id === loaded.activeSpaceId)
      ? loaded.activeSpaceId
      : DEFAULT_SPACE_ID,
  };
})();

const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn(state); } catch { /* ignore */ } });
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      spaces: state.spaces,
      activeSpaceId: state.activeSpaceId,
    }));
  } catch { /* QuotaExceededError 等忽略 */ }
}

export function getSpaces() {
  return state.spaces;
}

export function getActiveSpaceId() {
  return state.activeSpaceId;
}

export function getSpace(spaceId) {
  return state.spaces.find(s => s.id === spaceId) || null;
}

export function getDefaultSpaceId() {
  return DEFAULT_SPACE_ID;
}

export function subscribeSpaces(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setActiveSpace(spaceId) {
  if (!state.spaces.some(s => s.id === spaceId)) return;
  state.activeSpaceId = spaceId;
  persist();
  notify();
}

export function createSpace(name) {
  const trimmed = String(name || '').trim().slice(0, 24);
  if (!trimmed) return null;
  if (state.spaces.some(s => s.name === trimmed)) return null; // 同名去重
  if (state.spaces.length >= MAX_SPACES) return null;
  const space = {
    id: `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    name: trimmed,
    createdAt: Date.now(),
  };
  state.spaces.push(space);
  state.activeSpaceId = space.id; // 新建即激活，符合「建了就进去用」直觉
  persist();
  notify();
  return space;
}

export function renameSpace(spaceId, name) {
  const trimmed = String(name || '').trim().slice(0, 24);
  const space = state.spaces.find(s => s.id === spaceId);
  if (!space || !trimmed) return false;
  if (spaceId === DEFAULT_SPACE_ID) return false; // 默认空间不可改名
  if (state.spaces.some(s => s.id !== spaceId && s.name === trimmed)) return false;
  space.name = trimmed;
  persist();
  notify();
  return true;
}

/** 删除空间：其下会话迁回默认空间（由调用方执行会话迁移，这里只管空间本身） */
export function deleteSpace(spaceId) {
  if (spaceId === DEFAULT_SPACE_ID) return false;
  const idx = state.spaces.findIndex(s => s.id === spaceId);
  if (idx === -1) return false;
  state.spaces.splice(idx, 1);
  if (state.activeSpaceId === spaceId) state.activeSpaceId = DEFAULT_SPACE_ID;
  persist();
  notify();
  return true;
}

/**
 * 会话空间归属迁移（幂等）：
 * 老会话没有 spaceId → 归入默认空间；spaceId 指向已删除空间 → 迁回默认空间。
 * @returns {Array|null} 有变更时返回新会话数组（调用方 setSessions），否则 null
 */
export function migrateSessionSpaces(sessions) {
  if (!Array.isArray(sessions)) return null;
  let changed = false;
  const validIds = new Set(state.spaces.map(s => s.id));
  const next = sessions.map(s => {
    if (!s.spaceId || !validIds.has(s.spaceId)) {
      changed = true;
      return { ...s, spaceId: DEFAULT_SPACE_ID };
    }
    return s;
  });
  return changed ? next : null;
}
