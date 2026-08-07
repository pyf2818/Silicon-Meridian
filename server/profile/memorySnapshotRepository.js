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
  snapshots.set(`${userId}:${date}`, {
    id,
    userId,
    snapshot_date: date,
    algorithmVersion,
    // 对齐 snapshotRepository.getSnapshotByDate 的别名（驼峰）
    algorithmPayload: algorithmPayload || {},
    aiPayload,
    aiCitationIds,
    aiStatus: aiStatus || 'not_requested',
  });
  const list = snapshotLists.get(userId) || [];
  list.unshift({ id, date, algorithmVersion, aiStatus: aiStatus || 'not_requested', oneLine });
  snapshotLists.set(userId, list.slice(0, 90));
  return { snapshotId: id };
}
