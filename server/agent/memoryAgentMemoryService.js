/**
 * 开发态内存版 agent 记忆 / 画像深化服务（仅 DEV_MEMORY_AUTH=true 且非 production 时启用）。
 * 字段形状对齐 agentMemoryService.js / 003_agent_memory.sql / user_profiles.persona_summary。
 * 留存治理与 PG 版同口径（memoryRetention.js）：cap 500/user + agent_insight TTL 90d
 * + 读取过滤过期——保证 dev 模式和生产行为一致，测试也能直接打内存版。
 */
import { personaSummaries, personaHistories, agentMemories, randomUUID } from '../db/devMemoryStore.js';
import { AGENT_MEMORY_CAP, resolveExpiresAt, isExpiredMemory, selectEvictions, mergePersonaSummaryFields } from './memoryRetention.js';

export async function getPersonaSummary(userId) {
  const p = personaSummaries.get(userId);
  if (!p) return { personaSummary: {}, learnedPreferences: {}, personaUpdatedAt: null };
  return p;
}

export async function setPersonaSummary(userId, personaSummary, learnedPreferences = null) {
  const existing = personaSummaries.get(userId) || { personaSummary: {}, learnedPreferences: {}, personaUpdatedAt: null };
  personaSummaries.set(userId, {
    personaSummary: personaSummary || {},
    learnedPreferences: learnedPreferences !== null ? learnedPreferences : existing.learnedPreferences,
    personaUpdatedAt: new Date().toISOString(),
  });
  return { updated: 1 };
}

export async function getPersonaHistory(userId, limit = 30) {
  const list = personaHistories.get(userId) || [];
  return list.slice(0, Math.max(1, Math.min(90, Number(limit) || 30)));
}

export async function getAgentMemories(userId, options = {}) {
  const list = agentMemories.get(userId) || [];
  let filtered = list.filter(m => !isExpiredMemory(m));
  if (options.agentId) filtered = filtered.filter(m => m.agentId === options.agentId);
  if (options.memoryType) filtered = filtered.filter(m => m.memoryType === options.memoryType);
  const limit = Math.min(Math.max(options.limit || 20, 1), 200);
  const offset = Math.max(options.offset || 0, 0);
  return filtered.slice(offset, offset + limit).map(m => ({ ...m }));
}

export async function searchAgentMemories(userId, query, options = {}) {
  const list = agentMemories.get(userId) || [];
  const pattern = String(query || '').trim().toLowerCase();
  const matched = list.filter(m => !isExpiredMemory(m) && String(m.content || '').toLowerCase().includes(pattern));
  const limit = Math.min(Math.max(options.limit || 10, 1), 50);
  return matched
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, limit)
    .map(m => ({ ...m }));
}

/** 写入后的留存维护：清过期 + 超 cap 淘汰（与 PG 版 maintainAgentMemories 同口径）。 */
function maintainMemories(userId) {
  const list = agentMemories.get(userId) || [];
  const alive = list.filter(m => !isExpiredMemory(m));
  const evictIds = new Set(selectEvictions(alive, AGENT_MEMORY_CAP).map(m => m.id));
  agentMemories.set(userId, evictIds.size ? alive.filter(m => !evictIds.has(m.id)) : alive);
}

export async function addAgentMemory({
  userId, agentId, sessionId = null, memoryType, content, evidence = [], weight = 1, expiresAt,
}) {
  const list = agentMemories.get(userId) || [];
  const id = randomUUID();
  const resolved = resolveExpiresAt(memoryType, expiresAt);
  list.push({
    id,
    userId,
    agentId,
    sessionId,
    memoryType,
    content: String(content || ''),
    evidence,
    weight: Math.max(1, Math.min(10, weight || 1)),
    createdAt: new Date().toISOString(),
    expiresAt: resolved ? resolved.toISOString() : null,
  });
  agentMemories.set(userId, list);
  maintainMemories(userId);
  return id;
}

export async function addAgentMemoriesBatch(userId, memories) {
  if (!Array.isArray(memories) || memories.length === 0) return [];
  const ids = [];
  for (const m of memories) ids.push(await addAgentMemory({ userId, ...m }));
  return ids;
}

export async function mergePersonaSummary(userId, patch) {
  const current = (await getPersonaSummary(userId)).personaSummary || {};
  const now = new Date().toISOString();
  // 数组字段与 PG 版同口径：新在前合并去重 + cap 20（防旧画像被浅覆盖抹掉）
  const next = { ...mergePersonaSummaryFields(current, patch), lastEvolvedAt: patch.lastEvolvedAt || now, lastUpdated: now };
  await setPersonaSummary(userId, next);
  const hist = personaHistories.get(userId) || [];
  hist.unshift({ id: randomUUID(), snapshot: next, evolved_at: now });
  personaHistories.set(userId, hist.slice(0, 90));
  return { personaSummary: next };
}
