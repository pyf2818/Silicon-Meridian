/**
 * auditService.js - 服务端审计日志（内存 / PG 双仓储，模式对齐 artifactService）
 *
 * 纪律：审计写入失败绝不影响主流程（fire-and-forget + 内部吞错 + 告警计数）。
 * 查询端点仅限本人（list 校验 userId）；保留量 cap（每用户 500 条）由注册路径清理。
 */
import { getPool } from '../db/client.js';
import { isDevMemoryModeResolved } from '../db/devMemoryStore.js';

export const AUDIT_ACTIONS = [
  'auth.login', 'auth.logout', 'auth.register',
  'tool.execute', 'tool.denied',
  'artifact.register', 'artifact.delete',
  'upload.create',
  'export.run',
  'mcp.call',
  'llm-config.update',
];

const AUDIT_PER_USER_CAP = 500;

// `${userId}:${id}` -> 行；userId -> [id] 最新在前
const auditRows = new Map();
const auditOrder = new Map();
let auditSeq = 1;
export let auditWriteFailures = 0; // 进程内告警计数（暴露给 /api/health）

const ACTION_RE = /^[a-z][a-z0-9.-]{1,63}$/;

export function __resetAuditForTest() {
  auditRows.clear();
  auditOrder.clear();
  auditSeq = 1;
}

function normInput({ userId = '', action, target = '', outcome = 'ok', detail = {}, ip = '', userAgent = '' } = {}) {
  if (!ACTION_RE.test(String(action || ''))) {
    throw Object.assign(new Error('无效的审计 action'), { code: 'INVALID_AUDIT_ACTION', status: 400 });
  }
  return {
    userId: String(userId || ''),
    action: String(action),
    target: String(target || '').slice(0, 200),
    outcome: ['ok', 'denied', 'error'].includes(outcome) ? outcome : 'ok',
    detail: detail && typeof detail === 'object' ? detail : {},
    ip: String(ip || '').slice(0, 64),
    userAgent: String(userAgent || '').slice(0, 200),
  };
}

// ===== 内存仓储 ========================================================
function memoryWrite(row) {
  const id = `a${auditSeq++}`;
  const createdAt = new Date().toISOString();
  const full = { id, ...row, detail: row.detail, createdAt };
  auditRows.set(`${row.userId}:${id}`, full);
  const list = auditOrder.get(row.userId) || [];
  list.unshift(id);
  while (list.length > AUDIT_PER_USER_CAP) {
    auditRows.delete(`${row.userId}:${list.pop()}`);
  }
  auditOrder.set(row.userId, list);
  return full;
}

function memoryList(userId, { action = '', limit = 50 } = {}) {
  const ids = auditOrder.get(userId) || [];
  const filtered = ids
    .map(id => auditRows.get(`${userId}:${id}`))
    .filter(Boolean)
    .filter(r => (action ? r.action === action : true));
  return { entries: filtered.slice(0, Math.min(Number(limit) || 50, 200)) };
}

// ===== PG 仓储 ========================================================
async function pgWrite(row) {
  const pool = getPool();
  await pool.query(
    `insert into audit_log (user_id, action, target, outcome, detail, ip, user_agent)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [row.userId || null, row.action, row.target, row.outcome, JSON.stringify(row.detail), row.ip, row.userAgent],
  );
  // cap 清理（低频写路径，子查询删除超额）
  if (row.userId) {
    await pool.query(
      `delete from audit_log
       where user_id = $1 and id not in (
         select id from audit_log where user_id = $1 order by created_at desc limit $2
       )`,
      [row.userId, AUDIT_PER_USER_CAP],
    );
  }
  return true;
}

async function pgList(userId, { action = '', limit = 50 } = {}) {
  const pool = getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const conditions = ['user_id = $1'];
  const params = [userId];
  if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
  const result = await pool.query(
    `select id, action, target, outcome, detail, ip, created_at from audit_log
     where ${conditions.join(' and ')} order by created_at desc limit ${safeLimit}`,
    params,
  );
  return {
    entries: result.rows.map(r => ({
      id: String(r.id),
      action: r.action,
      target: r.target,
      outcome: r.outcome,
      detail: r.detail || {},
      ip: r.ip,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
  };
}

// ===== 统一出口 =======================================================
export async function getAuditService() {
  if (await isDevMemoryModeResolved()) {
    return {
      mode: 'memory',
      write: row => memoryWrite(row),
      list: (userId, query) => memoryList(userId, query),
    };
  }
  return {
    mode: 'pg',
    write: row => pgWrite(row),
    list: (userId, query) => pgList(userId, query),
  };
}

/** 记录一条审计（fire-and-forget：内部 catch，绝不向上抛） */
export function recordAudit(input) {
  (async () => {
    try {
      const row = normInput(input);
      const svc = await getAuditService();
      svc.write(row);
    } catch (err) {
      auditWriteFailures += 1;
      console.warn('[audit] write failed:', err?.code || err?.message);
    }
  })();
}

/** 从 req 提取审计上下文（ip / ua） */
export function auditContextFrom(req) {
  return {
    ip: String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 200),
  };
}
