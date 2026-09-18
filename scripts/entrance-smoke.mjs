/**
 * entrance-smoke.mjs — 入场动画 v6「墨川 Ink Meridian」冒烟探针
 *
 * 验证：墨层（浓墨核 + 三层晕 + 飞溅）→ SVG 造型滤镜齐全 → 纸纹/暗角 → 品牌结构
 * → 进度墨线推进 → 自动卸载；全程收集 pageerror 与 console 严重错误。
 * v6 特征断言：零 canvas（墨由 SVG 滤镜造型），无 v5 星尘/河流遗留节点。
 *
 * 用法：node scripts/entrance-smoke.mjs [url]
 */
import { chromium } from 'playwright';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = process.argv[2] || 'http://127.0.0.1:5175/';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const errors = [];
const consoleErrors = [];
const openPage = async (freezeLeave) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (freezeLeave) {
    // 把离场调度（2000/2620ms）放大 10 倍，让 splash 停在画面上供采样
    await ctx.addInitScript(() => {
      const orig = window.setTimeout;
      window.setTimeout = (fn, d, ...a) => orig(fn, d > 1500 ? d * 10 : d, ...a);
    });
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  p.on('console', (m) => {
    if (m.type() === 'error' && /ReferenceError|TypeError|before initialization/.test(m.text())) {
      consoleErrors.push(m.text().slice(0, 200));
    }
  });
  return p;
};

// 趟 1：冻结离场 → 结构与进度墨线采样
const page = await openPage(true);

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.entrance', { timeout: 15000 });

const structure = await page.evaluate(() => {
  const q = (s) => !!document.querySelector(s);
  const n = (s) => document.querySelectorAll(s).length;
  const el = document.querySelector('.entrance');
  return {
    zIndex: el ? getComputedStyle(el).zIndex : null,
    // 墨层：1 浓墨核 + 3 层晕 + 4 飞溅
    core: n('.entrance__core'),
    blobs: n('.entrance__blob'),
    drops: n('.entrance__drop'),
    // 造型滤镜：inkA/B/C/Core(墨核与飞溅)/Edge(字飞白)
    filters: n('.entrance__defs filter'),
    filterIds: ['enInkA', 'enInkB', 'enInkC', 'enInkCore', 'enInkEdge']
      .filter((id) => !!document.getElementById(id)),
    paper: q('.entrance__paper'),
    vignette: q('.entrance__vignette'),
    // 品牌结构
    brandChars: n('.entrance__brand-char'),
    seal: q('.entrance__seal'),
    meter: q('.entrance__meter-fill'),
    drown: q('.entrance__drown'),
    lightMode: el ? el.classList.contains('entrance--light') : null,
    // v6 特征：splash 内部彻底无 canvas（注意：app 自身的图表 canvas 是允许的）
    noCanvas: !q('.entrance canvas'),
    // v5「星尘入川」遗物（canvas 星河 / 星层 / 星云 / 噪点 / 经线 / 遥测条）不应存在
    noLegacy: !q('.entrance__river') && !q('.entrance__stars') && !q('.entrance__glow')
      && !q('.entrance__noise') && !q('.entrance__meridian') && !q('.entrance__bar')
      && !q('.entrance__flash') && !q('.entrance__stage')
      // v4 遗物（光核时代）
      && !q('.entrance__ring') && !q('.entrance__grid') && !q('.entrance__sweep')
      && !q('.entrance__rail') && !q('.entrance__brandscan'),
  };
});

// 起跑后采样进度墨线
await page.waitForFunction(
  () => document.querySelector('.entrance')?.classList.contains('is-run') === true,
  null,
  { timeout: 12000 }
).catch(() => {});
await page.waitForTimeout(400);
const telemetry = await page.evaluate(() => ({
  isRun: document.querySelector('.entrance')?.classList.contains('is-run') ?? null,
  fill: document.querySelector('.entrance__meter-fill')?.style.transform ?? null,
}));

// 趟 2：正常节奏 → 自动离场卸载（v6 总长 2.6s，留足余量）
const page2 = await openPage(false);
await page2.goto(URL, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('.entrance', { timeout: 15000 });
await page2.waitForSelector('.entrance', { state: 'detached', timeout: 14000 });
const unmounted = (await page2.locator('.entrance').count()) === 0;

console.log(JSON.stringify({ structure, telemetry, unmounted, errors, consoleErrors }, null, 2));
await browser.close();

const bad =
  errors.length > 0 || consoleErrors.length > 0 ||
  !unmounted || structure.brandChars !== 4 ||
  structure.core !== 1 || structure.blobs !== 3 || structure.drops !== 4 ||
  structure.filterIds.length !== 5 || !structure.paper || !structure.vignette ||
  !structure.seal || !structure.meter || !structure.drown ||
  !structure.noCanvas || !structure.noLegacy ||
  telemetry.isRun !== true || !/scaleX/.test(telemetry.fill || '');
console.log(bad ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(bad ? 1 : 0);
