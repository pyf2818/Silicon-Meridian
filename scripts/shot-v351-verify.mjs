// v35.1 验证：① 流结束后活动行立即折叠（不再卡「正在生成」）② 工具行带类型标志
// 流程：登录 editor-demo → 工作站发消息（mock 网关：tool_calls → 收敛）→ 断言 + 截图
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
const setCookie = loginRes.headers.get('set-cookie') || '';
const sessionValue = setCookie.split(';')[0].split('=').slice(1).join('=');
if (!sessionValue) { console.error('登录失败'); process.exit(1); }
log('登录 OK');

const browser = await (async () => {
  try { const b = await chromium.launch({ headless: true, channel: 'chrome' }); log('Chrome'); return b; }
  catch { const b = await chromium.launch({ headless: true, channel: 'msedge' }); log('Edge'); return b; }
})();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const safeShot = async (path) => {
  try { await page.screenshot({ path, timeout: 10_000 }); log('截图:', path); }
  catch (e) { log('截图失败(继续):', path, String(e?.message || e).slice(0, 60)); }
};
await context.addCookies([{ name: 'meridian_session', value: sessionValue, domain: 'localhost', path: '/' }]);
const page = await context.newPage();
const diagLogs = [];
page.on('console', m => { if (m.type() === 'error') diagLogs.push(`[err] ${m.text().slice(0, 200)}`); });
page.on('pageerror', e => diagLogs.push(`[pageerror] ${String(e).slice(0, 300)}`));

await context.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({
    baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', selectedModel: 'mock-fast', provider: 'custom',
  }));
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
const onboarding = page.getByRole('dialog', { name: '新用户引导' });
if (await onboarding.isVisible().catch(() => false)) {
  await onboarding.getByRole('button', { name: '跳过引导' }).click();
  await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
}
const stationInput = page.locator('textarea.chat-input');
await stationInput.waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForFunction(() => !document.querySelector('textarea.chat-input')?.disabled, null, { timeout: 20_000 });
log('工作站就绪');

await stationInput.fill('帮我检索一下 Codex 流式输出的风格要点');
await stationInput.press('Enter');
log('消息已发送');

// ① 执行中：抓类型标志 + 活动行（kind-* 类）
let sawTypeMark = false, sawKindActivity = false;
try {
  await page.waitForSelector('.tool-call, .chat-tool-thinking', { timeout: 12_000 });
  await page.waitForTimeout(500);
  sawTypeMark = await page.locator('.tool-call-type-mark').count() > 0;
  sawKindActivity = await page.locator('.chat-tool-thinking.kind-think, .chat-tool-thinking.kind-generate, .chat-tool-thinking.kind-tool').count() > 0;
  await safeShot('v351-1-running.png');
  log(`① 执行中：类型标志=${sawTypeMark} 活动行带kind=${sawKindActivity}`);
} catch { log('① 执行中状态未捕获（mock 太快）'); }

// ② 完成折叠：摘要行出现
try {
  await page.waitForSelector('.chat-activity-summary', { timeout: 45_000 });
} catch {
  log('② 超时未出现折叠摘要。诊断：');
  console.log(diagLogs.slice(-20).join('\n') || '(无 console 错误)');
  await safeShot('v351-2-timeout.png');
  await browser.close();
  process.exit(2);
}
// 核心断言：摘要出现瞬间，活动行/加载态必须已消失（bug：以前这里会残留「正在生成」）
// 注：类型标志只在展开态渲染（折叠态无工具行），计数放到 ③ 展开后
const residualThinking = await page.locator('.chat-tool-thinking').count();
const residualSpinner = await page.locator('.tool-call-mark-spinner').count();
log(`② 完成态：活动行残留=${residualThinking}（须为0） spinner残留=${residualSpinner}（须为0）`);
await page.waitForTimeout(600);
await safeShot('v351-2-collapsed.png');

// ③ 展开回看：类型标志可见
let expandedMarks = 0;
const summary = page.locator('.chat-activity-summary');
if (await summary.count()) {
  await summary.last().click();
  await page.waitForTimeout(400);
  expandedMarks = await page.locator('.tool-call-type-mark').count();
  log(`③ 展开后类型标志=${expandedMarks}（须>0）`);
  await safeShot('v351-3-expanded.png');
}

await browser.close();
const ok = residualThinking === 0 && residualSpinner === 0 && expandedMarks > 0;
log(ok ? 'PASS ✅' : `FAIL ❌ residual=${residualThinking}/${residualSpinner} marks=${expandedMarks}`);
process.exit(ok ? 0 : 3);
