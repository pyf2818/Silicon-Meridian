// C1 微交互统一验证：token 注入 + focus-visible 全局可见环 + spinner + 全站无异常 + 截图
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const results = {};
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });

// 1) motion token 已注入
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const tokens = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return { easeOut: g('--ease-out'), durBase: g('--dur-base'), easeSpring: g('--ease-spring'), shadowHover: g('--shadow-hover') };
});
results.tokens = { ...tokens, pass: !!(tokens.easeOut && tokens.durBase && tokens.easeSpring && tokens.shadowHover) };

// 2) focus-visible 全局可见环（真实键盘 Tab 到 BUTTON）
await page.keyboard.press('Tab');
for (let i = 0; i < 14; i++) {
  const tag = await page.evaluate(() => document.activeElement?.tagName);
  if (tag === 'BUTTON') break;
  await page.keyboard.press('Tab');
}
const fv = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el.tagName !== 'BUTTON') return { tag: el?.tagName, found: false };
  const cs = getComputedStyle(el);
  return { tag: el.tagName, found: true, outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor };
});
results.focusVisible = { ...fv, pass: fv.found && fv.outlineWidth !== '0px' && fv.outlineStyle !== 'none' };

// 3) 全站走查 + 截图（无 pageerror 即视为无回归）
const views = ['home', 'all', 'stock', 'github', 'studio', 'profile-center', 'monitor'];
for (const v of views) {
  await page.goto(`${BASE}/?view=${v}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `screenshots/motion-${v}.png`, fullPage: false });
}
results.walkPages = { count: views.length };

// 4) spinner 动画（股市终端加载态可能含 .spinner）
await page.goto(`${BASE}/?view=stock`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const spinner = await page.evaluate(() => {
  // 运行时注入 .spinner.spinner--sm 验证 C1.4 修饰类真生效
  const el = document.createElement('div');
  el.className = 'spinner spinner--sm';
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const out = { injectedWidth: cs.width, injectedBorder: cs.borderTopWidth, animationName: cs.animationName };
  el.remove();
  out.realSpinnerFound = !!document.querySelector('.spinner');
  return out;
});
results.spinner = { ...spinner, pass: spinner.injectedWidth === '16px' && spinner.injectedBorder === '2px' && spinner.animationName === 'spin' };

await browser.close();

results.pageErrors = pageErrors.slice(0, 5);
results.allPass = results.tokens.pass && results.focusVisible.pass && results.spinner.pass && pageErrors.length === 0;
console.log('=== C1 MOTION RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('ALL_PASS=' + results.allPass + ' ERRORS=' + pageErrors.length);
process.exit(results.allPass ? 0 : 1);
