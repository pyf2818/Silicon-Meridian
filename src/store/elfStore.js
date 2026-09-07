/**
 * Elf Store - AI 助手人格设定
 *
 * 包含：助手头像、头像历史、助手名字 3 个状态。
 * 全部持久化到 localStorage。
 *
 * 使用方式：
 *   import { useElfStore } from './store';
 *   const elfAvatar = useElfStore(s => s.elfAvatar);
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ============ Elf Store ============
export const useElfStore = create(
  persist(
    (set, get) => ({
      // ===== 助手头像 =====
      elfAvatar: (() => {
        try { return localStorage.getItem('elfAvatar') || ''; }
        catch { return ''; }
      })(),
      setElfAvatar: (v) => {
        const prev = get().elfAvatar;
        set({ elfAvatar: v });
        try {
          if (v) localStorage.setItem('elfAvatar', v);
          else localStorage.removeItem('elfAvatar');
          return true;
        } catch {
          // v23 #1 修复：写入失败（配额满）不再静默吞掉——回滚内存态并告知调用方，
          // 避免"看着成功、刷新即丢"的假成功
          set({ elfAvatar: prev });
          return false;
        }
      },

      // ===== 划词翻译（v23 #1）：选中文字后自动显示翻译和解释 =====
      selectionTranslateEnabled: (() => {
        try { return localStorage.getItem('elfSelectionTranslate') !== 'off'; }
        catch { return true; }
      })(),
      setSelectionTranslateEnabled: (v) => {
        set({ selectionTranslateEnabled: !!v });
        try { localStorage.setItem('elfSelectionTranslate', v ? 'on' : 'off'); } catch {}
      },

      // ===== 精灵协作能力（v23 #1）：对接 AI 工作站的多智能体引擎 =====
      // subagent = spawn_subagent（并行子代理派活收报告）
      // team     = spawn_agent_team（共享任务列表 + 邮箱的团队群聊）
      // 两者均无审批需求（team 只写本地任务板；subagent 子代理写操作仍被精灵 deny 政策拦截）
      elfCollab: { subagent: true, team: true },
      setElfCollab: (patch) => {
        set((s) => ({ elfCollab: { ...s.elfCollab, ...patch } }));
      },

      // ===== 头像历史 =====
      elfAvatarHistory: (() => {
        try { return JSON.parse(localStorage.getItem('elfAvatarHistory') || '[]'); }
        catch { return []; }
      })(),
      setElfAvatarHistory: (updater) => {
        const cur = get().elfAvatarHistory;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ elfAvatarHistory: next });
      },

      // ===== 助手名字 =====
      elfName: (() => {
        try { return localStorage.getItem('elfName') || '艾尔'; }
        catch { return '艾尔'; }
      })(),
      setElfName: (v) => {
        set({ elfName: v });
        try { localStorage.setItem('elfName', v); } catch {}
      },

      // ===== 聊天记录（持久化）：用户手动保存的对话快照 =====
      elfChatHistory: (() => {
        try {
          const parsed = JSON.parse(localStorage.getItem('elfChatHistory') || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      })(),
      setElfChatHistory: (updater) => {
        const cur = get().elfChatHistory;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ elfChatHistory: next });
      },
    }),
    {
      name: 'siliconstream-elf-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        elfAvatar: state.elfAvatar,
        elfAvatarHistory: state.elfAvatarHistory,
        elfName: state.elfName,
        elfChatHistory: state.elfChatHistory,
        elfCollab: state.elfCollab,
      }),
    }
  )
);
