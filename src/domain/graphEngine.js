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
/**
 * 节点填充色常量（深色模式兜底值）。
 * 键名必须与 constants/appConstants.jsx 的 MATERIAL_TYPES 完全一致：
 *   quote / data / case / viewpoint / chart / project + default 兜底。
 * 之前误用了 knowledge/material 这两个不存在的类型键，导致大部分素材节点
 * 全部回退到 default 色（全图同灰）。
 */
export const TYPE_COLORS = {
  viewpoint: '#60a5fa',   // 观点 — 蓝
  case:     '#22c55e',    // 案例 — 绿
  quote:    '#f59e0b',    // 金句 — 琥珀
  data:     '#a855f7',    // 数据 — 紫
  chart:    '#06b6d4',    // 图表 — 青
  project:  '#f43f5e',    // 项目 — 玫瑰
  default:  '#64748b',    // 兜底 — 石板灰
};

/**
 * @param {Array} materials 素材列表（含 id/title/type/tags）
 * @param {Object} [opts]
 * @param {number} [opts.maxNodes] 最多纳入多少素材（避免图过密，缺省 120）
 * @returns {{nodes: Array, links: Array}}
 */
/**
 * 构建素材知识图谱数据（纯函数，可单测）
 * @param {Array} materials 素材列表
 * @param {Object} opts
 * @param {Array} [opts.files] 本地空间关联文件 [{ name, path, content?, spaceName? }]
 *   —— 文件作为独立节点入图；素材标题出现在文件内容中（或文件名包含标题）时连边，
 *   让"素材 ↔ 本地资产"的关联一眼可见
 * @param {number} [opts.maxNodes] 素材节点上限
 */
export function buildGraphData(materials, { files = [], maxNodes = 120 } = {}) {
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

  // 本地文件节点 + 边：文件 ↔ 素材（素材标题被文件内容引用，或文件名含标题关键词）
  const fileList = (Array.isArray(files) ? files : []).slice(0, 80);
  for (const f of fileList) {
    if (!f?.name) continue;
    const fileId = `file:${f.path || f.name}`;
    const content = String(f.content || '');
    nodes.push({
      id: fileId,
      kind: 'file',
      group: 'file',
      file: f,
      val: Math.max(2, Math.min(10, Math.round(content.length / 2000) + 2)),
    });
    for (const m of selected) {
      const title = String(m.title || '').trim();
      if (title.length < 2) continue;
      const fileName = String(f.name || '');
      if ((content && content.includes(title)) || fileName.includes(title.slice(0, 12))) {
        links.push({ source: materialId(m), target: fileId });
      }
    }
  }

  return { nodes, links };
}