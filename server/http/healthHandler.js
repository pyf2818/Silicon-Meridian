/**
 * healthHandler.js - 进程健康端点（对齐 WorkBuddy supervisor 的可观测语义）
 *
 * GET /api/health → { ok, mode, db, uptimeSeconds, rssMB, heapUsedMB, auditWriteFailures, ts }
 * 供外部探活（Docker healthcheck / PM2 / systemd）与水位告警。
 * pg 模式下做 1.5s 超时的 select 1 探测；memory 模式（dev/无 PG）直接 ok。
 */
import { isDevMemoryMode, isDevMemoryModeResolved } from '../db/devMemoryStore.js';
import { auditWriteFailures } from '../security/auditService.js';

export function healthSnapshot({ dbStatus = 'memory' } = {}) {
  const mem = process.memoryUsage();
  return {
    ok: dbStatus !== 'error',
    mode: isDevMemoryMode() ? 'memory' : 'pg',
    db: dbStatus,
    uptimeSeconds: Math.round(process.uptime()),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    auditWriteFailures,
    ts: new Date().toISOString(),
  };
}

export async function handleHealthRequest(req, res) {
  let dbStatus = 'memory';
  try {
    if (!(await isDevMemoryModeResolved())) {
      const { getPool } = await import('../db/client.js');
      await Promise.race([
        getPool().query('select 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('db probe timeout')), 1500)),
      ]);
      dbStatus = 'ok';
    }
  } catch {
    dbStatus = 'error';
  }
  const snapshot = healthSnapshot({ dbStatus });
  const body = JSON.stringify(snapshot);
  res.statusCode = snapshot.ok ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}
