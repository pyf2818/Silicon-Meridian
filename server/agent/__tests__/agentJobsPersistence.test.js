import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createJob, updateJob } from '../agentJobsService.js';
import { getPool } from '../../db/client.js';

vi.mock('../../db/client.js', () => ({ getPool: vi.fn() }));

describe('agent job persistence', () => {
  const query = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T01:00:00Z'));
    query.mockReset();
    getPool.mockReturnValue({ query });
  });
  afterEach(() => vi.useRealTimers());

  it('creates the next run using the requested timezone', async () => {
    query.mockResolvedValue({ rows: [{ id: 'job', next_run_at: 'next' }] });
    await createJob({ userId: 'u', agentId: 'a', name: 'job', missionPrompt: 'run', cronExpr: '0 8 * * *', timezone: 'UTC' });
    // 0011 护栏在 insert 前新增了一次 count 查询——按 SQL 特征定位 insert 调用，不依赖调用序号
    const insertCall = query.mock.calls.find(([sql]) => sql.includes('insert into agent_jobs'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][7].toISOString()).toBe('2026-09-13T08:00:00.000Z');
  });

  it('persists camelCase API fields and recalculates the schedule with the saved timezone', async () => {
    query.mockResolvedValueOnce({ rows: [{ cron_expr: '0 8 * * *', timezone: 'UTC' }] }).mockResolvedValue({ rowCount: 1 });
    expect(await updateJob('job', 'u', { cronExpr: '0 9 * * *', missionPrompt: 'updated' })).toEqual({ updated: 1 });
    const [sql, params] = query.mock.calls.find(([sql]) => sql.startsWith('update'));
    expect(sql).toContain('cron_expr =');
    expect(sql).toContain('mission_prompt =');
    expect(params).toContain('0 9 * * *');
    expect(params).toContain('updated');
    expect(params.find(p => p instanceof Date).toISOString()).toBe('2026-09-13T09:00:00.000Z');
    expect(params.slice(-2)).toEqual(['job', 'u']);
  });

  it('recalculates next_run_at when only timezone changes', async () => {
    query.mockResolvedValueOnce({ rows: [{ cron_expr: '0 8 * * *', timezone: 'Asia/Shanghai' }] }).mockResolvedValue({ rowCount: 1 });
    await updateJob('job', 'u', { timezone: 'UTC' });
    const [sql, params] = query.mock.calls.find(([sql]) => sql.startsWith('update'));
    expect(sql).toContain('next_run_at =');
    expect(params.find(p => p instanceof Date).toISOString()).toBe('2026-09-13T08:00:00.000Z');
  });

  it('does not update a job owned by another user', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await updateJob('job', 'other', { cronExpr: '0 9 * * *' })).toEqual({ updated: 0 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('update'))).toBe(false);
  });
});
