// probe-reduced-motion.mjs — 验证 Playwright headless 下 prefers-reduced-motion 的判定
import { chromium } from 'playwright';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';

const browser = await chromium.launch({ executablePath: EXE, headless: true });

// ① 不设 reducedMotion（默认）
const c1 = await browser.newContext({ viewport: { width: 800, height: 600 } });
const p1 = await c1.newPage();
await p1.goto('about:blank');
const v1 = await p1.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ② 显式 reducedMotion: 'no-preference'
const c2 = await browser.newContext({ viewport: { width: 800, height: 600 }, reducedMotion: 'no-preference' });
const p2 = await c2.newPage();
await p2.goto('about:blank');
const v2 = await p2.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

await browser.close();
console.log(JSON.stringify({ default: v1, noPreference: v2 }));
