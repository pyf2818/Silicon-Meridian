import { describe, it, expect, vi, afterEach } from 'vitest';
import { runElfAgentLoop } from '../runElfAgentLoop.js';
import { registerTool, unregisterTool } from '../../../utils/toolRegistry.js';

// 画像/进化档案写入模块在 node 环境无 localStorage，必须 mock 以保证测试确定性。
// （已验证：profileLearning / agentEvolution 的 vi.mock 在 vitest 中正常生效；
//  而 agentLoopCore 的 mock 在本环境无法拦截，故改用「真实循环 + fetch stub」套路，
//  这正是 agentLoopContracts.test.js 验证过的做法。）
const mocks = vi.hoisted(() => ({ observeToolUsage: vi.fn(), recordAgentRun: vi.fn() }));
vi.mock('../../../utils/profileLearning.js', () => ({ observeToolUsage: mocks.observeToolUsage }));
vi.mock('../../../domain/agent/agentEvolution.js', () => ({ recordAgentRun: mocks.recordAgentRun }));

const TOOL = 'zz_elf_obs_tool';
const toolSchema = { type: 'function', function: { name: TOOL, description: 't', parameters: { type: 'object', properties: {} } } };
const makeCall = (id, args, name) => ({ index: 0, id, type: 'function', function: { name, arguments: args } });
function response(events) {
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''));
}

const baseParams = (over = {}) => ({
  activeAgentId: 'elf-finance',
  baseMessages: [{ role: 'user', content: '茅台今天怎么样' }],
  toolSchemas: [],
  systemPrompt: '你是 AI 精灵',
  llmConfig: { selectedModel: 'test-model', webSearchEnabled: false },
  setAgentMessages: () => {},
  ...over,
});

describe('runElfAgentLoop 画像观测', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.observeToolUsage.mockReset();
    mocks.recordAgentRun.mockReset();
    try { unregisterTool(TOOL); } catch { /* ignore */ }
  });

  it('无工具调用：仍记录一次运行，usage 透传（此前硬编码 null 的契约违反已修复）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { delta: '净利润同比增长 30%' },
      { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, turns: 1 } },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runElfAgentLoop(baseParams());

    expect(result.content).toBe('净利润同比增长 30%');
    expect(result.toolCallCount).toBe(0);
    expect(mocks.observeToolUsage).toHaveBeenCalledWith([]);
    expect(mocks.recordAgentRun).toHaveBeenCalledWith('elf-finance', { toolCalls: 0, tokens: 15, goalRounds: 1 });
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, turns: 1 });
  });

  it('有工具调用：把真实工具名补录进画像/进化档案', async () => {
    registerTool(TOOL, { schema: toolSchema, executor: async () => '证据', meta: { riskLevel: 'read' } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ toolCallDelta: [makeCall('t1', '{}', TOOL)] }]))
      .mockResolvedValueOnce(response([{ delta: '汇总：茅台上涨' }, { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }]))
      .mockResolvedValue(response([{ delta: 'fallback' }, { usage: { total_tokens: 1 } }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runElfAgentLoop(baseParams({ toolSchemas: [toolSchema] }));

    expect(result.toolCallCount).toBe(1);
    expect(mocks.observeToolUsage).toHaveBeenCalledWith([TOOL]);
    // 循环真实跑了 2 轮（工具轮 + 收敛轮），turns 累计为 2
    expect(mocks.recordAgentRun).toHaveBeenCalledWith('elf-finance', { toolCalls: 1, tokens: 30, goalRounds: 2 });
    expect(result.content).toBe('汇总：茅台上涨');
  });

  it('内核循环抛错：不崩溃，且不写入任何观测（运行未成功）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('upstream boom'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runElfAgentLoop(baseParams());

    expect(result.content).toContain('分析失败');
    expect(mocks.observeToolUsage).not.toHaveBeenCalled();
    expect(mocks.recordAgentRun).not.toHaveBeenCalled();
  });

  it('观测函数自身抛错：不影响精灵正常返回', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { delta: '正常回复' },
      { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    mocks.observeToolUsage.mockImplementation(() => { throw new Error('storage dead'); });

    const result = await runElfAgentLoop(baseParams());

    expect(result.content).toBe('正常回复');
    expect(result.toolCallCount).toBe(0);
    // observe 抛错被内层 catch 吞掉，观测块整体失败，recordAgentRun 不应被调用
    expect(mocks.recordAgentRun).not.toHaveBeenCalled();
  });
});
