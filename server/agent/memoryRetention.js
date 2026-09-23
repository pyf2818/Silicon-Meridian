/**
 * memoryRetention.js - agent_memories 留存治理（零依赖：常量 + 纯函数）
 *
 * 为什么单独一个文件：agentMemoryService.js（PG 版）与 memoryAgentMemoryService.js
 * （内存版）需要**同一套治理口径**，但后者已被前者 import（isDevMemoryMode 分流），
 * 反向 import 会成环。抽到这里，双版各取所需，单测也能直接测纯函数。
 *
 * 治理策略（2026-09-22 定稿）：
 * - CAP：每 user 最多 AGENT_MEMORY_CAP 条，超出按 (weight asc, created_at asc) 淘汰
 *   —— 权重低的先走（agent_insight weight=5 的任务产物比 weight=1 的习惯观察活得久），
 *      同权重再看时间。写入时顺带清理（对齐 persona_summary_history cap 90 的既有模式，
 *      不引入独立 cron）。
 * - TTL：agent_insight（定时任务/后台执行的产出记录）是过程性数据，默认 90 天过期；
 *   画像类（user_habit/user_thought/user_trait/user_need）不过期。过期条目读取时过滤、
 *   写入时物理清理。
 * - 一致性：治理是「最终一致」——并发写入下瞬时可能超 cap 几条，下次写入修掉，
 *   不为它上事务/锁（记忆治理不是账务）。
 */

/** 每 user 的记忆条数上限。检索纵深足够（prompt 注入最近 5 条、检索 top 50）。 */
export const AGENT_MEMORY_CAP = 500;

/** agent_insight（任务产物）默认存活天数。画像类记忆不受此限。 */
export const AGENT_INSIGHT_TTL_DAYS = 90;

/**
 * 解析一条记忆的过期时间。
 * - 显式传入的 expiresAt 优先（尊重调用方的明确意图）
 * - 未传时：agent_insight 默认 now + 90d；其余类型永不过期（null）
 * @param {string} memoryType
 * @param {Date|string|null} [expiresAt]
 * @param {Date} [now]
 * @returns {Date|null} PG 参数直接可用；内存版自行 toISOString
 */
export function resolveExpiresAt(memoryType, expiresAt, now = new Date()) {
  if (expiresAt !== undefined && expiresAt !== null) {
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (memoryType === 'agent_insight') {
    return new Date(now.getTime() + AGENT_INSIGHT_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
  return null;
}

/**
 * 判断一条记忆是否已过期（双版通用：expiresAt 可能是 Date 或 ISO 字符串）。
 */
export function isExpiredMemory(record, now = new Date()) {
  const raw = record?.expiresAt ?? record?.expires_at;
  if (!raw) return false;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

/**
 * 选出应淘汰的记忆（内存版直接消费；PG 版用同口径的 SQL ROW_NUMBER 实现）。
 * 淘汰序：weight asc → createdAt asc → id asc（稳定，幂等）。
 * @param {Array<{id:string, weight?:number, createdAt?:string|Date}>} records 单个 user 的全部记忆
 * @param {number} [cap]
 * @returns {Array} 超出 cap、应删除的记录（按淘汰优先级排列）
 */
export function selectEvictions(records, cap = AGENT_MEMORY_CAP) {
  if (!Array.isArray(records) || records.length <= cap) return [];
  const ts = (v) => (v instanceof Date ? v.getTime() : new Date(v || 0).getTime() || 0);
  const sorted = [...records].sort((a, b) =>
    ((a.weight || 1) - (b.weight || 1)) ||
    (ts(a.createdAt) - ts(b.createdAt)) ||
    String(a.id).localeCompare(String(b.id))
  );
  return sorted.slice(0, records.length - cap);
}

/* ============ persona_summary 数组字段治理 ============ */

/** 受治理的数组字段（其余字段浅合并原样）。 */
export const PERSONA_ARRAY_FIELDS = ['habits', 'traits', 'needs', 'thoughts', 'preferences'];

/** 数组字段条数上限（对齐 learned_preferences.topics 的 cap 20 既有先例）。 */
export const PERSONA_ARRAY_CAP = 20;

/**
 * persona_summary 数组字段的合并语义（2026-09-22 修正）：
 * 此前 mergePersonaSummary 是浅覆盖——patch.habits 直接替换旧 habits，每轮对话
 * 后旧画像被新 patch 无声抹掉（用户画像"健忘"）。改为：新条目在前、与旧条目
 * 合并去重、cap 20、单条截断 200 字。非数组 patch 值原样浅合并（不碰）。
 * @param {Object} current 现有 persona_summary
 * @param {Object} patch 增量 patch
 * @returns {Object} 合并后的 persona_summary（不含时间戳字段，由调用方补）
 */
export function mergePersonaSummaryFields(current, patch) {
  const next = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (PERSONA_ARRAY_FIELDS.includes(key)) {
      if (Array.isArray(value)) {
        const old = Array.isArray(next[key]) ? next[key] : [];
        const incoming = value.map(v => String(v ?? '').trim().slice(0, 200)).filter(Boolean);
        next[key] = [...incoming, ...old.map(v => String(v ?? '').trim().slice(0, 200))]
          .filter((v, i, arr) => v && arr.indexOf(v) === i)
          .slice(0, PERSONA_ARRAY_CAP);
      } else {
        // 显式给了非数组值：尊重写入方意图（如清空置 []/null 由 setPersonaSummary 走，这里原样覆盖）
        next[key] = value;
      }
      continue;
    }
    next[key] = value;
  }
  return next;
}
