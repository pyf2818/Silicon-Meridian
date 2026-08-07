/**
 * 开发态内存版 agent 记忆 / 画像深化服务（仅 DEV_MEMORY_AUTH=true 且非 production 时启用）。
 * 字段形状对齐 agentMemoryService.js / 003_agent_memory.sql / user_profiles.persona_summary。
 */
import { personaSummaries, personaHistories, agentMemories, randomUUID } from '../db/devMemoryStore.js';

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
  let filtered = list;
  if (options.agentId) filtered = filtered.filter(m => m.agentId === options.agentId);
  if (options.memoryType) filtered = filtered.filter(m => m.memoryType === options.memoryType);
  const limit = Math.min(Math.max(options.limit || 20, 1), 200);
  const offset = Math.max(options.offset || 0, 0);
  return filtered.slice(offset, offset + limit).map(m => ({ ...m }));
}

export async function searchAgentMemories(userId, query, options = {}) {
  const list = agentMemories.get(userId) || [];
  const pattern = String(query || '').trim().toLowerCase();
  const matched = list.filter(m => String(m.content || '').toLowerCase().includes(pattern));
  const limit = Math.min(Math.max(options.limit || 10, 1), 50);
  return matched
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, limit)
    .map(m => ({ ...m }));
}

export async function addAgentMemory({
  userId, agentId, sessionId = null, memoryType, content, evidence = [], weight = 1, expiresAt = null,
}) {
  const list = agentMemories.get(userId) || [];
  const id = randomUUID();
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
    expiresAt,
  });
  agentMemories.set(userId, list);
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
  const next = { ...current, ...patch, lastEvolvedAt: patch.lastEvolvedAt || now, lastUpdated: now };
  await setPersonaSummary(userId, next);
  const hist = personaHistories.get(userId) || [];
  hist.unshift({ id: randomUUID(), snapshot: next, evolved_at: now });
  personaHistories.set(userId, hist.slice(0, 90));
  return { personaSummary: next };
}
