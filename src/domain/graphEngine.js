/**
 * graphEngine.js - 知识图谱数据构造（纯逻辑，无 DOM 依赖，可单测）
 *
 * 把素材库转成力导向图数据：
 * - 素材节点（id = 素材 id）
 * - tag 节点（id = `tag:xxx`，避免与素材 id 冲突），val 反映被引用次数
 * - 边：素材 ↔ 共享标签
 *
 * 独立为纯 JS 模块，使其可在 node/vitest 环境中 import（不含 React/canvas）。
 */
export const TYPE_COLORS = {
  viewpoint: '#6aa0ff',
  case: '#22c55e',
  knowledge: '#f59e0b',
  material: '#94a3b8',
  default: '#64748b',
};

/**
 * @param {Array} materials 素材列表（含 id/title/type/tags）
 * @param {Object} [opts]
 * @param {number} [opts.maxNodes] 最多纳入多少素材（避免图过密，缺省 120）
 * @returns {{nodes: Array, links: Array}}
 */
export function buildGraphData(materials, { maxNodes = 120 } = {}) {
  const list = Array.isArray(materials) ? materials : [];
  const selected = list.slice(0, maxNodes);
  const nodes = [];
  const links = [];

  // 素材 id（缺 id 时用 title+type 兜底）
  const materialId = (m) => String(m.id ?? `${m.title}-${m.type}`);

  // tag 计数
  const tagCount = new Map();
  for (const m of selected) {
    for (const t of (Array.isArray(m.tags) ? m.tags : [])) {
      const key = String(t).trim();
      if (!key) continue;
      tagCount.set(key, (tagCount.get(key) || 0) + 1);
    }
  }

  // tag 节点
  for (const [tag, count] of tagCount) {
    nodes.push({ id: `tag:${tag}`, kind: 'tag', tag, val: Math.max(1, Math.min(count, 12)) });
  }

  // 素材节点
  for (const m of selected) {
    nodes.push({
      id: materialId(m),
      kind: 'material',
      material: m,
      group: m.type || 'default',
    });
  }

  // 边：素材 ↔ tag
  for (const m of selected) {
    const srcId = materialId(m);
    for (const t of (Array.isArray(m.tags) ? m.tags : [])) {
      const tag = String(t).trim();
      if (!tag) continue;
      links.push({ source: srcId, target: `tag:${tag}` });
    }
  }

  return { nodes, links };
}