/**
 * 取证 D：与真实调用链同构的时序 —— 先 await readJsonBody(req)，再进 handler 挂 req.on('close')
 *
 * 真实调用链（server/http/aiHandlers.js）：
 *   handleAiGenerateRequest → await readJsonBody(req) → handleAiStreamRequest(req,res,body)
 *                                                  → req.on('close', () => controller.abort())
 *                                                  → res.writeHead(200, SSE) → fetch(上游, signal)
 *
 * 判定标准：
 *   - 若 'close' 在 SSE 流仍在写的时候就触发  → 每个请求都会被误 abort（P0，但流式应完全不可用）
 *   - 若 'close' 在流结束后才触发            → 监听器安全（但"前端断开"检测也仅在客户端断开时有效）
 *   - 若 'close' 永不触发                    → 监听器失效，「停止」无法掐断上游（当前最可能）
 */
import http from 'node:http';

const out = (s) => process.stdout.write(`${s}\n`);
const t0 = Date.now();
const at = () => `+${Date.now() - t0}ms`;

out(`Node ${process.version} · 场景 D：readJsonBody 先读完，再挂 close`);

/** 模拟 server/http/httpUtils.js 的 readJsonBody */
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const bodyText = await readBody(req);           // ← 等价 readJsonBody(req)
  out(`  ${at()} readBody 完成 len=${bodyText.length}`);

  // ↓↓↓ 以下等价 handleAiStreamRequest：此刻才挂监听
  let aborted = false;
  req.on('close', () => {
    aborted = true;
    out(`  ${at()} req 'close' 触发 → 真实代码此处会 controller.abort()（aborted=${req.aborted}）`);
  });
  out(`  ${at()} 已挂 req.on('close')，开始 SSE`);

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    if (n > 4) {
      clearInterval(timer);
      res.end();
      out(`  ${at()} 响应 end()（全程 aborted=${aborted}）`);
      return;
    }
    if (aborted) { out(`  ${at()} 已 abort，停止写流`); return; }
    res.write(`data: {"delta":"c${n}"}\n\n`);
    out(`  ${at()} 写 chunk${n}`);
  }, 300);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const body = JSON.stringify({ model: 'm', stream: true });
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/ai-generate',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  (res) => {
    res.on('data', () => {});
    res.on('end', () => out(`  ${at()} 客户端收到 end`));
  });
  req.on('error', () => {});
  req.end(body);

  setTimeout(() => { server.close(); out('完成'); process.exit(0); }, 2600);
});
