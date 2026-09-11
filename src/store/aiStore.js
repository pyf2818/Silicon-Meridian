/**
 * AI Store - AI 助手状态
 *
 * 包含：AI Insights、Elf 引用上下文、Copilot 待发消息 3 个核心状态。
 * （v28：aiBrief 已随「洞察分析 v1」下线移除——generateAiBrief 唯一写入方不存在，
 *   旧 persisted 里的 aiBrief 由 merge 剔除，独立 LS key 'aiBrief' 按既有策略留置不删。）
 *
 * 持久化策略：
 * - aiInsights / elfQuotedContext / copilotPendingMessage 不持久化（会话级临时状态）
 * - 持久化桶当前为空：保留 persist 壳以兼容既有 LS 键名，避免旧数据残留生效
 *
 * 使用方式：
 *   import { useAiStore } from './store';
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ============ AI Store ============
export const useAiStore = create(
  persist(
    (set, get) => ({
      // ===== AI Insights（不持久化）=====
      aiInsights: { loading: false, data: null, error: '' },
      setAiInsights: (updater) => {
        const cur = get().aiInsights;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ aiInsights: next });
      },

      // ===== Elf 引用上下文（不持久化）=====
      elfQuotedContext: null,
      setElfQuotedContext: (v) => set({ elfQuotedContext: v }),

      // ===== Copilot 待发消息（不持久化）=====
      copilotPendingMessage: '',
      setCopilotPendingMessage: (v) => set({ copilotPendingMessage: v }),
    }),
    {
      name: 'siliconstream-ai-store',
      storage: createJSONStorage(() => localStorage),
      // v28：aiBrief 下线后持久化桶为空；merge 显式剔除旧 persisted 残留，
      // 防 zustand 默认浅合并把孤儿字段重新注入 state
      partialize: () => ({}),
      merge: (persisted, current) => {
        const { aiBrief: _legacyAiBrief, ...rest } = persisted || {};
        void _legacyAiBrief;
        return { ...current, ...rest };
      },
    }
  )
);
