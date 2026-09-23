// 帧序列探针：直连本地 OpenAI 兼容网关（zen2api 9015），agent 循环同款参数
// 目标：找出哪一帧会把 "O"/"0" 混进 content
const BASE = 'http://127.0.0.1:9090';

// 1. 列模型
let models = [];
try {
  const r = await fetch(`${BASE}/v1/models`);
  const d = await r.json().catch(() => ({}));
  models = (d.data || []).map(m => m.id).slice(0, 10);
} catch (e) { console.log('models ERR', e.message); }
console.log('models:', JSON.stringify(models));

if (!models.length) { console.log('无可用模型，退出'); process.exit(0); }
const model = models.find(m => /gpt|claude|deepseek|qwen|glm/i.test(m)) || models[0];
console.log('用模型:', model);

// 2. 流式请求（agent 循环同款：stream + include_usage）
const res = await fetch(`${BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: '只回复四个字：你好世界' }],
    max_tokens: 100, temperature: 0.7, stream: true,
    stream_options: { include_usage: true },
  }),
});
console.log('status:', res.status);
const text = await res.text();
let contentJoined = '';
for (const line of text.split('\n')) {
  const t = line.trim();
  if (!t || !t.startsWith('data:')) { if (t) console.log('非data行:', JSON.stringify(t.slice(0, 80))); continue; }
  const p = t.slice(5).trim();
  if (p === '[DONE]') { console.log('[DONE]'); continue; }
  try {
    const j = JSON.parse(p);
    const choice = j.choices?.[0];
    const dc = choice?.delta?.content;
    if (typeof dc === 'string' && dc) contentJoined += dc;
    console.log('帧:', JSON.stringify({
      delta_content: dc !== undefined ? dc : undefined,
      delta_rc: choice?.delta?.reasoning_content ? '(rc)' : undefined,
      finish: choice?.finish_reason || undefined,
      usage: j.usage ? 'yes' : undefined,
      emptyChoices: Array.isArray(j.choices) && j.choices.length === 0 ? true : undefined,
    }).slice(0, 160));
  } catch { console.log('非JSON帧:', JSON.stringify(p.slice(0, 80))); }
}
console.log('=== content 拼接结果 ===');
console.log(JSON.stringify(contentJoined));
