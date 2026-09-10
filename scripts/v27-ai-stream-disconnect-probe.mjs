/**
 * v27 探针：/api/ai-generate 流式端点的「客户端断开 → 掐断上游」回归验证
 *
 * 背景（本轮实测修复）：
 *   server/http/aiHandlers.js 原先用 `req.on('close')` 检测前端断开。而该函数是在
 *   `await readJsonBody(req)` 之后才被调用的，此时 IncomingMessage 的 'close' 早已发出
 *   → 监听器形同死代码 → 用户点「停止」时服务端**不会**中止上游请求，继续空转烧 token
 *   并占住连接（配合流式阶段无超时，上游静默挂起时会永久泄漏）。
 *   已改为监听 res 的 'close' + `!res.writableEnded` 判定。
 *
 * 本探针用「本地 mock 上游」观测真值：mock 在自己被中止时记录 aborted=true。
 *
 * 断言：
 *   [1] 正常收完整流：客户端收到 [DONE]，mock 上游**未**被中止
 *   [2] 客户端中途断开：mock 上游在 ~2s 内被中止 ← 修复前该断言必然失败
 *   [3] 两种情况下服务端都不崩溃（无未捕获异常），响应头为 text/event-stream
 *
 * 前置：dev server 运行在 5175（node scripts/v27-ai-stream-disconnect-probe.mjs [base]）
 */
import http from 'node:http';

const BASE = process.argv[2] || 'http://127.0.0.1:5175';
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── mock 上游：OpenAI 兼容 SSE，慢速吐字，可观测是否被中止 ──
const upstreamState = { aborted: false, completed: false, requests: 0, lastAbortAt: 0 };
let releaseUpstream = null;

function startMockUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      upstreamState.requests += 1;
      req.on('data', () => {});
      req.on('end', () => {});
      // 上游侧同样只在「未正常写完」时算作被中止
      res.on('close', () => {
        if (!res.writableEnded) {
          upstreamState.aborted = true;
          upstreamState.lastAbortAt = Date.now();
        }
      });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });

      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        if (n > 30) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
          upstreamState.completed = true;
          return;
        }
        if (res.writableEnded || res.destroyed) { clearInterval(timer); return; }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `字${n}` } }] })}\n\n`);
      }, 200);
      if (releaseUpstream) releaseUpstream();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** 直接以原生 http 请求 /api/ai-generate，可控地中途 destroy */
function callStream(port, { destroyAfterMs = null } = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'mock-model',
      apiKey: 'sk-mock',
      action: 'chat',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
      systemPrompt: '你是测试助手',
    });
    const started = Date.now();
    const out = { chunks: 0, done: false, status: null, contentType: null, destroyedAt: 0 };
    const req = http.request({
      host: '127.0.0.1', port: __devPort, method: 'POST', path: '/api/ai-generate',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      out.status = res.statusCode;
      out.contentType = res.headers['content-type'] || '';
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('[DONE]')) out.done = true;
        out.chunks += 1;
      });
      res.on('end', () => resolve(out));
      res.on('error', () => resolve(out));
      if (destroyAfterMs != null) {
        setTimeout(() => {
          out.destroyedAt = Date.now() - started;
          req.destroy();
        }, destroyAfterMs);
      }
    });
    req.on('error', () => resolve(out));
    req.end(body);
    // 中途 destroy 后 res 不会 end，兜底超时
    if (destroyAfterMs != null) setTimeout(() => resolve(out), destroyAfterMs + 6000);
  });
}

let __devPort = 5175;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`探测 ${BASE}\n`);
  __devPort = Number(new URL(BASE).port || 80);

  // 先确认 dev server 在线
  const alive = await fetch(`${BASE}/api/meta`).then((r) => r.status < 500).catch(() => false);
  if (!alive) {
    console.log('❌ dev server 未就绪（先 npm run dev）');
    process.exit(2);
  }

  const mock = await startMockUpstream();
  const mockPort = mock.address().port;
  console.log(`mock 上游端口 ${mockPort}\n`);

  // ── 场景 1：正常收完整流 ──
  console.log('【1】客户端正常收流');
  const r1 = await callStream(mockPort);
  check('响应为 SSE', /text\/event-stream/.test(r1.contentType), r1.contentType);
  check('客户端收到 [DONE]', r1.done === true, `${r1.chunks} chunk`);
  await sleep(500);
  check('mock 上游正常跑完（未被中止）', upstreamState.completed === true && upstreamState.aborted === false,
    `completed=${upstreamState.completed} aborted=${upstreamState.aborted}`);

  // ── 场景 2：客户端中途断开 → 必须掐断上游 ──
  console.log('\n【2】客户端中途断开（等价用户点「停止」）');
  upstreamState.aborted = false;
  upstreamState.completed = false;
  const before = Date.now();
  const r2 = await callStream(mockPort, { destroyAfterMs: 900 });
  check('客户端确实提前断开（未收到 [DONE]）', r2.done === false, `destroyedAt=${r2.destroyedAt}ms`);
  // 给服务端一点时间感知断开并 abort 上游
  await sleep(2000);
  check('⚠️ 核心断言：mock 上游被中止', upstreamState.aborted === true,
    `aborted=${upstreamState.aborted}（修复前恒为 false → 上游会继续空转到 30 个 chunk）`);
  check('中止发生得足够快（< 3s）',
    upstreamState.lastAbortAt > 0 && upstreamState.lastAbortAt - before < 3000,
    `+${upstreamState.lastAbortAt ? upstreamState.lastAbortAt - before : 'N/A'}ms`);
  check('mock 上游未跑完（证明是被掐断而非自然结束）', upstreamState.completed === false,
    `completed=${upstreamState.completed}`);

  // ── 场景 3：断开后服务端仍可正常服务下一次请求（无状态污染） ──
  console.log('\n【3】断开后恢复正常服务');
  upstreamState.aborted = false;
  upstreamState.completed = false;
  const r3 = await callStream(mockPort);
  check('后续请求仍能正常收完整流', r3.done === true, `${r3.chunks} chunk`);

  mock.close();
  await sleep(200);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('失败项：\n' + failed.map((f) => `  - ${f.name} (${f.detail})`).join('\n'));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('探针异常：', e); process.exit(1); });
