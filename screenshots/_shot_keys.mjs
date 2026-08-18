import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5175/';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errs.push(m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);

const facts = {};
const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());
const nav = () => page.evaluate(() => document.querySelector('main')?.dataset.nav);

// 1) Ctrl/K 在首页（之前 NewsPage 内才生效，这里验证全局可达）
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
facts.paletteOpensOnHome = await page.evaluate(() => !!document.querySelector('.cmd-palette'));
facts.paletteHasRepreheat = await page.evaluate(() => document.body.innerText.includes('重新预热今日简报'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
facts.paletteClosed = await page.evaluate(() => !document.querySelector('.cmd-palette'));

// 2) g s -> stock
await blur();
facts.navBefore = await nav();
await page.keyboard.press('g'); await page.waitForTimeout(150);
await page.keyboard.press('s'); await page.waitForTimeout(500);
facts.navAfterGS = await nav();

// 3) g h -> home
await blur();
await page.keyboard.press('g'); await page.waitForTimeout(150);
await page.keyboard.press('h'); await page.waitForTimeout(500);
facts.navAfterGH = await nav();

// 4) g d -> recommendations
await blur();
await page.keyboard.press('g'); await page.waitForTimeout(150);
await page.keyboard.press('d'); await page.waitForTimeout(500);
facts.navAfterGD = await nav();

// 5) ? 打开快捷键面板（含分组标题）—— 用合成事件绕过 headless 的 ? 按键映射怪癖
await blur();
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })));
await page.waitForTimeout(400);
facts.shortcutsHasGroup = await page.evaluate(() => document.body.innerText.includes('页面跳转'));
facts.modalOpen = await page.evaluate(() => !!document.querySelector('.modal-overlay'));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
await page.waitForTimeout(200);

// 视觉：再开一次命令面板截图
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/b21-palette.png' });

console.log('FACTS=' + JSON.stringify(facts, null, 2));
console.log('ERRORS=' + JSON.stringify(errs.slice(0, 8), null, 2));
await b.close();
