function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function textFor(event = {}) {
  return `${event.title || ''} ${event.summary || ''} ${event.category || ''} ${event.categoryLabel || ''} ${(event.entities || []).join(' ')}`.toLowerCase();
}

export function scorePersonalFit(event = {}, context = {}) {
  const interests = normalizeList(context.interests);
  const follows = normalizeList(context.follows || context.specialFollows);
  const sourceTiers = normalizeList(context.sourceTiers);
  // 学习主题（learned_preferences.topics）：LLM/启发式从历史交互推导，权重低于手动兴趣
  const learnedTopics = normalizeList(context.learnedTopics || context.learned?.topics);
  const text = textFor(event);
  const eventCategory = String(event.category || '').toLowerCase();
  const eventCategoryLabel = String(event.categoryLabel || '').toLowerCase();

  // v26.8 修复：interests 是类目 ID（如 ai-models / policy-finance），此前一律
  // text.includes 匹配标题——类目 ID 几乎永远不会出现在标题里，22pt 加权形同虚设。
  // 现在优先做类目直等/标签匹配，标题文本匹配仅作为兜底（关键词型兴趣）。
  const interestMatches = interests.filter(interest => {
    const value = interest.toLowerCase();
    if (!value) return false;
    if (eventCategory === value || eventCategoryLabel === value) return true;
    return text.includes(value);
  });
  const followMatches = follows.filter(follow => {
    const value = follow.toLowerCase();
    return value && text.includes(value);
  });
  const sourceMatches = sourceTiers.filter(source => {
    const value = source.toLowerCase();
    return value && (event.sources || []).some(item => String(item).toLowerCase().includes(value));
  });
  const learnedMatches = learnedTopics.filter(topic => {
    const value = topic.toLowerCase();
    return value && text.includes(value);
  });

  const score = Math.min(100,
    interestMatches.length * 22
    + followMatches.length * 28
    + sourceMatches.length * 14
    + learnedMatches.length * 12
    + ((event.confidence || 0) >= 70 ? 8 : 0)
    + ((event.independentSourceCount || 1) > 1 ? 8 : 0)
  );

  return {
    personalScore: Math.round(score),
    personalReasons: [
      ...interestMatches.map(item => `interest:${item}`),
      ...followMatches.map(item => `follow:${item}`),
      ...sourceMatches.map(item => `source:${item}`),
      ...learnedMatches.map(item => `learned:${item}`),
    ].slice(0, 6),
  };
}

import { rankItem } from '../../ranking/ranker.js';

/** 影子模式开关：读在调用时而非模块加载时，测试可动态切换 */
function rankerEnabled() {
  return process.env.MERIDIAN_RANKER_V2 === '1';
}

export function applyPersonalScores(events = [], context = {}) {
  const hasContext = normalizeList(context.interests).length
    || normalizeList(context.follows || context.specialFollows).length
    || normalizeList(context.sourceTiers).length
    || normalizeList(context.learnedTopics || context.learned?.topics).length;

  // 事件本身就是聚类：自带 independentSourceCount + firstSeenAt，velocity 信号因此有真实数据
  const withRank = event => (rankerEnabled()
    ? { ...rankItem(event, { lane: 'personal', now: context.now ?? Date.now(), hasProfile: hasContext, cluster: event }) }
    : {});

  if (!hasContext) {
    return events.map(event => ({
      ...event,
      personalScore: event.personalScore || 0,
      personalReasons: event.personalReasons || [],
      ...withRank(event),
    }));
  }

  return events.map(event => {
    const personal = scorePersonalFit(event, context);
    return {
      ...event,
      ...personal,
      intelligenceScore: Math.round(Math.min(100, (event.intelligenceScore || 0) * 0.72 + personal.personalScore * 0.28)),
      ...withRank(event),
    };
  }).sort((a, b) => {
    // 影子模式开启时优先按统一排序内核的分数排；否则保持原口径
    if (a.rankScore != null && b.rankScore != null && a.rankScore !== b.rankScore) return b.rankScore - a.rankScore;
    const scoreDiff = (b.intelligenceScore || 0) - (a.intelligenceScore || 0);
    if (scoreDiff) return scoreDiff;
    return (b.personalScore || 0) - (a.personalScore || 0);
  });
}
