/**
 * NewsPreviewStore - 资讯侧边预览的全局状态
 *
 * 为什么用 store 而不是 props：NewsItem 在 4 个页面（全部资讯/今日推荐/热门/GitHub）
 * 中复用，逐层透传 onOpenPreview 需要改 6 个文件的接口；卡片点击只做一件事
 * 「打开我」，用全局 store 零接线，面板本身在 App 根部挂一次。
 *
 * v26.8：打开预览 = 一次预览行为，顺手记入行为库（预览轨迹 + depth='preview'
 * 并入阅读记录，作为画像/推荐的分析依据）。节流与去重在 recordPreview 内部处理。
 */
import { create } from 'zustand';
import { useBehaviorStore } from './behaviorStore.js';

export const useNewsPreviewStore = create((set) => ({
  item: null,       // 当前预览的资讯快照 { id,title,summary,url,source,... }
  open: (item) => {
    if (item?.id) {
      try { useBehaviorStore.getState().recordPreview(item); } catch { /* 行为记录失败不影响预览 */ }
    }
    set({ item });
  },
  close: () => set({ item: null }),
}));
