/**
 * v26.9c-5 时序幅度法精测：连拍 8 帧，逐像素算亮度极差(range)
 * - 粒子扫过的像素 range 大；被面板压掉的粒子 range 小
 * - 对照组：内容区（无面板覆盖）= 「可见粒子」基准
 * - 候选：侧栏不同 alpha/blur 配比
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const SIDEBAR = { x: 6, y: 130, width: 200, height: 500 };
const CONTENT = { x: 700, y: 130, width: 200, height: 500 }; // 等面积对照
const FRAMES = 8;
const CANDIDATES = [
  { alpha: 46, blur: 14, label: '当前 46%/blur14' },
  { alpha: 40, blur: 4, label: '40%/blur4' },
  { alpha: 34, blur: 2, label: '34%/blur2' },
  { alpha: 30, blur: 1, label: '30%/blur1' },
  { alpha: 30, blur: 0, label: '30%/无blur' },
  { alpha: 22, blur: 0, label: '22%/无blur' },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

async function frames(clip) {
  const out = [];
  for (let i = 0; i < FRAMES; i++) {
    const buf = await page.screenshot({ clip });
    const lum = await page.evaluate(async (data) => {
      const res = await fetch('data:image/png;base64,' + data);
      const bmp = await createImageBitmap(await res.blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const a = new Array(d.length / 4);
      for (let i2 = 0, j = 0; i2 < d.length; i2 += 4, j++) a[j] = 0.299 * d[i2] + 0.587 * d[i2 + 1] + 0.114 * d[i2 + 2];
      return a;
    }, buf.toString('base64'));
    out.push(lum);
    await page.waitForTimeout(320);
  }
  return out;
}

const rangeStats = (fr) => {
  const n = fr[0].length;
  let active = 0, maxRange = 0, sumRange = 0;
  for (let i = 0; i < n; i++) {
    let mn = 255, mx = 0;
    for (const f of fr) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const r = mx - mn;
    sumRange += r;
    if (r > maxRange) maxRange = r;
    if (r > 8) active++;
  }
  return { active, pct: +((active / n) * 100).toFixed(2), maxRange: +maxRange.toFixed(1), avgRange: +(sumRange / n).toFixed(2) };
};

const ref = rangeStats(await frames(CONTENT));
console.log(`[对照] 内容区动态像素 ${ref.active} (${ref.pct}%) | 最大极差 ${ref.maxRange} | 平均极差 ${ref.avgRange}\n`);

for (const c of CANDIDATES) {
  await page.evaluate(({ alpha, blur }) => {
    let st = document.getElementById('__exp');
    if (!st) { st = document.createElement('style'); st.id = '__exp'; document.head.appendChild(st); }
    st.textContent = `.sidebar, .sidebar-footer {
      background: color-mix(in srgb, var(--bg-secondary) ${alpha}%, transparent) !important;
      backdrop-filter: ${blur ? `blur(${blur}px) saturate(1.35)` : 'none'} !important;
      -webkit-backdrop-filter: ${blur ? `blur(${blur}px) saturate(1.35)` : 'none'} !important;
    }`;
  }, c);
  await page.waitForTimeout(400);
  const s = rangeStats(await frames(SIDEBAR));
  const ratio = ref.active > 0 ? ((s.active / ref.active) * 100).toFixed(0) : 'n/a';
  console.log(`${c.label.padEnd(18)} | 动态像素 ${s.active} (${s.pct}%) | 相对内容区 ${ratio}% | 最大极差 ${s.maxRange} | 平均极差 ${s.avgRange}`);
}

await browser.close();
