import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentJobsRequest } from '../agentJobsHandlers.js';
import { getUserIdFromRequest } from '../agentAuth.js';
import { getJobRuns } from '../../agent/agentJobsService.js';

vi.mock('../agentAuth.js', () => ({ getUserIdFromRequest: vi.fn(async () => 'user') }));
vi.mock('../../agent/agentJobsService.js', () => ({
  createJob: vi.fn(), updateJob: vi.fn(), deleteJob: vi.fn(), listJobs: vi.fn(),
  getJobRuns: vi.fn(async () => []), nextCronRun: vi.fn(),
}));
function res() { return { setHeader() {}, end(body) { this.body = JSON.parse(body); } }; }
beforeEach(() => vi.clearAllMocks());

describe('agent job history input validation', () => {
  it.each(['abc', '0', '101', '1.5'])('rejects invalid limit %s before querying', async limit => {
    const output = res();
    await handleAgentJobsRequest({ url: `/api/agent-jobs/job/runs?limit=${limit}`, headers: {} }, output, '/api/agent-jobs/job/runs', 'GET');
    expect(output.statusCode).toBe(400);
    expect(getJobRuns).not.toHaveBeenCalled();
  });

  it('passes a bounded integer limit', async () => {
    const output = res();
    await handleAgentJobsRequest({ url: '/api/agent-jobs/job/runs?limit=25', headers: {} }, output, '/api/agent-jobs/job/runs', 'GET');
    expect(output.statusCode).toBe(200);
    expect(getJobRuns).toHaveBeenCalledWith('job', 'user', 25);
  });

  it('rejects unauthenticated history access', async () => {
    getUserIdFromRequest.mockResolvedValueOnce(null);
    const output = res();
    await handleAgentJobsRequest({ url: '/api/agent-jobs/job/runs?limit=25', headers: {} }, output, '/api/agent-jobs/job/runs', 'GET');
    expect(output.statusCode).toBe(401);
    expect(getJobRuns).not.toHaveBeenCalled();
  });
});
