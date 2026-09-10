/**
 * v26.9c-3 参数扫描实验：找出「粒子可见 + 仍有毛玻璃质感」的侧栏配比
 * 对每组 (alpha, blur)：注入覆盖样式 → 截侧栏区域(粒子开) → 隐藏画布 → 再截 → 逐像素比对
 * 指标：粒子贡献度(平均绝对差) / 文字对比度(亮度标准差，越高越清晰)
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const CANDIDATES = [
  { alpha: 46, blur: 14, label: '当前值 46%/blur14' },
  { alpha: 46, blur: 2, label: '46%/blur2' },
  { alpha: 40, blur: 3, label: '40%/blur3' },
  { alpha: 38, blur: 2, label: '38%/blur2' },
  { alpha: 34, blur: 4, label: '34%/blur4' },
  { alpha: 30, blur: 0, label: '30%/无 blur' },
  { alpha: 26, blur: 2, label: '26%/blur2' },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

const clip = { x: 6, y: 130, width: 200, height: 560 };

const measure = async (b64) => page.evaluate(async (data) => {
  const res = await fetch('data:image/png;base64,' + data);
  const bmp = await createImageBitmap(await res.blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const lum = [];
  for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const std = Math.sqrt(lum.reduce((s, v) => s + (v - mean) ** 2, 0) / lum.length);
  return { lum, mean: +mean.toFixed(2), std: +std.toFixed(2) };
}, b64);

const rows = [];
for (const c of CANDIDATES) {
  await page.evaluate(({ alpha, blur }) => {
    let st = document.getElementById('__exp');
    if (!st) { st = document.createElement('style'); st.id = '__exp'; document.head.appendChild(st); }
    st.textContent = `.sidebar, .sidebar-footer {
      background: color-mix(in srgb, var(--bg-secondary) ${alpha}%, transparent) !important;
      backdrop-filter: ${blur ? `blur(${blur}px) saturate(1.35)` : 'none'} !important;
      -webkit-backdrop-filter: ${blur ? `blur(${blur}px) saturate(1.35)` : 'none'} !important;
    }`;
    const canvas = document.querySelector('.visual-particle-layer');
    if (canvas) canvas.style.display = '';
  }, c);
  await page.waitForTimeout(500);
  const on = await measure((await page.screenshot({ clip })).toString('base64'));
  await page.evaluate(() => { const cv = document.querySelector('.visual-particle-layer'); if (cv) cv.style.display = 'none'; });
  await page.waitForTimeout(250);
  const off = await measure((await page.screenshot({ clip })).toString('base64'));
  const delta = on.lum.reduce((s, v, i) => s + Math.abs(v - off.lum[i]), 0) / on.lum.length;
  rows.push({ label: c.label, delta: +delta.toFixed(3), textContrast: on.std, meanLum: on.mean });
  console.log(`${c.label.padEnd(22)} | 粒子贡献 ${delta.toFixed(3)} | 文字对比(std) ${on.std} | 平均亮度 ${on.mean}`);
}

console.log('\n判读：粒子贡献越高越透；文字对比(std) 越高文字越清晰');
await browser.close();
