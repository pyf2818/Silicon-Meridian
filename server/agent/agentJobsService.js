// agentJobsService.js - 智能体定时任务 CRUD + 下次执行时间计算
import { getPool } from '../db/client.js';
import { runAgentOnce } from '../http/agentRunHandlers.js';
import { assertJobCreationAllowed, assertCronIntervalAllowed } from './agentJobsGuards.js';

/* ============ Cron 表达式解析（简化版，支持 5 字段：分 时 日 月 周） ============ */
// 不支持 L/W/# 等高级语法，仅支持 * / 数字 / , / -
// 例子：'0 8 * * *' (每天8点) / '*/30 * * * *' (每30分钟) / '0 9 * * 1-5' (工作日9点)

function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`invalid value: ${part}`);
    const [, range, stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isSafeInteger(step) || step < 1) throw new Error(`invalid step: ${part}`);
    const [start, explicitEnd] = range === '*' ? [min, max] : range.split('-').map(Number);
    const end = explicitEnd ?? (stepText === undefined ? start : max);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`invalid range: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

/**
 * 计算 cron 表达式的下一次执行时间
 * @param {string} cronExpr - 5字段 cron: "分 时 日 月 周"
 * @param {Date} from - 起始时间（默认 now）
 * @param {string} timezone - IANA 时区，独立于服务器时区
 * @returns {Date} 下次执行时间
 */
export function nextCronRun(cronExpr, from = new Date(), timezone = 'Asia/Shanghai') {
  if (typeof cronExpr !== 'string' || !(from instanceof Date) || !Number.isFinite(from.getTime())) {
    throw new Error('invalid cron expression or start date');
  }
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron expression must have 5 fields: ${cronExpr}`);

  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const daysOfMonth = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const daysOfWeek = parseCronField(parts[4], 0, 7);
  if (daysOfWeek.delete(7)) daysOfWeek.add(0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  });

  // 从 from + 1 分钟开始逐分钟扫描（最多扫 366 天）
  const start = new Date(from.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const maxIter = 366 * 24 * 60; // 最多扫一年
  for (let i = 0; i < maxIter; i++) {
    const t = new Date(start.getTime() + i * 60 * 1000);
    const local = {};
    for (const part of formatter.formatToParts(t)) {
      if (part.type !== 'literal') local[part.type] = Number(part.value);
    }
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    if (
      minutes.has(local.minute) &&
      hours.has(local.hour) &&
      daysOfMonth.has(local.day) &&
      months.has(local.month) &&
      daysOfWeek.has(weekday)
    ) {
      return t;
    }
  }
  throw new Error(`no next run found within 1 year for cron: ${cronExpr}`);
}

/* ============ Jobs CRUD ============ */

export async function createJob({ userId, agentId, name, description = '', cronExpr, timezone = 'Asia/Shanghai', missionPrompt }) {
  const pool = getPool();
  // 校验 cron 表达式
  const nextRun = nextCronRun(cronExpr, new Date(), timezone);
  // 护栏：per-user 任务数上限 + cron 最小触发间隔（防 LLM 成本失控）
  const countRes = await pool.query('select count(*)::int as count from agent_jobs where user_id = $1', [userId]);
  assertJobCreationAllowed({ count: countRes.rows[0]?.count || 0, cronExpr, timezone, nextCronRunFn: nextCronRun });
  const result = await pool.query(
    `insert into agent_jobs (user_id, agent_id, name, description, cron_expr, timezone, mission_prompt, next_run_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, next_run_at`,
    [userId, agentId, name, description, cronExpr, timezone, missionPrompt, nextRun]
  );
  return { id: result.rows[0].id, nextRunAt: result.rows[0].next_run_at };
}

export async function updateJob(jobId, userId, patch) {
  const pool = getPool();
  const fields = [];
  const params = [];
  let idx = 1;
  // HTTP 使用 camelCase；旧的 snake_case 调用仍可兼容。
  patch = { ...patch, cronExpr: patch.cronExpr ?? patch.cron_expr, missionPrompt: patch.missionPrompt ?? patch.mission_prompt };
  for (const key of ['name', 'description', 'cronExpr', 'timezone', 'missionPrompt', 'enabled']) {
    if (patch[key] !== undefined) {
      const col = key === 'cronExpr' ? 'cron_expr' : key === 'missionPrompt' ? 'mission_prompt' : key;
      fields.push(`${col} = $${idx++}`);
      params.push(patch[key]);
    }
  }
  if (patch.cronExpr !== undefined || patch.timezone !== undefined || patch.enabled === true) {
    const current = await pool.query(
      'select cron_expr, timezone from agent_jobs where id = $1 and user_id = $2',
      [jobId, userId]
    );
    if (!current.rows.length) return { updated: 0 };
    const nextRun = nextCronRun(patch.cronExpr ?? current.rows[0].cron_expr, new Date(), patch.timezone ?? current.rows[0].timezone);
    // 护栏：cron 表达式/时区变更时重验最小触发间隔
    assertCronIntervalAllowed({ cronExpr: patch.cronExpr ?? current.rows[0].cron_expr, timezone: patch.timezone ?? current.rows[0].timezone, nextCronRunFn: nextCronRun });
    fields.push(`next_run_at = $${idx++}`);
    params.push(nextRun);
  }
  if (fields.length === 0) return { updated: 0 };
  params.push(jobId, userId);
  const result = await pool.query(
    `update agent_jobs set ${fields.join(', ')}, updated_at = now() where id = $${idx++} and user_id = $${idx++}`,
    params
  );
  return { updated: result.rowCount };
}

export async function deleteJob(jobId, userId) {
  const pool = getPool();
  const result = await pool.query('delete from agent_jobs where id = $1 and user_id = $2', [jobId, userId]);
  return { deleted: result.rowCount };
}

export async function listJobs(userId) {
  const pool = getPool();
  const result = await pool.query(
    `select id, agent_id, name, description, cron_expr, timezone, mission_prompt, enabled,
            last_run_at, next_run_at, run_count, created_at, updated_at
     from agent_jobs where user_id = $1 order by created_at desc`,
    [userId]
  );
  return result.rows.map(r => ({
    id: r.id, agentId: r.agent_id, name: r.name, description: r.description,
    cronExpr: r.cron_expr, timezone: r.timezone, missionPrompt: r.mission_prompt,
    enabled: r.enabled, lastRunAt: r.last_run_at, nextRunAt: r.next_run_at,
    runCount: r.run_count, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function getJobRuns(jobId, userId, limit = 20) {
  const pool = getPool();
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100) : 20;
  const result = await pool.query(
    `select id, job_id, status, started_at, finished_at, duration_ms, output, error, tokens_used
     from agent_job_runs
     where job_id = $1 and user_id = $2
     order by started_at desc limit $3`,
    [jobId, userId, safeLimit]
  );
  return result.rows.map(r => ({
    id: r.id, jobId: r.job_id, status: r.status, startedAt: r.started_at,
    finishedAt: r.finished_at, durationMs: r.duration_ms, output: r.output,
    error: r.error, tokensUsed: r.tokens_used,
  }));
}

/* ============ Cron 守护：扫描到期任务并执行 ============ */

let cronTimer = null;
let cronRunning = false;

/**
 * 扫描所有到期的 agent jobs 并执行
 * 注意：这里需要从 user 的 LLM 配置中获取 baseUrl/apiKey/selectedModel
 * 当前实现：用环境变量 AGENT_LLM_CONFIG（JSON）作为默认 LLM 配置
 * 后续可改为从 user_settings 表读取每用户的 LLM 配置
 */
async function tickCronJobs() {
  if (cronRunning) return; // 防止重叠执行
  cronRunning = true;
  try {
    const pool = getPool();
    // 查找所有到期的任务
    const result = await pool.query(
      `select id, user_id, agent_id, mission_prompt, cron_expr, timezone
       from agent_jobs
       where enabled = true and next_run_at <= now()
       limit 10` // 每轮最多执行 10 个，避免长阻塞
    );

    for (const job of result.rows) {
      await executeJob(job);
    }
  } catch (err) {
    console.error('[cronTick] error:', err.message);
  } finally {
    cronRunning = false;
  }
}

async function executeJob(job) {
  const pool = getPool();
  const startedAt = new Date();
  let status = 'running';
  let output = '';
  let errorMessage = null;
  let tokensUsed = null;

  // 创建 run 记录
  const runResult = await pool.query(
    `insert into agent_job_runs (job_id, user_id, status, started_at) values ($1, $2, $3, $4) returning id`,
    [job.id, job.user_id, status, startedAt]
  );
  const runId = runResult.rows[0].id;

  try {
    // 读取 LLM 配置：暂用环境变量
    // TODO: 后续改为从 user_settings 表读取每用户的 LLM 配置
    let llmConfig = null;
    try {
      const rawConfig = process.env.AGENT_LLM_CONFIG;
      if (rawConfig) llmConfig = JSON.parse(rawConfig);
    } catch {}

    if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
      throw new Error('LLM config not available for cron jobs (set AGENT_LLM_CONFIG env var)');
    }

    // 执行任务
    const result = await runAgentOnce({
      agentId: job.agent_id,
      missionPrompt: job.mission_prompt,
      userId: job.user_id,
      llmConfig,
      newsContext: { blocked: [], interests: [] },
      sessionId: `cron-${runId}`,
    });
    output = (result.output || '').slice(0, 5000);
    tokensUsed = result.tokensUsed;
    status = 'success';
  } catch (err) {
    errorMessage = err.message;
    status = 'failed';
    console.error(`[executeJob] job ${job.id} failed:`, err.message);
  } finally {
    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;

    // 更新 run 记录
    await pool.query(
      `update agent_job_runs set status = $1, finished_at = $2, duration_ms = $3, output = $4, error = $5, tokens_used = $6 where id = $7`,
      [status, finishedAt, durationMs, output, errorMessage, tokensUsed, runId]
    );

    // 计算下次执行时间
    let nextRun = null;
    try {
      nextRun = nextCronRun(job.cron_expr, finishedAt, job.timezone);
    } catch (err) {
      console.error(`[executeJob] next cron calc failed:`, err.message);
    }

    // 更新 job 状态
    await pool.query(
      `update agent_jobs set last_run_at = $1, next_run_at = $2, last_result = $3, run_count = run_count + 1 where id = $4`,
      [startedAt, nextRun, JSON.stringify({ status, runId, durationMs }), job.id]
    );

    // 留存治理（2026-09-22）：run 记录每次执行都插一行，无限涨；写入时顺带裁剪
    // 该 job 只保留最近 100 条（对齐 memoryRetention 的「写入顺带维护、无独立 cron」模式）。
    // 失败只记日志，不影响本次执行结果落账。
    try {
      await pool.query(
        `delete from agent_job_runs
         where job_id = $1 and id not in (
           select id from agent_job_runs where job_id = $1 order by started_at desc limit 100
         )`,
        [job.id]
      );
    } catch (err) {
      console.error(`[executeJob] run retention cleanup failed:`, err.message);
    }
  }
}

/**
 * 启动 cron 守护进程
 * @param {number} intervalMs - 扫描间隔（默认 60 秒）
 * @returns {Function} stop 函数
 */
export function startCronDaemon(intervalMs = 60 * 1000) {
  if (cronTimer) {
    console.log('[cron] daemon already running');
    return () => {};
  }
  console.log(`[cron] daemon started, interval = ${intervalMs}ms`);
  // 启动后立即跑一次（扫描已过期任务）
  const initialTimer = setTimeout(() => tickCronJobs().catch(() => {}), 5000);
  cronTimer = setInterval(() => {
    tickCronJobs().catch(err => console.error('[cron tick] error:', err.message));
  }, intervalMs);
  return () => {
    clearTimeout(initialTimer);
    if (cronTimer) {
      clearInterval(cronTimer);
      cronTimer = null;
      console.log('[cron] daemon stopped');
    }
  };
}
