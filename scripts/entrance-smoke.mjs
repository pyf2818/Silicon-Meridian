/**
 * entrance-smoke.mjs — 入场动画 v4「万川归一」冒烟探针
 *
 * 验证：光河 canvas 存在并绘制 → 品牌结构齐全 → 遥测推进 → 自动卸载；
 * 全程收集 pageerror 与 console 严重错误。
 *
 * 用法：node scripts/entrance-smoke.mjs [url]
 */
import { chromium } from 'playwright';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = process.argv[2] || 'http://127.0.0.1:5175/';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && /ReferenceError|TypeError|before initialization/.test(m.text())) {
    consoleErrors.push(m.text().slice(0, 200));
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.entrance', { timeout: 15000 });

const structure = await page.evaluate(() => {
  const q = (s) => !!document.querySelector(s);
  const el = document.querySelector('.entrance');
  const cv = document.querySelector('.entrance__river');
  let painting = false;
  if (cv && cv.width > 0) {
    const off = document.createElement('canvas');
    off.width = 80; off.height = 50;
    off.getContext('2d').drawImage(cv, 0, 0, 80, 50);
    painting = off.getContext('2d').getImageData(0, 0, 80, 50).data.some((v) => v !== 0);
  }
  return {
    zIndex: el ? getComputedStyle(el).zIndex : null,
    riverCanvas: !!cv,
    riverPainting: painting,
    stage: q('.entrance__stage'),
    glows: document.querySelectorAll('.entrance__glow').length,
    brandChars: document.querySelectorAll('.entrance__brand-char').length,
    seal: q('.entrance__seal'),
    meter: q('.entrance__meter-fill'),
    flash: q('.entrance__flash'),
    lightMode: el ? el.classList.contains('entrance--light') : null,
    noLegacy: !q('.entrance__grid') && !q('.entrance__sweep') && !q('.entrance__rail') && !q('.entrance__brandscan'),
  };
});

// 起跑后采样遥测
await page.waitForFunction(
  () => document.querySelector('.entrance')?.classList.contains('is-run') === true,
  null,
  { timeout: 12000 }
).catch(() => {});
await page.waitForTimeout(400);
const telemetry = await page.evaluate(() => ({
  isRun: document.querySelector('.entrance')?.classList.contains('is-run') ?? null,
  pct: document.querySelector('.entrance__pct')?.textContent ?? null,
  fill: document.querySelector('.entrance__meter-fill')?.style.transform ?? null,
  phase: document.querySelector('.entrance__bar-phase')?.textContent ?? null,
}));

// 自动离场卸载
await page.waitForSelector('.entrance', { state: 'detached', timeout: 14000 });
const unmounted = (await page.locator('.entrance').count()) === 0;

console.log(JSON.stringify({ structure, telemetry, unmounted, errors, consoleErrors }, null, 2));
await browser.close();

const bad =
  errors.length > 0 || consoleErrors.length > 0 ||
  !unmounted || !structure.stage || structure.brandChars !== 4 ||
  !structure.riverCanvas || !structure.noLegacy ||
  telemetry.isRun !== true;
console.log(bad ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(bad ? 1 : 0);
