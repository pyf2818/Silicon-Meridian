import { afterEach, describe, expect, it, vi } from 'vitest';
import { runToolLoop } from '../aichat/agentLoopCore.js';
import { registerTool, unregisterTool } from '../../utils/toolRegistry.js';

const name = 'zz_contract_tool';
const hiddenName = 'zz_hidden_tool';
const schema = (toolName = name) => ({ type: 'function', function: {
  name: toolName, description: 'test',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
} });
const call = (id, args, toolName = name) => ({ index: 0, id, type: 'function', function: { name: toolName, arguments: args } });
function response(events) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
}
function setup(calls, meta = {}, overrides = {}) {
  const executor = vi.fn(async () => 'tool evidence');
  registerTool(name, { schema: schema(), executor, meta });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response([{ toolCallDelta: calls }]))
    .mockResolvedValueOnce(response([{ delta: 'finished' }]));
  vi.stubGlobal('fetch', fetchMock);
  return { executor, fetchMock, run: () => runToolLoop({
    controller: new AbortController(), toolSchemas: [schema()],
    baseMessages: [{ role: 'user', content: 'test' }], systemPrompt: 'test',
    llmConfig: { baseUrl: 'https://example.com' }, selectedModel: 'test',
    toolCtx: { approvalMode: 'auto' }, maxIterations: 2, ...overrides,
  }) };
}
afterEach(() => {
  unregisterTool(name);
  unregisterTool(hiddenName);
  vi.unstubAllGlobals();
});

describe('agent tool loop contracts', () => {
  it.each(['{"query":', '{}'])('returns a tool result for invalid arguments %s so the model can repair them', async args => {
    const { executor, fetchMock, run } = setup([call('bad', args), { ...call('good', '{"query":"ok"}'), index: 1 }]);
    const result = await run();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.finalContent).toBe('finished');
    const messages = JSON.parse(fetchMock.mock.calls[1][1].body).messages;
    const replies = messages.filter(m => m.role === 'tool');
    expect(replies.map(m => m.tool_call_id)).toEqual(['bad', 'good']);
    expect(replies[0].content).toContain('参数校验失败');
    expect(replies[0].content).toContain('<untrusted_data');
  });

  it('normalizes legacy arguments before validation', async () => {
    const { executor, run } = setup([call('alias', '{"keyword":"search"}')], {
      normalizeArgs: args => ({ ...args, query: args.query || args.keyword }),
    });
    await run();
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ query: 'search' }), expect.anything());
  });

  it('does not execute a globally registered tool outside this agent whitelist', async () => {
    const hiddenExecutor = vi.fn(async () => 'should never run');
    registerTool(hiddenName, { schema: schema(hiddenName), executor: hiddenExecutor });
    const { run } = setup([call('hidden', '{"query":"x"}', hiddenName)]);
    const result = await run();
    expect(hiddenExecutor).not.toHaveBeenCalled();
    expect(result.conversationMessages.find(m => m.role === 'tool')?.content).toContain('未授权');
  });

  it('does not execute tools returned during the final turn with tools disabled', async () => {
    const { executor, run } = setup([call('final', '{"query":"x"}')], {}, { maxIterations: 1 });
    const result = await run();
    expect(executor).not.toHaveBeenCalled();
    expect(result.finalContent).toContain('达到本次推理轮次上限');
    expect(result.toolCallTrace[0].status).toBe('skipped');
  });
});
