import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,120)));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(800);
const read = () => page.evaluate(() => {
  const c = document.querySelector('.wf-canvas'), n = document.querySelector('.wf-node'), w = document.querySelector('.wf-world');
  return {
    mode: document.documentElement.dataset.mode,
    canvasBg: getComputedStyle(c).backgroundColor,
    nodeBg: getComputedStyle(n).backgroundColor,
    nodeColor: getComputedStyle(n).color,
    gridImg: getComputedStyle(w).backgroundImage.slice(0, 60),
  };
});
for (const m of ['light', 'dark']) {
  await page.evaluate(mm => { document.documentElement.dataset.mode = mm; }, m);
  await page.waitForTimeout(350);
  console.log(m, JSON.stringify(await read()));
  await page.screenshot({ path: `screenshots/v18-canvas/theme-${m}.png` });
}
console.log('errors:', JSON.stringify(errs));
await b.close();
