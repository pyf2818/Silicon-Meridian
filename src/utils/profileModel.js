// Profile Model — pure functions for computing profile representations.
// No React dependency; easy to unit test.

import { domainTierScore, normalizeTier, sourceTierScore } from '../domain/intelligence/profileTiers.js';

const CURRENT_DATE = () => new Date().toISOString().slice(0, 10);

/**
 * Compute the full intelligence profile representation from signals.
 *
 * @param {Object} opts
 * @param {Array} opts.bookmarks
 * @param {Array} opts.readingHistory
 * @param {Array} opts.materials
 * @param {Array} opts.selectedInterests
 * @param {Object} opts.recommendationFeedback
 * @param {Array} opts.followKeywords
 * @param {Object} opts.sourcePriorities
 * @param {Object} opts.domainPriorities
 * @param {Array} opts.insightSourceQuality
 * @param {number} opts.workbenchItemCount
 * @param {number} opts.focusMatches
 * @param {Array} [opts.categories]
 * @param {Object} [opts.domainTiers]
 * @param {Object} [opts.sourceTiers]
 * @returns {Object}
 */
export function computeIntelligenceProfile({
  bookmarks = [],
  readingHistory = [],
  materials = [],
  selectedInterests = [],
  recommendationFeedback = {},
  followKeywords = [],
  sourcePriorities = {},
  domainPriorities = {},
  insightSourceQuality = [],
  workbenchItemCount = 0,
  focusMatches = 0,
  categories = null,
  domainTiers = null,
  sourceTiers = null,
}) {
  const focusLabels = selectedInterests.map(id => {
    const category = categories?.find(c => c.id === id);
    return category?.label || id;
  });
  const boosted = Object.entries(recommendationFeedback.boostedCategories || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => {
      const category = categories?.find(c => c.id === id);
      return category?.label || id;
    });
  const muted = Object.keys(recommendationFeedback.mutedSources || {}).slice(0, 3);
  const tracked = [...new Set([...followKeywords, ...Object.keys(recommendationFeedback.trackedTerms || {})])].slice(0, 8);
  const depth = workbenchItemCount > 0 && focusMatches / Math.max(workbenchItemCount, 1) > 0.5 ? '深度聚焦' : '探索校准';
  const outputGoal = materials.length > bookmarks.length ? '素材沉淀' : '阅读判断';

  // Derive confidence from the learning engine so callers (e.g. buildSystemPrompt)
  // see a real value instead of a hardcoded 0. (Phase 1.2 Task 8)
  const learningEngine = computeProfileLearningEngine({
    readingHistory,
    bookmarks,
    materials,
    selectedInterests,
    domainTiers,
    domainPriorities,
    recommendationFeedback,
    followKeywords,
    sourceTiers,
    sourcePriorities,
    categories,
  });

  return {
    focusLabels,
    boosted,
    muted,
    tracked,
    depth,
    outputGoal,
    confidence: learningEngine.confidence,
    confidenceLabel: learningEngine.confidenceLabel,
  };
}

/**
 * Compute reading profile stats from bookmarks (bookmarks tracks reads).
 */
export function computeReadingProfile(bookmarks = []) {
  const now = new Date();
  const sorted = [...bookmarks].sort((a, b) => new Date(b.readAt || 0) - new Date(a.readAt || 0));

  // streak
  const readDates = new Set(sorted.filter(b => b.readAt).map(b => b.readAt.slice(0, 10)));
  let streak = 0;
  let checkDate = new Date(now);
  const fmtDs = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!readDates.has(fmtDs(checkDate))) checkDate = new Date(checkDate.getTime() - 86400000);
  while (readDates.has(fmtDs(checkDate))) { streak++; checkDate = new Date(checkDate.getTime() - 86400000); }

  // hour distribution
  const hourDist = Array(24).fill(0);
  sorted.filter(b => b.readAt).forEach(b => { hourDist[new Date(b.readAt).getHours()]++; });
  const peakHour = hourDist.indexOf(Math.max(...hourDist));

  // interests
  const interestDist = {};
  bookmarks.forEach(b => { const c = b.category || 'unknown'; interestDist[c] = (interestDist[c] || 0) + 1; });
  const topInterests = Object.entries(interestDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, count, pct: bookmarks.length ? Math.round(count / bookmarks.length * 100) : 0 }));

  // sources
  const sourceDist = {};
  bookmarks.forEach(b => { const s = b.source || '未知来源'; sourceDist[s] = (sourceDist[s] || 0) + 1; });
  const topSources = Object.entries(sourceDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count, pct: bookmarks.length ? Math.round(count / bookmarks.length * 100) : 0 }));

  // tags
  const tagDist = {};
  bookmarks.forEach(b => (b.tags || []).forEach(t => { tagDist[t] = (tagDist[t] || 0) + 1; }));
  const totalTagCount = Object.values(tagDist).reduce((a, b) => a + b, 0);
  const topTags = Object.entries(tagDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count, pct: totalTagCount ? Math.round(count / totalTagCount * 100) : 0 }));

  // summary metrics
  const avgSummaryLength = bookmarks.length ? Math.round(bookmarks.reduce((s, b) => s + (b.summary?.length || 0), 0) / bookmarks.length) : 0;
  const deepReads = bookmarks.filter(b => (b.summary?.length || 0) > 200).length;
  const shallowReads = bookmarks.filter(b => (b.summary?.length || 0) <= 100).length;
  const totalBookmarks = bookmarks.length;

  // 7-day avg read
  const day7 = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - idx));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const weekReads = day7.map(d => sorted.filter(b => (b.readAt || '').slice(0, 10) === d).length);
  const avgDailyRead = Math.round(weekReads.reduce((a, b) => a + b, 0) / 7 * 10) / 10;
  const maxHeat = Math.max(...weekReads, 1);
  const readRate = bookmarks.length ? Math.round(bookmarks.filter(b => b.isRead).length / bookmarks.length * 100) : 0;

  // 30-day trend
  const day30 = Array.from({ length: 30 }).map((_, idx) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (29 - idx));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const trendData = day30.map(d => sorted.filter(b => (b.readAt || '').slice(0, 10) === d).length);
  const maxTrend = Math.max(...trendData, 1);

  return {
    streak,
    peakHour,
    hourDist,
    topInterests,
    avgDailyRead,
    readRate,
    topSources,
    trendData,
    maxTrend,
    day30,
    avgSummaryLength,
    deepReads,
    shallowReads,
    topTags,
    totalBookmarks,
    // 7 天热力图（原来只算不导出；useIntelligenceMemos 曾为此整段重算一遍）
    day7,
    heatData: weekReads,
    maxHeat,
  };
}

/**
 * 把阅读画像里 topInterests[].id 映射为赛道展示名（label）。
 *
 * 为什么不并进 computeReadingProfile：label 依赖外部赛道字典（categories 来自 store），
 * 而 computeReadingProfile 是零依赖纯函数——混进来会让它无法脱离 store 单测。
 * 这里单独留一层纯函数做映射，既保住 computeReadingProfile 的纯度，又让映射本身可被单测
 * （此前这段逻辑只存在于 useIntelligenceMemos 的 useMemo 里，无任何测试覆盖）。
 *
 * @param {Object} readingProfile - computeReadingProfile 的返回值
 * @param {Array<{id:string,label:string}>} categories - 赛道字典
 * @returns {Object} 同结构对象，topInterests 每项多了 label 字段
 */
export function withInterestLabels(readingProfile, categories = []) {
  if (!readingProfile || typeof readingProfile !== 'object') return readingProfile;
  const list = Array.isArray(categories) ? categories : [];
  const interests = Array.isArray(readingProfile.topInterests) ? readingProfile.topInterests : [];
  return {
    ...readingProfile,
    topInterests: interests.map(t => ({
      ...t,
      label: list.find(c => c?.id === t?.id)?.label || t?.id,
    })),
  };
}

/**
 * Compute the learning engine representation.
 */
export function computeProfileLearningEngine({
  readingHistory = [],
  bookmarks = [],
  materials = [],
  selectedInterests = [],
  domainTiers = null,
  domainPriorities = {},
  recommendationFeedback = {},
  followKeywords = [],
  sourceTiers = null,
  sourcePriorities = {},
  categories = null,
}) {
  const resolvedDomainTiers = domainTiers || domainPriorities;
  const resolvedSourceTiers = sourceTiers || sourcePriorities;
  const categoryMap = new Map();
  const sourceMap = new Map();
  const tagMap = new Map();
  // v22 画像敏感度：阅读深度分级权重——完整阅读 3、预览 1.5（历史无 depth 字段按完整阅读算）
  const READING_WEIGHT = { full: 3, preview: 1.5 };
  const fullReadCount = readingHistory.filter(item => item.depth !== 'preview').length;
  const previewCount = readingHistory.length - fullReadCount;
  const allBehaviorItems = [
    ...readingHistory.map(item => ({ ...item, weight: READING_WEIGHT[item.depth] ?? 3 })),
    ...bookmarks.map(item => ({ ...item, weight: 4 })),
    ...materials.map(item => ({ ...item, weight: 5 })),
  ];

  allBehaviorItems.forEach(item => {
    if (item.category) categoryMap.set(item.category, (categoryMap.get(item.category) || 0) + item.weight);
    if (item.source) sourceMap.set(item.source, (sourceMap.get(item.source) || 0) + item.weight);
    (item.tags || []).forEach(tag => { if (tag) tagMap.set(tag, (tagMap.get(tag) || 0) + item.weight); });
  });

  // domain priorities
  selectedInterests.forEach(id => categoryMap.set(id, (categoryMap.get(id) || 0) + domainTierScore(resolvedDomainTiers[id])));
  // recommendation feedback
  Object.entries(recommendationFeedback.boostedCategories || {}).forEach(([id, count]) => categoryMap.set(id, (categoryMap.get(id) || 0) + count * 6));
  Object.entries(recommendationFeedback.trackedTerms || {}).forEach(([term, count]) => tagMap.set(term, (tagMap.get(term) || 0) + count * 5));
  followKeywords.forEach(term => tagMap.set(term, (tagMap.get(term) || 0) + 4));
  Object.entries(resolvedSourceTiers || {}).forEach(([source, tier]) => sourceMap.set(source, (sourceMap.get(source) || 0) + sourceTierScore(tier)));
  // muted sources
  Object.entries(recommendationFeedback.mutedSources || {}).forEach(([source, count]) => sourceMap.set(source, Math.max(0, (sourceMap.get(source) || 0) - count * 8)));

  const topCategories = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => {
      const tier = normalizeTier(resolvedDomainTiers[id]);
      const category = categories?.find(c => c.id === id);
      return {
        id,
        label: category?.label || id,
        ...(tier ? { tier, tierScore: domainTierScore(tier) } : {}),
        score: Math.round(score),
      };
    });
  const topSources = [...sourceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, score]) => {
      const tier = normalizeTier(resolvedSourceTiers[name]);
      return {
        name,
        ...(tier ? { tier, tierScore: sourceTierScore(tier) } : {}),
        score: Math.round(score),
      };
    });
  const topTags = [...tagMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, score]) => ({ name, score: Math.round(score) }));

  // behavior depth
  const recentReads = readingHistory.filter(item => Date.now() - new Date(item.readAt || 0).getTime() < 7 * 24 * 60 * 60 * 1000);
  const savedRatio = readingHistory.length ? Math.round(bookmarks.length / Math.max(readingHistory.length, 1) * 100) : 0;
  const behaviorDepth = materials.length >= bookmarks.length && materials.length > 0
    ? '资产沉淀型'
    : savedRatio >= 50 ? '收藏复盘型'
    : recentReads.length >= 6 ? '高频扫描型'
    : '探索校准型';

  // feedback learning count — needed for confidence formula (Phase 1.2 Task 10)
  const feedbackLearningCount =
    (recommendationFeedback.hiddenIds || []).length
    + Object.values(recommendationFeedback.boostedCategories || {}).reduce((sum, v) => sum + v, 0)
    + Object.values(recommendationFeedback.mutedSources || {}).reduce((sum, v) => sum + v, 0)
    + Object.values(recommendationFeedback.trackedTerms || {}).reduce((sum, v) => sum + v, 0);

  // confidence（v22：预览行为按 0.7 折算计入，画像对轻量浏览更敏感）
  const confidence = Math.min(96, Math.round(
    Math.min(fullReadCount, 30) * 1.4
    + Math.min(previewCount, 30) * 0.7
    + Math.min(bookmarks.length, 20) * 1.3
    + Math.min(materials.length, 20) * 1.8
    + selectedInterests.length * 3
    + followKeywords.length * 1.8
    + feedbackLearningCount * 2
  ));

  const dominantCategory = topCategories[0]?.label || '综合科技';
  const dominantSource = topSources[0]?.name || '多来源';
  const dominantTag = topTags[0]?.name || '关键趋势';

  // blind spots — categories not selected AND not read
  const selectedSet = new Set(selectedInterests);
  const readCategorySet = new Set(readingHistory.map(item => item.category).filter(Boolean));
  const blindSpots = [];
  if (topCategories.length === 0 && selectedInterests.length === 0) {
    blindSpots.push('尚未建立阅读偏好，建议先浏览今日推荐');
  }
  if (confidence < 30) {
    blindSpots.push('行为数据不足，画像可信度偏低，建议先阅读并收藏 3 条内容');
  }
  if (!followKeywords.length) {
    blindSpots.push('尚未设置追踪词汇，建议添加 2-3 个专注方向');
  }

  const nextActions = [];
  if (selectedInterests.length === 0) nextActions.push('设置关注领域');
  if (followKeywords.length === 0) nextActions.push('添加追踪关键词');
  if (readingHistory.length < 3) nextActions.push('先阅读今日推荐的 5 条资讯');
  if (!nextActions.length && focusMatchCount(topCategories, selectedInterests) < 3) nextActions.push('扩充关注领域或提高对应领域权重');
  if (!nextActions.length) nextActions.push('今日情报已接入推荐，继续阅读并收藏有价值的内容');

  // extended fields (Phase 1.2 Task 7) — mirror App.jsx inline useMemo behavior
  const multimediaReads = readingHistory.filter(item => item.imageUrl || item.videoUrl).length;
  const materialRatio = bookmarks.length
    ? Math.round(materials.length / Math.max(bookmarks.length, 1) * 100) : 0;
  // feedbackLearningCount is computed above (before confidence) — reused here
  const authorMap = new Map();
  bookmarks.forEach(b => {
    if (b.author) authorMap.set(b.author, (authorMap.get(b.author) || 0) + 1);
  });
  const topAuthors = [...authorMap.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  const explanationArr = [
    topCategories[0] ? `领域权重最高：${topCategories[0].label}` : '',
    topSources[0] ? `信任来源最高：${topSources[0].name}` : '',
    topTags.length ? `记忆关键词：${topTags.slice(0, 3).map(i => i.name).join('、')}` : '',
    recommendationFeedback.mutedSources && Object.keys(recommendationFeedback.mutedSources).length
      ? `已降低 ${Object.keys(recommendationFeedback.mutedSources).slice(0, 2).join('、')} 的权重` : ''
  ].filter(Boolean);

  return {
    confidence,
    confidenceLabel: confidence >= 75 ? '高可信' : confidence >= 45 ? '持续学习中' : '需要校准',
    behaviorDepth,
    topCategories,
    topSources,
    topTags,
    blindSpots: blindSpots.slice(0, 4),
    nextActions: nextActions.slice(0, 4),
    summary: confidence >= 45
      ? `系统判断你当前更偏向「${dominantCategory}」与「${dominantTag}」，信任来源集中在「${dominantSource}」，推荐会优先保留高质量、可沉淀的信息。`
      : confidence >= 20
        ? '正在学习你的阅读偏好，多阅读和收藏后会更快收敛。'
        : '行为数据不足，继续进行阅读和收藏动作后系统会更懂你。',
    explanation: explanationArr.join('；'),
    savedRatio,
    materialRatio,
    recentReadCount: recentReads.length,
    multimediaReads,
    feedbackLearningCount,
    topAuthors,
    fullReadCount,
    previewCount,
  };
}

function focusMatchCount(topCategories, selectedInterests) {
  const sel = new Set(selectedInterests);
  return topCategories.filter(c => sel.has(c.id)).length;
}

/**
 * Compute today's profile snapshot object.
 */
export function computeTodayProfileSnapshot({
  date,
  intelligenceProfile,
  profileLearningEngine,
  readingHistory,
  bookmarks,
  materials,
  sourcePriorityItems = [],
}) {
  return {
    date,
    focus: (intelligenceProfile.focusLabels || []).slice(0, 5),
    tracked: (intelligenceProfile.tracked || []).slice(0, 5),
    depth: intelligenceProfile.depth || '探索校准',
    outputGoal: intelligenceProfile.outputGoal || '阅读判断',
    confidence: profileLearningEngine.confidence ?? 0,
    learningSummary: profileLearningEngine.summary || '',
    behaviorDepth: profileLearningEngine.behaviorDepth || '探索校准型',
    blindSpots: (profileLearningEngine.blindSpots || []).slice(0, 3),
    nextActions: (profileLearningEngine.nextActions || []).slice(0, 3),
    reads: readingHistory.length,
    saved: bookmarks.length,
    materials: materials.length,
    sources: sourcePriorityItems.slice(0, 3).map(s => s.name),
  };
}

/**
 * Compute calibration signals for the AI prompt layer.
 *
 * Returns three booleans used to decide whether the AI should mention
 * calibration suggestions in its responses. The UI-derived "校准信号卡片数组"
 * (array of {label, value, desc} cards) is kept inline in App.jsx because
 * it depends on UI-only state (profilePriorityItems / sourcePriorityItems).
 *
 * @param {Object} opts
 * @param {Object} [opts.intelligenceProfile] - profile with `confidence` field
 * @param {Object} [opts.recommendationFeedback] - feedback with boostedCategories/mutedSources/trackedTerms
 * @param {Array}  [opts.dailyProfileSnapshots] - snapshot history array
 * @returns {{hasFeedbackData: boolean, hasSnapshotHistory: boolean, needsCalibration: boolean}}
 */
export function computeCalibrationSignals({
  intelligenceProfile = {},
  recommendationFeedback = {},
  dailyProfileSnapshots = [],
} = {}) {
  const confidence = intelligenceProfile?.confidence ?? 0;
  const hasFeedbackData =
    Object.keys(recommendationFeedback?.boostedCategories || {}).length > 0 ||
    Object.keys(recommendationFeedback?.mutedSources || {}).length > 0 ||
    Object.keys(recommendationFeedback?.trackedTerms || {}).length > 0;
  const hasSnapshotHistory = (dailyProfileSnapshots?.length || 0) >= 3;
  return {
    hasFeedbackData,
    hasSnapshotHistory,
    needsCalibration: confidence < 45,
  };
}
