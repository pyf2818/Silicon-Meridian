// C2 出入场节奏统一验证：命令面板 / 首跑引导 的动画时长+缓动收敛到 C1 token，keyframe name 保留；全站无异常
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const results = {};
const pageErrors = [];

const norm = (s) => (s || '').replace(/\s+/g, '');

const browser = await chromium.launch({ headless: true });

// ctx1: 命令面板（Ctrl+K）
const ctx1 = await browser.newContext();
const p1 = await ctx1.newPage();
p1.on('pageerror', (e) => pageErrors.push('cmd:' + e));
await p1.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await p1.goto(BASE, { waitUntil: 'networkidle' });
await p1.waitForTimeout(1000);
await p1.keyboard.press('Control+k');
await p1.waitForTimeout(500);
const cmd = await p1.evaluate(() => {
  const rd = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { dur: cs.animationDuration, timing: cs.animationTimingFunction, name: cs.animationName }; };
  return { overlay: rd(document.querySelector('.cmd-palette-overlay')), panel: rd(document.querySelector('.cmd-palette')) };
});
const cmdOk = cmd.overlay && cmd.panel &&
  cmd.overlay.name === 'cmd-palette-fade' && cmd.panel.name === 'cmd-palette-slide' &&
  cmd.overlay.dur !== '0s' && cmd.panel.dur !== '0s' &&
  norm(cmd.overlay.timing).includes('cubic-bezier(0.16,1,0.3,1)') &&
  norm(cmd.panel.timing).includes('cubic-bezier(0.16,1,0.3,1)');
results.cmdPalette = { ...cmd, pass: cmdOk };
await p1.screenshot({ path: 'screenshots/c2-cmd-palette.png' });
await p1.keyboard.press('Escape');
await ctx1.close();

// ctx2: 首跑引导（不设 onboarded → 自动弹出）
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => pageErrors.push('onb:' + e));
await p2.goto(BASE, { waitUntil: 'networkidle' });
await p2.waitForTimeout(1300);
const onb = await p2.evaluate(() => {
  const rd = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { dur: cs.animationDuration, timing: cs.animationTimingFunction, name: cs.animationName }; };
  const ov = document.querySelector('.onb-overlay');
  const body = document.querySelector('.onb-body');
  return { present: !!ov, overlay: rd(ov), body: rd(body) };
});
const onbOk = onb.present && onb.overlay && onb.body &&
  onb.overlay.name === 'onbFadeIn' && onb.body.name === 'onbSlide' &&
  norm(onb.overlay.timing).includes('cubic-bezier(0.16,1,0.3,1)') &&
  norm(onb.body.timing).includes('cubic-bezier(0.16,1,0.3,1)');
results.onboarding = { ...onb, pass: onbOk };
await p2.screenshot({ path: 'screenshots/c2-onboarding.png' });
await ctx2.close();

// ctx3: 全站走查无异常
const ctx3 = await browser.newContext();
const p3 = await ctx3.newPage();
p3.on('pageerror', (e) => pageErrors.push('walk:' + e));
await p3.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
for (const v of ['home', 'all', 'stock', 'github', 'studio', 'profile-center', 'monitor']) {
  await p3.goto(`${BASE}/?view=${v}`, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(700);
}
results.walk = { pages: 7 };
await ctx3.close();

await browser.close();
results.pageErrors = pageErrors.slice(0, 5);
results.allPass = results.cmdPalette.pass && results.onboarding.pass && pageErrors.length === 0;
console.log('=== C2 RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('ALL_PASS=' + results.allPass + ' ERRORS=' + pageErrors.length);
process.exit(results.allPass ? 0 : 1);
