// 探针：模拟工作站第 2 轮（含 tool 消息 → 收敛），观察后端 SSE 是否正常终结
const BASE = 'http://127.0.0.1:5175';
const body = {
  baseUrl: 'http://127.0.0.1:9100/v1',
  apiKey: 'local-gateway',
  model: 'mock-fast',
  action: 'chat',
  systemPrompt: '你是测试助手',
  messages: [
    { role: 'user', content: '检索一下' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_mock_1', type: 'function', function: { name: 'search_news', arguments: '{"keyword":"Codex"}' } }] },
    { role: 'tool', tool_call_id: 'call_mock_1', content: '（工具结果）' },
  ],
  max_tokens: 500,
  stream: true,
  includeUsage: true,
  tools: [{ type: 'function', function: { name: 'search_news', description: 'search', parameters: { type: 'object', properties: { keyword: { type: 'string' } } } } }],
  tool_choice: 'auto',
};

const t0 = Date.now();
const res = await fetch(`${BASE}/api/ai-generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
console.log('HTTP', res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const timer = setTimeout(() => { console.log('WATCHDOG: 20s 未终结，打印 buffer 尾部后退出'); console.log('tail:', buf.slice(-400)); process.exit(2); }, 20_000);
while (true) {
  const { value, done } = await reader.read();
  if (done) { console.log(`[${Date.now() - t0}ms] reader DONE`); break; }
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const line of lines) {
    if (line.trim()) console.log(`[${Date.now() - t0}ms]`, line.slice(0, 160));
  }
}
clearTimeout(timer);
console.log('TOTAL FRAMES OK');
