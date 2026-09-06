import { useMemo } from 'react';
import {
  computeIntelligenceProfile,
  computeProfileLearningEngine,
  computeTodayProfileSnapshot,
  computeCalibrationSignals,
} from '../utils/profileModel.js';

/**
 * Extracted workbench and intelligence profile useMemo computations.
 *
 * Phase 1.2 refactor: this hook is now a thin shell over profileModel.js
 * pure functions. The intelligenceProfile / profileLearningEngine /
 * todayProfileSnapshot / calibrationFlags memos delegate to the pure
 * functions so they can be unit-tested independently.
 *
 * The "校准信号卡片数组" (array of {label, value, desc} cards) is kept
 * inline in App.jsx because it depends on UI-only state
 * (profilePriorityItems / sourcePriorityItems).
 *
 * Source of truth: src/utils/profileModel.js
 */

/**
 * @param {object} params
 * @param {Array}  params.todayMustRead         - Today's must-read items.
 * @param {Array}  params.selectedDateItems     - Items filtered by selected date.
 * @param {Array}  params.selectedInterests     - Selected interest category ids.
 * @param {Array}  params.followKeywords        - Tracked keyword list.
 * @param {object} params.recommendationFeedback - User feedback state (hiddenIds/boostedCategories/mutedSources/trackedTerms).
 * @param {Array}  params.bookmarks             - Saved bookmark items.
 * @param {Array}  params.materials             - Material library items.
 * @param {Array}  params.categories            - Full category list (with id/label/icon).
 * @param {object} params.domainTiers           - Domain tier map (id -> 'focus'|'normal'|'explore').
 * @param {object} params.sourceTiers           - Source tier map (name -> 'focus'|'normal'|'explore').
 * @param {object} params.readingProfile        - Reading profile object (must expose `topSources`).
 * @param {object} params.insightData           - Insight data object (must expose `sourceQuality`).
 * @param {(id: string) => boolean} params.isBookmarked  - Bookmark membership check.
 * @param {(id: string) => boolean} params.isInMaterials - Material membership check.
 * @param {Array}  [params.readingHistory]      - Reading history (for profile learning engine).
 * @param {string} [params.selectedNewsDate]    - Selected date string YYYY-MM-DD (for today's snapshot).
 * @param {Array}  [params.dailyProfileSnapshots] - Daily snapshot history (for calibration signals).
 */
export function useWorkbenchMemos({
  todayMustRead,
  selectedDateItems,
  selectedInterests,
  followKeywords,
  recommendationFeedback,
  bookmarks,
  materials,
  categories,
  domainTiers,
  sourceTiers,
  customDomains = [],
  customSources = [],
  readingProfile,
  insightData,
  isBookmarked,
  isInMaterials,
  readingHistory = [],
  selectedNewsDate,
  dailyProfileSnapshots = [],
}) {
  const workbenchItems = useMemo(() => {
    const seen = new Set();
    const hiddenIds = new Set(recommendationFeedback.hiddenIds || []);
    const boostedCategories = recommendationFeedback.boostedCategories || {};
    const mutedSources = recommendationFeedback.mutedSources || {};
    const trackedTerms = recommendationFeedback.trackedTerms || {};
    const enrichedDateItems = selectedDateItems
      .filter(item => (item.mustReadScore || 0) > 0 || selectedInterests.includes(item.category) || item.sourceGradeLabel?.startsWith('S') || item.sourceGradeLabel?.startsWith('A'));
    const fallbackDateItems = selectedDateItems.filter(item => !enrichedDateItems.includes(item));
    const primary = [...todayMustRead, ...enrichedDateItems, ...fallbackDateItems]
      .filter(item => {
        if (!item?.id || seen.has(item.id) || hiddenIds.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .map(item => {
        const feedbackBoost = (boostedCategories[item.category] || 0) * 8;
        const sourcePenalty = (mutedSources[item.source] || 0) * 12;
        const trackedBoost = Object.keys(trackedTerms).some(term => `${item.title} ${item.summary}`.toLowerCase().includes(term.toLowerCase())) ? 14 : 0;
        const feedbackScore = feedbackBoost + trackedBoost - sourcePenalty;
        if (item.recommendation) {
          const extraReasons = [];
          if (feedbackBoost > 0) extraReasons.push('你要求更多类似内容');
          if (trackedBoost > 0) extraReasons.push('匹配继续追踪主题');
          if (sourcePenalty > 0) extraReasons.push('已降低此来源权重');
          return {
            ...item,
            mustReadScore: (item.mustReadScore || 0) + feedbackScore,
            recommendationReasons: [...new Set([...(item.recommendationReasons || []), ...extraReasons])].slice(0, 3),
            recommendation: [...new Set([...(item.recommendationReasons || []), ...extraReasons])].slice(0, 3).join(' · ') || item.recommendation
          };
        }
        const reasons = [];
        if (selectedInterests.includes(item.category)) reasons.push('匹配你的关注领域');
        if (followKeywords.some(kw => `${item.title} ${item.summary}`.toLowerCase().includes(kw.toLowerCase()))) reasons.push('命中你的追踪关键词');
        if (item.sourceGradeLabel?.startsWith('S') || item.sourceGradeLabel?.startsWith('A')) reasons.push('来源质量较高');
        const age = (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60);
        if (age < 6) reasons.push('发布时间较新');
        if (feedbackBoost > 0) reasons.push('你要求更多类似内容');
        if (trackedBoost > 0) reasons.push('匹配继续追踪主题');
        if (sourcePenalty > 0) reasons.push('已降低此来源权重');
        return {
          ...item,
          mustReadScore: Math.max(0, feedbackScore),
          recommendationReasons: reasons.slice(0, 3),
          recommendation: reasons.length ? reasons.slice(0, 3).join(' · ') : '与所选日期和当前筛选条件相关'
        };
      })
      .sort((a, b) => (b.mustReadScore || 0) - (a.mustReadScore || 0));
    return primary;
  }, [todayMustRead, selectedDateItems, selectedInterests, followKeywords, recommendationFeedback]);

  const workbenchStats = useMemo(() => {
    const gradeCounts = workbenchItems.reduce((acc, item) => {
      const grade = item.sourceGradeLabel?.charAt(0) || item.grade || 'N/A';
      acc[grade] = (acc[grade] || 0) + 1;
      return acc;
    }, {});
    const focusMatches = workbenchItems.filter(item => selectedInterests.includes(item.category)).length;
    const keywordMatches = workbenchItems.filter(item => followKeywords.some(kw => `${item.title} ${item.summary}`.toLowerCase().includes(kw.toLowerCase()))).length;
    const savedCount = workbenchItems.filter(item => isBookmarked(item.id) || isInMaterials(item.id)).length;
    return { gradeCounts, focusMatches, keywordMatches, savedCount };
  }, [workbenchItems, selectedInterests, followKeywords, bookmarks, materials]);

  // intelligenceProfile: delegate to pure function (Phase 1.2 Task 10)
  const intelligenceProfile = useMemo(() => computeIntelligenceProfile({
    bookmarks,
    readingHistory: readingHistory || [],
    materials,
    selectedInterests,
    recommendationFeedback,
    followKeywords,
    sourcePriorities: Object.fromEntries(Object.entries(sourceTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
    domainPriorities: Object.fromEntries(Object.entries(domainTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
    insightSourceQuality: insightData?.sourceQuality || [],
    workbenchItemCount: workbenchItems.length,
    focusMatches: workbenchStats.focusMatches,
    categories,
    domainTiers, sourceTiers,
  }), [bookmarks, readingHistory, materials, selectedInterests, recommendationFeedback,
       followKeywords, sourceTiers, domainTiers, insightData, workbenchItems.length,
       workbenchStats.focusMatches, categories]);

  const profilePriorityItems = useMemo(() => {
    const base = selectedInterests.length ? selectedInterests : categories.slice(0, 6).map(c => c.id);
    const inferred = base.slice(0, 8).map((id, index) => {
      const category = categories.find(c => c.id === id);
      return {
        id,
        label: category?.label || id,
        tier: domainTiers[id] || (index < 2 ? 'focus' : index < 5 ? 'normal' : 'explore'),
        icon: category?.icon || 'target'
      };
    });
    // 用户手动添加的自定义领域：始终展示（不截断），分层跟随 domainTiers
    const custom = (customDomains || []).map(d => ({
      id: d.id,
      label: d.label,
      icon: 'plus',
      custom: true,
      tier: domainTiers[d.id] || 'normal',
    }));
    return [...inferred, ...custom.filter(c => !inferred.some(i => i.label === c.label))];
  }, [selectedInterests, domainTiers, categories, customDomains]);

  const sourcePriorityItems = useMemo(() => {
    const fallbackSources = Array.isArray(insightData.sourceQuality) ? insightData.sourceQuality : [];
    const sources = readingProfile.topSources.length
      ? readingProfile.topSources
      : fallbackSources.slice(0, 5).map(source => ({ name: source.name, count: source.count }));
    const inferred = sources.slice(0, 6).map((source, index) => ({
      name: source.name,
      count: source.count || 0,
      tier: sourceTiers[source.name] || (index < 2 ? 'focus' : index < 4 ? 'normal' : 'explore')
    }));
    // 自定义信息源：始终展示（不截断）
    const custom = (customSources || []).map(s => ({
      name: s.name,
      count: 0,
      custom: true,
      tier: sourceTiers[s.name] || 'normal',
    }));
    return [...inferred, ...custom.filter(c => !inferred.some(i => i.name === c.name))];
  }, [readingProfile.topSources, insightData.sourceQuality, sourceTiers, customSources]);

  // profileLearningEngine: delegate to pure function (Phase 1.2 Task 10)
  const profileLearningEngine = useMemo(() => computeProfileLearningEngine({
    readingHistory: readingHistory || [],
    bookmarks,
    materials,
    selectedInterests,
    domainTiers,
    domainPriorities: Object.fromEntries(Object.entries(domainTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
    recommendationFeedback,
    followKeywords,
    sourceTiers,
    sourcePriorities: Object.fromEntries(Object.entries(sourceTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
    categories,
  }), [readingHistory, bookmarks, materials, selectedInterests, domainTiers, recommendationFeedback, followKeywords, sourceTiers, categories]);

  // todayProfileSnapshot: delegate to pure function (Phase 1.2 Task 10)
  const todayProfileSnapshot = useMemo(() => computeTodayProfileSnapshot({
    date: selectedNewsDate,
    intelligenceProfile,
    profileLearningEngine,
    readingHistory: readingHistory || [],
    bookmarks,
    materials,
    sourcePriorityItems,
  }), [selectedNewsDate, intelligenceProfile, profileLearningEngine, readingHistory, bookmarks, materials, sourcePriorityItems]);

  // calibrationFlags: 3 booleans for AI prompt layer (Phase 1.2 Task 10)
  // Note: the UI "校准信号卡片数组" (cards with {label, value, desc}) is kept inline in App.jsx
  // because it depends on UI-only state (profilePriorityItems / sourcePriorityItems).
  const calibrationFlags = useMemo(() => computeCalibrationSignals({
    intelligenceProfile,
    recommendationFeedback,
    dailyProfileSnapshots,
  }), [intelligenceProfile, recommendationFeedback, dailyProfileSnapshots]);

  return {
    workbenchItems,
    workbenchStats,
    intelligenceProfile,
    profilePriorityItems,
    sourcePriorityItems,
    profileLearningEngine,
    todayProfileSnapshot,
    calibrationFlags,
  };
}
