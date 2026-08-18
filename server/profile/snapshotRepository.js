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
 * Phase 3 Task B4: 三表事务写入
 * 1. upsert recommendation_snapshots (返回 snapshot_id)
 * 2. 删除旧 recommendation_items，批量插入新的
 * 3. upsert briefing_snapshots (algorithm_payload + ai_payload + ai_citation_ids + ai_status)
 *    ai_payload 用 COALESCE：preheat 无 AI 产物（not_requested/ai_failed）时保留已存在的前端分析
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

    // 3. upsert briefing_snapshots（ai_payload 空时保留既有值与状态，防止覆盖前端已沉淀的分析）
    await client.query(
      `INSERT INTO briefing_snapshots (snapshot_id, algorithm_payload, ai_payload, ai_citation_ids, ai_status, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (snapshot_id) DO UPDATE SET
         algorithm_payload = EXCLUDED.algorithm_payload,
         ai_payload = COALESCE(EXCLUDED.ai_payload, briefing_snapshots.ai_payload),
         ai_citation_ids = EXCLUDED.ai_citation_ids,
         ai_status = CASE WHEN EXCLUDED.ai_payload IS NULL AND briefing_snapshots.ai_payload IS NOT NULL
                          THEN briefing_snapshots.ai_status ELSE EXCLUDED.ai_status END,
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
 * 快照对账（前端 agentic 分析写透传）：把 AI 工作站当日分析保存到服务端 briefing_snapshots。
 * - 当日无快照：创建最小占位行（algorithm_version=0，preheat 会识别并补全三表）
 * - 当日已有快照且已有 ai_payload：保持「首份权威」不覆盖
 * - ai_status 标记 'frontend-saved'，与 preheat 的产物区分
 */
export async function saveFrontendAiAnalysis({ userId, date, aiPayload }) {
  if (isDevMemoryMode()) return memorySnapshotRepository.saveFrontendAiAnalysis({ userId, date, aiPayload });
  const pool = getPool();
  const snapRes = await pool.query(
    `INSERT INTO recommendation_snapshots (user_id, snapshot_date, profile_version, algorithm_version, updates)
     VALUES ($1, $2, 1, 0, '["frontend-only"]'::jsonb)
     ON CONFLICT (user_id, snapshot_date) DO NOTHING
     RETURNING id`,
    [userId, date]
  );
  let snapshotId = snapRes.rows[0]?.id;
  if (!snapshotId) {
    const sel = await pool.query(
      'SELECT id FROM recommendation_snapshots WHERE user_id = $1 AND snapshot_date = $2',
      [userId, date]
    );
    snapshotId = sel.rows[0]?.id;
  }
  await pool.query(
    `INSERT INTO briefing_snapshots (snapshot_id, algorithm_payload, ai_payload, ai_citation_ids, ai_status, updated_at)
     VALUES ($1, '{}'::jsonb, $2, '[]'::jsonb, 'frontend-saved', now())
     ON CONFLICT (snapshot_id) DO UPDATE SET
       ai_payload = COALESCE(briefing_snapshots.ai_payload, EXCLUDED.ai_payload),
       ai_status = CASE WHEN briefing_snapshots.ai_payload IS NULL THEN EXCLUDED.ai_status ELSE briefing_snapshots.ai_status END,
       updated_at = now()`,
    [snapshotId, JSON.stringify(aiPayload || {})]
  );
  return { snapshotId };
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
