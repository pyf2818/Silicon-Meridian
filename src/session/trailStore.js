/**
 * trailStore.js - 会话树持久化（对标 pi 的 session manager，localStorage 实现）
 *
 * 以「根会话 -> 树节点」的方式存储会话树，兼容现有老式线性会话（导入时转单链）。
 * 存储结构（localStorage key: ai-elf-trails）：
 *   {
 *     "<sessionId>": {
 *       title, createdAt, updatedAt,
 *       messages: [ { id, parentId, role, content, toolCalls?, thinking?, createdAt } ],
 *       activeLeafId: "<id>",   // 当前显示/继续的分支叶子
 *       children: { "<leafId>": { label?, createdAt } }  // 可切换分支的标签（可选）
 *     }
 *   }
 *
 * 对外 API：
 *   loadTrail / saveTrail / resetTrails
 *   switchLeaf(id, leafId) / branchHere(id, newMsgs)
 *   trailMessages(id)  // 从 activeLeaf 回溯的消息列表（可直接发给 UI 展示）
 * 全量按 sessionId 隔离，最大保留最近 10 个会话（防 localStorage 膨胀）。
 */

import { getActivePath, normalizeMessage, makeBranch, getLeafIds, linearToTrail } from './trail.js';

const STORAGE_KEY = 'aiTrails';
const MAX_TRAILS = 10;

/** 从 localStorage 加载全部 trail。解析失败安全返回 {}。 */
function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/**
 * 从「线性消息数组」（历代格式）构造一棵 trail 树。
 * 兼容点：不报错，旧的 agentMessages/agentHistory 线性结构可被无损迁移。
 */
export function ensureTrail(sessionId, legacyMessages = []) {
  const all = loadRaw();
  const existing = all[sessionId];
  if (existing && Array.isArray(existing.messages) && existing.messages.length > 0) {
    return existing;
  }
  const messages = legacyMessages.map(m => normalizeMessage(m, { parentId: null }));
  const trail = {
    title: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages,
    activeId: messages.length ? messages[messages.length - 1].id : null, // 默认选中最后叶子
  };
  all[sessionId] = trail;
  // 修剪超过上限的旧会话
  const keys = Object.keys(all);
  if (keys.length > MAX_TRAILS) {
    const sorted = keys.sort((a, b) => (all[a].updatedAt || 0) - (all[b].updatedAt || 0));
    for (const k of sorted.slice(0, keys.length - MAX_TRAILS)) delete all[k];
  }
  save(all);
  return trail;
}

function persistAll(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* QuotaExceeded */ }
}

export function saveTrail(sessionId, trail) {
  const all = loadRaw();
  all[sessionId] = { ...(all[sessionId] || {}), ...trail, updatedAt: Date.now() };
  persistAll(all);
  return all[sessionId];
}

export function getTrail(sessionId) {
  return loadRaw()[sessionId] || null;
}

export function getActiveTrailPath(sessionId) {
  const trail = getTrail(sessionId);
  if (!trail) return [];
  return getActivePath(trail.messages, trail.activeId);
}

/** 切换某条消息为新的活动叶子（/tree 用）。 */
export function switchLeaf(sessionId, leafId) {
  const all = loadRaw();
  const trail = all[sessionId];
  if (!trail) return false;
  const path = getActivePath(trail.messages, leafId);
  if (!path.length) return false;
  trail.activeId = leafId;
  trail.updatedAt = Date.now();
  persistAll(all);
  return true;
}

/**
 * 在某锚点下追加新分支消息：
 *  - 若锚点是当前活动叶子，等价于「继续对话」（parentId 链延伸）
 *  - 若锚点是历史节点，则从这里分叉，形成新活动分支
 * 返回新活动 leafId（即最后一条新消息 id）。
 */
export function branchHere(sessionId, anchorId, newMsgs) {
  const all = loadRaw();
  const trail = all[sessionId];
  if (!trail || !Array.isArray(trail.messages)) return null;
  const { branch, anchorPath } = makeBranch(trail.messages, anchorId, newMsgs);
  if (!branch.length) return null;
  // 归并分支到树：把 branch（路径+新消息）合并进 messages（原子替换同 id）
  const merged = mergeBranches(trail.messages, branch);
  trail.messages = merged;
  const lastNew = branch[branch.length - 1];
  trail.activeId = lastNew.id;
  trail.updatedAt = Date.now();
  persistAll(all);
  return lastNew.id;
}

/** 把一条「路径+新消息」的分支合并进树（保留树中已有节点）。 */
export function mergeBranches(existing, branch) {
  const byId = new Map();
  for (const m of existing) byId.set(m.id, m);
  for (const m of branch) byId.set(m.id, m); // 覆盖（用分支节点）
  return [...byId.values()];
}

/**
 * 把一段「线性会话」转成会话树，并从某条消息处 fork 出一条新分支会话。
 * 用于 AI 对话的「从此处继续」（pi /tree + fork 的最小落地）。
 *
 * 语义（/fork 对齐）：用户对第 anchor 条消息说「从这里继续」，那么
 *   新会话 = 保留 anchor 之前的全部消息 + anchor 本条 作为上下文起点，
 *   之后的旧内容丢弃，用户从此继续。
 *
 * 返回：{ messages, anchorIndex, parentId }
 *   - messages 为带 parentId 的树形单链；首条 parentId=null
 * @param {Object} session { id, title?, messages[] }
 * @param {Object} [opts]
 * @param {number} [opts.anchorIndex] - 锚点（优先级高；消息无 id 场景）
 * @param {string} [opts.anchorMessageId] - 锚点消息 id
 * @param {boolean} [opts.keepOnlyFromAnchor=null] - true=保留「锚点及之后」为分支根
 * （与默认「保留锚点及之前」相反）。
 */
export function forkLinearSession(session, { anchorMessageId = null, anchorIndex = -1, keepOnlyFromAnchor = false } = {}) {
  const raw = Array.isArray(session?.messages) ? session.messages : [];
  const trail = linearToTrail(raw);
  if (!trail.length) {
    return { messages: [], anchorIndex: -1, parentId: null };
  }
  // 解析锚点位置
  let anchorAt = -1;
  if (anchorIndex >= 0 && anchorIndex < trail.length) {
    anchorAt = anchorIndex;
  } else if (anchorMessageId) {
    anchorAt = trail.findIndex(m => m.id === anchorMessageId || String(m.id) === String(anchorMessageId));
  }
  // 无锚点 -> 直接复用全链（相当于复制整个会话）
  if (anchorAt < 0) {
    return { messages: trail.map(m => ({ ...m })), anchorIndex: -1, parentId: trail[0]?.id || null };
  }
  // 分支起点：默认保留 [0..anchor]（历史 + 锚点=上下文根）；keepOnlyFromAnchor 时保留 [anchor..]
  const sliceFrom = keepOnlyFromAnchor ? anchorAt : 0;
  const sliced = trail.slice(sliceFrom, keepOnlyFromAnchor ? undefined : anchorAt + 1);
  if (sliced.length) sliced[0] = { ...sliced[0], parentId: null };
  return { messages: sliced, anchorIndex: anchorAt, parentId: sliced[0]?.id || null };
}

/** 供调试/测试：清空全部 trail。 */
export function clearTrails() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/** 取得所有会话的可切换叶子（供 /tree 选择器渲染）。 */
export function listLeafOptions(sessionId) {
  const trail = getTrail(sessionId);
  if (!trail) return [];
  return getLeafIds(trail.messages).map(id => {
    const node = trail.messages.find(m => m.id === id);
    return { id, content: node?.content?.slice(0, 40) || '', role: node?.role };
  });
}

// 兼容：normalizeMessage 导出供外部（AiElf 集成点）复用
export { normalizeMessage };