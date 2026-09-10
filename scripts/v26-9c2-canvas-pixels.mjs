/**
 * v26.9c-2 对照诊断：直接读粒子画布自身像素
 * 对比「侧栏区域」(x 0-240) 与「内容区」(x 800-1400) 的像素分布，
 * 判断是画布整体没绘制，还是侧栏区域被遮挡。
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(5000);

const out = await page.evaluate(async () => {
  const canvas = document.querySelector('.visual-particle-layer');
  if (!canvas) return { error: 'canvas 不存在' };
  const dpr = canvas.width / parseFloat(getComputedStyle(canvas).width || '1');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: '拿不到 2d 上下文' };
  const region = (x, y, w, h) => {
    const d = ctx.getImageData(x * dpr, y * dpr, w * dpr, h * dpr).data;
    let nonZero = 0, sumA = 0, maxA = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a > 0) nonZero++;
      sumA += a;
      if (a > maxA) maxA = a;
      n++;
    }
    return { nonZeroPx: nonZero, totalPx: n, meanAlpha: +(sumA / n).toFixed(2), maxAlpha: maxA };
  };
  const res = {
    canvas: { width: canvas.width, height: canvas.height, dpr: +dpr.toFixed(2), opacity: getComputedStyle(canvas).opacity },
    sidebarRegion: region(10, 150, 200, 400),
    contentRegion: region(800, 150, 500, 400),
  };
  // 采样两帧看画布是否在动
  const frameSig = (x, y, w, h) => {
    const d = ctx.getImageData(x * dpr, y * dpr, w * dpr, h * dpr).data;
    let s = 0;
    for (let i = 3; i < d.length; i += 4 * 53) s += d[i];
    return s;
  };
  const s1 = frameSig(800, 150, 300, 300);
  await new Promise((r) => setTimeout(r, 700));
  const s2 = frameSig(800, 150, 300, 300);
  res.contentFrameDelta = Math.abs(s2 - s1);
  return res;
});

console.log(JSON.stringify(out, null, 2));
console.log('\n判读：');
if (out.error) console.log('  ' + out.error);
else {
  console.log(`  画布 ${out.canvas.width}x${out.canvas.height} (dpr=${out.canvas.dpr}) opacity=${out.canvas.opacity}`);
  console.log(`  侧栏区域非透明像素 ${out.sidebarRegion.nonZeroPx}/${out.sidebarRegion.totalPx} (均值α=${out.sidebarRegion.meanAlpha}, 峰值=${out.sidebarRegion.maxAlpha})`);
  console.log(`  内容区非透明像素 ${out.contentRegion.nonZeroPx}/${out.contentRegion.totalPx} (均值α=${out.contentRegion.meanAlpha}, 峰值=${out.contentRegion.maxAlpha})`);
  console.log(`  内容区两帧差 ${out.contentFrameDelta}（>0 = 粒子在动）`);
}
await browser.close();
