/**
 * 站内资讯语义检索（本地哈希向量，零 API 成本）。
 *
 * 定位：给「子串 OR 匹配」补一层语义召回。子串匹配对自然语句很脆弱——
 * 用户问「值得关注的 AI 动态」时，标题里没有这些字照样命中不了；
 * 而哈希向量让「共享实体/主题词」的条目也能被召回（同义不同词）。
 *
 * 为什么用本地哈希而不是托管 embeddings：
 *   - 零 API 成本、零网络依赖（离线可用）；500 条向量化 + 余弦排序是毫秒级
 *   - 质量弱于真实 embeddings，但作为「词法检索的补充召回」足够
 *   - 复用 recommendationEngine 里已验证过的 hashEmbedding / cosineSim，避免第二套实现
 *
 * 用法：词法检索结果不足时，用它对最新一批资讯做语义 top-N 补充。
 */

import { hashEmbedding, cosineSim } from './recommendationEngine.js';

export const DEFAULT_DIM = 256;
/** 语义分下限：哈希向量的经验噪声底，低于此视为不相关（避免召回一堆弱相关条目） */
export const MIN_SEMANTIC_SCORE = 0.12;
/** 候选池上限（控制响应体积与向量化耗时） */
export const POOL_LIMIT = 120;

/** 建索引文本：标题拼两次（词频加权，标题实体比摘要词更重要）+ 摘要截断 */
export function indexText(item) {
  const title = String(item?.title || '');
  const summary = String(item?.summary || '').slice(0, 300);
  const tags = Array.isArray(item?.tags) ? item.tags.join(' ') : '';
  return `${title} ${title} ${tags} ${summary}`.trim();
}

/** 建立索引：[{ item, vec }] */
export function buildIndex(items, { dim = DEFAULT_DIM } = {}) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(Boolean)
    .map(item => ({ item, vec: hashEmbedding(indexText(item), dim) }));
}

/**
 * 语义检索：返回按分数降序的 [{ item, score }]。
 * 分数 = 余弦相似度（已归一化向量的点积），低于 minScore 的丢弃。
 */
export function semanticSearch(index, query, {
  limit = 20,
  minScore = MIN_SEMANTIC_SCORE,
  dim = DEFAULT_DIM,
} = {}) {
  const q = String(query || '').trim();
  if (!q || !Array.isArray(index) || index.length === 0) return [];
  // 查询同样「加权」：短查询信息量少，重复一次提升其词频权重
  const qv = hashEmbedding(`${q} ${q}`, dim);
  const scored = [];
  for (const entry of index) {
    const score = cosineSim(qv, entry.vec);
    if (score >= minScore) scored.push({ item: entry.item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * 语义补充召回：把语义命中的条目追加进已有结果（去重，保持已有结果在前）。
 * @returns {{ items: Array, added: number }}
 */
/** 去重键：优先 id，其次 url，最后回落到 标题|来源（无 id 的条目也能正确去重） */
export function itemKey(item) {
  return String(item?.id || item?.url || `${item?.title || ''}|${item?.source || ''}`);
}

export function augmentWithSemantics(existing, pool, query, options = {}) {
  const base = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(base.map(itemKey).filter(Boolean));
  const hits = semanticSearch(buildIndex(pool, { dim: options.dim }), query, options);
  let added = 0;
  for (const { item } of hits) {
    if (!item) continue;
    const key = itemKey(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    base.push(item);
    added += 1;
  }
  return { items: base, added };
}
