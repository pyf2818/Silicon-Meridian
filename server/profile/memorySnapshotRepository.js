/**
 * 开发态内存版快照仓储（仅 DEV_MEMORY_AUTH=true 且非 production 时启用）。
 * 字段形状对齐 snapshotRepository.js / 002_recommendation.sql：
 *   - getSnapshotByDate 返回 { algorithmPayload, aiPayload, aiCitationIds, aiStatus }
 *   - getRecentSnapshots 返回 { id, date, algorithmVersion, aiStatus, oneLine }
 */
import { snapshots, snapshotLists, randomUUID } from '../db/devMemoryStore.js';

export async function getSnapshotByDate(userId, date) {
  return snapshots.get(`${userId}:${date}`) || null;
}

export async function getRecentSnapshots(userId, limit = 30) {
  const list = snapshotLists.get(userId) || [];
  return list.slice(0, limit);
}

export async function insertSnapshot({
  userId, date, algorithmVersion, lanes, algorithmPayload, aiPayload = null, aiCitationIds = [], aiStatus = 'not_requested',
}) {
  const id = randomUUID();
  const oneLine = algorithmPayload?.oneLine || '';
  const existing = snapshots.get(`${userId}:${date}`);
  // 与 PG 路径的 COALESCE 语义对齐：preheat 无 AI 产物时保留已存在的前端分析
  const keepAi = !aiPayload && existing?.aiPayload ? existing.aiPayload : aiPayload;
  const keepStatus = !aiPayload && existing?.aiPayload
    ? (existing.aiStatus || 'frontend-saved')
    : (aiStatus || 'not_requested');
  snapshots.set(`${userId}:${date}`, {
    id,
    userId,
    snapshot_date: date,
    algorithmVersion,
    // 对齐 snapshotRepository.getSnapshotByDate 的别名（驼峰）
    algorithmPayload: algorithmPayload || {},
    aiPayload: keepAi,
    aiCitationIds,
    aiStatus: keepStatus,
  });
  const list = snapshotLists.get(userId) || [];
  list.unshift({ id, date, algorithmVersion, aiStatus: keepStatus, oneLine });
  snapshotLists.set(userId, list.slice(0, 90));
  return { snapshotId: id };
}

/**
 * 快照对账（前端 agentic 分析写透传，dev 内存版）：
 * - 无当日快照：创建 algorithmVersion=0 的占位行（preheat 会补全）
 * - 已有 aiPayload：首份权威不覆盖
 */
export async function saveFrontendAiAnalysis({ userId, date, aiPayload }) {
  const key = `${userId}:${date}`;
  const existing = snapshots.get(key);
  if (!existing) {
    const id = randomUUID();
    snapshots.set(key, {
      id,
      userId,
      snapshot_date: date,
      algorithmVersion: 0,
      algorithmPayload: {},
      aiPayload: aiPayload || {},
      aiCitationIds: [],
      aiStatus: 'frontend-saved',
    });
    const list = snapshotLists.get(userId) || [];
    list.unshift({ id, date, algorithmVersion: 0, aiStatus: 'frontend-saved', oneLine: '' });
    snapshotLists.set(userId, list.slice(0, 90));
    return { snapshotId: id };
  }
  if (existing.aiPayload) return { snapshotId: existing.id, kept: true };
  existing.aiPayload = aiPayload || {};
  existing.aiStatus = 'frontend-saved';
  return { snapshotId: existing.id };
}
