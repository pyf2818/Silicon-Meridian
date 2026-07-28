/**
 * Phase 3 Task B5: 手动触发单用户预热的 dev 脚本
 *
 * 用法：
 *   node scripts/runPreheatToday.mjs <userId>
 *
 * 环境变量：
 *   - DATABASE_URL：必填，PG 连接串
 *   - DEFAULT_LLM_BASE_URL / DEFAULT_LLM_API_KEY / DEFAULT_LLM_MODEL：用户未同步 LLM 配置时的兜底
 */
import { preheatSingleUser } from '../server/cron/dailyBriefingPreheatJob.js';
import { closePool } from '../server/db/client.js';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: node scripts/runPreheatToday.mjs <userId>');
  process.exit(1);
}

try {
  console.log(`[preheat] running for user ${userId}`);
  const result = await preheatSingleUser(userId);
  // result 可能很大，仅打印前 500 字符
  console.log('[preheat] result:', JSON.stringify(result, null, 2).slice(0, 500));
  process.exit(0);
} catch (err) {
  console.error('[preheat] failed:', err);
  process.exit(1);
} finally {
  await closePool().catch(() => {});
}
