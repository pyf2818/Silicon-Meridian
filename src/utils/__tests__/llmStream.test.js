import { describe, it, expect, vi } from 'vitest';
import { streamLlm } from '../llmStream.js';

// 构造一个 SSE 响应（ReadableStream），帧数组逐条编码为 data: 行
function sseResponse(frames, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  const text = frames.map(f => (f === '[DONE]' ? 'data: [DONE]\n\n' : `data: ${JSON.stringify(f)}\n\n`)).join('');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return { ok, status, body: stream };
}

const CFG = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', selectedModel: 'test-model' };

describe('llmStream streamLlm', () => {
  it('解析 delta 增量并回调 onDelta，返回累计全文与 usage', async () => {
    const deltas = [];
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      { ok: true, delta: '第一' },
      { ok: true, delta: '段文字' },
      { ok: true, usage: { total_tokens: 42 } },
      '[DONE]',
    ]));
    const { content, usage } = await streamLlm({
      llmConfig: CFG,
      userPrompt: '你好',
      onDelta: (_d, full) => deltas.push(full),
      fetchImpl,
    });
    expect(content).toBe('第一段文字');
    expect(usage.total_tokens).toBe(42);
    expect(deltas).toEqual(['第一', '第一段文字']);
    // 请求体必须是流式协议
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.action).toBe('chat');
    expect(body.content).toBe('你好');
  });

  it('v31：默认不请求用量（兼容严格网关），显式 includeUsage:true 才携带', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([{ ok: true, delta: 'ok' }, '[DONE]']));
    await streamLlm({ llmConfig: CFG, userPrompt: 'x', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.includeUsage).toBe(false); // 默认关闭，与后端保守策略对齐

    const fetchImpl2 = vi.fn().mockResolvedValue(sseResponse([{ ok: true, delta: 'ok' }, '[DONE]']));
    await streamLlm({ llmConfig: CFG, userPrompt: 'x', includeUsage: true, fetchImpl: fetchImpl2 });
    expect(JSON.parse(fetchImpl2.mock.calls[0][1].body).includeUsage).toBe(true);
  });

  it('跳过 SSE 注释帧（: ka 保活）与非法 JSON 行', async () => {
    const encoder = new TextEncoder();
    const text = ': ka\n\ndata: {"ok":true,"delta":"A"}\n\ndata: {broken json}\n\ndata: {"ok":true,"delta":"B"}\n\ndata: [DONE]\n\n';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, body: new ReadableStream({
      start(c) { c.enqueue(encoder.encode(text)); c.close(); },
    }) });
    const { content } = await streamLlm({ llmConfig: CFG, userPrompt: 'x', fetchImpl });
    expect(content).toBe('AB');
  });

  it('失败帧（ok:false）抛错并带服务端消息', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      { ok: false, error: '模型服务繁忙（429）', errorCode: 'UPSTREAM_RATE_LIMITED' },
    ]));
    await expect(streamLlm({ llmConfig: CFG, userPrompt: 'x', fetchImpl }))
      .rejects.toThrow('模型服务繁忙（429）');
  });

  it('非 2xx 响应抛错（解析服务端 JSON error）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ ok: false, error: 'baseUrl 和 model 不能为空' }),
    });
    await expect(streamLlm({ llmConfig: CFG, userPrompt: 'x', fetchImpl }))
      .rejects.toThrow('baseUrl 和 model 不能为空');
  });

  it('缺少 llmConfig 直接抛引导错误', async () => {
    await expect(streamLlm({ llmConfig: {}, userPrompt: 'x', fetchImpl: vi.fn() }))
      .rejects.toThrow('请先配置大模型');
  });
});
