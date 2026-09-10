/**
 * v26.9c-7 A/B 交替实测：blur 14px vs 2px（同会话，各 3 轮，全侧栏区域）
 * 指标：总时序能量 sum(range) —— 比"计数"稳健，不受"区域里恰好几颗亮点"影响
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const CLIP = { x: 0, y: 0, width: 240, height: 860 };
const FRAMES = 6;
const ROUNDS = 3;
const A = { alpha: 46, blur: 14, tag: 'A 46%/blur14(旧)' };
const B = { alpha: 38, blur: 2, tag: 'B 38%/blur2(新)' };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

const apply = (c) => page.evaluate(({ alpha, blur }) => {
  let st = document.getElementById('__ab');
  if (!st) { st = document.createElement('style'); st.id = '__ab'; document.head.appendChild(st); }
  st.textContent = `.sidebar, .sidebar-footer {
    background: color-mix(in srgb, var(--bg-secondary) ${alpha}%, transparent) !important;
    backdrop-filter: blur(${blur}px) saturate(1.35) !important;
    -webkit-backdrop-filter: blur(${blur}px) saturate(1.35) !important;
  }`;
}, c);

async function energy() {
  const fr = [];
  for (let i = 0; i < FRAMES; i++) {
    const buf = await page.screenshot({ clip: CLIP });
    fr.push(await page.evaluate(async (data) => {
      const res = await fetch('data:image/png;base64,' + data);
      const bmp = await createImageBitmap(await res.blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const a = new Float32Array(d.length / 4);
      for (let i2 = 0, j = 0; i2 < d.length; i2 += 4, j++) a[j] = 0.299 * d[i2] + 0.587 * d[i2 + 1] + 0.114 * d[i2 + 2];
      return Array.from(a);
    }, buf.toString('base64')));
    await page.waitForTimeout(280);
  }
  const n = fr[0].length;
  let energy = 0, sticky = 0;
  for (let i = 0; i < n; i++) {
    let mn = 255, mx = 0;
    for (const f of fr) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const r = mx - mn;
    energy += r;
    if (r > 10) sticky++;
  }
  return { energy: Math.round(energy), sticky, px: n };
}

const resA = [], resB = [];
for (let r = 0; r < ROUNDS; r++) {
  await apply(A); await page.waitForTimeout(500);
  resA.push(await energy());
  await apply(B); await page.waitForTimeout(500);
  resB.push(await energy());
  console.log(`第 ${r + 1} 轮 | A 能量 ${resA[r].energy} (显著像素 ${resA[r].sticky}) | B 能量 ${resB[r].energy} (显著像素 ${resB[r].sticky})`);
}

const avg = (arr, k) => Math.round(arr.reduce((s, x) => s + x[k], 0) / arr.length);
const eA = avg(resA, 'energy'), eB = avg(resB, 'energy');
const sA = avg(resA, 'sticky'), sB = avg(resB, 'sticky');
console.log(`\n=== A/B 汇总（全侧栏 240x860, ${FRAMES}帧 x ${ROUNDS}轮）===`);
console.log(`A 46%/blur14: 平均能量 ${eA} | 平均显著像素 ${sA}`);
console.log(`B 38%/blur2 : 平均能量 ${eB} | 平均显著像素 ${sB}`);
console.log(eB > eA ? `✅ 新配置粒子可见度提升 ${(eB / Math.max(eA, 1)).toFixed(1)}×` : `❌ 新配置未见提升`);
await browser.close();
