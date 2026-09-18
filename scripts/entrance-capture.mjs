/**
 * entrance-capture.mjs — 入场动画 v6「墨川 Ink Meridian」视觉取证（seek 定格法）
 *
 * 为什么用 seek：v6 全长 2.6s，而 CDP 慢放/Node 计时都受「动画已跑一段」的窗口期
 * 干扰，连续错帧。这里改为在页面内用 Web Animations API 把全部动画 pause 后
 * seek 到目标时刻——完全确定性，想拍哪一帧就是哪一帧，与加载速度、协议开销无关。
 * （JS 侧离场调度经 addInitScript 放大 10 倍冻结，splash 不会自行卸载。）
 *
 * 预热轮：加载页面 + 等字体就绪（Noto Serif SC 进缓存）。
 * 深色/浅色各 5 张：落墨 300ms → 泛形 1000ms → 定形 2000ms → 转场 → 揭幕后首屏。
 *
 * 用法：node scripts/entrance-capture.mjs [url]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = process.argv[2] || 'http://127.0.0.1:5175/';
const OUT = 'screenshots';

const browser = await chromium.launch({ executablePath: EXE, headless: true });

/* ---------- 预热轮：编译缓存 + 字体落盘（不求截图） ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 20000 })
    .catch(() => console.log('  (warmup fonts slow)'));
  await page.waitForTimeout(1200);
  await ctx.close();
  console.log('WARMUP DONE');
}

async function capture({ light, name }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'no-preference',
  });
  // 冻结 JS 离场调度（>1500ms 的 setTimeout ×10），splash 停在画面上由我们摆布
  await context.addInitScript(() => {
    const orig = window.setTimeout;
    window.setTimeout = (fn, d, ...a) => orig(fn, d > 1500 ? d * 10 : d, ...a);
    try { localStorage.setItem('meridian_onboarded', '1'); } catch { /* 忽略 */ }
  });
  if (light) {
    await context.addInitScript(() => { try { localStorage.setItem('themeMode', 'light'); } catch { /* 忽略 */ } });
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance', { timeout: 15000 });
  // 等品牌字动画注册（React 挂载即注册，稍等一帧确保 getAnimations 拿到全集）
  await page.waitForTimeout(400);

  const shot = async (shotName) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/entrance-v6-${shotName}.png`, Buffer.from(data, 'base64'));
    console.log(`[${shotName}]`);
  };
  // 全部动画 seek 到同一时间轴时刻 t（CSS 动画的 currentTime 含 delay，统一设值即对齐）
  const seek = async (t) => {
    const n = await page.evaluate((ms) => {
      const anims = document.getAnimations();
      anims.forEach((a) => {
        try { a.pause(); a.currentTime = ms; } catch { /* 忽略个别不可 seek 的 */ }
      });
      return anims.length;
    }, t);
    await page.waitForTimeout(120);
    return n;
  };

  const n1 = await seek(300);
  await shot(`${name}-1-drop`);
  const n2 = await seek(1000);
  await shot(`${name}-2-spread`);
  const n3 = await seek(2000);
  await shot(`${name}-3-formed`);
  // 转场帧：手动落下 leaving 类触发墨幕，再 seek 到转场中段
  await page.evaluate(() => { document.querySelector('.entrance')?.classList.add('entrance--leaving'); });
  await page.waitForTimeout(300);   // 转场真实时间轴（0.6s）中段
  await shot(`${name}-4-drown`);
  // 揭幕后首屏：移除 splash 直接看应用
  await page.evaluate(() => { document.querySelector('.entrance')?.remove(); });
  await page.waitForTimeout(500);
  await shot(`${name}-5-revealed`);
  console.log(`  (animations sampled: ${n1}/${n2}/${n3})`);
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
