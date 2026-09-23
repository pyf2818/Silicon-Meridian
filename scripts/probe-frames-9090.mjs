// 甯у簭鍒楁帰閽堬細鐩磋繛鏈湴 OpenAI 鍏煎缃戝叧锛坺en2api 9015锛夛紝agent 寰幆鍚屾鍙傛暟
// 鐩爣锛氭壘鍑哄摢涓€甯т細鎶?"O"/"0" 娣疯繘 content
const BASE = 'http://127.0.0.1:9090';

// 1. 鍒楁ā鍨?let models = [];
try {
  const r = await fetch(`${BASE}/v1/models`);
  const d = await r.json().catch(() => ({}));
  models = (d.data || []).map(m => m.id).slice(0, 10);
} catch (e) { console.log('models ERR', e.message); }
console.log('models:', JSON.stringify(models));

if (!models.length) { console.log('鏃犲彲鐢ㄦā鍨嬶紝閫€鍑?); process.exit(0); }
const model = models.find(m => /gpt|claude|deepseek|qwen|glm/i.test(m)) || models[0];
console.log('鐢ㄦā鍨?', model);

// 2. 娴佸紡璇锋眰锛坅gent 寰幆鍚屾锛歴tream + include_usage锛?const res = await fetch(`${BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: '鍙洖澶嶅洓涓瓧锛氫綘濂戒笘鐣? }],
    max_tokens: 100, temperature: 0.7, stream: true,
    stream_options: { include_usage: true },
  }),
});
console.log('status:', res.status);
const text = await res.text();
let contentJoined = '';
for (const line of text.split('\n')) {
  const t = line.trim();
  if (!t || !t.startsWith('data:')) { if (t) console.log('闈瀌ata琛?', JSON.stringify(t.slice(0, 80))); continue; }
  const p = t.slice(5).trim();
  if (p === '[DONE]') { console.log('[DONE]'); continue; }
  try {
    const j = JSON.parse(p);
    const choice = j.choices?.[0];
    const dc = choice?.delta?.content;
    if (typeof dc === 'string' && dc) contentJoined += dc;
    console.log('甯?', JSON.stringify({
      delta_content: dc !== undefined ? dc : undefined,
      delta_rc: choice?.delta?.reasoning_content ? '(rc)' : undefined,
      finish: choice?.finish_reason || undefined,
      usage: j.usage ? 'yes' : undefined,
      emptyChoices: Array.isArray(j.choices) && j.choices.length === 0 ? true : undefined,
    }).slice(0, 160));
  } catch { console.log('闈濲SON甯?', JSON.stringify(p.slice(0, 80))); }
}
console.log('=== content 鎷兼帴缁撴灉 ===');
console.log(JSON.stringify(contentJoined));

