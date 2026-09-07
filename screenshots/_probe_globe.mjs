/**
 * v25 全球大屏重构探针 —— 结构化验证
 *  入口：Topbar .globe-entry-btn → .gs-overlay 全屏大屏
 *  断言：氛围层（星空/光环/扫描线/角框）+ 命令条（品牌/实时热点ticker/时钟）+ 侧面板
 *        + 点位光标（gs-marker ≥6，含待机兜底）+ 点击点位滑出详情 + Esc 关闭
 *        + 拖拽旋转不报错 + PAGE_ERRORS 0
 * 运行：node screenshots/_probe_globe.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5177';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('meridian_onboarded', '1');
  localStorage.setItem('sidebarCollapsed', 'false');
  localStorage.setItem('nav', 'all'); // 全球大屏入口在「全部资讯」页顶栏
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
/* v26: 瓦片请求由 MapLibre Worker 发起，page.on('response') 看不到 → 用 CDP 网络层 */
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
const textureRequests = [];
cdp.on('Network.responseReceived', e => {
  const u = e.response.url;
  if (u.includes('/textures/')) textureRequests.push({ url: u.split('/').pop(), status: e.response.status });
  if (u.includes('arcgisonline') && u.includes('/tile/')) textureRequests.push({ url: 'esri-tile', status: e.response.status });
});
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);

/* 登录（体验模式） */
await page.evaluate(() => {
  [...document.querySelectorAll('button, a, [class*="nav"]')].find(el => el.textContent.trim() === '登录' || el.textContent.includes('登录'))?.click();
});
await page.waitForTimeout(600);
await page.click('.auth-guest-btn, [data-testid="auth-guest"]').catch(() => {});
await page.waitForTimeout(1500);

/* 打开大屏 */
await page.click('.globe-entry-btn');
await page.waitForSelector('.gs-overlay', { timeout: 8000 });
await page.waitForTimeout(1200);
const structure = await page.evaluate(() => ({
  overlay: !!document.querySelector('.gs-overlay'),
  stars: !!document.querySelector('.gs-stars'),
  halos: document.querySelectorAll('.gs-halo').length,
  scanline: !!document.querySelector('.gs-scanline'),
  corners: document.querySelectorAll('.gs-corner').length,
  brand: document.querySelector('.gs-brand-title')?.textContent || '',
  tickerLabel: document.querySelector('.gs-ticker-label')?.textContent || '',
  clock: /^\d{2}:\d{2}:\d{2}$/.test(document.querySelector('.gs-clock')?.textContent || ''),
  sidePanels: document.querySelectorAll('.gs-side').length,
  bottombar: !!document.querySelector('.gs-bottombar'),
  timelineDates: document.querySelectorAll('.gs-tl-date').length,
  caption: (document.querySelector('.gs-stage-caption')?.textContent || '').includes('拖拽旋转'),
}));
console.log('大屏结构:', JSON.stringify(structure));

/* 等地球与点位就绪（纹理网络加载 + three 初始化） */
let markers = 0;
for (let i = 0; i < 40; i++) {
  markers = await page.evaluate(() => document.querySelectorAll('.gs-marker').length);
  if (markers > 0) break;
  await page.waitForTimeout(500);
}
const globeReady = await page.evaluate(markerCount => ({
  globeCanvas: !!document.querySelector('.gs-stage canvas'),
  markerCount,
  ripples: document.querySelectorAll('.gs-marker-ripple').length,
  names: [...document.querySelectorAll('.gs-marker-name')].slice(0, 4).map(e => e.textContent),
}), markers);
console.log('地球与点位:', JSON.stringify(globeReady));

/* 点击点位 → 小弹窗 → 点资讯 → 内容预览窗
 * v26 关键改进：用【真实鼠标命中点击】（measure rect → mouse.move/down/up），
 * 不再用 dispatchEvent 合成事件——合成事件绕过命中测试，测不出 pointer-events/遮挡问题 */
let detail = { clicked: false };
if (markers > 0) {
  const mc = await page.evaluate(() => {
    const m = document.querySelector('.gs-marker');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (mc) {
    await page.mouse.move(mc.x, mc.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  detail = await page.evaluate(markerCenter => ({
    clicked: !!markerCenter,
    popup: !!document.querySelector('.gs-popup'),
    popupCity: document.querySelector('.gs-popup-city')?.textContent || '',
    popupItems: document.querySelectorAll('.gs-popup-item').length,
  }), mc);
  /* 点资讯 → 预览窗（真实命中点击） */
  const ic = await page.evaluate(() => {
    const item = document.querySelector('.gs-popup-item');
    if (!item) return null;
    const r = item.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (ic) {
    await page.mouse.move(ic.x, ic.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  detail.preview = await page.evaluate(() => ({
    preview: !!document.querySelector('.gs-preview'),
    title: (document.querySelector('.gs-preview-title')?.textContent || '').slice(0, 40),
    hasBody: document.querySelectorAll('.gs-preview-body p').length > 0,
    hasLink: !!document.querySelector('.gs-preview-link'),
  }));
  /* Esc 关闭预览 → Esc 关闭弹窗 */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  detail.closedByEsc = !(await page.evaluate(() => !!document.querySelector('.gs-preview') || !!document.querySelector('.gs-popup')));
}
console.log('点位详情面板:', JSON.stringify(detail));

/* 拖拽旋转（不抛错即通过，PAGE_ERRORS 兜底） */
await page.mouse.move(800, 470);
await page.mouse.down();
await page.mouse.move(950, 430, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
const afterDrag = await page.evaluate(() => ({
  overlayAlive: !!document.querySelector('.gs-overlay'),
  markerCount: document.querySelectorAll('.gs-marker').length,
}));

/* 滚轮缩放（视口上滚） */
await page.mouse.wheel(0, -240);
await page.waitForTimeout(500);
const afterZoom = await page.evaluate(() => !!document.querySelector('.gs-overlay'));

console.log('交互后状态:', JSON.stringify({ ...afterDrag, overlayAfterZoom: afterZoom }));

/* 深度放大到卫星级：连续滚轮 12 次推近（maxZoom 18），瓦片持续流式加载 */
const tilesBefore = textureRequests.length;
for (let i = 0; i < 12; i++) { await page.mouse.move(800, 470); await page.mouse.wheel(0, -400); await page.waitForTimeout(220); }
await page.waitForTimeout(1500);
const deepZoom = await page.evaluate(() => ({
  overlayAlive: !!document.querySelector('.gs-overlay'),
  markers: document.querySelectorAll('.gs-marker').length,
}));
console.log('卫星级深放大:', JSON.stringify({ ...deepZoom, tilesBefore, tilesAfter: textureRequests.length, tilesGrew: textureRequests.length > tilesBefore }));
/* 等瓦片请求出现（Worker 发起，CDP 层捕获） */
for (let i = 0; i < 20 && textureRequests.length === 0; i++) await page.waitForTimeout(500);
console.log('贴图加载:', JSON.stringify(textureRequests.slice(0, 6)));
console.log('PAGE_ERRORS:', JSON.stringify(errs));
await b.close();
