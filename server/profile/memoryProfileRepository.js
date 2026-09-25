/**
 * 开发态内存版画像仓储（仅 DEV_MEMORY_AUTH=true 且非 production 时启用）。
 * 字段形状对齐 profileRepository.js / 001_platform.sql：
 *   user_profiles: version, confidence, behavior_signals, briefing_config, pending_suggestions, llm_config
 *   profile_domains / profile_sources / special_follows / (dailyProfileSnapshots 来自 briefing 快照)
 */
import { profiles, randomUUID } from '../db/devMemoryStore.js';
import { encryptLlmSecrets, decryptLlmSecrets } from '../security/llmSecrets.js';

function ensureProfile(userId) {
  let p = profiles.get(userId);
  if (!p) {
    p = {
      version: 1,
      confidence: 0,
      behaviorSignals: {},
      briefingConfig: {},
      pendingSuggestions: [],
      domains: new Map(), // id -> tier
      sources: new Map(), // id -> tier
      specialFollows: [],
      dailyProfileSnapshots: [],
      llmConfig: {},
    };
    profiles.set(userId, p);
  }
  return p;
}

export function createMemoryProfileRepository() {
  return {
    async getState(userId) {
      const p = ensureProfile(userId);
      return {
        version: p.version,
        confidence: p.confidence,
        behaviorSignals: p.behaviorSignals,
        briefingConfig: p.briefingConfig,
        pendingSuggestions: p.pendingSuggestions,
        domains: [...p.domains].map(([id, tier]) => ({ id, tier })),
        sources: [...p.sources].map(([id, tier]) => ({ id, tier })),
        specialFollows: p.specialFollows,
        dailyProfileSnapshots: p.dailyProfileSnapshots,
      };
    },
    async saveState(userId, state) {
      const p = ensureProfile(userId);
      const base = state.expectedVersion && state.expectedVersion >= p.version ? state.expectedVersion : p.version;
      p.version = base + 1;
      p.confidence = Number(state.confidence) || 0;
      p.behaviorSignals = state.behaviorSignals || {};
      p.briefingConfig = state.briefingConfig || {};
      p.pendingSuggestions = state.pendingSuggestions || [];
      p.domains = new Map(Object.entries(state.domainTiers || {}));
      p.sources = new Map(Object.entries(state.sourceTiers || {}));
      p.specialFollows = (state.specialFollows || []).map(f => ({
        id: f.id || randomUUID(),
        type: f.type,
        target: f.target,
        note: f.note || '',
        createdAt: f.createdAt || new Date().toISOString(),
      }));
      return p.version;
    },
    async getLlmConfig(userId) {
      return decryptLlmSecrets(ensureProfile(userId).llmConfig || {});
    },
    async setLlmConfig(userId, config) {
      ensureProfile(userId).llmConfig = encryptLlmSecrets(config) || {};
    },
  };
}
