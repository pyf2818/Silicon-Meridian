// 探针 v2：日志直写文件（免疫管道缓冲），心跳 + 强制退出看门狗定位挂点。
// 验证：响应头已到、body 零字节时 abort 信号，pending 的 reader.read() 会怎样？
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const LOG = 'probe-undici.log';
const mode = process.argv[2] || 'flush'; // flush = writeHead+flushHeaders 裸头响应
appendFileSync(LOG, `\n=== probe start mode=${mode} ===\n`);
const log = (msg) => appendFileSync(LOG, `${msg}\n`);

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (mode === 'flush') res.flushHeaders(); // 显式冲刷响应头（模拟上游立即回 200 头）
  if (mode === 'after-chunk') setTimeout(() => res.write('data: hi\n\n'), 30);
  // 之后永久静默
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const t0 = Date.now();
const at = () => `[t+${Date.now() - t0}ms]`;
const watchdog = setTimeout(() => { log(`${at()} WATCHDOG: 6s 未走完 → 挂在 read()（abort 未能打断）`); server.closeAllConnections?.(); process.exit(2); }, 6000);

const ac = new AbortController();
const resp = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
  method: 'POST', signal: ac.signal, body: '{}', headers: { 'Content-Type': 'application/json' },
});
log(`${at()} fetch resolved (status ${resp.status})`);

const reader = resp.body.getReader();
setTimeout(() => { log(`${at()} calling ac.abort()`); ac.abort(); }, 500);

try {
  const { done, value } = await reader.read();
  log(`${at()} read() RESOLVED done=${done} len=${value?.length ?? 0}  ← abort 没有打断 read`);
} catch (err) {
  log(`${at()} read() REJECTED name=${err?.name} msg=${err?.message}  ← abort 正常打断 read`);
}
clearTimeout(watchdog);
log(`${at()} probe end`);
server.closeAllConnections?.();
process.exit(0);
