/**
 * v26.9c 诊断：侧栏粒子可见性实证 + 祖先链不透明层排查
 * 1. 打印 .sidebar 计算样式（background alpha / backdrop-filter）
 * 2. 沿 .sidebar 祖先链打印每个节点的 background alpha、position、z-index、是否创建层叠上下文
 *    （找出可能挡在 z-index:-1 粒子画布之上的不透明背景层）
 * 3. 像素实证：截图侧栏区域 → display:none 粒子画布 → 再截同一区域 → 逐像素比对平均差
 *    （差异≈0 = 粒子没有透出来；差异明显 = 粒子可见）
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000); // 等粒子懒加载 + 动画起来

const info = await page.evaluate(() => {
  const alphaOf = (bg) => {
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return 0;
    const m = bg.match(/\/\s*([\d.]+)\s*\)/);
    if (m) return parseFloat(m[1]);
    const m2 = bg.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
    if (m2) return parseFloat(m2[1]);
    return 1; // 无 alpha 通道 = 完全不透明
  };
  const sidebar = document.querySelector('.sidebar');
  const cs = getComputedStyle(sidebar);
  const chain = [];
  let el = sidebar;
  while (el && el !== document.documentElement.parentNode) {
    const s = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''),
      bg: s.backgroundColor,
      bgAlpha: alphaOf(s.backgroundColor),
      bgImage: s.backgroundImage === 'none' ? null : s.backgroundImage.slice(0, 60),
      position: s.position,
      zIndex: s.zIndex,
      createsSC: ['transform', 'filter', 'backdropFilter', 'perspective', 'opacity'].some((p) => {
        const v = s[p];
        return v && v !== 'none' && v !== '1';
      }),
    });
    el = el.parentElement;
  }
  const canvas = document.querySelector('.visual-particle-layer');
  const ccs = canvas ? getComputedStyle(canvas) : null;
  return {
    sidebar: { bg: cs.backgroundColor, bf: cs.backdropFilter || cs.webkitBackdropFilter, zIndex: cs.zIndex, position: cs.position, bgImage: cs.backgroundImage === 'none' ? null : cs.backgroundImage.slice(0, 80) },
    canvas: canvas ? { exists: true, opacity: ccs.opacity, zIndex: ccs.zIndex, position: ccs.position, rect: (() => { const r = canvas.getBoundingClientRect(); return { w: r.width, h: r.height }; })(), display: ccs.display } : { exists: false },
    chain,
  };
});
console.log('=== 侧栏计算样式 ===');
console.log(JSON.stringify(info.sidebar, null, 2));
console.log('=== 粒子画布 ===');
console.log(JSON.stringify(info.canvas, null, 2));
console.log('=== 祖先链（由内到外）===');
for (const c of info.chain) console.log(JSON.stringify(c));

// ===== 像素实证：侧栏区域对比（粒子开/关）=====
const clip = { x: 8, y: 120, width: 180, height: 500 };
const sample = async () => {
  const buf = await page.screenshot({ clip });
  const b64 = buf.toString('base64');
  return page.evaluate(async (data) => {
    const res = await fetch('data:image/png;base64,' + data);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const lum = [];
    for (let i = 0; i < px.length; i += 4 * 37) lum.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    return lum;
  }, b64);
};

const onA = await sample();
await page.waitForTimeout(600);
const onB = await sample(); // 粒子自身运动，两次都开着 → 应有差异（证明采样区对画布变化敏感）
await page.evaluate(() => { const c = document.querySelector('.visual-particle-layer'); if (c) c.style.display = 'none'; });
await page.waitForTimeout(300);
const off = await sample();

const meanAbs = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? v)), 0) / a.length;
const selfMotion = meanAbs(onA, onB);      // 粒子在动 → 该值代表画布可见时的动态幅度
const withParticles = meanAbs(onA, off);   // 粒子层移除前后差异 → 粒子对侧栏区域的实际贡献

console.log('\n=== 像素实证（侧栏区域 180x500）===');
console.log(`粒子层自身运动差异(参考): ${selfMotion.toFixed(2)}`);
console.log(`移除粒子层前后差异: ${withParticles.toFixed(2)}`);
console.log(withParticles < 0.5
  ? '❌ 结论：侧栏区域几乎不含粒子贡献 → 粒子被不透明层挡住 / 画布未覆盖该区域'
  : '✅ 结论：侧栏区域确有粒子贡献 → 粒子可见');

await browser.close();
