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
 * @param {string} deps.selectedNewsDate         - Currently selected news date (YYYY-MM-DD).
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

  // 统一推荐引擎：系统A(用户权重)+系统B(AI算法)+系统C(动态行为)
  const todayMustRead = useMemo(() => {
    const readIds = new Set(readingHistory.map(h => h.id));
    const bookmarkIds = new Set(bookmarks.map(b => b.itemId || b.id));

    // 领域热度统计（基于当前所有文章）
    const categoryPopularity = new Map();
    items.forEach(item => {
      if (item.category) {
        categoryPopularity.set(item.category, (categoryPopularity.get(item.category) || 0) + 1);
      }
    });
    const maxCategoryPop = Math.max(...categoryPopularity.values(), 1);

    // 热门关键词统计
    const keywordFrequency = new Map();
    items.forEach(item => {
      const text = `${item.title} ${item.summary || ''}`.toLowerCase();
      const words = text.match(/\b[a-z一-龥]{2,}\b/g) || [];
      words.forEach(word => {
        if (!/^[a-z]{2}$/.test(word)) { // 过滤过短的英文单词
          keywordFrequency.set(word, (keywordFrequency.get(word) || 0) + 1);
        }
      });
    });
    const topKeywords = [...keywordFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([word]) => word);
    const eventClusters = clusterEvents(items);
    const clusterByItemId = new Map();
    eventClusters.forEach(cluster => cluster.itemIds.forEach(id => clusterByItemId.set(id, cluster)));
    const effectiveDomainTiers = selectedInterests.reduce(
      (tiers, id) => ({ ...tiers, [id]: tiers[id] || 'normal' }),
      { ...domainTiers }
    );
    const effectiveSpecialFollows = [
      ...specialFollows,
      ...followKeywords.map(target => ({ type: 'keyword', target })),
    ];

    return items
      .filter(item => !readIds.has(item.id))  // 已读过滤：避免重复推荐
      .map(item => {
        // 领域匹配（用于 trendVelocity 上下文）
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
          isNovel: !readIds.has(item.id),
          // Phase 3 Task B12: 注入 personaSummary + relevantMemories 供推荐算法可选使用
          personaSummary,
          relevantMemories,
        });
      })
      .sort((a, b) => b.mustReadScore - a.mustReadScore)
      .slice(0, 500);
  }, [items, followKeywords, readingHistory, bookmarks, selectedInterests, domainTiers, sourceTiers, specialFollows, personaSummary, relevantMemories]);

  const recommendationCandidates = useMemo(() => todayMustRead.filter(item =>
    item.publishedAt?.slice(0, 10) === selectedNewsDate
  ), [todayMustRead, selectedNewsDate]);

  const recommendationLanes = useMemo(() => selectBriefingLanes(recommendationCandidates, {
    perLane: 5,
    maxPerSource: 2,
    maxCategoryRatio: 0.4,
  }), [recommendationCandidates]);

  const algorithmBriefing = useMemo(() => buildAlgorithmBriefing({
    date: selectedNewsDate,
    lanes: recommendationLanes,
  }), [selectedNewsDate, recommendationLanes]);

  // Phase 3 Task B17: 暴露 eventClusters 给 App.jsx，避免 L1112 重复调用 clusterEvents
  // 注意：基于全量 items 聚类（与 todayMustRead 内部一致），App.jsx 用作 eventClusters prop
  const eventClusters = useMemo(() => clusterEvents(items), [items]);

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
