import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { buildAiInsightsPrompt, handleAiStreamRequest } from '../aiHandlers.js';

describe('buildAiInsightsPrompt', () => {
  const items = [
    { id: '1', title: 'GPU 短缺', category: 'ai', source: 'TechCrunch', summary: '芯片供应紧张', tags: ['hardware'] },
    { id: '2', title: 'Rust 1.75', category: 'dev', source: 'Rust Blog', summary: '新版本发布', tags: ['language'] },
  ];

  it('includes personaSummary context when provided', () => {
    const prompt = buildAiInsightsPrompt(items, { habits: ['简洁回复'], traits: ['技术派'], needs: ['GPU 资讯'] });
    expect(prompt).toContain('简洁回复');
    expect(prompt).toContain('技术派');
    expect(prompt).toContain('GPU 资讯');
    expect(prompt).toContain('【用户画像】');
  });

  it('shows 无 when personaSummary fields are empty', () => {
    const prompt = buildAiInsightsPrompt(items, {});
    expect(prompt).toMatch(/习惯：无/);
    expect(prompt).toMatch(/性格：无/);
    expect(prompt).toMatch(/需求：无/);
  });

  it('handles null personaSummary', () => {
    const prompt = buildAiInsightsPrompt(items, null);
    expect(prompt).toContain('【用户画像】');
    expect(prompt).toContain('无');
  });

  it('preserves item list rendering', () => {
    const prompt = buildAiInsightsPrompt(items, null);
    expect(prompt).toContain('GPU 短缺');
    expect(prompt).toContain('Rust 1.75');
    expect(prompt).toContain('TechCrunch');
  });
});

// ========== handleAiStreamRequest 三段式静默看门狗 ==========
// 背景（2026-09-18 实测 bug）：旧版流式看门狗 60s 且不分阶段——设置页「测试连接」是
// 50 token 的 "Hello" 非流式小请求秒回成功，而真实生成（长 systemPrompt + 全对话 +
// 推理模型思考）首包普遍 >60s，被服务端先行杀掉，报「上游 60 秒无响应」。
// 重构后：首包看门狗 180s（AI_STREAM_FIRST_TOKEN_MS）+ 首包保活注释 15s
// （AI_STREAM_KEEPALIVE_MS，收到首包即停）+ 流中静默看门狗 90s（AI_STREAM_STALL_MS，
// 与前端 agentLoopCore 对齐）。测试用环境变量把超时压到秒级、本地假上游模拟各种节奏。

function createMockRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.writableEnded = false;
  res.destroyed = false;
  res.frames = []; // { text, at }：按写入顺序记录，at 用于「首包后停止保活」的时序断言
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; return res; };
  res.write = (chunk) => { res.frames.push({ text: String(chunk), at: Date.now() }); return true; };
  res.end = (chunk) => { if (chunk) res.frames.push({ text: String(chunk), at: Date.now() }); res.writableEnded = true; return res; };
  return res;
}

const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8' };
const deltaFrame = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const keepaliveFrames = (res) => res.frames.filter(f => f.text.startsWith(': ka'));

function parsedErrorFrame(res) {
  for (const frame of res.frames) {
    for (const line of frame.text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        const json = JSON.parse(trimmed.slice(5).trim());
        if (json.ok === false) return json;
      } catch { /* 非完整 JSON 行 */ }
    }
  }
  return null;
}

async function startFakeUpstream(script) {
  const server = createServer(script);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('handleAiStreamRequest 三段式静默看门狗', () => {
  let upstream = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (upstream) {
      upstream.closeAllConnections?.(); // 静默用例的上游连接不会自然关闭，测试后强制回收
      await new Promise(resolve => upstream.close(resolve));
      upstream = null;
    }
  });

  const runStream = async (extraBody = {}) => {
    const res = createMockRes();
    await handleAiStreamRequest({}, res, {
      baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      model: 'test-model',
      messages: [{ role: 'user', content: '你好' }],
      ...extraBody,
    });
    return res;
  };

  it('首包看门狗：上游连上但迟迟不吐首包 → 中止并报「未返回首包」，等待期间有保活注释', async () => {
    vi.stubEnv('AI_STREAM_FIRST_TOKEN_MS', '1300');
    vi.stubEnv('AI_STREAM_KEEPALIVE_MS', '50');
    // 注意 flushHeaders：真实 SSE 网关会立即回响应头（node 裸 writeHead 不冲刷，头会等首个 body 写入）
    upstream = await startFakeUpstream((req, res) => { res.writeHead(200, SSE_HEADERS); res.flushHeaders(); /* 之后永久静默 */ });

    const res = await runStream();

    expect(res.statusCode).toBe(200);
    const err = parsedErrorFrame(res);
    expect(err).toBeTruthy();
    expect(err.errorCode).toBe('UPSTREAM_TIMEOUT');
    expect(err.error).toContain('未返回首包');
    expect(err.error).not.toContain('无响应'); // 首包阶段与流中静默的文案可区分
    expect(keepaliveFrames(res).length).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it('首包保活：长思考期间持续发 `: ka`，首包到达后停止保活并正常完成', async () => {
    vi.stubEnv('AI_STREAM_FIRST_TOKEN_MS', '10000'); // 不触发
    vi.stubEnv('AI_STREAM_KEEPALIVE_MS', '50');
    upstream = await startFakeUpstream((req, res) => {
      res.writeHead(200, SSE_HEADERS); res.flushHeaders();
      setTimeout(() => res.write(deltaFrame('你')), 220); // 首包 220ms（期间应有 ~4 帧保活）
      setTimeout(() => { res.write('data: [DONE]\n\n'); res.end(); }, 480); // 之后 260ms 静默（保活若未停会有 ~5 帧）
    });

    const res = await runStream();

    const err = parsedErrorFrame(res);
    expect(err).toBeFalsy();
    expect(res.frames.some(f => f.text.includes('"delta"'))).toBe(true);
    expect(res.frames.some(f => f.text.includes('[DONE]'))).toBe(true);
    expect(keepaliveFrames(res).length).toBeGreaterThanOrEqual(1);
    // 关键行为：首包到达后保活必须停止（否则静默期会掩盖真实卡死）
    const firstDataAt = res.frames.find(f => f.text.includes('"delta"')).at;
    expect(keepaliveFrames(res).filter(f => f.at > firstDataAt)).toHaveLength(0);
  }, 10_000);

  it('流中静默看门狗：首包后持续静默 → 中止并报「无响应」（与首包文案区分），且不再有保活', async () => {
    vi.stubEnv('AI_STREAM_STALL_MS', '1600');
    vi.stubEnv('AI_STREAM_FIRST_TOKEN_MS', '10000');
    vi.stubEnv('AI_STREAM_KEEPALIVE_MS', '10000'); // 首包 30ms 就到 → 理论上 0 帧保活
    upstream = await startFakeUpstream((req, res) => {
      res.writeHead(200, SSE_HEADERS); res.flushHeaders();
      setTimeout(() => res.write(deltaFrame('你')), 30); // 之后永久静默
    });

    const res = await runStream();

    const err = parsedErrorFrame(res);
    expect(err).toBeTruthy();
    expect(err.errorCode).toBe('UPSTREAM_TIMEOUT');
    expect(err.error).toContain('无响应');
    expect(err.error).not.toContain('首包');
    expect(keepaliveFrames(res)).toHaveLength(0);
  }, 10_000);

  it('正常快速流不受影响：delta 与 [DONE] 照常透传，无保活无报错', async () => {
    upstream = await startFakeUpstream((req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.write(deltaFrame('你好'));
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const res = await runStream();

    const err = parsedErrorFrame(res);
    expect(err).toBeFalsy();
    expect(res.frames.some(f => f.text.includes('你好'))).toBe(true);
    expect(res.frames.some(f => f.text.includes('[DONE]'))).toBe(true);
    expect(keepaliveFrames(res)).toHaveLength(0); // 默认 15s 保活间隔，快速流内不应出现
  }, 10_000);
});
