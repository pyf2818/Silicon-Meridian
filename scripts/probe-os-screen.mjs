// probe-os-screen.mjs — 打开有头浏览器窗口停在中段，供系统级截屏验证真实显示路径
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:5175/';

const browser = await chromium.launch({
  channel: 'msedge',
  headless: false,
  args: ['--window-position=40,60', '--window-size=1340,920'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'no-preference',
});
await ctx.addInitScript(() => {
  try { localStorage.setItem('meridian_onboarded', '1'); } catch {}
  const orig = window.setTimeout;
  window.setTimeout = (fn, d, ...a) => orig(fn, d > 2500 ? d * 10 : d, ...a);
});
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.entrance', { timeout: 15000 });
console.log('entrance shown — window stays open for OS screenshot');
await page.waitForTimeout(25000);
await browser.close();
console.log('DONE');
