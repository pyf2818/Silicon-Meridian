import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentRunRequest, runAgentOnce } from '../agentRunHandlers.js';
import { getUserIdFromRequest } from '../agentAuth.js';
import { safeExternalFetch } from '../../security/urlSafety.js';

vi.mock('../agentAuth.js', () => ({ getUserIdFromRequest: vi.fn(async () => 'user') }));
vi.mock('../../agent/agentContext.js', () => ({
  buildAgentSystemPrompt: vi.fn(async () => 'system'),
  buildAgentUserMessage: vi.fn(async () => 'user'),
}));
vi.mock('../../agent/agentMemoryService.js', () => ({ addAgentMemory: vi.fn() }));
vi.mock('../../security/urlSafety.js', () => ({ safeExternalFetch: vi.fn(), allowPrivateAiNetwork: () => false }));

const args = { agentId: 'analyst', missionPrompt: 'test', userId: 'user', llmConfig: { baseUrl: 'https://model.example/v1/', selectedModel: 'test' } };
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }], usage: { total_tokens: 7 } }));
function res() {
  return { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
}
beforeEach(() => {
  vi.clearAllMocks();
  safeExternalFetch.mockResolvedValue(response());
  vi.stubGlobal('fetch', vi.fn(async () => response()));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('background agent model calls', () => {
  it('uses the safe gateway and appends chat/completions only once', async () => {
    expect(await runAgentOnce(args)).toMatchObject({ output: 'done', tokensUsed: 7 });
    expect(safeExternalFetch).toHaveBeenCalledWith('https://model.example/v1/chat/completions', expect.objectContaining({
      allowPrivate: false, signal: expect.any(AbortSignal), method: 'POST',
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    let signal;
    safeExternalFetch.mockImplementation(async (_, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }) };
    });
    const promise = runAgentOnce(args);
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(90_001);
    await assertion;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout after success', async () => {
    vi.useFakeTimers();
    await runAgentOnce(args);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns URL safety status codes through HTTP', async () => {
    safeExternalFetch.mockRejectedValue(Object.assign(new Error('Private address blocked'), { code: 'PRIVATE_NETWORK_BLOCKED', status: 403 }));
    const output = res();
    await handleAgentRunRequest({ body: args }, output);
    expect(output.statusCode).toBe(403);
  });

  it.each(['null', '{bad json', JSON.stringify({ ...args, missionPrompt: 123 })])('returns 400 for malformed input %s', async body => {
    const output = res();
    await handleAgentRunRequest({ body }, output);
    expect(output.statusCode).toBe(400);
    expect(safeExternalFetch).not.toHaveBeenCalled();
  });

  it('does not call the model when unauthenticated', async () => {
    getUserIdFromRequest.mockResolvedValueOnce(null);
    const output = res();
    await handleAgentRunRequest({ body: args }, output);
    expect(output.statusCode).toBe(401);
    expect(safeExternalFetch).not.toHaveBeenCalled();
  });
});
