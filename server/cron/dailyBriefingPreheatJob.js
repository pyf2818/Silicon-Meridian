/**
 * Phase 3 Task B5: 每日简报预热 cron job
 * 06:00 Asia/Shanghai 触发，扫描近 7 天活跃用户，并发预热今日推荐快照。
 *
 * - 单用户复用 snapshotService.preheatForUser（缓存命中则直接返回）
 * - 并发上限 3，避免一次性压垮上游 LLM
 * - 单用户失败不影响其他用户
 */
import { getPool } from '../db/client.js';
import { preheatForUser } from '../profile/snapshotService.js';

const CONCURRENCY_LIMIT = 3;

/**
 * 查询活跃用户（近 7 天有 last_seen_at 记录）
 * last_seen_at 由 lastSeenMiddleware 节流更新（5min throttle）
 */
async function getActiveUsers() {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, username FROM users
     WHERE last_seen_at IS NOT NULL
       AND last_seen_at >= now() - interval '7 days'
     ORDER BY last_seen_at DESC`
  );
  return res.rows;
}

/**
 * 简易并发池：从队列中取 task 执行，最多 limit 个 worker 并行
 * @param {Array<() => Promise>} tasks
 * @param {number} limit
 */
async function runWithConcurrency(tasks, limit) {
  const queue = [...tasks];
  const workers = Array(Math.min(limit, tasks.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

/**
 * 主入口：cron 06:00 调用
 * 也可通过 npm run preheat:today <userId> 手动触发单用户
 */
export async function runDailyPreheat() {
  console.log('[preheat] cron started at', new Date().toISOString());
  try {
    const users = await getActiveUsers();
    console.log(`[preheat] ${users.length} active users to preheat`);

    if (users.length === 0) {
      console.log('[preheat] no active users, exit');
      return { total: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    const tasks = users.map(user => async () => {
      try {
        const result = await preheatForUser({ userId: user.id });
        console.log(`[preheat] ${user.username || user.id} done (cached=${result.cached})`);
        succeeded++;
      } catch (err) {
        console.error(`[preheat] ${user.username || user.id} failed:`, err.message);
        failed++;
      }
    });

    await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
    console.log(`[preheat] cron finished: ${succeeded} ok, ${failed} failed`);
    return { total: users.length, succeeded, failed };
  } catch (err) {
    console.error('[preheat] cron failed:', err.message);
    return { total: 0, succeeded: 0, failed: 0, error: err.message };
  }
}

/**
 * 单用户手动触发（dev 用，scripts/runPreheatToday.mjs 调用）
 */
export async function preheatSingleUser(userId) {
  return preheatForUser({ userId });
}
