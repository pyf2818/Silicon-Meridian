// agentMemoryService.js - 智能体跨会话记忆与用户画像深化服务
// 提供 agent_memories 表的 CRUD + 用户画像 persona_summary 读写
// 留存治理（2026-09-22）：cap 500/user + agent_insight TTL 90d + 读取过滤过期，
// 策略与纯函数见 memoryRetention.js（双版共用口径）。
import { getPool } from '../db/client.js';
import { isDevMemoryMode } from '../db/devMemoryStore.js';
import * as memoryAgent from './memoryAgentMemoryService.js';
import { AGENT_MEMORY_CAP, resolveExpiresAt, mergePersonaSummaryFields } from './memoryRetention.js';

/* ============ Agent 记忆 CRUD ============ */

/* ============ 留存治理（写入时顺带维护，无独立 cron） ============ */

/**
 * 写入后的留存维护：① 物理清理全表过期条目；② 当前 user 超 cap 时按
 * (weight asc, created_at asc, id asc) 淘汰。失败只记日志——治理是最终一致，
 * 绝不让一次正常写入因为清理失败而报错。
 */
async function maintainAgentMemories(pool, userId) {
  try {
    await pool.query('delete from agent_memories where expires_at is not null and expires_at <= now()');
    await pool.query(
      `delete from agent_memories where user_id = $1 and id in (
         select id from (
           select id, row_number() over (order by weight asc, created_at asc, id asc) as rn
           from agent_memories where user_id = $1
         ) t where rn > $2
       )`,
      [userId, AGENT_MEMORY_CAP]
    );
  } catch (err) {
    console.error('[agentMemory] retention maintenance failed:', err.message);
  }
}

/**
 * 写入一条 agent 记忆
 * @param {Object} params - { userId, agentId, sessionId, memoryType, content, evidence, weight, expiresAt }
 *   expiresAt 未显式传入时：agent_insight 默认 90 天后过期，其余类型永不过期。
 * @returns {Promise<string>} 新建记忆 id
 */
export async function addAgentMemory({ userId, agentId, sessionId = null, memoryType, content, evidence = [], weight = 1, expiresAt }) {
  const pool = getPool();
  const validTypes = ['user_habit', 'user_thought', 'user_trait', 'user_need', 'agent_insight'];
  if (!validTypes.includes(memoryType)) {
    throw new Error(`invalid memory_type: ${memoryType}, must be one of ${validTypes.join('/')}`);
  }
  if (isDevMemoryMode()) return memoryAgent.addAgentMemory({ userId, agentId, sessionId, memoryType, content, evidence, weight, expiresAt });
  const resolvedExpiresAt = resolveExpiresAt(memoryType, expiresAt);
  const result = await pool.query(
    `insert into agent_memories (user_id, agent_id, session_id, memory_type, content, evidence, weight, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [userId, agentId, sessionId, memoryType, content, JSON.stringify(evidence), Math.max(1, Math.min(10, weight)), resolvedExpiresAt]
  );
  await maintainAgentMemories(pool, userId);
  return result.rows[0]?.id;
}

/**
 * 批量写入记忆（一次对话总结后调用）
 */
export async function addAgentMemoriesBatch(userId, memories) {
  if (!Array.isArray(memories) || memories.length === 0) return [];
  if (isDevMemoryMode()) return memoryAgent.addAgentMemoriesBatch(userId, memories);
  const pool = getPool();
  const client = await pool.connect();
  const ids = [];
  try {
    await client.query('BEGIN');
    for (const m of memories) {
      const r = await client.query(
        `insert into agent_memories (user_id, agent_id, session_id, memory_type, content, evidence, weight, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [userId, m.agentId, m.sessionId || null, m.memoryType, m.content, JSON.stringify(m.evidence || []), Math.max(1, Math.min(10, m.weight || 1)), resolveExpiresAt(m.memoryType, m.expiresAt)]
      );
      ids.push(r.rows[0]?.id);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // 批量只在提交后做一次维护（逐条做会重复跑同样的清理）
  await maintainAgentMemories(pool, userId);
  return ids;
}

/**
 * 检索用户记忆（按 agent 或全量，按时间倒序）
 */
export async function getAgentMemories(userId, options = {}) {
  if (isDevMemoryMode()) return memoryAgent.getAgentMemories(userId, options);
  const pool = getPool();
  const agentId = options.agentId;
  const memoryType = options.memoryType;
  const limit = Math.min(Math.max(options.limit || 20, 1), 200);
  const offset = Math.max(options.offset || 0, 0);

  let sql = `select id, agent_id, session_id, memory_type, content, evidence, weight, created_at, expires_at
             from agent_memories
             where user_id = $1 and (expires_at is null or expires_at > now())`;
  const params = [userId];
  let idx = 2;
  if (agentId) { sql += ` and agent_id = $${idx++}`; params.push(agentId); }
  if (memoryType) { sql += ` and memory_type = $${idx++}`; params.push(memoryType); }
  sql += ` order by created_at desc limit $${idx++} offset $${idx++}`;
  params.push(limit, offset);

  const result = await pool.query(sql, params);
  return result.rows.map(r => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    memoryType: r.memory_type,
    content: r.content,
    evidence: r.evidence,
    weight: r.weight,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * 全文检索记忆（简单 ilike 匹配）
 */
export async function searchAgentMemories(userId, query, options = {}) {
  if (isDevMemoryMode()) return memoryAgent.searchAgentMemories(userId, query, options);
  const pool = getPool();
  const limit = Math.min(Math.max(options.limit || 10, 1), 50);
  const pattern = `%${String(query || '').trim().toLowerCase()}%`;
  const result = await pool.query(
    `select id, agent_id, session_id, memory_type, content, evidence, weight, created_at
     from agent_memories
     where user_id = $1 and (expires_at is null or expires_at > now()) and lower(content) like $2
     order by weight desc, created_at desc
     limit $3`,
    [userId, pattern, limit]
  );
  return result.rows.map(r => ({
    id: r.id, agentId: r.agent_id, sessionId: r.session_id, memoryType: r.memory_type,
    content: r.content, evidence: r.evidence, weight: r.weight, createdAt: r.created_at,
  }));
}

/**
 * 删除记忆（按 id 或按会话）
 */
export async function deleteAgentMemory(userId, { memoryId = null, sessionId = null } = {}) {
  const pool = getPool();
  if (memoryId) {
    await pool.query('delete from agent_memories where user_id = $1 and id = $2', [userId, memoryId]);
    return { deleted: 1 };
  }
  if (sessionId) {
    const r = await pool.query('delete from agent_memories where user_id = $1 and session_id = $2', [userId, sessionId]);
    return { deleted: r.rowCount };
  }
  return { deleted: 0 };
}

/* ============ 用户画像 persona_summary 深化 ============ */

/**
 * 读取用户画像深化字段（persona_summary + learned_preferences）
 */
export async function getPersonaSummary(userId) {
  if (isDevMemoryMode()) return memoryAgent.getPersonaSummary(userId);
  const pool = getPool();
  const result = await pool.query(
    `select persona_summary, learned_preferences, persona_updated_at
     from user_profiles where user_id = $1`,
    [userId]
  );
  if (result.rows.length === 0) {
    return { personaSummary: {}, learnedPreferences: {}, personaUpdatedAt: null };
  }
  const row = result.rows[0];
  return {
    personaSummary: row.persona_summary || {},
    learnedPreferences: row.learned_preferences || {},
    personaUpdatedAt: row.persona_updated_at,
  };
}

/**
 * 写入用户画像深化字段
 * personaSummary: { personality, needs, habits, thoughts, preferences, lastUpdated }
 */
export async function setPersonaSummary(userId, personaSummary, learnedPreferences = null) {
  if (isDevMemoryMode()) return memoryAgent.setPersonaSummary(userId, personaSummary, learnedPreferences);
  const pool = getPool();
  const fields = ['persona_summary = $2', 'persona_updated_at = now()'];
  const params = [userId, JSON.stringify(personaSummary)];
  let idx = 3;
  if (learnedPreferences !== null) {
    fields.push(`learned_preferences = $${idx++}`);
    params.push(JSON.stringify(learnedPreferences));
  }
  const result = await pool.query(
    `update user_profiles set ${fields.join(', ')} where user_id = $1`,
    params
  );
  return { updated: result.rowCount };
}

/**
 * Phase 5: 合并式更新 personaSummary
 * - 同事务写入 persona_summary_history
 * - 同事务清理 cap 90 旧记录
 * - 统一时间戳字段名为 lastEvolvedAt + lastUpdated（修 Bug 3：清理 updatedAt）
 */
export async function mergePersonaSummary(userId, patch) {
  if (isDevMemoryMode()) return memoryAgent.mergePersonaSummary(userId, patch);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 读取当前 persona_summary（FOR UPDATE 行锁，防并发）
    const cur = await client.query(
      'SELECT persona_summary FROM user_profiles WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    const current = cur.rows[0]?.persona_summary || {};

    // 2. 合并字段；统一时间戳字段名（清理 updatedAt）
    // 数组字段（habits/traits/needs/thoughts/preferences）走「新在前合并去重 + cap 20」，
    // 修复此前浅覆盖导致旧画像被每轮 patch 无声抹掉的问题（治理口径见 memoryRetention.js）
    const now = new Date().toISOString();
    const next = {
      ...mergePersonaSummaryFields(current, patch),
      lastEvolvedAt: patch.lastEvolvedAt || now,
      lastUpdated: now,
      updatedAt: undefined,  // JSON.stringify 会忽略 undefined，清理遗留字段
    };

    // 3. UPDATE user_profiles
    await client.query(
      `UPDATE user_profiles SET persona_summary = $2, persona_updated_at = now() WHERE user_id = $1`,
      [userId, JSON.stringify(next)]
    );

    // 4. INSERT persona_summary_history（同事务）
    await client.query(
      `INSERT INTO persona_summary_history (user_id, snapshot, evolved_at)
       VALUES ($1, $2, $3)`,
      [userId, JSON.stringify(next), now]
    );

    // 5. 清理 cap 90（同事务，避免单独 cron）
    await client.query(
      `DELETE FROM persona_summary_history
       WHERE user_id = $1 AND id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY evolved_at DESC) AS rn
           FROM persona_summary_history WHERE user_id = $1
         ) t WHERE rn > 90
       )`,
      [userId]
    );

    await client.query('COMMIT');
    return { personaSummary: next };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Phase 5: 读取 personaSummary 进化历史（最新在前）
 * @param {string} userId
 * @param {number} limit - 默认 30，最大 90（与 cap 一致）
 * @returns {Promise<Array<{ id, snapshot, evolved_at }>>}
 */
export async function getPersonaHistory(userId, limit = 30) {
  if (isDevMemoryMode()) return memoryAgent.getPersonaHistory(userId, limit);
  const pool = getPool();
  const cappedLimit = Math.max(1, Math.min(90, Number(limit) || 30));
  const result = await pool.query(
    `SELECT id, snapshot, evolved_at
     FROM persona_summary_history
     WHERE user_id = $1
     ORDER BY evolved_at DESC
     LIMIT $2`,
    [userId, cappedLimit]
  );
  return result.rows.map(r => ({
    id: r.id,
    snapshot: r.snapshot,
    evolved_at: r.evolved_at,
  }));
}

/**
 * Phase 3 Task B7-3: 合并式更新 learned_preferences
 * - topics: 与现有合并去重（保留高频在前），cap 20
 * - preferredDepth / preferredFormat: 直接覆盖（最新值优先）
 * - updatedAt: 时间戳
 *
 * @param {string} userId
 * @param {{topics?: string[], preferredDepth?: 'deep'|'shallow', preferredFormat?: 'detailed'|'concise'}} patch
 * @returns {Promise<{updated: number}>}
 */
export async function mergeLearnedPreferences(userId, patch) {
  if (!userId) return { updated: 0 };
  const current = await getPersonaSummary(userId);
  const existing = current.learnedPreferences || {};
  const existingTopics = Array.isArray(existing.topics) ? existing.topics : [];

  // topics 合并去重：新 topics 优先，旧的追加在后，cap 20
  const newTopics = Array.isArray(patch?.topics) ? patch.topics : [];
  const mergedTopics = [...newTopics, ...existingTopics]
    .filter((t, i, arr) => arr.indexOf(t) === i) // 去重
    .slice(0, 20);

  const next = {
    topics: mergedTopics,
    preferredDepth: patch?.preferredDepth || existing.preferredDepth || 'shallow',
    preferredFormat: patch?.preferredFormat || existing.preferredFormat || 'concise',
    updatedAt: new Date().toISOString(),
  };

  return setPersonaSummary(userId, current.personaSummary || {}, next);
}

/**
 * Phase 3 Task B4: 为一批资讯条目拉取相关 agent 记忆。
 * 取每条 item 的 title+summary 作为 query 调用 searchAgentMemories（top 3），
 * 合并后按 weight+createdAt 去重排序，最多返回 5 条。
 *
 * 用于 /api/profile/snapshots/analyze 与 preheat 流程注入 LLM prompt。
 *
 * @param {string} userId
 * @param {Array<{title?:string, summary?:string}>} items
 * @returns {Promise<Array>} 去重后的相关记忆数组
 */
export async function fetchRelevantMemoriesForItems(userId, items) {
  if (!userId || !Array.isArray(items) || items.length === 0) return [];
  const queries = items.slice(0, 3).map(item => {
    const t = String(item?.title || '').slice(0, 100);
    const s = String(item?.summary || '').slice(0, 100);
    return `${t} ${s}`.trim();
  }).filter(Boolean);
  if (queries.length === 0) return [];

  const seen = new Set();
  const all = [];
  for (const q of queries) {
    try {
      const results = await searchAgentMemories(userId, q, { limit: 3 });
      for (const m of results) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        all.push(m);
      }
    } catch {
      // 单次检索失败不影响整体
    }
  }
  // 按 weight desc, createdAt desc 排序，取 top 5
  all.sort((a, b) => {
    const w = (b.weight || 0) - (a.weight || 0);
    if (w !== 0) return w;
    const t1 = new Date(a.createdAt || 0).getTime();
    const t2 = new Date(b.createdAt || 0).getTime();
    return t2 - t1;
  });
  return all.slice(0, 5);
}
