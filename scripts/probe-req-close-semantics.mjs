/**
 * 取证：Node 下 req.on('close') 何时触发？（回答 server/http/aiHandlers.js:160 的正确性）
 *
 * 用法：node scripts/probe-req-close-semantics.mjs <A|C>
 *   A = 服务端在业务 handler 里挂 req.on('close')，客户端正常收完整流
 *   C = 客户端在流进行中主动断开
 *
 * 期望（正确语义）：A 中 close 只应在响应结束后触发；C 中 close 应在断开时触发。
 * 若 A 中 close 早于响应结束就触发，则 aiHandlers 的断开检测会在每个请求上误 abort → P0。
 */
import http from 'node:http';

const scenario = (process.argv[2] || 'A').toUpperCase();
const out = (s) => process.stdout.write(`${s}\n`);

const t0 = Date.now();
const at = () => `+${Date.now() - t0}ms`;

out(`Node ${process.version} · 场景 ${scenario}`);

const server = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => out(`  ${at()} req 'end'（请求体读完）`));

  // 与 aiHandlers 同构：handler 内挂 close 监听
  req.on('close', () => out(`  ${at()} req 'close'  ← aborted=${req.aborted} complete=${req.complete}`));
  res.on('close', () => out(`  ${at()} res 'close'  ← writableEnded=${res.writableEnded}`));

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  // 模拟流式输出：每 300ms 一个 chunk，共 5 个
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    if (n > 5) {
      clearInterval(timer);
      res.end();
      out(`  ${at()} 响应正常 end()`);
      return;
    }
    res.write(`data: {"delta":"c${n}"}\n\n`);
    out(`  ${at()} 写 chunk${n}`);
  }, 300);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const body = JSON.stringify({ model: 'm', stream: true, pad: 'x'.repeat(200) });
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/ai-generate',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  (res) => {
    res.on('data', () => {});
    res.on('end', () => out(`  ${at()} 客户端收到 res end`));
  });
  req.on('error', () => {});
  req.end(body);

  if (scenario === 'C') {
    setTimeout(() => { out(`  ${at()} 客户端 destroy() 主动断开`); req.destroy(); }, 900);
  }

  setTimeout(() => {
    server.close();
    out('完成');
    process.exit(0);
  }, 3200);
});
