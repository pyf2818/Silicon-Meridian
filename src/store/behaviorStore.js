import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const READING_HISTORY_CAP = 200;
const PREVIEW_HISTORY_CAP = 200;
// 同一条目 60s 内重复打开预览只算一次（防连点/预览面板内反复刷新灌水）
const PREVIEW_DEDUPE_WINDOW_MS = 60_000;

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch { return fallback; }
}

/**
 * 将旧 localStorage key（readingHistory/followKeywords/trackTargets/
 * recommendationFeedback/recommendationFeedback:v2）合并到 persisted。
 * 旧 key 保留 30 天不删除（仅复制）。
 */
export function migrateLegacyBehavior(persisted = {}) {
  const merged = { ...persisted };

  if (!merged.readingHistory || !merged.readingHistory.length) {
    const legacy = readLS('readingHistory', []);
    if (legacy.length) merged.readingHistory = legacy;
  }

  if (!merged.followKeywords || !merged.followKeywords.length) {
    const legacy = readLS('followKeywords', []);
    if (legacy.length) merged.followKeywords = legacy;
  }

  if (!merged.trackTargets || !merged.trackTargets.length) {
    const legacy = readLS('trackTargets', []);
    if (legacy.length) merged.trackTargets = legacy;
  }

  const legacyFeedback = readLS('recommendationFeedback', null);
  if (legacyFeedback && (!merged.recommendationFeedback ||
      Object.keys(merged.recommendationFeedback).length === 0 ||
      (merged.recommendationFeedback.hiddenIds?.length === 0 &&
       Object.keys(merged.recommendationFeedback.boostedCategories || {}).length === 0))) {
    merged.recommendationFeedback = {
      hiddenIds: legacyFeedback.hiddenIds || [],
      boostedCategories: legacyFeedback.boostedCategories || {},
      mutedSources: legacyFeedback.mutedSources || {},
      trackedTerms: legacyFeedback.trackedTerms || {},
    };
  }

  if (!merged.recommendationFeedbackEvents || !merged.recommendationFeedbackEvents.length) {
    const legacy = readLS('recommendationFeedback:v2', []);
    if (legacy.length) merged.recommendationFeedbackEvents = legacy;
  }

  return merged;
}

export const useBehaviorStore = create(
  persist(
    (set, get) => ({
      readingHistory: [],
      previewHistory: [],
      recommendationFeedback: { hiddenIds: [], boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
      recommendationFeedbackEvents: [],
      followKeywords: [],
      trackTargets: [],

      // ===== actions =====
      addReadingHistory: (item) => set(state => ({
        readingHistory: [{ ...item, readAt: item.readAt || new Date().toISOString() },
                          ...state.readingHistory].slice(0, READING_HISTORY_CAP)
      })),
      /**
       * v22 画像敏感度：统一的行为入账入口，带深度合并。
       * depth: 'preview'（侧边预览）/ 'full'（点击阅读原文或预览停留≥8s）。
       * 同一条目重复触发不产生重复行：保留最高深度 + 累计 previewCount，置顶并刷新 readAt。
       */
      upsertReadingEntry: (item, depth = 'full') => set(state => {
        const prev = state.readingHistory.find(x => x.id === item.id);
        const nextDepth = prev?.depth === 'full' || depth === 'full' ? 'full' : 'preview';
        const now = new Date().toISOString();
        const merged = {
          ...item,
          depth: nextDepth,
          previewCount: (prev?.previewCount || 0) + (depth === 'preview' ? 1 : 0),
          readAt: now,
          ...(prev?.firstReadAt ? {} : { firstReadAt: now }),
        };
        return {
          readingHistory: [merged, ...state.readingHistory.filter(x => x.id !== item.id)].slice(0, READING_HISTORY_CAP),
        };
      }),
      setReadingHistory: (updater) => {
        const cur = get().readingHistory;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ readingHistory: next.slice(0, READING_HISTORY_CAP) });
      },
      clearReadingHistory: () => set({ readingHistory: [] }),

      // ===== v26.8 预览历史 =====
      /** 预览轨迹（独立持久化）：同 id upsert 置顶 + 累计 previewCount，cap 200 */
      addPreviewHistory: (item) => set(state => {
        const now = new Date().toISOString();
        const prev = state.previewHistory.find(x => x.id === item.id);
        const merged = {
          ...(prev || {}),
          ...item,
          previewCount: (prev?.previewCount || 0) + 1,
          previewAt: now,
          ...(prev?.firstPreviewAt ? {} : { firstPreviewAt: now }),
        };
        return {
          previewHistory: [merged, ...state.previewHistory.filter(x => x.id !== item.id)].slice(0, PREVIEW_HISTORY_CAP),
        };
      }),
      /**
       * v26.8 预览入账统一入口（newsPreviewStore.open 调用）：
       * 1) 记入预览轨迹；2) 以 depth='preview' 并入阅读记录（与正式阅读一并纳入画像分析，
       *    不覆盖已存在的 full 深度）。60s 内同条目重复打开直接忽略。
       */
      recordPreview: (item) => {
        if (!item?.id) return;
        const prev = get().previewHistory.find(x => x.id === item.id);
        if (prev?.previewAt && Date.now() - Date.parse(prev.previewAt) < PREVIEW_DEDUPE_WINDOW_MS) return;
        get().addPreviewHistory(item);
        get().upsertReadingEntry(item, 'preview');
      },
      clearPreviewHistory: () => set({ previewHistory: [] }),

      setRecommendationFeedback: (updater) => {
        const cur = get().recommendationFeedback;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ recommendationFeedback: next });
      },
      addFeedbackEvent: (event) => set(state => ({
        recommendationFeedbackEvents: [{ ...event, ts: event.ts || Date.now() },
                                       ...state.recommendationFeedbackEvents].slice(0, 200)
      })),

      addFollowKeyword: (kw) => set(state => state.followKeywords.includes(kw)
        ? state
        : { followKeywords: [...state.followKeywords, kw] }),
      removeFollowKeyword: (kw) => set(state => ({ followKeywords: state.followKeywords.filter(k => k !== kw) })),
      setFollowKeywords: (updater) => {
        const cur = get().followKeywords;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ followKeywords: next });
      },

      addTrackTarget: (t) => set(state => {
        const idx = state.trackTargets.findIndex(x => x.term === t.term);
        if (idx >= 0) {
          const next = [...state.trackTargets];
          next[idx] = { ...next[idx], ...t };
          return { trackTargets: next };
        }
        return { trackTargets: [...state.trackTargets, t] };
      }),
      removeTrackTarget: (term) => set(state => ({ trackTargets: state.trackTargets.filter(t => t.term !== term) })),
      setTrackTargets: (updater) => {
        const cur = get().trackTargets;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ trackTargets: next });
      },

      clearAll: () => set({
        readingHistory: [],
        previewHistory: [],
        recommendationFeedback: { hiddenIds: [], boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
        recommendationFeedbackEvents: [],
        followKeywords: [],
        trackTargets: [],
      }),
    }),
    {
      name: 'siliconstream-behavior-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        readingHistory: s.readingHistory,
        previewHistory: s.previewHistory,
        recommendationFeedback: s.recommendationFeedback,
        recommendationFeedbackEvents: s.recommendationFeedbackEvents,
        followKeywords: s.followKeywords,
        trackTargets: s.trackTargets,
      }),
      // 仅首次 rehydrate 时执行迁移
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const migrated = migrateLegacyBehavior({
          readingHistory: state.readingHistory,
          recommendationFeedback: state.recommendationFeedback,
          recommendationFeedbackEvents: state.recommendationFeedbackEvents,
          followKeywords: state.followKeywords,
          trackTargets: state.trackTargets,
        });
        // 已 rehydrate 的 state 不能直接覆盖，用 setTimeout 推迟一拍
        setTimeout(() => useBehaviorStore.setState(migrated), 0);
      },
    }
  )
);
