// 下半屏 + 空数据降级验证
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5175/';
const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.evaluate(() => {
  localStorage.setItem('bookmarks', JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
    id: `b${i}`, title: `t${i}`, category: 'ai-models', source: '量子位',
    readAt: new Date(Date.now() - i * 5e7).toISOString(), tags: ['大模型'], summary: 'x',
  }))));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button, a')].find(el => (el.textContent || '').trim().startsWith('用户画像'));
  btn?.click();
});
await page.waitForTimeout(2400);
await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
await page.waitForTimeout(600);
// 滚动到漏斗区域
await page.evaluate(() => document.querySelector('.pa-grid-trio')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/atlas-bottom.png' });
const probe = await page.evaluate(() => ({
  funnelRows: document.querySelectorAll('.pa-funnel-row').length,
  bubbles: document.querySelectorAll('.pa-bubble').length,
  timebandBars: document.querySelectorAll('.pa-timeband i').length,
  emptyBubbles: document.querySelector('.pa-grid-trio .pa-empty')?.textContent?.slice(0, 20) || null,
}));
console.log('bottom probe:', JSON.stringify(probe));
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
