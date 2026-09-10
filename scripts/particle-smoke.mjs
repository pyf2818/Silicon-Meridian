/**
 * 粒子动效探针：验证 (1) 画布存在 (2) 粒子真的在动（像素 diff）
 * (3) 深浅模式 --particle-mode-speed 系数不同 (4) 无 pageerror
 */
import { chromium } from 'playwright';

const BASE = process.env.PW_BASE || 'http://127.0.0.1:5175';
const OUT = process.env.PW_OUT || `.pw-particle-${Date.now()}`;

const browser = await chromium.launch({ headless: true, channel: undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.addInitScript(() => {
  localStorage.setItem('meridian_onboarded', '1');
});
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });

// 等入场动画离场（splash 完全卸载，最长 15s）
await page.waitForSelector('.visual-particle-layer', { state: 'visible', timeout: 20000 });
await page.waitForTimeout(3000);

function check(cond, label) {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
}

// 1) 画布存在
const canvasCount = await page.locator('canvas.visual-particle-layer').count();
check(canvasCount >= 1, `粒子画布存在 (count=${canvasCount})`);

// 2) 像素 diff 证明粒子在动：800ms 内同一画布快照应不同
const moved = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas.visual-particle-layer');
  if (!canvas) return false;
  const ctx = canvas.getContext('2d');
  const snap = () => ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 400)).data;
  const a = snap();
  await new Promise((r) => setTimeout(r, 800));
  const b = snap();
  if (a.length !== b.length) return true;
  let diff = 0;
  for (let i = 3; i < a.length; i += 40) { if (a[i] !== b[i]) diff++; }
  return diff > 20;
});
check(moved, '粒子在动（800ms 像素 diff > 20）');

// 3) 深浅模式速度系数
const speeds = {};
for (const mode of ['dark', 'light']) {
  speeds[mode] = await page.evaluate((m) => {
    document.documentElement.setAttribute('data-mode', m);
    return parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--particle-mode-speed')
    );
  }, mode);
}
check(speeds.dark === 1.15, `深色模式速度系数 = 1.15 (got ${speeds.dark})`);
check(speeds.light === 0.75, `浅色模式速度系数 = 0.75 (got ${speeds.light})`);
check(speeds.dark > speeds.light, '深色比浅色更快（深浅模式体感不同）');

// 切到浅色后再采一次像素 diff，确认浅色下也在动
await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'light'));
await page.waitForTimeout(600);
const movedLight = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas.visual-particle-layer');
  const ctx = canvas.getContext('2d');
  const a = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 400)).data;
  await new Promise((r) => setTimeout(r, 800));
  const b = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 400)).data;
  let diff = 0;
  for (let i = 3; i < a.length; i += 40) { if (a[i] !== b[i]) diff++; }
  return diff > 20;
});
check(movedLight, '浅色模式下粒子也在动');

// 4) 无 pageerror
check(pageErrors.length === 0, `无 pageerror (${pageErrors.length})`);
if (pageErrors.length) console.log(pageErrors.slice(0, 5).join('\n'));

await browser.close();
console.log(process.exitCode ? '== 粒子探针：存在失败项 ==' : '== 粒子探针：全部通过 ==');
