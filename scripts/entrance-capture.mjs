/**
 * entrance-capture.mjs — 入场动画 v5「星尘入川」视觉取证
 *
 * 先跑一轮预热（让 Vite 完成模块编译、浏览器缓存就位），正式轮截图才是毫秒级——
 * 否则 page.screenshot 在 dev 冷编译期会等稳定帧等上数秒，拍到的全是卸载后的画面。
 * 深色：三幕各一张 + 揭幕后首屏；浅色：三幕各一张。
 * 预置 meridian_onboarded=1 排除首跑引导遮罩干扰（真实用户二刷场景即纯 splash）。
 *
 * 用法：node scripts/entrance-capture.mjs [url]
 */
import { chromium } from 'playwright';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = process.argv[2] || 'http://127.0.0.1:5175/';
const OUT = 'screenshots';

const browser = await chromium.launch({ executablePath: EXE, headless: true });

/* ---------- 预热轮：加载一次页面直到 splash 卸载（只求编译缓存，不求截图） ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); // 沙盒访问 Google Fonts 慢，Playwright 截图前会等 fonts 就绪——直接断掉走系统字体
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4800);
  await ctx.close();
  console.log('WARMUP DONE');
}

async function capture({ light, name }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('meridian_onboarded', '1'); } catch { /* 忽略 */ }
  });
  if (light) {
    await context.addInitScript(() => { try { localStorage.setItem('themeMode', 'light'); } catch { /* 忽略 */ } });
  }
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); // 同预热轮：断外网字体，截图不再等 fonts
  // CDP 原生截帧：不等 fonts/稳定帧，直接合成当前画面（Playwright screenshot 首帧有 ~2s 协议开销）
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const cdpShot = async (shot) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${OUT}/entrance-v5-${shot}.png`, Buffer.from(data, 'base64'));
    console.log(`[${shot}] t=${Date.now() - t0}ms`);
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance', { timeout: 15000 });
  const t0 = Date.now();
  const at = async (ms, shot) => {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await cdpShot(`${name}-${shot}`);
  };
  await at(500, '1-stardust');
  await at(1800, '2-river');
  await at(3200, '3-brand');
  await page.waitForSelector('.entrance', { state: 'detached', timeout: 14000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/entrance-v5-${name}-4-revealed.png` });
  await context.close();
  return errors;
}

const errDark = await capture({ light: false, name: 'dark' });
const errLight = await capture({ light: true, name: 'light' });
await browser.close();
const all = [...errDark, ...errLight];
console.log(all.length ? `PAGEERRORS: ${all.join(' | ')}` : 'NO PAGE ERRORS');
console.log('CAPTURE DONE');
process.exit(0);
