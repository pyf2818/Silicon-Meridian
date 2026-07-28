import { createProfileRepository } from './profileRepository.js';

const TIERS = new Set(['focus', 'normal', 'explore']);
const FOLLOW_TYPES = new Set(['source', 'author', 'keyword', 'url']);
const BRIEFING_LENGTHS = new Set(['compact', 'standard', 'detailed']);
const SNAPSHOT_SUMMARY_MAX = 500;
const SNAPSHOT_CAP = 90; // 最多保留 90 天快照（约 3 个月）

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }

function normalizeTiers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PROFILE', '画像等级格式无效');
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([id, tier]) => {
    if (!String(id).trim() || !TIERS.has(tier)) fail('INVALID_PROFILE_TIER', '画像等级无效');
    return [String(id).slice(0, 200), tier];
  }));
}

/**
 * Phase 1.4 Task 18: 校验 briefingConfig 输入。
 * 仅接受 length ∈ {compact, standard, detailed} + includeRead boolean。
 * 任何非法输入回退到 { length: 'standard', includeRead: false }。
 */
export function normalizeBriefingConfig(input) {
  const fallback = { length: 'standard', includeRead: false };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const length = typeof input.length === 'string' && BRIEFING_LENGTHS.has(input.length) ? input.length : 'standard';
  const includeRead = input.includeRead === true; // 严格 boolean 检查
  return { length, includeRead };
}

/**
 * Phase 1.4 Task 18: 校验 dailyProfileSnapshot 输入。
 * 必须包含有效的 date（YYYY-MM-DD 或 ISO）+ 数字 confidence。
 * date 缺失/无效/confidence 缺失 → 返回 null。
 * summary 截断到 500 字符，confidence clamp 到 [0, 100]。
 */
export function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  // date 校验：必须是 YYYY-MM-DD 或 ISO 字符串，可被解析
  if (typeof input.date !== 'string' || !input.date) return null;
  const dateMatch = input.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return null;

  // confidence 校验：必须可转换为数字
  const confidenceRaw = Number(input.confidence);
  if (!Number.isFinite(confidenceRaw)) return null;
  const confidence = Math.min(100, Math.max(0, Math.round(confidenceRaw)));

  const summary = typeof input.summary === 'string'
    ? input.summary.slice(0, SNAPSHOT_SUMMARY_MAX)
    : '';

  return { date, confidence, summary };
}

export function createProfileService(repository = createProfileRepository()) {
  return {
    getState(userId) { if (!userId) fail('UNAUTHORIZED', '请先登录', 401); return repository.getState(userId); },
    async saveState(userId, input) {
      if (!userId) fail('UNAUTHORIZED', '请先登录', 401);
      const domainTiers = normalizeTiers(input.domainTiers || {});
      const sourceTiers = normalizeTiers(input.sourceTiers || {});
      const specialFollows = Array.isArray(input.specialFollows) ? input.specialFollows.slice(0, 100).map(follow => {
        const type = String(follow.type || ''); const target = String(follow.target || '').trim();
        if (!FOLLOW_TYPES.has(type) || !target || target.length > 500) fail('INVALID_SPECIAL_FOLLOW', '特殊关注格式无效');
        return { type, target, note: String(follow.note || '').slice(0, 280) };
      }) : [];
      const confidence = Math.min(100, Math.max(0, Number(input.confidence) || 0));
      const expectedVersion = Number.isInteger(input.expectedVersion) && input.expectedVersion > 0 ? input.expectedVersion : null;
      // Phase 1.4 Task 18: validate briefingConfig via normalizeBriefingConfig
      const briefingConfig = normalizeBriefingConfig(input.briefingConfig);
      // pendingSuggestions: 校验为最多 50 项的数组（store 已有 cap=20，这里更宽松）
      const pendingSuggestions = Array.isArray(input.pendingSuggestions)
        ? input.pendingSuggestions.slice(0, 50).map(s => ({
            id: String(s.id || '').slice(0, 60),
            type: typeof s.type === 'string' && ['track', 'boost', 'mute'].includes(s.type) ? s.type : 'track',
            target: String(s.target || '').slice(0, 200),
            reason: String(s.reason || '').slice(0, 500),
            source: String(s.source || 'ai').slice(0, 20),
            metadata: s.metadata && typeof s.metadata === 'object' ? s.metadata : {},
            createdAt: Number.isFinite(Number(s.createdAt)) ? Number(s.createdAt) : Date.now(),
            status: typeof s.status === 'string' && ['pending', 'accepted', 'rejected'].includes(s.status) ? s.status : 'pending',
          })).filter(s => s.id && s.target)
        : [];
      return repository.saveState(userId, {
        domainTiers, sourceTiers, specialFollows, confidence,
        behaviorSignals: input.behaviorSignals || {},
        briefingConfig, pendingSuggestions,
        expectedVersion,
      });
    },
    /**
     * Phase 1.4 Task 18: 追加今日 snapshot 到 dailyProfileSnapshots（去重 + cap 90）。
     * 输入先经过 normalizeSnapshot，无效则忽略。
     */
    async appendSnapshot(userId, snapshotInput, existingSnapshots = []) {
      if (!userId) fail('UNAUTHORIZED', '请先登录', 401);
      const normalized = normalizeSnapshot(snapshotInput);
      if (!normalized) return existingSnapshots; // 输入无效，静默返回现状
      // 去重：同日覆盖
      const others = existingSnapshots.filter(s => s.date !== normalized.date);
      const next = [normalized, ...others].slice(0, SNAPSHOT_CAP);
      return next;
    },
  };
}
