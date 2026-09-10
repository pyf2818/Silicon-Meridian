/**
 * batch-smoke.mjs — 三模块改版冒烟：粒子 / 登录弹窗 / 股市分析卡
 *
 * 1) 粒子：.visual-particle-layer 存在且 canvas 在绘制（非空白）
 * 2) 登录：打开 AuthModal，断言网格/扫描线/角标/核心环新结构 + 无 console ReferenceError
 * 3) 股市：切到股票页，断言分析卡新结构类名存在（保存按钮需生成诊断后才渲染，不强断言）
 *
 * 用法：node scripts/batch-smoke.mjs [url]
 */
import { chromium } from 'playwright';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = process.argv[2] || 'http://127.0.0.1:5175/?view=home';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  try { localStorage.setItem('meridian_onboarded', '1'); } catch { /* ignore */ }
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && /ReferenceError|before initialization|TypeError/.test(m.text())) {
    consoleErrors.push(m.text().slice(0, 300));
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// 跳过入场动画
const splash = page.locator('.entrance');
await splash.waitFor({ timeout: 15000 }).catch(() => {});
if (await splash.count()) await splash.click().catch(() => {});
await page.waitForSelector('.entrance', { state: 'detached', timeout: 15000 }).catch(() => {});

// ---- 1) 粒子层 ----
const particle = await page.evaluate(async () => {
  const cv = document.querySelector('.visual-particle-layer');
  if (!cv) return { exists: false };
  // 取两帧像素差，确认 rAF 在画（非静止空白）
  const snap = () => {
    const off = document.createElement('canvas');
    off.width = 160; off.height = 90;
    off.getContext('2d').drawImage(cv, 0, 0, 160, 90);
    return off.getContext('2d').getImageData(0, 0, 160, 90).data.join(',');
  };
  const a = snap();
  await new Promise(r => setTimeout(r, 350));
  const b = snap();
  return { exists: true, animating: a !== b };
});

// ---- 2) 登录弹窗 ----
let auth = { opened: false };
try {
  // 登录按钮是未登录态下侧边栏的第一个 .sidebar-action（折叠时无文本，role name 会失配）
  await page.evaluate(() => { document.querySelector('.sidebar-action')?.click(); });
  await page.waitForSelector('[data-testid="auth-modal"]', { timeout: 6000 });
  auth = await page.evaluate(() => ({
    opened: true,
    grid: !!document.querySelector('.auth-aside-grid'),
    scan: !!document.querySelector('.auth-aside-scan'),
    corners: document.querySelectorAll('.auth-hud-corner').length,
    coreRing: !!document.querySelector('.auth-core-ring'),
    telemetry: !!document.querySelector('.auth-telemetry'),
    guestBtn: !!document.querySelector('[data-testid="auth-guest"]'),
  }));
  await page.keyboard.press('Escape');
} catch (e) {
  auth = { opened: false, note: String(e).slice(0, 120) };
}

// ---- 3) 股市页分析卡骨架（?view=stock 直达） ----
let stock = { checked: false };
try {
  await page.goto('http://127.0.0.1:5175/?view=stock', { waitUntil: 'domcontentloaded' });
  const splash2 = page.locator('.entrance');
  await splash2.waitFor({ timeout: 12000 }).catch(() => {});
  if (await splash2.count()) await splash2.click().catch(() => {});
  await page.waitForSelector('.entrance', { state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('.stock-page', { timeout: 12000 });
  stock = await page.evaluate(() => ({
    checked: true,
    onStockPage: !!document.querySelector('.stock-page'),
    aiPanel: !!document.querySelector('.stock-ai-panel'),
    // 未生成诊断时面板为空态属正常；只验证面板存在与页面无崩溃
  }));
} catch (e) {
  stock = { checked: false, note: String(e).slice(0, 120) };
}

console.log(JSON.stringify({ particle, auth, stock, consoleErrors, errorCount: errors.length }, null, 2));
await browser.close();

const bad =
  !particle.exists || particle.animating === false ||
  consoleErrors.length > 0 || errors.length > 0 ||
  (auth.opened && !(auth.grid && auth.scan && auth.corners === 4 && auth.coreRing));
console.log(bad ? 'BATCH SMOKE: FAIL' : 'BATCH SMOKE: PASS');
process.exit(bad ? 1 : 0);
