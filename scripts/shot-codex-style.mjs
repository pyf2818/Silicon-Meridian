// Codex 风格流式输出改造：真实浏览器视觉验证
// 流程：登录 editor-demo（mock 网关已配好）→ 打开 AI 工作站 → 发消息触发 agent 循环
// → 截图 ①执行中过程流 ②完成后折叠摘要 ③展开回看
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 1. API 登录拿会话 cookie（内存认证模式）
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
const setCookie = loginRes.headers.get('set-cookie') || '';
const sessionValue = setCookie.split(';')[0].split('=').slice(1).join('=');
if (!sessionValue) { console.error('登录失败，拿不到会话'); process.exit(1); }
log('登录 OK');

const browser = await (async () => {
  try {
    const b = await chromium.launch({ headless: true, channel: 'chrome' });
    log('使用系统 Chrome');
    return b;
  } catch {
    const b = await chromium.launch({ headless: true, channel: 'msedge' });
    log('使用系统 Edge');
    return b;
  }
})();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// 截图降级：字体加载挂起时不让流程崩掉
const safeShot = async (path) => {
  try { await page.screenshot({ path, timeout: 10_000 }); log('截图:', path); }
  catch (e) { log('截图失败(继续):', path, String(e?.message || e).slice(0, 60)); }
};
await context.addCookies([{ name: 'meridian_session', value: sessionValue, domain: 'localhost', path: '/' }]);
const page = await context.newPage();
// 诊断：收集页面 console 错误与未捕获异常
const diagLogs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') diagLogs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => diagLogs.push(`[pageerror] ${String(e).slice(0, 400)}`));

// 前端 llmConfig 权威源是 localStorage（服务端同步为单向只写）——注入配置模拟「本机已配置」
await context.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({
    baseUrl: 'http://127.0.0.1:9100/v1',
    apiKey: 'local-gateway',
    selectedModel: 'mock-fast',
    provider: 'custom',
  }));
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// 等开场 splash 退场（z-10000 覆盖层会拦截点击）
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
// 关首访引导蒙层
const onboarding = page.getByRole('dialog', { name: '新用户引导' });
if (await onboarding.isVisible().catch(() => false)) {
  await onboarding.getByRole('button', { name: '跳过引导' }).click();
  await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
}
log('进场完成');
await safeShot('shot-0-station.png');

// 2. 确保在 AI 工作站（home）——等 llmConfig 从服务端 hydrate（新 localStorage 首次加载为空，输入框先 disabled）
const stationInput = page.locator('textarea.chat-input');
await stationInput.waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForFunction(() => !document.querySelector('textarea.chat-input')?.disabled, null, { timeout: 20_000 });
log('工作站就绪（llmConfig 已 hydrate）');

// 3. 发消息触发 agent 循环（mock 网关：第 1 轮 tool_calls → web_search → 第 2 轮收敛）
await stationInput.fill('帮我检索一下 Codex 流式输出的风格要点');
await stationInput.press('Enter');
log('消息已发送');

// ① 执行中：抓工具行 spinner / thinking 活动行
try {
  await page.waitForSelector('.tool-call, .chat-tool-thinking', { timeout: 12_000 });
  await page.waitForTimeout(600); // 让工具行渲染稳定
  await safeShot('shot-1-running.png');
  log('① 执行中截图完成');
} catch { log('① 执行中状态未捕获（mock 太快）'); }

// ② 完成后折叠摘要（只认摘要行——宽松的 content 条件会误匹配历史消息）
try {
  await page.waitForSelector('.chat-activity-summary', { timeout: 45_000 });
} catch {
  log('② 超时未出现折叠摘要。页面诊断日志：');
  console.log(diagLogs.slice(-25).join('\n') || '(无 console 错误)');
  await safeShot('shot-2-timeout.png');
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(800);
await safeShot('shot-2-collapsed.png');
log('② 折叠摘要截图完成');

// ③ 点击摘要展开回看
const summary = page.locator('.chat-activity-summary');
if (await summary.count()) {
  await summary.first().click();
  await page.waitForTimeout(500);
  await safeShot('shot-3-expanded.png');
  log('③ 展开回看截图完成');
} else {
  log('③ 无折叠摘要（本轮无工具调用？）');
}

await browser.close();
log('DONE');
