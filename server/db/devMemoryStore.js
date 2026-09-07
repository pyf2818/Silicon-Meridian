/**
 * 开发态内存共享存储（仅 DEV_MEMORY_AUTH=true 且非 production 时启用）。
 *
 * 与 memoryAuthRepository.js 思路一致：用模块级单例 Map，保证一次进程内多次
 * createXxxRepository() / 跨请求调用共享同一份数据，从而让「注册 → 登录 → 画像
 * → 预热」这类端到端链路在本地无 PostgreSQL 时也能跑通。
 *
 * 字段形状刻意对齐各 *Repository / SQL 迁移文件，保证内存态与数据库态语义一致。
 */
import { randomUUID } from 'node:crypto';

// userId -> 画像行
export const profiles = new Map();
// `${userId}:${date}` -> 快照对象
export const snapshots = new Map();
// userId -> [ { id, date, algorithmVersion, aiStatus, oneLine } ]（最新在前）
export const snapshotLists = new Map();
// userId -> { personaSummary, learnedPreferences, personaUpdatedAt }
export const personaSummaries = new Map();
// userId -> [ { id, snapshot, evolved_at } ]（最新在前）
export const personaHistories = new Map();
// userId -> [ agent memory ]
export const agentMemories = new Map();
// id -> intelligence_event 行（形状对齐 intelligence_events 表）
export const intelligenceEvents = new Map();
// id -> intelligence_article 行（形状对齐 intelligence_articles 表）
export const intelligenceArticles = new Map();

/**
 * 开发态内存备用存储开关。
 * v22 放宽：非 production 且满足任一条件即启用——
 *   ① 显式 DEV_MEMORY_AUTH=true（原有行为）；
 *   ② 未配置 DATABASE_URL（测试开发阶段免启动 PostgreSQL，登录/群聊/广场/画像全自动落内存）。
 * 生产环境绝不会进入该分支，避免掩盖真实 DB 故障；配了 DATABASE_URL 的 dev 仍走真实 PG。
 */
export function isDevMemoryMode() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.DEV_MEMORY_AUTH === 'true') return true;
  return !process.env.DATABASE_URL;
}

// —— v22：PG 连通性探测（每进程一次，记忆化） ————————————————
// 场景：DATABASE_URL 配了但 PostgreSQL 实际没启动（测试开发阶段常态）。
// 同步门控覆盖不了这种情况，这里提供异步版判定：真实探测 select 1（1.5s 超时），
// 连不上即视为内存模式。生产环境永不触发。
let pgProbePromise = null;

export function isDevMemoryModeResolved() {
  if (process.env.NODE_ENV === 'production') return Promise.resolve(false);
  if (isDevMemoryMode()) return Promise.resolve(true);
  if (!process.env.DATABASE_URL) return Promise.resolve(true);
  if (!pgProbePromise) {
    pgProbePromise = (async () => {
      try {
        const { getPool } = await import('./client.js');
        await Promise.race([
          getPool().query('select 1'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('pg probe timeout')), 1500)),
        ]);
        return false; // PG 可用 → 走真实数据库
      } catch {
        return true;  // PG 不可用 → 内存兜底
      }
    })();
  }
  return pgProbePromise;
}

export { randomUUID };
export const __devMemoryStore = {
  profiles, snapshots, snapshotLists, personaSummaries, personaHistories, agentMemories,
  intelligenceEvents, intelligenceArticles,
};
