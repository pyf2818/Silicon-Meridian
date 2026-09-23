// 定位「0」：发一条消息后读 localStorage 里最后一条 assistant 消息的原始 content
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5175';
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
const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
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
// 带附件（复现「0」的条件：附件消息）
const { writeFileSync } = await import('node:fs');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
writeFileSync('.workbuddy/zero-att.png', PNG_1PX);
await page.locator('input[type="file"]').first().setInputFiles('.workbuddy/zero-att.png');
await page.waitForFunction(() => [...document.querySelectorAll('.chat-attachment-state')].some(s => s.textContent.includes('就绪')), null, { timeout: 15_000 });
await input.fill('zero 定位带附件轮');
await input.press('Enter');
await page.waitForSelector('.chat-activity-summary', { timeout: 45_000 });
await page.waitForTimeout(800);
const content = await page.evaluate(() => {
  try {
    const raw = localStorage.getItem('siliconstream-sessions') || localStorage.getItem('sessions') || '';
    const keys = Object.keys(localStorage);
    return { keys: keys.filter(k => /session/i.test(k)) };
  } catch (e) { return { err: String(e) }; }
});
console.log('session keys:', JSON.stringify(content));
// 直接从 zustand store 拿（React 内部不可达）——改为读 DOM：气泡 content 的 innerHTML 开头
const html = await page.evaluate(() => {
  const bubbles = document.querySelectorAll('.chat-msg-assistant .chat-bubble-content');
  const last = bubbles[bubbles.length - 1];
  return last ? last.innerHTML.slice(0, 400) : 'NO CONTENT NODE';
});
console.log('=== content innerHTML 开头 ===');
console.log(html);
await browser.close();
