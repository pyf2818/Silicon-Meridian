// probe-headed.mjs — 终极裁决：有头真实窗口 vs headless，灰白块是否为 headless 伪影
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:5175/';

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
await ctx.addInitScript(() => {
  try { localStorage.setItem('meridian_onboarded', '1'); } catch {}
  const orig = window.setTimeout;
  window.setTimeout = (fn, d, ...a) => orig(fn, d > 2500 ? d * 10 : d, ...a);
});
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const cdp = await ctx.newCDPSession(page);
await cdp.send('Page.enable');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.entrance', { timeout: 15000 });

await page.waitForTimeout(1600);
// CDP 截图（与 headless 实验同管线）
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('screenshots/hd-cdp.png', Buffer.from(data, 'base64'));
console.log('shot hd-cdp');

// Playwright 原生截图（另一条截图管线交叉验证）
const buf = await page.screenshot({ path: 'screenshots/hd-pw.png' });
console.log(`shot hd-pw (${buf.length} bytes)`);

await browser.close();
console.log('DONE');
