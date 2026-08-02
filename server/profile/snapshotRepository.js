import { getPool, withTransaction } from '../db/client.js';
import { isDevMemoryMode } from '../db/devMemoryStore.js';
import * as memorySnapshotRepository from './memorySnapshotRepository.js';

/**
 * Phase 3 Task B2: 纯函数 — 构造 recommendation_items 批量 INSERT 的 values 字符串和参数数组。
 * 不接触 DB，便于单测。lane 顺序固定为 public → personal；position 从 0 开始。
 */
export function buildInsertItemsParams(snapshotId, lanes) {
  const valuePlaceholders = [];
  const params = [];
  let i = 0;
  for (const lane of ['public', 'personal']) {
    const items = Array.isArray(lanes?.[lane]) ? lanes[lane] : [];
    items.forEach((item, pos) => {
      valuePlaceholders.push(`($${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i})`);
      params.push(
        snapshotId,
        String(item.id ?? ''),
        lane,
        pos,
        Number(item.mustReadScore ?? 0),
        JSON.stringify(item.scoreParts || {}),
        JSON.stringify(item.reasons || []),
        JSON.stringify(item)
      );
    });
  }
  return { values: valuePlaceholders.join(','), params };
}

/**
 * Phase 3 Task B2: 三表事务写入
 * 1. upsert recommendation_snapshots (返回 snapshot_id)
 * 2. 删除旧 recommendation_items，批量插入新的
 * 3. upsert briefing_snapshots (algorithm_payload + ai_payload + ai_citation_ids + ai_status)
 *
 * 使用 withTransaction 保证原子性。
 */
export async function insertSnapshot({ userId, date, algorithmVersion, lanes, algorithmPayload, aiPayload = null, aiCitationIds = [], aiStatus = 'not_requested' }) {
  if (isDevMemoryMode()) return memorySnapshotRepository.insertSnapshot({ userId, date, algorithmVersion, lanes, algorithmPayload, aiPayload, aiCitationIds, aiStatus });
  return withTransaction(async (client) => {
    // 1. upsert recommendation_snapshots
    const snapRes = await client.query(
      `INSERT INTO recommendation_snapshots (user_id, snapshot_date, profile_version, algorithm_version, updates)
       VALUES ($1, $2, 1, $3, '[]'::jsonb)
       ON CONFLICT (user_id, snapshot_date) DO UPDATE SET algorithm_version = EXCLUDED.algorithm_version
       RETURNING id`,
      [userId, date, algorithmVersion]
    );
    const snapshotId = snapRes.rows[0].id;

    // 2. 清空旧 items，批量插入新 items
    await client.query('DELETE FROM recommendation_items WHERE snapshot_id = $1', [snapshotId]);
    const { values, params } = buildInsertItemsParams(snapshotId, lanes);
    if (values) {
      await client.query(
        `INSERT INTO recommendation_items (snapshot_id, item_id, lane, position, total_score, score_parts, reasons, item_payload)
         VALUES ${values}`,
        params
      );
    }

    // 3. upsert briefing_snapshots
    await client.query(
      `INSERT INTO briefing_snapshots (snapshot_id, algorithm_payload, ai_payload, ai_citation_ids, ai_status, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (snapshot_id) DO UPDATE SET
         algorithm_payload = EXCLUDED.algorithm_payload,
         ai_payload = EXCLUDED.ai_payload,
         ai_citation_ids = EXCLUDED.ai_citation_ids,
         ai_status = EXCLUDED.ai_status,
         updated_at = now()`,
      [
        snapshotId,
        JSON.stringify(algorithmPayload || {}),
        aiPayload ? JSON.stringify(aiPayload) : null,
        JSON.stringify(aiCitationIds),
        aiStatus,
      ]
    );

    return { snapshotId };
  });
}

/**
 * Phase 3 Task B2: 按日期查询某用户的快照
 */
export async function getSnapshotByDate(userId, date) {
  if (isDevMemoryMode()) return memorySnapshotRepository.getSnapshotByDate(userId, date);
  const res = await getPool().query(
    `SELECT rs.*, bs.algorithm_payload as "algorithmPayload", bs.ai_payload as "aiPayload",
            bs.ai_citation_ids as "aiCitationIds", bs.ai_status as "aiStatus"
     FROM recommendation_snapshots rs
     LEFT JOIN briefing_snapshots bs ON bs.snapshot_id = rs.id
     WHERE rs.user_id = $1 AND rs.snapshot_date = $2`,
    [userId, date]
  );
  return res.rows[0] || null;
}

/**
 * Phase 3 Task B2: 查询最近 N 天的快照列表
 */
export async function getRecentSnapshots(userId, limit = 30) {
  if (isDevMemoryMode()) return memorySnapshotRepository.getRecentSnapshots(userId, limit);
  const res = await getPool().query(
    `SELECT rs.id, rs.snapshot_date as date, rs.algorithm_version as "algorithmVersion",
            bs.ai_status as "aiStatus",
            bs.algorithm_payload->>'oneLine' as "oneLine"
     FROM recommendation_snapshots rs
     LEFT JOIN briefing_snapshots bs ON bs.snapshot_id = rs.id
     WHERE rs.user_id = $1
     ORDER BY rs.snapshot_date DESC
     LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}
