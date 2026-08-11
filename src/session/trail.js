/**
 * trail.js - 会话树（对标 pi 的 session tree：id + parentId 就地分支）
 *
 * 现有智能体会话是「线性数组」：新消息永远 append 到末尾，没有分支/回溯概念。
 * pi 的核心建模是每条消息带 id + parentId，形成一棵树：
 *   - /tree 可在任意历史节点重新分支继续
 *   - /fork /clone 从一个旧节点复制出一条新分支
 *   - 分支之间互不影响
 *
 * 本模块是纯逻辑（无 localStorage / 无 React），存储层在 trailStore.js。
 * message 形态：
 *   { id, parentId, role, content, toolCalls?, thinking?, createdAt, ...extra }
 *
 * 兼容性：旧会话（线性数组）可在导入时「补全 parentId」为一条单链，不破坏专有 UI。
 */

/** 生成短 id（与项目现有 h_/t_ 前缀风格一致，避免与工具/任务 id 撞名） */
export function genTrailId(prefix = 'm') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 归一化一条消息：补全缺省字段。overrideParent=true 时强制用调用方给的 parentId。 */
export function normalizeMessage(msg, { parentId = null, overrideParent = false } = {}) {
  const source = msg && typeof msg === 'object' ? msg : {};
  const normalized = {
    id: source.id || genTrailId(),
    role: source.role === 'tool' ? 'tool' : (source.role === 'assistant' ? 'assistant' : 'user'),
    content: String(source.content ?? ''),
    createdAt: source.createdAt ?? Date.now(),
  };
  if (source.toolCalls) normalized.toolCalls = source.toolCalls;
  if (source.thinking) normalized.thinking = source.thinking;
  if (source.meta) normalized.meta = source.meta;
  // parentId：优先已有（除非 overrideParent），否则用调用方 parentId
  normalized.parentId = (source.parentId != null && !overrideParent) ? source.parentId : parentId;
  return normalized;
}

/** 追加一条消息，parent 默认接在 last.id 之后 */
export function appendMessage(messages, msg, { previousId = null } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const parentId = (msg?.parentId != null && !previousId) ? msg.parentId : (previousId ?? list[list.length - 1]?.id ?? null);
  return [...list, normalizeMessage(msg, { parentId })];
}

/** 单链：把线性数组就地补成一条 parentId 链（迁移旧数据用） */
export function linearToTrail(messages) {
  let prev = null;
  return (messages || []).map((m, i) => {
    const node = normalizeMessage(m, { parentId: prev, overrideParent: true });
    if (i === 0) node.id = node.id || genTrailId();
    prev = node.id;
    return node;
  });
}

/**
 * 计算某 id 的「完整活动路径」：从根一路到该节点（含该节点）。
 * 找不到叶子返回 []。
 */
export function getActivePath(messages, leafId) {
  if (!Array.isArray(messages) || !leafId) return [];
  const byId = new Map();
  for (const m of messages) byId.set(m.id, m);
  const path = [];
  let cur = byId.get(leafId);
  const seen = new Set(); // 防环
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/**
 * 从某节点派生新分支：返回「锚点路径 + 新消息」，供调用方写入存储。
 * 不修改原树。新消息的 parent 依次为锚点 -> 上一条新消息。
 */
export function makeBranch(messages, anchorId, newMsgs) {
  const activePath = getActivePath(messages, anchorId);
  if (activePath.length === 0) return { branch: [], anchorId, anchorPath: [] };
  const anchor = activePath[activePath.length - 1];
  const branch = [...activePath];
  let parentId = anchor.id;
  for (const m of newMsgs || []) {
    const node = normalizeMessage(m, { parentId, overrideParent: true });
    branch.push(node);
    parentId = node.id;
  }
  return { branch, anchorId, anchorPath: activePath };
}

/** 找出所有「叶子」节点 id（无子节点的节点）。 */
export function getLeafIds(messages) {
  const hasChild = new Set();
  for (const m of messages || []) {
    if (m.parentId != null) hasChild.add(m.parentId);
  }
  return (messages || []).filter(m => !hasChild.has(m.id)).map(m => m.id);
}

/** 以某节点为活动叶子，返回应展示的有序消息（即 getActivePath） */
export function activeTrail(messages, leafId) {
  return getActivePath(messages, leafId);
}