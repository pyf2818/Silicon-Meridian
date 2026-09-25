/**
 * agentJobsGuards.js - 定时任务创建/修改护栏（纯逻辑，无 IO）
 *
 * 对抗性审查结论（批 7）：
 * - P1 无任务数上限：agent_jobs 无 per-user cap，用户可无限创建任务，
 *   每次 cron 触发都跑完整 agent 循环（LLM 调用）→ 无限任务 = 无限成本。
 * - P1 无频率护栏：合法的 "* * * * *"（每分钟）会通过 nextCronRun 校验，
 *   全自动模式下 = 每天 1440 次 LLM 调用。
 * - 解法：创建时验 cap + 最小触发间隔；更新 cronExpr/timezone 时重验间隔。
 * - nextCronRunFn 依赖注入：guards 不 import service（service 反向 import guards），
 *   避免循环依赖，且纯逻辑可直接单测。
 */
export const JOBS_PER_USER_CAP = 20;
export const MIN_CRON_INTERVAL_MS = 10 * 60_000;

/**
 * 估算 cron 表达式的最小触发间隔。
 * 关键：跳过首个 gap——它包含「从当前时刻到下一次调度网格」的残余时间
 * （例如 10:07:23 创建每 10 分钟一次的任务，首 gap 只有 2.6 分钟），
 * 不代表调度周期，会造成误杀；从第二个样本起两个触发点均已对齐网格，
 * gap 即真实周期。
 * 对非法表达式由 nextCronRunFn 抛错透传（调用方已先做过 nextCronRun 校验）。
 */
export function estimateMinCronInterval(cronExpr, { timezone, nextCronRunFn, samples = 4 } = {}) {
  if (typeof nextCronRunFn !== 'function') {
    throw Object.assign(new Error('nextCronRunFn is required'), { code: 'GUARD_MISCONFIG' });
  }
  let cursor = new Date();
  let minGap = Infinity;
  for (let i = 0; i < samples; i++) {
    const next = nextCronRunFn(cronExpr, cursor, timezone || 'Asia/Shanghai');
    const gap = next.getTime() - cursor.getTime();
    cursor = next;
    if (i === 0) continue; // 首个 gap 含残余时间，非调度周期
    if (Number.isFinite(gap) && gap < minGap) minGap = gap;
  }
  return minGap;
}

function assertInterval({ cronExpr, timezone, nextCronRunFn, minIntervalMs }) {
  const gap = estimateMinCronInterval(cronExpr, { timezone, nextCronRunFn });
  if (gap < minIntervalMs) {
    throw Object.assign(
      new Error(`定时任务最小触发间隔为 ${Math.round(minIntervalMs / 60000)} 分钟，当前表达式触发过密（会放大 LLM 调用成本），请调整 cron 表达式`),
      { code: 'CRON_TOO_FREQUENT', status: 400 },
    );
  }
}

/** 创建护栏：任务数上限 + 最小触发间隔。超限抛 400 语义错误（handler 统一转 JSON）。 */
export function assertJobCreationAllowed({
  count, cronExpr, timezone, nextCronRunFn,
  cap = JOBS_PER_USER_CAP, minIntervalMs = MIN_CRON_INTERVAL_MS,
}) {
  if (Number(count) >= cap) {
    throw Object.assign(new Error(`每个用户最多创建 ${cap} 个定时任务，请先清理不再使用的任务`), {
      code: 'JOBS_LIMIT_REACHED', status: 400,
    });
  }
  assertInterval({ cronExpr, timezone, nextCronRunFn, minIntervalMs });
}

/** 更新护栏：仅当 cron 表达式/时区变更时重验最小触发间隔。 */
export function assertCronIntervalAllowed({
  cronExpr, timezone, nextCronRunFn, minIntervalMs = MIN_CRON_INTERVAL_MS,
}) {
  assertInterval({ cronExpr, timezone, nextCronRunFn, minIntervalMs });
}
