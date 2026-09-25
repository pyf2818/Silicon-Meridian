import { describe, it, expect } from 'vitest';

const {
  JOBS_PER_USER_CAP, MIN_CRON_INTERVAL_MS,
  estimateMinCronInterval, assertJobCreationAllowed, assertCronIntervalAllowed,
} = await import('../agentJobsGuards.js');

// 真实 cron 推进器（对齐 agentJobsService.nextCronRun 的行为面：返回 Date，非法抛错）
function fakeNextCronRun(cronExpr, from) {
  const [min] = String(cronExpr).trim().split(/\s+/);
  const d = new Date(from);
  if (min === '*') {
    d.setMinutes(d.getMinutes() + 1, 0, 0);
    return d;
  }
  if (min.startsWith('*/')) {
    const step = Number(min.slice(2));
    d.setMinutes(Math.ceil((d.getMinutes() + 1) / step) * step, 0, 0);
    return d;
  }
  const target = Number(min);
  d.setMinutes(target, 0, 0);
  if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}

describe('agentJobsGuards（定时任务护栏，纯逻辑）', () => {
  it('常量合理：cap=20，最小间隔=10 分钟', () => {
    expect(JOBS_PER_USER_CAP).toBe(20);
    expect(MIN_CRON_INTERVAL_MS).toBe(10 * 60_000);
  });

  it('estimateMinCronInterval：每分钟表达式返回 60s，每天表达式返回 24h', () => {
    const everyMin = estimateMinCronInterval('* * * * *', { nextCronRunFn: fakeNextCronRun });
    expect(everyMin).toBe(60_000);
    const daily = estimateMinCronInterval('0 6 * * *', { nextCronRunFn: fakeNextCronRun });
    expect(daily).toBe(24 * 3600_000);
    const every30 = estimateMinCronInterval('*/30 * * * *', { nextCronRunFn: fakeNextCronRun });
    expect(every30).toBe(30 * 60_000);
  });

  it('estimateMinCronInterval：缺 nextCronRunFn 抛 GUARD_MISCONFIG（防御循环依赖误用）', () => {
    expect(() => estimateMinCronInterval('* * * * *')).toThrowError(/nextCronRunFn/);
    try {
      estimateMinCronInterval('* * * * *');
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('GUARD_MISCONFIG');
    }
  });

  it('assertJobCreationAllowed：未达 cap 且间隔合规 → 放行', () => {
    expect(() => assertJobCreationAllowed({
      count: 19, cronExpr: '0 6 * * *', nextCronRunFn: fakeNextCronRun,
    })).not.toThrow();
  });

  it('assertJobCreationAllowed：达 cap 抛 JOBS_LIMIT_REACHED（400 语义）', () => {
    try {
      assertJobCreationAllowed({ count: 20, cronExpr: '0 6 * * *', nextCronRunFn: fakeNextCronRun });
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('JOBS_LIMIT_REACHED');
      expect(err.status).toBe(400);
      expect(err.message).toContain('20');
    }
  });

  it('assertJobCreationAllowed：过密 cron 抛 CRON_TOO_FREQUENT', () => {
    try {
      assertJobCreationAllowed({ count: 0, cronExpr: '* * * * *', nextCronRunFn: fakeNextCronRun });
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('CRON_TOO_FREQUENT');
      expect(err.status).toBe(400);
      expect(err.message).toContain('10 分钟');
    }
  });

  it('assertJobCreationAllowed：边界 */10（恰好 10 分钟）→ 放行；*/5 → 拒绝', () => {
    expect(() => assertJobCreationAllowed({
      count: 0, cronExpr: '*/10 * * * *', nextCronRunFn: fakeNextCronRun,
    })).not.toThrow();
    try {
      assertJobCreationAllowed({ count: 0, cronExpr: '*/5 * * * *', nextCronRunFn: fakeNextCronRun });
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('CRON_TOO_FREQUENT');
    }
  });

  it('assertCronIntervalAllowed：合规放行、过密拒绝', () => {
    expect(() => assertCronIntervalAllowed({
      cronExpr: '0 9 * * 1-5', nextCronRunFn: fakeNextCronRun,
    })).not.toThrow();
    expect(() => assertCronIntervalAllowed({
      cronExpr: '* * * * *', nextCronRunFn: fakeNextCronRun,
    })).toThrowError(/CRON_TOO_FREQUENT|最小触发间隔/);
  });
});
