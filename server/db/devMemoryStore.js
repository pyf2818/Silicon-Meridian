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

/**
 * 开发态内存备用存储开关。
 * 仅当显式设置 DEV_MEMORY_AUTH=true 且非 production 时生效。
 * 生产环境绝不会进入该分支，避免掩盖真实 DB 故障。
 */
export function isDevMemoryMode() {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_MEMORY_AUTH === 'true';
}

export { randomUUID };
export const __devMemoryStore = {
  profiles, snapshots, snapshotLists, personaSummaries, personaHistories, agentMemories,
};
