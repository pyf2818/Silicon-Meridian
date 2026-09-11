import { describe, it, expect, vi, afterEach } from 'vitest';
import { runToolLoop } from '../aichat/agentLoopCore.js';
import { registerTool, unregisterTool } from '../../utils/toolRegistry.js';

/**
 * runToolLoop trace 层：僵尸进度守卫
 *
 * 性质：trace 卡片完结（done/skipped）之后，任何迟到的 emitProgress 补丁
 * （如被超时弃等的 executor、嵌套子代理残存的 onProgress）不得再刷新卡片，
 * 也不得触发新的 onProgress flush —— UI 完结态必须稳定。
 * 同时守住反面：running 期间的合法进度必须照常透传。
 */

const TOOL_NAME = 'zz_zombie_progress_tool';

function mkSchema(name) {
  return {
    type: 'function',
    function: { name, description: 'test', parameters: { type: 'object', properties: {} } },
  };
}

/** 伪造 SSE 流式响应：chunks 为字符串数组，逐块吐出后 done */
function sseResponse(chunks) {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            const idx = i;
            i += 1; // 消费指针必须推进，否则流永不结束（别问是怎么知道的）
            return idx < chunks.length
              ? { value: encoder.encode(chunks[idx]), done: false }
              : { value: undefined, done: true };
          },
          cancel: async () => {},
        };
      },
    },
  };
}

const sseLine = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

afterEach(() => {
  unregisterTool(TOOL_NAME);
  vi.restoreAllMocks();
});

describe('runToolLoop 僵尸进度守卫', () => {
  it('running 期间的 emitProgress 正常透传；完结后的迟到补丁被吞掉', async () => {
    registerTool(TOOL_NAME, {
      source: 'custom-http',
      schema: mkSchema(TOOL_NAME),
      meta: { label: '僵尸进度测试', timeoutMs: 5000 },
      executor: async (args, ctx) => {
        ctx?.emitProgress?.({ pct: 50 }); // 运行中：合法进度，应透传
        // 迟到僵尸：executor 返回后 40ms 才到达（trace 项此时已是 done）
        setTimeout(() => {
          try { ctx?.emitProgress?.({ pct: 99 }); } catch { /* 守卫应让这里无声无息 */ }
        }, 40);
        return 'ok';
      },
    });

    const firstCall = [
      sseLine({
        toolCallDelta: [{ index: 0, id: 'call_z1', function: { name: TOOL_NAME, arguments: '{}' } }],
      }),
      sseLine({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    ];
    const secondCall = [sseLine({ delta: '最终答案' }), 'data: [DONE]\n\n'];
    const responses = [sseResponse(firstCall), sseResponse(secondCall)];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()));

    const patches = [];
    const result = await runToolLoop({
      controller: new AbortController(),
      toolSchemas: [mkSchema(TOOL_NAME)],
      baseMessages: [{ role: 'user', content: '测试僵尸进度守卫' }],
      systemPrompt: 'test',
      llmConfig: { baseUrl: 'https://llm.example.com', apiKey: 'k' },
      selectedModel: 'test-model',
      toolCtx: { sessionId: '' },
      maxIterations: 2,
      onProgress: (p) => patches.push(p),
    });

    // 主链正常：工具跑完 + 拿到最终答案
    expect(result.finalContent).toBe('最终答案');
    expect(result.toolCallTrace).toHaveLength(1);
    expect(result.toolCallTrace[0].status).toBe('done');

    // 反面守住：running 期间的合法进度真的透传到了 UI
    const sawRunningProgress = patches.some(
      (p) => Array.isArray(p.toolCalls) && p.toolCalls.some((t) => t.progress?.pct === 50),
    );
    expect(sawRunningProgress).toBe(true);

    // 正面守住：循环结束后等僵尸定时器开火，onProgress 调用数必须稳定不变
    const countAtEnd = patches.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(patches.length).toBe(countAtEnd);
  });
});
