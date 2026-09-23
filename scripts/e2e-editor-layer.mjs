// 编辑层端到端实测：注册 → 登录 → 用户自定义模型配置 → 触发 → 验证 editorPick
// 网关：本机 API Switch 9090（models: auto/fast/smart），编辑层用 fast（性价比档）
const BASE = 'http://127.0.0.1:5175';
const username = 'editor-e2e-' + Date.now().toString(36);
const password = 'E2eTest#2026';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 1. 注册（内存认证模式）
let res = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
log('register:', res.status, (await res.text()).slice(0, 80));

// 2. 登录拿会话 cookie
res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const setCookie = res.headers.get('set-cookie') || '';
const cookie = setCookie.split(';')[0];
log('login:', res.status, cookie ? 'cookie=OK' : 'cookie=MISSING');
if (!cookie) process.exit(1);

// 3. 用户自定义模型配置（本次实测核心：不碰任何 env）
// E2E_LLM_BASE 可覆盖；默认指向本地 mock 网关（scripts/mock-llm-gateway.mjs，9100）
const llmBase = process.env.E2E_LLM_BASE || 'http://127.0.0.1:9100/v1';
res = await fetch(`${BASE}/api/profile/llm-config`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ config: { baseUrl: llmBase, apiKey: 'local-gateway', selectedModel: process.env.E2E_LLM_MODEL || 'mock-fast' } }),
});
log('llm-config:', res.status, (await res.text()).slice(0, 150));

// 等 dev server / 编辑层状态就绪（新进程无 disabled 退避，短暂等待即可）
log('等待 3s（服务就绪）...');
await new Promise(r => setTimeout(r, 3_000));

// 5. 带认证拉资讯 → 触发 ensureDailyEditorRun（fire-and-forget）
res = await fetch(`${BASE}/api/news?page=0&pageSize=50`, { headers: { Cookie: cookie } });
const first = await res.json();
log('news trigger:', (first.items || []).length, 'items');

// 6. 轮询验证（fast 模型 Top30 预期 <15s，给 45s 窗口）
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 3000));
  res = await fetch(`${BASE}/api/news?page=0&pageSize=50`, { headers: { Cookie: cookie } });
  const d = await res.json();
  const items = d.items || [];
  const picked = items.filter(it => it.editorPick);
  const noted = items.filter(it => it.editorNote);
  const noisy = items.filter(it => it.editorNoise);
  log(`poll#${i}: items=${items.length} pick=${picked.length} note=${noted.length} noise=${noisy.length}`);
  if (picked.length) {
    log('SAMPLE pick:', JSON.stringify({
      title: String(picked[0].title).slice(0, 60),
      note: picked[0].editorNote || '',
    }));
    log('E2E PASS ✅');
    process.exit(0);
  }
}
log('E2E TIMEOUT（45s 内未出现编辑精选，需查服务端日志）');
process.exit(2);
