/**
 * Profile Store - 用户画像与偏好状态
 *
 * 包含：领域分层、来源分层、特别关注、每日画像快照、资料表单、
 * 特别关注表单、当前编辑中的特别关注 ID、简报配置 8 个状态。
 *
 * 业务数据（domainTiers/sourceTiers/specialFollows/dailyProfileSnapshots/briefingConfig）
 * 通过 persist 中间件持久化到 localStorage，替代 App.jsx 中手写的 saveLS effect。
 * UI 状态（profileForm/specialFollowForm/editingSpecialFollowId）不持久化。
 *
 * 使用方式：
 *   import { useProfileStore } from './store';
 *   const domainTiers = useProfileStore(s => s.domainTiers);
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { migratePreferenceState, migrateSpecialFollows } from '../domain/intelligence/profileTiers.js';

// 读取 localStorage 工具
function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch { return fallback; }
}

// ============ pendingSuggestions 常量 ============
const PENDING_CAP = 20;
const COOLDOWN_MS = 60 * 60 * 1000;
const AUDIT_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function createSuggestionId() {
  return `sg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ============ Profile Store ============
export const useProfileStore = create(
  persist(
    (set, get) => ({
      // ===== 领域分层（持久化）=====
      domainTiers: migratePreferenceState({
        'domainTiers:v1': readLS('domainTiers:v1', null),
        domainPriorities: readLS('domainPriorities', {}),
      }, 'domain'),
      setDomainTiers: (updater) => {
        const cur = get().domainTiers;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ domainTiers: next });
      },

      // ===== 来源分层（持久化）=====
      sourceTiers: migratePreferenceState({
        'sourceTiers:v1': readLS('sourceTiers:v1', null),
        sourcePriorities: readLS('sourcePriorities', {}),
      }, 'source'),
      setSourceTiers: (updater) => {
        const cur = get().sourceTiers;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ sourceTiers: next });
      },

      // ===== 每日画像快照（持久化）=====
      dailyProfileSnapshots: readLS('dailyProfileSnapshots', []),
      setDailyProfileSnapshots: (updater) => {
        const cur = get().dailyProfileSnapshots;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ dailyProfileSnapshots: next });
      },

      // ===== 特别关注（持久化）=====
      specialFollows: migrateSpecialFollows(
        readLS('specialFollows:v2', null) ?? readLS('specialFollows', [])
      ),
      setSpecialFollows: (updater) => {
        const cur = get().specialFollows;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ specialFollows: next });
      },

      // ===== 简报配置（持久化）=====
      briefingConfig: readLS('briefingConfig', { length: 'standard', includeRead: false }),
      setBriefingConfig: (updater) => {
        const cur = get().briefingConfig;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ briefingConfig: next });
      },

      // ===== 待处理建议（持久化）=====
      // 由 AI 引擎派生出的用户画像建议（如新增特别关注、来源升级等），
      // 等待用户接受或拒绝。包含去重、容量上限、冷却期与历史保留机制。
      pendingSuggestions: [],
      addPendingSuggestion: (s) => get().addPendingSuggestions([s]),
      addPendingSuggestions: (input) => set(state => {
        const now = Date.now();
        let next = [...state.pendingSuggestions];

        for (const s of input) {
          const idx = next.findIndex(x => x.type === s.type && x.target === s.target);
          if (idx >= 0) {
            const existing = next[idx];
            if (existing.status === 'pending') {
              // pending 状态：更新 reason + createdAt（去重）
              next[idx] = { ...existing, ...s, id: existing.id, createdAt: now };
              continue;
            }
            // accepted/rejected 状态：1 小时冷却检查
            if (now - existing.createdAt < COOLDOWN_MS) continue;
            // 冷却已过：作为新 pending 加入
          }
          next.unshift({ ...s, id: createSuggestionId(), createdAt: now, status: 'pending' });
        }

        // 仅过滤 pending 状态做上限控制
        const pending = next.filter(s => s.status === 'pending');
        const nonPending = next.filter(s => s.status !== 'pending');
        if (pending.length > PENDING_CAP) {
          pending.sort((a, b) => (b.metadata?.confidence || 0) - (a.metadata?.confidence || 0));
          pending.splice(PENDING_CAP);
        }
        next = [...pending, ...nonPending];
        return { pendingSuggestions: next };
      }),
      updateSuggestionStatus: (id, status) => set(state => ({
        pendingSuggestions: state.pendingSuggestions.map(s => s.id === id ? { ...s, status } : s)
      })),
      pruneExpiredSuggestions: () => set(state => {
        const cutoff = Date.now() - AUDIT_RETAIN_MS;
        return {
          pendingSuggestions: state.pendingSuggestions.filter(s =>
            s.status === 'pending' || s.createdAt >= cutoff)
        };
      }),
      clearPendingSuggestions: () => set({ pendingSuggestions: [] }),

      // ===== AI 性格画像（持久化）Phase 3 Task B6 =====
      // 由 agent_memories 派生的用户性格画像摘要，跨会话保留。
      // habits/traits/needs 各最多 10 项，避免 LLM prompt 过长。
      personaSummary: { habits: [], traits: [], needs: [], updatedAt: null },
      setPersonaSummary: (updater) => set(state => {
        const next = typeof updater === 'function' ? updater(state.personaSummary) : updater;
        const capped = {
          habits: Array.isArray(next?.habits) ? next.habits.slice(0, 10) : [],
          traits: Array.isArray(next?.traits) ? next.traits.slice(0, 10) : [],
          needs: Array.isArray(next?.needs) ? next.needs.slice(0, 10) : [],
        };
        return { personaSummary: { ...capped, updatedAt: new Date().toISOString() } };
      }),

      // ===== UI 状态（不持久化）=====
      // 资料表单（打开资料弹窗时预填充）
      profileForm: { displayName: '', signature: '' },
      setProfileForm: (updater) => {
        const cur = get().profileForm;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ profileForm: next });
      },

      // 特别关注表单
      specialFollowForm: { type: 'source', target: '', note: '' },
      setSpecialFollowForm: (updater) => {
        const cur = get().specialFollowForm;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ specialFollowForm: next });
      },

      // 当前编辑中的特别关注 ID
      editingSpecialFollowId: null,
      setEditingSpecialFollowId: (v) => set({ editingSpecialFollowId: v }),
    }),
    {
      name: 'siliconstream-profile-store',
      storage: createJSONStorage(() => localStorage),
      // 仅持久化业务数据，UI 临时状态不持久化
      partialize: (state) => ({
        domainTiers: state.domainTiers,
        sourceTiers: state.sourceTiers,
        dailyProfileSnapshots: state.dailyProfileSnapshots,
        specialFollows: state.specialFollows,
        briefingConfig: state.briefingConfig,
        pendingSuggestions: state.pendingSuggestions,
        personaSummary: state.personaSummary,
      }),
    }
  )
);
