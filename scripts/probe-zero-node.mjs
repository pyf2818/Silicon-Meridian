// dump 最后一条 assistant 气泡的 DOM 结构（定位「0」节点）
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5175';
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([{ name: 'meridian_session', value: cookie, domain: 'localhost', path: '/' }]);
await context.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', selectedModel: 'mock-fast', provider: 'custom' }));
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
const input = page.locator('textarea.chat-input');
await input.waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForFunction(() => !document.querySelector('textarea.chat-input')?.disabled, null, { timeout: 20_000 });
await input.fill('再测一次 zero 定位');
await input.press('Enter');
await page.waitForSelector('.chat-activity-summary', { timeout: 45_000 });
await page.waitForTimeout(500);
// 展开最后一条的过程流
const summaries = page.locator('.chat-activity-summary');
await summaries.last().click().catch(() => {});
await page.waitForTimeout(300);
// dump 最后一个 assistant 气泡的顶层子节点标签+文本
const info = await page.evaluate(() => {
  const bubbles = document.querySelectorAll('.chat-msg-assistant .chat-bubble');
  const b = bubbles[bubbles.length - 1];
  if (!b) return 'NO BUBBLE';
  return Array.from(b.children).map((el, i) => {
    const txt = (el.textContent || '').trim().slice(0, 60).replace(/\s+/g, ' ');
    return `${i}: <${el.tagName.toLowerCase()} class="${el.className}"> "${txt}"`;
  }).join('\n');
});
console.log('=== 最后一条 assistant 气泡顶层结构 ===');
console.log(info);
await browser.close();
