import { useMemo, useState, useEffect } from 'react';
import {
  domainTierScore,
  sourceTierScore,
} from '../domain/intelligence/profileTiers.js';
import {
  buildRecommendation,
  clusterEvents,
  selectBriefingLanes,
} from '../domain/intelligence/recommendationEngine.js';
import { buildPrecisionFeed } from '../domain/intelligence/precisionFeed.js';
import { buildAlgorithmBriefing } from '../domain/intelligence/briefingEngine.js';
import { useProfileStore } from '../store';
import { fetchRelevantMemories } from '../utils/memoryEvolver.js';

// Category groups used for related-category scoring in todayMustRead.
// Mirrors the App.jsx file-scope constant so the hook stays self-contained
// while preserving identical scoring behavior.
const CATEGORY_GROUPS = [
  { id: 'tech-ai', label: '科技前沿', icon: 'flask', categories: ['ai-models', 'research', 'open-source', 'data-science', 'quantum', 'cybersecurity', 'chips-compute'] },
  { id: 'hardware-consumer', label: '消费电子', icon: 'device', categories: ['devices', 'robotics', 'iot-5g', 'metaverse-xr', 'automotive'] },
  { id: 'industry-economy', label: '产业经济', icon: 'building', categories: ['silicon-valley', 'china-tech', 'policy-finance', 'fintech', 'economy-stock'] },
  { id: 'entertainment', label: '娱乐文化', icon: 'star', categories: ['gaming', 'game-entertain', 'showbiz', 'anime-acg'] },
  { id: 'lifestyle-health', label: '生活健康', icon: 'heart', categories: ['space', 'new-energy', 'climate-esg', 'healthcare', 'education-tech'] }
];

/**
 * Extracts the recommendation-related useMemo computations from App.jsx.
 *
 * Returns the five memoized values:
 *  - followKeywordUpdates
 *  - todayMustRead
 *  - recommendationCandidates
 *  - recommendationLanes
 *  - algorithmBriefing
 *
 * All logic and dependency arrays are preserved verbatim from App.jsx so
 * behavior remains identical.
 *
 * @param {Object} deps
 * @param {Array}  deps.items                    - Current news items pool.
 * @param {Array}  deps.followKeywords           - User-tracked keyword list.
 * @param {Array}  deps.readingHistory           - User reading history records.
 * @param {Array}  deps.bookmarks                - User bookmarked items.
 * @param {Array}  deps.selectedInterests        - User-selected interest category ids.
 * @param {Object} deps.domainTiers              - Profile domain tier map.
 * @param {Object} deps.sourceTiers              - Profile source tier map.
 * @param {Array}  deps.specialFollows           - Special follow entries (source/author/url/keyword).
 * @param {string} deps.selectedNewsDate         - Currently selected news date (YYYY-MM-DD). Note: candidates no longer depend on this (they are now strictly the current day's feed).
 * @param {Object} deps.recommendationFeedback   - Feedback aggregate {hiddenIds, boostedCategories, mutedSources, trackedTerms} (negative feedback loop).
 * @param {Array}  deps.recommendationFeedbackEvents - Feedback event stream [{type, category, source, ts}].
 */
export function useRecommendationMemos({
  items,
  followKeywords,
  readingHistory,
  bookmarks,
  selectedInterests,
  domainTiers,
  sourceTiers,
  specialFollows,
  selectedNewsDate,
  recommendationFeedback = {},
  recommendationFeedbackEvents = [],
}) {
  // Phase 3 Task B12: 异步加载 relevantMemories（基于 top items 的 title+summary 做 query）
  // 失败静默，不阻塞主推荐流程
  const [relevantMemories, setRelevantMemories] = useState([]);
  useEffect(() => {
    if (items.length === 0) {
      setRelevantMemories([]);
      return;
    }
    let cancelled = false;
    const queries = items.slice(0, 5).map(item =>
      `${item.title} ${item.summary || ''}`.slice(0, 200)
    );
    Promise.all(queries.map(q => fetchRelevantMemories(q, 3).catch(() => [])))
      .then(results => {
        if (cancelled) return;
        const seen = new Set();
        const all = results.flat().filter(m => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
        setRelevantMemories(all.slice(0, 10));
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [items]);

  // Phase 3 Task B12: 读取 personaSummary（直接读不订阅，变化频率低，避免重算）
  const personaSummary = useProfileStore(s => s.personaSummary);

  // 我的关注动态：按关键词分组展示最新匹配的资讯
  const followKeywordUpdates = useMemo(() => {
    if (followKeywords.length === 0) return [];
    return followKeywords.map(kw => {
      const matched = items.filter(item =>
        `${item.title} ${item.summary}`.toLowerCase().includes(kw.toLowerCase())
      ).slice(0, 3);
      return { keyword: kw, count: matched.length, items: matched };
    }).filter(g => g.count > 0);
  }, [followKeywords, items]);

  // Phase 3 Task B17: eventClusters 提前计算——todayMustRead 与精准推荐流共用同一份聚类，
  // 消除此前 todayMustRead 内部重复执行一次 clusterEvents 的开销
  const eventClusters = useMemo(() => clusterEvents(items), [items]);
  const clusterByItemId = useMemo(() => {
    const map = new Map();
    eventClusters.forEach(cluster => cluster.itemIds.forEach(id => map.set(id, cluster)));
    return map;
  }, [eventClusters]);

  // 用户选择的兴趣领域视为 normal 分层参与打分；特别关注并入关注词
  const effectiveDomainTiers = useMemo(
    () => selectedInterests.reduce(
      (tiers, id) => ({ ...tiers, [id]: tiers[id] || 'normal' }),
      { ...domainTiers }
    ),
    [selectedInterests, domainTiers],
  );
  const effectiveSpecialFollows = useMemo(
    () => [...specialFollows, ...followKeywords.map(target => ({ type: 'keyword', target }))],
    [specialFollows, followKeywords],
  );

  // 统一推荐引擎：系统A(用户权重)+系统B(AI算法)+系统C(动态行为) —— 候选池（供简报/仪表盘）
  const todayMustRead = useMemo(() => {
    // v26.8：已读排除仅针对正式阅读（depth!=='preview'），预览过的条目仍可被推荐
    const readIds = new Set(readingHistory.filter(h => h?.depth !== 'preview').map(h => h.id));
    const bookmarkIds = new Set(bookmarks.map(b => b.itemId || b.id));

    // 领域热度统计（基于当前所有文章）
    const categoryPopularity = new Map();
    items.forEach(item => {
      if (item.category) {
        categoryPopularity.set(item.category, (categoryPopularity.get(item.category) || 0) + 1);
      }
    });
    const maxCategoryPop = Math.max(...categoryPopularity.values(), 1);

    return items
      .filter(item => !readIds.has(item.id))  // 已读过滤：避免重复推荐
      .map(item => {
        const categoryScore = categoryPopularity.get(item.category) || 0;
        const categoryReadCount = readingHistory.filter(h => h.category === item.category).length;
        const sourceReadCount = readingHistory.filter(h => h.source === item.source).length;

        const cluster = clusterByItemId.get(item.id);
        const grade = item.sourceGradeLabel?.charAt(0) || item.grade;
        const sourceQualityScore = ({ S: 20, A: 17, B: 13, C: 9, D: 4 })[grade] || 10;
        return buildRecommendation({
          ...item,
          canonicalId: item.canonicalId || cluster?.id,
          sourceQualityScore,
        }, {
          domainTiers: effectiveDomainTiers,
          sourceTiers,
          specialFollows: effectiveSpecialFollows,
          independentSourceCount: cluster?.independentSourceCount || 1,
          trendVelocity: categoryScore / maxCategoryPop,
          behaviorSignal: bookmarkIds.has(item.id)
            ? 10
            : Math.min(categoryReadCount * 1.5 + sourceReadCount, 10),
          // novelty 修复：此前恒 true（items 已过滤已读，!readIds.has 恒真）。
          // 真正的「新颖」= 该分类最近没有阅读记录——同类读得多的新条目不再拿满新颖分
          isNovel: !readIds.has(item.id) && categoryReadCount === 0,
          // Phase 3 Task B12: 注入 personaSummary + relevantMemories 供推荐算法可选使用
          personaSummary,
          relevantMemories,
        });
      })
      .sort((a, b) => b.mustReadScore - a.mustReadScore)
      .slice(0, 500);
  }, [items, readingHistory, bookmarks, effectiveDomainTiers, sourceTiers, effectiveSpecialFollows, clusterByItemId, personaSummary, relevantMemories]);

  // 当日精准推荐流（抖音式）：多信号预估互动概率 + 时间衰减行为 + 探索流量池 + 多样性打散。
  // 硬约束：仅保留本地时区"今天 00:00 → 现在"发布的资讯；不限条数。
  // v26.8：当日合格内容不足 24 条时，回填近 48h 高分条目（isBackfill 标记），
  // 避免"新增领域冷启动/夜间时段"候选过薄导致推荐页只剩几条。
  const recommendationCandidates = useMemo(() => buildPrecisionFeed({
    items: todayMustRead,
    now: Date.now(),
    profile: {
      domainTiers: effectiveDomainTiers,
      sourceTiers,
      specialFollows: effectiveSpecialFollows,
      selectedInterests,
      followKeywords,
    },
    behavior: {
      readingHistory,
      bookmarks,
      feedback: recommendationFeedback,
      feedbackEvents: recommendationFeedbackEvents,
    },
    clusters: eventClusters,
    options: { minFeedSize: 24, backfillWindowHours: 48, backfillCap: 60 },
  }).feed, [todayMustRead, effectiveDomainTiers, sourceTiers, effectiveSpecialFollows, selectedInterests, followKeywords, readingHistory, bookmarks, recommendationFeedback, recommendationFeedbackEvents, eventClusters]);

  const recommendationLanes = useMemo(() => selectBriefingLanes(recommendationCandidates, {
    perLane: 5,
    maxPerSource: 2,
    maxCategoryRatio: 0.4,
  }), [recommendationCandidates]);

  const algorithmBriefing = useMemo(() => buildAlgorithmBriefing({
    date: selectedNewsDate,
    lanes: recommendationLanes,
  }), [selectedNewsDate, recommendationLanes]);

  return {
    followKeywordUpdates,
    todayMustRead,
    recommendationCandidates,
    recommendationLanes,
    algorithmBriefing,
    // Phase 3 Task B12: 暴露给下游组件（如 buildSystemPrompt 注入）
    relevantMemories,
    personaSummary,
    // Phase 3 Task B17: 暴露给 App.jsx 用作 NewsPage prop + allFeedItems 二级条目过滤
    eventClusters,
  };
}

export default useRecommendationMemos;
