/**
 * v26.9c-4 精测：显著变化像素数 (|ΔL|>8) + 最大幅度，并加内容区对照组
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const SIDEBAR = { x: 6, y: 130, width: 200, height: 560 };
const CONTENT = { x: 700, y: 130, width: 640, height: 560 }; // 对照组：内容区（无覆盖）
const CANDIDATES = [
  { alpha: 46, blur: 14, label: '当前 46%/blur14' },
  { alpha: 34, blur: 2, label: '34%/blur2' },
  { alpha: 30, blur: 1, label: '30%/blur1' },
  { alpha: 26, blur: 0, label: '26%/无blur' },
  { alpha: 20, blur: 0, label: '20%/无blur' },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

const grab = async (clip) => page.evaluate(async (data) => {
  const res = await fetch('data:image/png;base64,' + data);
  const bmp = await createImageBitmap(await res.blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const lum = new Float32Array(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return Array.from(lum);
}, (await page.screenshot({ clip })).toString('base64'));

const stats = (on, off) => {
  let n = 0, max = 0;
  for (let i = 0; i < on.length; i++) {
    const dl = Math.abs(on[i] - off[i]);
    if (dl > 8) n++;
    if (dl > max) max = dl;
  }
  return { changed: n, pct: +((n / on.length) * 100).toFixed(2), max: +max.toFixed(1) };
};

// ===== 对照组：内容区（不改侧栏样式，保持默认）=====
const c1 = await grab(CONTENT);
await page.evaluate(() => { const cv = document.querySelector('.visual-particle-layer'); if (cv) cv.style.display = 'none'; });
await page.waitForTimeout(250);
const c2 = await grab(CONTENT);
await page.evaluate(() => { const cv = document.querySelector('.visual-particle-layer'); if (cv) cv.style.display = ''; });
const ref = stats(c1, c2);
console.log(`[对照] 内容区粒子可见度 | 显著变化像素 ${ref.changed} (${ref.pct}%) | 最大Δ ${ref.max}\n`);

for (const c of CANDIDATES) {
  await page.evaluate(({ alpha, blur }) => {
    let st = document.getElementById('__exp');
    if (!st) { st = document.createElement('style'); st.id = '__exp'; document.head.appendChild(st); }
    st.textContent = `.sidebar, .sidebar-footer {
      background: color-mix(in srgb, var(--bg-secondary) ${alpha}%, transparent) !important;
      backdrop-filter: ${blur ? `blur(${blur}px) saturate(1.35)` : 'none'} !important;
      -webkit-backdrop-filter: ${blur ? `blur(${blur}px) saturate(1.35)` : 'none'} !important;
    }`;
    const cv = document.querySelector('.visual-particle-layer'); if (cv) cv.style.display = '';
  }, c);
  await page.waitForTimeout(500);
  const on = await grab(SIDEBAR);
  await page.evaluate(() => { const cv = document.querySelector('.visual-particle-layer'); if (cv) cv.style.display = 'none'; });
  await page.waitForTimeout(250);
  const off = await grab(SIDEBAR);
  const s = stats(on, off);
  console.log(`${c.label.padEnd(18)} | 显著变化像素 ${s.changed} (${s.pct}%) | 最大Δ ${s.max}`);
}

await browser.close();
