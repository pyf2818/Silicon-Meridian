/**
 * NewsPreviewStore - 资讯侧边预览的全局状态
 *
 * 为什么用 store 而不是 props：NewsItem 在 4 个页面（全部资讯/今日推荐/热门/GitHub）
 * 中复用，逐层透传 onOpenPreview 需要改 6 个文件的接口；卡片点击只做一件事
 * 「打开我」，用全局 store 零接线，面板本身在 App 根部挂一次。
 */
import { create } from 'zustand';

export const useNewsPreviewStore = create((set) => ({
  item: null,       // 当前预览的资讯快照 { id,title,summary,url,source,... }
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}));
