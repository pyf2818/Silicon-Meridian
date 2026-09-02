/**
 * discoverFeed.js - 全部动态流（多领域大杂烩，与用户画像完全解耦，纯逻辑可单测）
 *
 * 定位：与「精准推荐」（画像驱动）刻意分离——全部动态是跨领域热点池，
 * 主打让用户扩展视野，看的是"世界正在发生什么"，而不是"你可能喜欢什么"。
 *
 * 排序信号（无画像参与）：
 * 1. 【互动信号】条目自带的真实指标：likes / comments / views（字段缺失时计 0——
 *    RSS 源通常没有，社区化/热点接口接入后自动生效）
 * 2. 【多源发酵】同一事件被多个独立信源报道（事件簇规模）= 正在成为热点的最强代理
 * 3. 【今日热词】全池词频 top 词的命中（热词是全局统计，不依赖用户画像）
 * 4. 【内容质量】后端 qualityScore + AI 相关性评分
 * 5. 【新鲜度】指数衰减（半衰期 18h）——热帖多浮一天，旧帖自然沉底
 *
 * 实时更新递进：newsService 轮询刷新后 items 流式进入，feed 纯派生即随之递进；
 * 排序以 (分数 → 发布时间 → id) 决胜，保证刷新时既有条目次序稳定不抖动。
 *
 * 领域打散：连续同领域 ≤2、连续同信源 ≤3 错位插入——"大杂烩"体验要求多个领域交错出现，
 * 而不是单一领域刷屏。
 */

import { diversifyOrder } from './precisionFeed.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 100) / 100;

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'the', 'to', 'with', 'new', 'today']);

/** 全池热词频次（不依赖用户画像，是"世界在关注什么"的统计） */
export function globalKeywordFrequencies(items) {
  const freq = Object.create(null);
  const re = /\b[a-z一-龥]{2,}\b/g;
  (Array.isArray(items) ? items : []).forEach(item => {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const words = text.match(re) || [];
    words.forEach(word => {
      if (/^[a-z]{2}$/.test(word) || STOP_WORDS.has(word)) return;
      freq[word] = (freq[word] || 0) + 1;
    });
  });
  return freq;
}

/** 互动信号：真实指标字段存在时聚合（likes 权重高、comments 更高、views 走对数近似） */
export function computeEngagement(item) {
  const likes = Math.max(0, Number(item.likes || item.likeCount) || 0);
  const comments = Math.max(0, Number(item.comments || item.commentCount) || 0);
  const views = Math.max(0, Number(item.views || item.viewCount) || 0);
  // views 用 log 压缩：10^4 与 10^6 的差距不应淹没其他信号
  const engagement = likes * 3 + comments * 4 + (views > 0 ? Math.log10(views) * 2 : 0);
  return { engagement, signals: { likes, comments, views } };
}

/** 新鲜度：半衰期指数衰减（0-15 分） */
export function freshnessDecay(publishedAt, now = Date.now(), halfLifeHours = 18, max = 15) {
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0;
  const ageHours = Math.max(0, (now - t) / 3_600_000);
  return round(max * Math.exp(-(ageHours / halfLifeHours) * Math.LN2));
}

/**
 * 单条热度分（0-100）。
 * @param {Object} ctx { clusterSize, keywordScore, maxKeywordScore }
 */
export function discoverScore(item, ctx = {}) {
  const { clusterSize = 1, keywordScore = 0, maxKeywordScore = 1, now = Date.now() } = ctx;
  const { engagement } = computeEngagement(item);

  // 内容质量（后端评分 + AI 相关性），0-30
  const quality = clamp((Number(item.qualityScore) || 0) * 0.3 + (Number(item.aiRelevanceScore) || 0) * 0.3, 0, 30);
  // 多源发酵：独立信源数是最强热点代理，0-25
  const corroboration = clamp((clusterSize - 1) * 6, 0, 25);
  // 今日热词命中：0-15
  const hot = clamp((keywordScore / Math.max(1, maxKeywordScore)) * 15, 0, 15);
  // 互动信号：0-15（真实指标存在时）
  const interaction = clamp(engagement, 0, 15);
  // 新鲜度：0-15
  const fresh = freshnessDecay(item.publishedAt, now);

  const score = round(clamp(quality + corroboration + hot + interaction + fresh, 0, 100));
  return { score, parts: { quality, corroboration, hot, interaction, fresh } };
}

/**
 * 组装全部动态流。
 * @param {Object} params
 * @param {Array}  params.items    资讯池（全量，不限日期——大杂烩跟随信源实时递进）
 * @param {Array}  params.clusters 事件簇 [{ itemIds, independentSourceCount }]
 * @returns {{ feed: Array, meta: object }}
 */
export function buildDiscoverFeed({ items = [], now = Date.now(), clusters = [], options = {} } = {}) {
  const { maxConsecutiveCategory = 2, maxConsecutiveSource = 3 } = options;

  const pool = Array.isArray(items) ? items.filter(Boolean) : [];

  // 事件簇索引 + 热词
  const clusterByItemId = new Map();
  (Array.isArray(clusters) ? clusters : []).forEach(cluster => {
    const size = clamp(Number(cluster.independentSourceCount) || 1, 1, 20);
    (cluster.itemIds || []).forEach(id => clusterByItemId.set(id, size));
  });
  const keywordFreq = globalKeywordFrequencies(pool);
  const maxKeywordScore = Math.max(1, ...Object.values(keywordFreq));

  const seen = new Set();
  const scored = [];
  for (const item of pool) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    const titleLower = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    // 热词命中取条目内最高词频（命中 3 个不同热词只按最强的计，防长文刷分）
    const hitWords = Object.keys(keywordFreq).filter(word => titleLower.includes(word));
    const keywordScore = hitWords.reduce((max, w) => Math.max(max, keywordFreq[w]), 0);
    const result = discoverScore(item, {
      clusterSize: clusterByItemId.get(item.id) || 1,
      keywordScore,
      maxKeywordScore,
      now,
    });
    scored.push({
      ...item,
      discoverScore: result.score,
      discoverParts: result.parts,
      discoverReasons: [
        result.parts.corroboration >= 12 && '多源正在报道',
        result.parts.interaction >= 8 && '互动信号强',
        result.parts.hot >= 8 && '命中今日热词',
        result.parts.fresh >= 10 && '刚发布',
      ].filter(Boolean).slice(0, 2),
    });
  }

  scored.sort((a, b) => b.discoverScore - a.discoverScore
    || (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
    || String(a.id).localeCompare(String(b.id)));

  const feed = diversifyOrder(scored, { maxConsecutiveCategory, maxConsecutiveSource });

  return {
    feed,
    meta: {
      total: feed.length,
      domainCount: new Set(feed.map(i => i.category).filter(Boolean)).size,
      hotKeywords: Object.entries(keywordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word),
      generatedAt: now,
    },
  };
}
