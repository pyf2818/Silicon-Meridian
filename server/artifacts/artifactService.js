/**
 * artifactService.js - 产物中心服务层：PG / 内存双仓储（dev 无 PG 自动落内存）
 *
 * 模式对齐 devMemoryStore / uploads 的既有约定：
 *   - isDevMemoryModeResolved() 决定仓储实现（生产永不进内存分支，不掩盖 DB 故障）
 *   - 内存态用模块级单例 Map，进程内跨请求共享
 *   - 行形状对齐 013_artifacts.sql；对外统一 camelCase meta 行（不含 data）
 *   - 每用户产物 cap 200 条，注册时同事务（内存同语义）清理超额
 */
import { randomUUID } from 'node:crypto';
import { getPool } from '../db/client.js';
import { isDevMemoryModeResolved } from '../db/devMemoryStore.js';
import {
  normalizeArtifactInput,
  artifactContentToBuffer,
  isArtifactId,
} from '../../src/session/artifactRegistry.js';

export const ARTIFACTS_PER_USER_CAP = 200;

// ===== 内存仓储（dev / 测试） ==========================================
// `${userId}:${id}` -> { id, userId, sessionId, taskId, kind, title, mime, size, data:Buffer, meta, createdAt:Date }
const memoryRows = new Map();
// userId -> [id]（最新在前）
const memoryOrder = new Map();

export function __resetArtifactsForTest() {
  memoryRows.clear();
  memoryOrder.clear();
}

function memoryMetaRow(row) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    taskId: row.taskId,
    kind: row.kind,
    title: row.title,
    mime: row.mime,
    size: row.size,
    meta: row.meta,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function memoryRegister(userId, input) {
  const { record } = normalizeArtifactInput(input);
  const buffer = artifactContentToBuffer(input);
  const id = randomUUID();
  const now = new Date();
  const row = { id, userId, ...record, data: buffer, createdAt: now };
  memoryRows.set(`${userId}:${id}`, row);
  const list = memoryOrder.get(userId) || [];
  list.unshift(id);
  // cap：超额从尾部淘汰
  while (list.length > ARTIFACTS_PER_USER_CAP) {
    const evicted = list.pop();
    memoryRows.delete(`${userId}:${evicted}`);
  }
  memoryOrder.set(userId, list);
  return memoryMetaRow(row);
}

function memoryList(userId, { sessionId = '', kind = '', limit = 50, offset = 0 } = {}) {
  const ids = memoryOrder.get(userId) || [];
  const filtered = ids
    .map(id => memoryRows.get(`${userId}:${id}`))
    .filter(Boolean)
    .filter(row => (sessionId ? row.sessionId === sessionId : true))
    .filter(row => (kind ? row.kind === kind : true));
  const slice = filtered.slice(offset, offset + limit).map(memoryMetaRow);
  return { artifacts: slice, hasMore: filtered.length > offset + limit, total: filtered.length };
}

function memoryGet(userId, id) {
  return memoryRows.get(`${userId}:${id}`) || null;
}

function memoryRemove(userId, id) {
  const existed = memoryRows.delete(`${userId}:${id}`);
  if (existed) {
    const list = (memoryOrder.get(userId) || []).filter(x => x !== id);
    memoryOrder.set(userId, list);
  }
  return existed;
}

// ===== PG 仓储 ========================================================
const PG_COLUMNS = 'id, user_id, session_id, task_id, kind, title, mime, size, meta, created_at';

function pgMetaRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    kind: row.kind,
    title: row.title,
    mime: row.mime,
    size: Number(row.size || 0),
    meta: row.meta || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

async function pgRegister(userId, input) {
  const { record } = normalizeArtifactInput(input);
  const buffer = artifactContentToBuffer(input);
  const pool = getPool();
  const result = await pool.query(
    `insert into artifacts (user_id, session_id, task_id, kind, title, mime, size, data, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning ${PG_COLUMNS}`,
    [userId, record.sessionId, record.taskId, record.kind, record.title, record.mime, record.size, buffer, JSON.stringify(record.meta)],
  );
  // cap 清理：保留每用户最新 N 条（注册路径低频，直接子查询删除）
  await pool.query(
    `delete from artifacts
     where user_id = $1 and id not in (
       select id from artifacts where user_id = $1 order by created_at desc limit $2
     )`,
    [userId, ARTIFACTS_PER_USER_CAP],
  );
  return pgMetaRow(result.rows[0]);
}

function pgListFilters(userId, { sessionId, kind }) {
  const conditions = ['user_id = $1'];
  const params = [userId];
  if (sessionId) { params.push(sessionId); conditions.push(`session_id = $${params.length}`); }
  if (kind) { params.push(kind); conditions.push(`kind = $${params.length}`); }
  return { where: conditions.join(' and '), params };
}

async function pgList(userId, { sessionId = '', kind = '', limit = 50, offset = 0 } = {}) {
  const { where, params } = pgListFilters(userId, { sessionId, kind });
  const pool = getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const totalResult = await pool.query(`select count(*)::int as total from artifacts where ${where}`, params);
  const result = await pool.query(
    `select ${PG_COLUMNS} from artifacts where ${where} order by created_at desc limit ${safeLimit} offset ${safeOffset}`,
    params,
  );
  return {
    artifacts: result.rows.map(pgMetaRow),
    hasMore: safeOffset + result.rows.length < Number(totalResult.rows[0]?.total || 0),
    total: Number(totalResult.rows[0]?.total || 0),
  };
}

async function pgGet(userId, id) {
  const pool = getPool();
  const result = await pool.query(
    `select ${PG_COLUMNS}, data from artifacts where user_id = $1 and id = $2`,
    [userId, id],
  );
  return result.rows[0] || null;
}

async function pgRemove(userId, id) {
  const pool = getPool();
  const result = await pool.query('delete from artifacts where user_id = $1 and id = $2', [userId, id]);
  return (result.rowCount || 0) > 0;
}

// ===== 统一出口 =======================================================
export async function getArtifactService() {
  if (await isDevMemoryModeResolved()) {
    // 统一 async 边界：内存实现的同步 throw 必须转为 rejected promise，
    // 与 PG 实现语义一致（否则 expect(...).rejects 这类「先求值再断言」的调用方会直接炸在求值阶段）。
    return {
      mode: 'memory',
      register: async (userId, input) => memoryRegister(userId, input),
      list: async (userId, query) => memoryList(userId, query),
      get: async (userId, id) => memoryGet(userId, id),
      remove: async (userId, id) => memoryRemove(userId, id),
    };
  }
  return {
    mode: 'pg',
    register: (userId, input) => pgRegister(userId, input),
    list: (userId, query) => pgList(userId, query),
    get: (userId, id) => pgGet(userId, id),
    remove: (userId, id) => pgRemove(userId, id),
  };
}

export { isArtifactId };
