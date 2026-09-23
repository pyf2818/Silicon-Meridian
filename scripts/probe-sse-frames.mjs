// 探测：/api/ai-generate 经 mock 网关的 SSE 帧序列（找「0」帧来源）
const BASE = 'http://localhost:5175';
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];

// 第 2 轮（带 tool 消息）→ 收敛输出
const res = await fetch(`${BASE}/api/ai-generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({
    baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', model: 'mock-fast',
    action: 'chat', systemPrompt: 'test', stream: true, includeUsage: true,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_news', arguments: '{"keyword":"x"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'result' },
    ],
  }),
});
const text = await res.text();
for (const line of text.split('\n')) {
  if (!line.startsWith('data:')) continue;
  const p = line.slice(5).trim();
  if (p === '[DONE]') { console.log('[DONE]'); continue; }
  try {
    const j = JSON.parse(p);
    if (j.delta !== undefined) console.log('DELTA:', JSON.stringify(j.delta).slice(0, 80));
    else if (j.toolCallDelta) console.log('TOOLCALL:', JSON.stringify(j.toolCallDelta).slice(0, 100));
    else if (j.usage) console.log('USAGE:', JSON.stringify(j.usage));
    else console.log('OTHER:', p.slice(0, 120));
  } catch { console.log('RAW:', p.slice(0, 120)); }
}
