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
/* 空间关联文件限制：元数据+截断后的内容一起持久化，防 localStorage 配额爆炸 */
const MAX_FILES_PER_SPACE = 30;
const MAX_FILE_CONTENT_CHARS = 16_000;

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

/* ============================================================
   空间 × 本地文件（工作空间以本地文件为核心）
   - space.rootName：空间绑定的本地根目录名（handle 本体在 IndexedDB，
     槽位 key = spaceId，见 utils/workspace.js）
   - space.files：关联文件 [{ name, path, content?, truncated? }]，
     content 截断持久化，供对话上下文直接使用
   ============================================================ */

function findSpace(spaceId) {
  return state.spaces.find(s => s.id === spaceId) || null;
}

/** 空间绑定/换绑本地根目录（记录目录名元数据） */
export function setSpaceRoot(spaceId, rootName) {
  const space = findSpace(spaceId);
  if (!space) return false;
  space.rootName = String(rootName || '').slice(0, 60);
  persist();
  notify();
  return true;
}

/**
 * 关联文件到空间（合并去重，按 path）。
 * @param {Array<{name,path,content?}>} files
 * @returns {number} 关联后的文件总数；失败返回 -1
 */
export function associateFiles(spaceId, files) {
  const space = findSpace(spaceId);
  if (!space || !Array.isArray(files)) return -1;
  if (!Array.isArray(space.files)) space.files = [];
  const byPath = new Map(space.files.map(f => [f.path, f]));
  files.forEach(f => {
    if (!f?.path) return;
    const content = typeof f.content === 'string' ? f.content : '';
    const truncated = content.length > MAX_FILE_CONTENT_CHARS;
    byPath.set(f.path, {
      name: String(f.name || f.path.split('/').pop() || 'file').slice(0, 120),
      path: String(f.path).slice(0, 300),
      content: truncated ? content.slice(0, MAX_FILE_CONTENT_CHARS) : content,
      truncated,
      associatedAt: Date.now(),
    });
  });
  space.files = [...byPath.values()]
    .sort((a, b) => (b.associatedAt || 0) - (a.associatedAt || 0))
    .slice(0, MAX_FILES_PER_SPACE);
  persist();
  notify();
  return space.files.length;
}

/** 解除关联 */
export function removeSpaceFile(spaceId, path) {
  const space = findSpace(spaceId);
  if (!space || !Array.isArray(space.files)) return false;
  const before = space.files.length;
  space.files = space.files.filter(f => f.path !== path);
  if (space.files.length !== before) {
    persist();
    notify();
    return true;
  }
  return false;
}

/** 清空空间的关联文件（换绑目录时用） */
export function clearSpaceFiles(spaceId) {
  const space = findSpace(spaceId);
  if (!space) return false;
  space.files = [];
  persist();
  notify();
  return true;
}
