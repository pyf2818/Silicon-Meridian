/**
 * precisionFeed.js - 当日精准推荐流（抖音式多信号排序，纯逻辑无 React / 无 fetch，可单测）
 *
 * 对标抖音推荐的核心思想（在本项目的离线启发式约束下的诚实近似）：
 *
 * 1. 【多信号预估互动概率】抖音对每条内容预估 pLike/pComment/pFinish/pDwell 再加权。
 *    无 ML 模型时，用四组可解释信号近似：
 *      - 画像契合（personalScore：领域分层/信源分层/特别关注/兴趣领域）
 *      - 公共质量（publicScore：多源印证/新鲜度/信源质量）
 *      - 行为信号（时间衰减的点击历史 + 收藏加权 + 「不感兴趣」负反馈惩罚）
 *      - 正在发酵（当日内多源报道同一事件 + 今日热词频次）
 *    加权融合为 feedScore（0-100）。
 *
 * 2. 【当日硬过滤】只保留本地时区"今天 00:00 → 现在"发布的内容——
 *    绝不显示其他日期的资讯（publishedAt 无法解析的条目一并排除，宁缺毋滥）。
 *
 * 3. 【探索流量池】(Exploration) 画像外内容按热度排序后以固定节奏插入主列
 *    （默认每 6 条插 1 条、占比封顶 20%）——对应抖音的信息流探索机制，防止信息茧房。
 *
 * 4. 【多样性打散】连续同领域/同信源条目封顶后错位插入，避免"刷到的十条全是同一话题"。
 *
 * 5. 【已读/负反馈排除】已读不再重现；hiddenIds 硬排除；负反馈按时间衰减惩罚类目/信源。
 *
 * 6. 【不限条数】不做 slice 截断——当日有多少合格内容就给多少。
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 100) / 100;

/** 本地时区"今天 00:00"的时间戳 */
export function startOfLocalDay(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 时间衰减权重：半衰期模型 exp(-age/halfLife * ln2)，age 单位毫秒；未来时间（时钟偏差/坏数据）权重为 0 */
export function decayWeight(ts, now = Date.now(), halfLifeHours = 48) {
  const t = Date.parse(ts) || Number(ts);
  if (!Number.isFinite(t)) return 0;
  const ageMs = now - t;
  if (ageMs < 0) return 0;
  const ageHours = ageMs / 3_600_000;
  return Math.exp(-(ageHours / Math.max(1, halfLifeHours)) * Math.LN2);
}

const NEGATIVE_EVENT_RE = /less|dislike|hide|not.?interested|muted|block/i;
const POSITIVE_EVENT_RE = /more|like|boost|follow|save|bookmark/i;

/**
 * 行为信号聚合：把点击历史与反馈事件折叠成"类目/信源"两个维度的加权正负信号。
 * 正向：点击按半衰期（默认 48h，抖音的行为时效性）衰减累加；收藏在 feedScore 中另算。
 * 负向：feedback.mutedSources / feedbackEvents 中的负反馈事件同样按半衰期衰减。
 */
export function computeBehaviorSignals({ readingHistory = [], feedback = {}, feedbackEvents = [], now = Date.now(), halfLifeHours = 48 } = {}) {
  const categoryWeights = Object.create(null);
  const sourceWeights = Object.create(null);
  (Array.isArray(readingHistory) ? readingHistory : []).forEach(h => {
    const w = decayWeight(h.readAt || h.ts || h.createdAt, now, halfLifeHours);
    if (w <= 0) return;
    if (h.category) categoryWeights[h.category] = (categoryWeights[h.category] || 0) + w;
    if (h.source) sourceWeights[h.source] = (sourceWeights[h.source] || 0) + w;
  });

  const penaltyCategories = Object.create(null);
  const penaltySources = Object.create(null);
  const boostCategories = Object.create(null);
  (Array.isArray(feedbackEvents) ? feedbackEvents : []).forEach(ev => {
    const type = String(ev?.type || '');
    const w = decayWeight(ev?.ts, now, halfLifeHours);
    if (w <= 0) return;
    if (NEGATIVE_EVENT_RE.test(type)) {
      if (ev.category) penaltyCategories[ev.category] = (penaltyCategories[ev.category] || 0) + w;
      if (ev.source) penaltySources[ev.source] = (penaltySources[ev.source] || 0) + w;
    } else if (POSITIVE_EVENT_RE.test(type)) {
      if (ev.category) boostCategories[ev.category] = (boostCategories[ev.category] || 0) + w;
    }
  });
  const mutedSources = feedback?.mutedSources || {};
  Object.entries(mutedSources).forEach(([source, count]) => {
    penaltySources[source] = (penaltySources[source] || 0) + clamp(Number(count) || 0, 0, 10);
  });
  const boostedCategories = feedback?.boostedCategories || {};
  Object.entries(boostedCategories).forEach(([cat, count]) => {
    boostCategories[cat] = (boostCategories[cat] || 0) + clamp(Number(count) || 0, 0, 10);
  });

  const hiddenIds = new Set((Array.isArray(feedback?.hiddenIds) ? feedback.hiddenIds : []).map(String));
  return { categoryWeights, sourceWeights, penaltyCategories, penaltySources, boostCategories, hiddenIds };
}

/**
 * 单条打分（item 应已通过 buildRecommendation 携带 personalScore/publicScore；
 * 缺失时退化为纯公共分，保证对旧数据鲁棒）。
 * @returns {{ score:number, parts:object, reasons:string[], isExploration:boolean }}
 */
export function scorePrecisionItem(item, ctx) {
  const { behaviorSignals, focusCategories, bookmarkIds, followKeywords = [], trackedTerms = [], clusterSize = 1, keywordFreq = 0, maxKeywordFreq = 1 } = ctx;
  const personal = clamp(Number(item.personalScore ?? 50), 0, 100);
  const publicScore = clamp(Number(item.publicScore ?? 50), 0, 100);

  // 行为信号（0-15 正向 + 负向惩罚 0-25）
  const catClick = behaviorSignals.categoryWeights[item.category] || 0;
  const srcClick = behaviorSignals.sourceWeights[item.source] || 0;
  const positive = clamp(catClick * 3 + srcClick * 2, 0, 15);
  const boost = clamp((behaviorSignals.boostCategories[item.category] || 0) * 4, 0, 10);
  const penalty = clamp(
    (behaviorSignals.penaltyCategories[item.category] || 0) * 10
    + (behaviorSignals.penaltySources[item.source] || 0) * 8,
    0, 25,
  );
  const bookmarked = bookmarkIds.has(item.id) ? 4 : 0;

  // 正在发酵（0-10）：多源报道 + 今日热词
  const hot = clamp((clusterSize - 1) * 3, 0, 6) + clamp((keywordFreq / Math.max(1, maxKeywordFreq)) * 4, 0, 4);

  // 画像契合权重（0.45 画像 + 0.20 公共）+ 行为 + 热度
  const score = round(clamp(
    personal * 0.45
    + publicScore * 0.20
    + positive + boost + bookmarked
    + hot
    - penalty,
    0, 100,
  ));

  const isFocusCategory = focusCategories.has(item.category);
  const reasons = [];
  if (item.recommendationReasons?.length) reasons.push(...item.recommendationReasons.slice(0, 2));
  if (positive >= 6) reasons.push('你近期常看这类内容');
  if (hot >= 5) reasons.push('多源正在发酵');
  if (penalty >= 8) reasons.push('已按你的负反馈降权');
  if (!isFocusCategory) reasons.push('探索：拓宽视野');

  // 探索判定：类目既不在兴趣领域、也没有正向行为历史 → 探索池候选
  const isExploration = !isFocusCategory
    && !(behaviorSignals.categoryWeights[item.category] > 0)
    && item.specialFollowHit !== true;

  return { score, parts: { personal, publicScore, positive, boost, bookmarked, hot, penalty }, reasons, isExploration };
}

/**
 * 多样性打散：贪心错位——连续同类目 ≤ maxConsecutiveCategory、连续同信源 ≤ maxConsecutiveSource，
 * 超限的条目押后到队列，遇到可插入的不同条目时优先消费。
 */
export function diversifyOrder(sorted, { maxConsecutiveCategory = 2, maxConsecutiveSource = 3 } = {}) {
  const result = [];
  const pending = [];
  let runCategory = null;
  let runCategoryLen = 0;
  let runSource = null;
  let runSourceLen = 0;

  const canPush = (item) => {
    const catOk = item.category !== runCategory || runCategoryLen < maxConsecutiveCategory;
    const srcOk = item.source !== runSource || runSourceLen < maxConsecutiveSource;
    return catOk && srcOk;
  };
  const push = (item) => {
    if (item.category === runCategory) runCategoryLen += 1;
    else { runCategory = item.category; runCategoryLen = 1; }
    if (item.source === runSource) runSourceLen += 1;
    else { runSource = item.source; runSourceLen = 1; }
    result.push(item);
  };

  for (const item of sorted) {
    if (canPush(item)) push(item);
    else pending.push(item);
    // 每插入一条后尝试消化押后队列（保持整体分数序）
    for (let i = 0; i < pending.length; i += 1) {
      if (canPush(pending[i])) {
        push(pending.splice(i, 1)[0]);
        break;
      }
    }
  }
  // 队列剩余（同质条目过多时）按原序兜底追加
  while (pending.length) push(pending.shift());
  return result;
}

/**
 * 探索池注入：每 every 条主列内容插 1 条探索内容（抖音探索流量池节奏）。
 * 占比封顶 capRatio（默认 0.2）。
 */
export function injectExploration(focusFeed, explorationFeed, { every = 6, capRatio = 0.2 } = {}) {
  const cap = Math.floor(focusFeed.length * capRatio);
  const pool = explorationFeed.slice(0, Math.max(0, cap));
  if (!pool.length) return focusFeed.slice();
  const result = [];
  let fi = 0;
  let ei = 0;
  while (fi < focusFeed.length || ei < pool.length) {
    for (let k = 0; k < every && fi < focusFeed.length; k += 1) {
      result.push(focusFeed[fi]);
      fi += 1;
    }
    if (ei < pool.length) {
      result.push(pool[ei]);
      ei += 1;
    }
  }
  return result;
}

/** 词频统计（今日热词，用于"正在发酵"信号） */
export function todayKeywordFrequencies(items) {
  const freq = Object.create(null);
  const re = /\b[a-z一-龥]{2,}\b/g;
  (Array.isArray(items) ? items : []).forEach(item => {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const words = text.match(re) || [];
    words.forEach(word => {
      if (/^[a-z]{2}$/.test(word)) return; // 过短英文词无区分度
      freq[word] = (freq[word] || 0) + 1;
    });
  });
  return freq;
}

/**
 * 组装当日精准推荐流。
 * @param {Object} params
 * @param {Array}  params.items    已过 buildRecommendation 的候选池（需含 personalScore/publicScore）
 * @param {number} params.now      当前时间戳
 * @param {Object} params.profile  { domainTiers, sourceTiers, selectedInterests, followKeywords, trackedTerms }
 * @param {Object} params.behavior { readingHistory, bookmarks, feedback, feedbackEvents }
 * @param {Array}  params.clusters 事件簇 [{ itemIds, independentSourceCount }]
 * @returns {{ feed: Array, meta: object }}
 */
export function buildPrecisionFeed({
  items = [],
  now = Date.now(),
  profile = {},
  behavior = {},
  clusters = [],
  options = {},
} = {}) {
  const {
    explorationEvery = 6,
    explorationCapRatio = 0.2,
    halfLifeHours = 48,
  } = options;

  // ── 1. 当日硬过滤：本地时区今天 00:00 → now，绝不显示其他日期 ──
  const dayStart = startOfLocalDay(now);
  const pool = (Array.isArray(items) ? items : []).filter(item => {
    const t = Date.parse(item.publishedAt);
    return Number.isFinite(t) && t >= dayStart && t <= now;
  });

  // ── 2. 行为信号 / 排除集 ──
  const behaviorSignals = computeBehaviorSignals({
    readingHistory: behavior.readingHistory,
    feedback: behavior.feedback,
    feedbackEvents: behavior.feedbackEvents,
    now,
    halfLifeHours,
  });
  const readIds = new Set((Array.isArray(behavior.readingHistory) ? behavior.readingHistory : []).map(h => String(h.id)));
  const bookmarkIds = new Set((Array.isArray(behavior.bookmarks) ? behavior.bookmarks : []).map(b => String(b.itemId || b.id)));

  const focusCategories = new Set([
    ...Object.entries(profile.domainTiers || {}).filter(([, tier]) => tier === 'focus').map(([cat]) => cat),
    ...(Array.isArray(profile.selectedInterests) ? profile.selectedInterests : []),
  ]);
  const followTerms = [
    ...(Array.isArray(profile.followKeywords) ? profile.followKeywords : []),
    ...Object.keys(profile.trackedTerms || {}),
  ].map(t => String(t).toLowerCase()).filter(Boolean);

  // 事件簇索引（多源发酵信号）
  const clusterByItemId = new Map();
  (Array.isArray(clusters) ? clusters : []).forEach(cluster => {
    const size = clamp(Number(cluster.independentSourceCount) || 1, 1, 20);
    (cluster.itemIds || []).forEach(id => clusterByItemId.set(id, size));
  });

  const keywordFreq = todayKeywordFrequencies(pool);
  const maxKeywordFreq = Math.max(1, ...Object.values(keywordFreq));

  const specialTargets = (Array.isArray(profile.specialFollows) ? profile.specialFollows : [])
    .map(rule => String(rule.target || rule.name || rule.url || '').toLowerCase()).filter(Boolean);

  // ── 3. 逐条打分 ──
  const scored = [];
  for (const item of pool) {
    const id = String(item.id);
    if (readIds.has(id)) continue;           // 已读不重现
    if (behaviorSignals.hiddenIds.has(id)) continue; // 负反馈硬排除
    const titleLower = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const keywordFreqScore = followTerms.reduce((sum, term) => (titleLower.includes(term) ? keywordFreq[term] || 0 : sum), 0);
    const isSpecial = specialTargets.some(target => titleLower.includes(target) || String(item.source || '').toLowerCase().includes(target));
    const result = scorePrecisionItem(
      { ...item, specialFollowHit: isSpecial },
      {
        behaviorSignals,
        focusCategories,
        bookmarkIds,
        followKeywords: profile.followKeywords,
        trackedTerms: profile.trackedTerms,
        clusterSize: clusterByItemId.get(item.id) || 1,
        keywordFreq: keywordFreqScore,
        maxKeywordFreq,
      },
    );
    scored.push({ ...item, feedScore: result.score, feedParts: result.parts, feedReasons: result.reasons, isExploration: result.isExploration });
  }

  // ── 4. 分列排序（分数 → 发布时间 → id，保证稳定不抖动） ──
  const byScore = (a, b) => b.feedScore - a.feedScore
    || (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
    || String(a.id).localeCompare(String(b.id));
  const focusFeed = scored.filter(i => !i.isExploration).sort(byScore);
  const explorationFeed = scored.filter(i => i.isExploration).sort(byScore);

  // ── 5. 探索注入 + 多样性打散 ──
  const merged = injectExploration(focusFeed, explorationFeed, { every: explorationEvery, capRatio: explorationCapRatio });
  const feed = diversifyOrder(merged, { maxConsecutiveCategory: 2, maxConsecutiveSource: 3 });

  return {
    feed,
    meta: {
      total: feed.length,
      focusCount: focusFeed.length,
      explorationCount: feed.filter(i => i.isExploration).length,
      candidateCount: pool.length,
      dayStart,
      generatedAt: now,
    },
  };
}
