import { getPool } from '../db/client.js';

const recentUpdates = new Map(); // userId -> lastUpdateTs
const THROTTLE_MS = 5 * 60 * 1000; // 5min

/**
 * 节流更新 users.last_seen_at
 * 在请求结束时异步调用，不阻塞响应
 */
export async function updateLastSeen(userId) {
  if (!userId) return;

  const now = Date.now();
  const last = recentUpdates.get(userId) || 0;
  if (now - last < THROTTLE_MS) return;

  recentUpdates.set(userId, now);
  try {
    await getPool().query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
  } catch {
    // silent: last_seen_at 失败不影响主流程
  }
}

/**
 * Express-style middleware 工厂，从 req.userId 调用 updateLastSeen
 */
export function createLastSeenHandler() {
  return (req, res, next) => {
    // res.on('finish') 不阻塞响应
    if (res.on) {
      res.on('finish', () => {
        if (req.userId) updateLastSeen(req.userId);
      });
    } else if (next) {
      // 兼容无 res.on 的情况
      if (req.userId) updateLastSeen(req.userId);
    }
    if (next) next();
  };
}
