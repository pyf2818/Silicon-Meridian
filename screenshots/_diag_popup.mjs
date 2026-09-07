/* 诊断2：弹窗定位内部状态 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5177';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => {
  localStorage.setItem('meridian_onboarded', '1');
  localStorage.setItem('sidebarCollapsed', 'false');
  localStorage.setItem('nav', 'all');
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const entry = page.locator('.globe-entry-btn').first();
try { await entry.click({ timeout: 6000 }); } catch { console.log('entry not found'); }
await page.waitForTimeout(5000);
let markers = 0;
for (let i = 0; i < 30; i++) {
  markers = await page.evaluate(() => document.querySelectorAll('.gs-marker').length);
  if (markers > 0) break;
  await page.waitForTimeout(500);
}
console.log('markers:', markers);
if (markers > 0) {
  await page.evaluate(() => {
    document.querySelector('.gs-marker')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  console.log(await page.evaluate(() => {
    const wrap = document.querySelector('.gs-popup-wrap');
    const popup = document.querySelector('.gs-popup');
    const stage = document.querySelector('.gs-stage');
    if (!wrap) return 'no wrap';
    const wr = wrap.getBoundingClientRect();
    const sr = stage?.getBoundingClientRect();
    const pr = popup?.getBoundingClientRect();
    return JSON.stringify({
      wrapTransform: wrap.style.transform,
      wrapOpacity: wrap.style.opacity,
      flip: wrap.dataset.flip,
      wrapRect: { x: Math.round(wr.x), y: Math.round(wr.y), w: Math.round(wr.width), h: Math.round(wr.height) },
      popupRect: pr ? { x: Math.round(pr.x), y: Math.round(pr.y) } : null,
      stageRect: sr ? { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) } : null,
      popupCity: popup?.dataset.city,
    }, null, 1);
  }));
}
await b.close();
console.log('done');
