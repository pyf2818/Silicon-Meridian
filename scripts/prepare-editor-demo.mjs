// 准备演示账号（浏览器视觉验证用）：editor-demo / E2eTest#2026 → 配 mock 模型 → 触发
const BASE = 'http://127.0.0.1:5175';
const username = 'editor-demo';
const password = 'E2eTest#2026';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let res = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
log('register:', res.status, (await res.text()).slice(0, 60));

res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
log('login:', res.status, cookie ? 'cookie=OK' : 'MISSING');

res = await fetch(`${BASE}/api/profile/llm-config`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ config: { baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', selectedModel: 'mock-fast' } }),
});
log('llm-config:', res.status);

// 触发若干次资讯请求，让编辑层在最新池上完成当日计算
for (let i = 0; i < 6; i++) {
  res = await fetch(`${BASE}/api/news?page=0&pageSize=50`, { headers: { Cookie: cookie } });
  const d = await res.json();
  const items = d.items || [];
  const picked = items.filter(it => it.editorPick).length;
  log(`warm#${i}: items=${items.length} pick=${picked}`);
  if (picked > 0) { log('DEMO READY ✅'); process.exit(0); }
  await new Promise(r => setTimeout(r, 4000));
}
log('DEMO NOT VISIBLE YET（编辑层当日已算过的话精选可能要等池刷新后浮出）');
