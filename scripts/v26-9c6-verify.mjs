/**
 * v26.9c-6 验证：新配置(38%/blur2)下侧栏粒子的时序幅度
 * 基线对比：46%/blur14 = 动态像素 287 / 平均极差 0.38
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const SIDEBAR = { x: 6, y: 130, width: 200, height: 500 };
const FRAMES = 8;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

const style = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.sidebar'));
  return { bg: cs.backgroundColor, bf: cs.backdropFilter || cs.webkitBackdropFilter };
});
console.log('实际侧栏样式:', JSON.stringify(style));

const fr = [];
for (let i = 0; i < FRAMES; i++) {
  const buf = await page.screenshot({ clip: SIDEBAR });
  fr.push(await page.evaluate(async (data) => {
    const res = await fetch('data:image/png;base64,' + data);
    const bmp = await createImageBitmap(await res.blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const a = new Array(d.length / 4);
    for (let i2 = 0, j = 0; i2 < d.length; i2 += 4, j++) a[j] = 0.299 * d[i2] + 0.587 * d[i2 + 1] + 0.114 * d[i2 + 2];
    return a;
  }, buf.toString('base64')));
  await page.waitForTimeout(320);
}

const n = fr[0].length;
let active = 0, sumRange = 0, maxRange = 0;
for (let i = 0; i < n; i++) {
  let mn = 255, mx = 0;
  for (const f of fr) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const r = mx - mn;
  sumRange += r;
  if (r > maxRange) maxRange = r;
  if (r > 8) active++;
}
console.log(`\n=== 修复后实测（侧栏 200x500，8 帧时序幅度）===`);
console.log(`动态像素: ${active} (${((active / n) * 100).toFixed(2)}%) | 最大极差 ${maxRange.toFixed(1)} | 平均极差 ${(sumRange / n).toFixed(2)}`);
console.log(`基线(46%/blur14): 动态像素 287 (0.29%) | 最大极差 214.3 | 平均极差 0.38`);
const ratio = (active / 287).toFixed(1);
console.log(active > 287 ? `✅ 粒子动态信号提升 ${ratio}×` : `❌ 未见提升（${ratio}×）`);
await browser.close();
