// 素材库上下文派生：对素材列表做归一化、打分、排序，选出 top 6 转成上下文行
// 从 src/components/AiChatPanel.jsx 抽离，纯函数
import { isAiElfAsset, normalizeAsset } from '../../domain/creative/assetModel.js';

/**
 * 按查询关键词对素材打分（定位：知识库联动里的"按当前问题检索"）。
 * 匹配维度：标题 > 标签 > 内容，权重递减。中文分词：按连续 CJK 片段两两切词 + 英文按词。
 * 纯逻辑、无副作用，可单测。
 *
 * @param {string} query 当前问题/会话上下文
 * @returns {string[]} 查询 token 列表
 */
export function tokenizeQuery(query) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const tokens = new Set();
  // 英文/数字词
  for (const w of q.match(/[a-z0-9]{2,}/g) || []) tokens.add(w);
  // 中文：2-4 字连续 CJK 片段（bigram 抛某些拼词）
  const cleaned = q.replace(/[a-z0-9\s]/g, '');
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.add(cleaned.slice(i, i + 2));
  }
  return [...tokens];
}

/**
 * 按 query 相关性检索素材（打分越高越相关）。
 * @param {Array} normalized 归一化后的素材列表（含 title/tags/content/fullContent）
 * @param {string} query 查询串
 * @returns {Map<material, number>} 素材->相关分（>0 才算相关）
 */
export function scoreMaterialsByQuery(normalized, query) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return new Map();
  const scores = new Map();
  for (const mat of normalized) {
    const title = String(mat.title || '').toLowerCase();
    const tags = (mat.tags || []).join(' ').toLowerCase();
    const content = String(mat.fullContent || mat.content || '').toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (title.includes(tok)) score += 5;
      else if (tags.includes(tok)) score += 3;
      else if (content.includes(tok)) score += 1;
    }
    if (score > 0) scores.set(mat, score);
  }
  return scores;
}

/**
 * 构造素材库上下文（知识库联动）：
 * - pinnedIds：素材「发送到工作站」时登记的置顶 ID——强制入选并排最前（结构化引用，
 *   不受关键词打分限制；正文由 agent 用 read_material 按需取回）
 * - query 提供时按相关性检索，取 top `limit` 条相关素材
 * - 无 query 或检索为空：回退「优先 + 收藏 + 最新」的通用列表
 *
 * @param {Array}  materials  素材列表
 * @param {string} [query]    当前问题/会话上下文（可选）
 * @param {number} [limit]    检索上限
 * @param {Array}  [pinnedIds] 置顶素材 ID（可选）
 * @returns {{total, elfCount, selected, lines, hasElf, mode:'query'|'default'|'pinned'}}
 */
export function buildMaterialContext(materials, { query = '', limit = 12, pinnedIds = [] } = {}) {
  const materialList = Array.isArray(materials) ? materials : [];
  const normalized = materialList.flatMap((material) => {
    try { return [normalizeAsset(material)]; } catch { return []; }
  });

  // 置顶素材：强制入选、排最前
  const pinnedIdSet = new Set((Array.isArray(pinnedIds) ? pinnedIds : []).map(String));
  const pinned = pinnedIdSet.size ? normalized.filter(m => pinnedIdSet.has(String(m.id))) : [];
  const rest = pinnedIdSet.size ? normalized.filter(m => !pinnedIdSet.has(String(m.id))) : normalized;
  const remaining = Math.max(1, limit - pinned.length);

  if (query) {
    const scores = scoreMaterialsByQuery(rest.length ? rest : normalized, query);
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, remaining)
      .map(([mat]) => mat);
    const fallback = ranked.length ? ranked : rankedDefault(rest.length ? rest : normalized, remaining);
    const selected = [...pinned, ...fallback].slice(0, limit);
    return { ...buildLines(selected, normalized.length, limit), mode: pinned.length ? 'pinned' : (ranked.length ? 'query' : 'default') };
  }

  // 无 query：置顶 + 「AI精灵 > 收藏 > 最新」
  const selected = [...pinned, ...rankedDefault(rest, remaining)].slice(0, limit);
  return { ...buildLines(selected, normalized.length, limit), mode: pinned.length ? 'pinned' : 'default' };
}

function rankedDefault(normalized, limit) {
  const scored = normalized.map((material, index) => ({
    material, index,
    score: (isAiElfAsset(material) ? 100 : 0)
      + (material.starred ? 20 : 0)
      + (Date.parse(material.createdAt || '') || 0) / 1_000_000_000_000,
  }));
  scored.sort((a, b) => b.score - a.score || b.index - a.index);
  return scored.slice(0, limit).map(entry => entry.material);
}

function buildLines(selected, total, limit) {
  const elfCount = selected.filter(m => isAiElfAsset(m)).length;
  const lines = selected.map((material, index) => {
    const tags = Array.isArray(material.tags) ? material.tags.join('、') : '';
    const content = String(material.fullContent || material.content || '').replace(/\s+/g, ' ').slice(0, 900);
    return `[素材:${material.id || index + 1}] 标题：${material.title || '未命名素材'}；来源：${material.source || '未知'}；类型：${material.type || 'material'}；标签：${tags || '无'}；内容：${content || '无内容'}`;
  });
  return { total, elfCount, selected, lines, hasElf: elfCount > 0 };
}
