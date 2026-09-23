// v36.2 工作空间关联文件「真送达」E2E：
// 种子空间关联文件 → 发消息 → 拦截 /api/ai-generate 请求体断言内容真正进 LLM
// → 断言用户气泡渲染空间文件卡 + 上下文 pill 可见。
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const WS_MARKER = 'const WS_E2E_MARKER = 424242; // 工作空间关联标记';

const doLogin = async () => fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
let loginRes = await doLogin();
if (loginRes.status === 401) {
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
  });
  loginRes = await doLogin();
}
const setCookie = loginRes.headers.get('set-cookie') || '';
const sessionValue = setCookie.split(';')[0].split('=').slice(1).join('=');
if (!sessionValue) { console.error('登录失败', loginRes.status); process.exit(1); }
log('登录 OK');

const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addCookies([{ name: 'meridian_session', value: sessionValue, domain: 'localhost', path: '/' }]);
await context.addInitScript((marker) => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', selectedModel: 'mock-fast', provider: 'custom' }));
  // 种子：默认空间挂两个关联文件（一个正常 JS，一个已截断的 md）
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify({
    spaces: [{
      id: 'default', name: '默认空间', createdAt: Date.now(), rootName: 'e2e-root',
      files: [
        { name: 'e2e-ws-file.js', path: 'src/e2e-ws-file.js', content: marker, truncated: false, associatedAt: Date.now() },
        { name: 'e2e-ws-doc.md', path: 'docs/e2e-ws-doc.md', content: '# 空间文档\n被截断的正文'.repeat(50), truncated: true, associatedAt: Date.now() },
      ],
    }],
    activeSpaceId: 'default',
  }));
}, WS_MARKER);

const page = await context.newPage();
const diagLogs = [];
page.on('pageerror', e => diagLogs.push(`[pageerror] ${String(e).slice(0, 300)}`));

// 捕获发给 LLM 的请求体（不阻断请求）
let capturedBodies = [];
await page.route('**/api/ai-generate', async (route) => {
  try {
    const body = route.request().postData() || '';
    if (body.includes('"stream":true')) capturedBodies.push(body);
  } catch { /* ignore */ }
  await route.continue();
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
const onboarding = page.getByRole('dialog', { name: '新用户引导' });
if (await onboarding.isVisible().catch(() => false)) {
  await onboarding.getByRole('button', { name: '跳过引导' }).click();
  await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
}
const input = page.locator('textarea.chat-input');
try {
  await input.waitFor({ state: 'visible', timeout: 15_000 });
} catch {
  await page.screenshot({ path: 'v362-ws-debug-landing.png', timeout: 10_000 }).catch(() => {});
  log('诊断 URL:', page.url());
  await browser.close();
  process.exit(4);
}
await page.waitForFunction(() => !document.querySelector('textarea.chat-input')?.disabled, null, { timeout: 20_000 });
log('工作站就绪');

// 1. 上下文 pill 可见（空间关联文件的 UI 反馈）
const pillText = await page.locator('.chat-context-pill-file').textContent().catch(() => '');
const pillVisible = pillText.includes('文件');
log(`上下文 pill：${pillVisible ? `「${(pillText || '').trim().slice(0, 20)}」✅` : '未出现 ❌'}`);
await page.screenshot({ path: 'v362-ws-1-pill.png', timeout: 10_000 });

// 2. 发消息
await input.fill('请审查当前空间里关联的代码文件');
await input.press('Enter');
log('消息已发送');

// 3. 等待用户气泡出现空间文件卡
let wsCards = 0;
try {
  await page.waitForSelector('.chat-msg-attachments .chat-att-file-ws', { timeout: 20_000 });
  wsCards = await page.locator('.chat-msg-attachments .chat-att-file-ws').count();
  log(`✅ 用户气泡出现空间文件卡 × ${wsCards}`);
} catch {
  log('❌ 用户气泡未出现空间文件卡');
}
await page.waitForTimeout(1500); // 等 mock 回复
await page.screenshot({ path: 'v362-ws-2-bubble.png', timeout: 10_000 });

// 4. 断言请求体：文件内容真正进 LLM 消息 + 系统提示列目录
const bodyJoined = capturedBodies.join('\n');
const contentDelivered = bodyJoined.includes('WS_E2E_MARKER = 424242');
const deliveredCount = (bodyJoined.match(/【空间文件】/g) || []).length;
const sysListing = bodyJoined.includes('【工作空间关联文件】');
const truncatedHint = bodyJoined.includes('read_workspace_file');
log(`LLM 请求体捕获 ${capturedBodies.length} 次：内容送达=${contentDelivered ? '✅' : '❌'} 空间文件块=${deliveredCount} 系统提示目录=${sysListing ? '✅' : '❌'} 截断提示=${truncatedHint ? '✅' : '❌'}`);
if (capturedBodies.length && !contentDelivered) {
  writeFileSync('.workbuddy/ws-e2e-last-body.txt', bodyJoined.slice(0, 8000));
}

await browser.close();
const ok = pillVisible && wsCards > 0 && contentDelivered && sysListing;
log(ok ? 'PASS ✅' : `FAIL ❌ pill=${pillVisible} cards=${wsCards} delivered=${contentDelivered} listing=${sysListing}`);
if (diagLogs.length) log('诊断:', diagLogs.slice(-5).join(' | '));
process.exit(ok ? 0 : 3);
