/**
 * README 截图生成 v3：guest 登录后点击侧边栏真实切页（修复登录回跳导致的重复截图）
 * 运行：node screenshots/_gen_readme_shots.mjs（需 dev server 127.0.0.1:5177）
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5177';
const OUT = 'public/screenshots';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 }, deviceScaleFactor: 2 });

async function newPage() {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('meridian_onboarded', '1');
    localStorage.setItem('sidebarCollapsed', 'false');
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a, [class*="nav"]')].find(el => el.textContent.trim() === '登录' || el.textContent.includes('登录'))?.click();
  });
  await page.waitForTimeout(600);
  await page.click('.auth-guest-btn, [data-testid="auth-guest"]').catch(() => {});
  await page.waitForTimeout(1600);
  return page;
}

/** 点击侧边栏叶子文本项（登录后切页，绕开 localStorage nav 只在启动时读取的限制） */
async function gotoNav(page, label) {
  const clicked = await page.evaluate((text) => {
    const leaf = [...document.querySelectorAll('span, div, button, a')]
      .filter(el => el.children.length === 0 && el.textContent.trim() === text)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    if (!leaf) return false;
    const target = leaf.closest('button, a, [role="button"], li, [class*="item"], [class*="nav"]') || leaf;
    target.click();
    return true;
  }, label);
  await page.waitForTimeout(1800);
  return clicked;
}

async function waitLandmark(page, fn, timeoutMs = 18000, step = 600) {
  const start = Date.now();
  let ok = false;
  while (Date.now() - start < timeoutMs) {
    ok = await page.evaluate(fn).catch(() => false);
    if (ok) break;
    await page.waitForTimeout(step);
  }
  return await page.evaluate(() => document.body.innerText.length);
}

const shots = [];

/* 1. AI 工作站 */
{
  const page = await newPage();
  const nav = await gotoNav(page, 'AI 工作站');
  const bodyLen = await waitLandmark(page, () => !!document.querySelector('textarea') && document.body.innerText.length > 900, 20000);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/main-interface.png` });
  shots.push(['main-interface.png', nav, bodyLen]);
  await page.close();
}

/* 2. 全部动态 */
{
  const page = await newPage();
  const nav = await gotoNav(page, '全部动态');
  const bodyLen = await waitLandmark(page, () => document.body.innerText.length > 9000, 20000);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/all-news.png` });
  shots.push(['all-news.png', nav, bodyLen]);
  await page.close();
}

/* 3. 全球态势大屏 */
{
  const page = await newPage();
  await page.locator('.globe-entry-btn').first().click({ timeout: 8000 });
  let markers = 0;
  for (let i = 0; i < 24; i++) {
    markers = await page.evaluate(() => document.querySelectorAll('.gs-marker').length);
    if (markers >= 8) break;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/globe-view.png` });
  shots.push(['globe-view.png', true, markers]);
  await page.close();
}

/* 4. 大屏两级弹窗 */
{
  const page = await newPage();
  await page.locator('.globe-entry-btn').first().click({ timeout: 8000 });
  for (let i = 0; i < 24; i++) {
    if (await page.evaluate(() => document.querySelectorAll('.gs-marker').length >= 8)) break;
    await page.waitForTimeout(700);
  }
  const mc = await page.evaluate(() => {
    const m = document.querySelector('.gs-marker');
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(mc.x, mc.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/globe-popup.png` });
  shots.push(['globe-popup.png', true, 0]);
  await page.close();
}

/* 5. 股市动向 */
{
  const page = await newPage();
  const nav = await gotoNav(page, '股市动向');
  const bodyLen = await waitLandmark(page, () => document.body.innerText.includes('上证指数') && document.querySelectorAll('canvas').length > 0, 25000);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/stock-analysis.png` });
  shots.push(['stock-analysis.png', nav, bodyLen]);
  await page.close();
}

/* 6. GitHub 热门 */
{
  const page = await newPage();
  const nav = await gotoNav(page, 'GitHub 热门');
  const bodyLen = await waitLandmark(page, () => document.body.innerText.includes('GitHub') && document.body.innerText.length > 3500, 20000);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/github-trending.png` });
  shots.push(['github-trending.png', nav, bodyLen]);
  await page.close();
}

/* 7. 无限画布 */
{
  const page = await newPage();
  const nav = await gotoNav(page, '无限画布') || await gotoNav(page, '画布');
  const bodyLen = await waitLandmark(page, () => document.body.innerText.length > 700, 20000);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/creative-canvas.png` });
  shots.push(['creative-canvas.png', nav, bodyLen]);
  await page.close();
}

/* 8. 用户广场 */
{
  const page = await newPage();
  const nav = await gotoNav(page, '用户广场');
  const bodyLen = await waitLandmark(page, () => document.body.innerText.length > 900, 22000);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/community-square.png` });
  shots.push(['community-square.png', nav, bodyLen]);
  await page.close();
}

/* 9. 团队群聊：点开第一个会话 */
{
  const page = await newPage();
  const nav = await gotoNav(page, '联系人');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[class*="contact"], [class*="conversation"], li, [class*="session"], [class*="item"]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 30 && r.left < 500 && el.textContent.trim(); })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    item?.click();
  });
  await page.waitForTimeout(2200);
  const bodyLen = await waitLandmark(page, () => document.body.innerText.length > 700, 12000);
  await page.screenshot({ path: `${OUT}/team-chat.png` });
  shots.push(['team-chat.png', nav, bodyLen]);
  await page.close();
}

await b.close();
console.log('=== 截图结果（nav=切页成功 bodyLen=内容量）===');
shots.forEach(([f, nav, len]) => console.log(`${len > 650 || f.startsWith('globe') ? '✓' : '⚠'} ${f}  nav=${nav} bodyLen=${len}`));
