/**
 * README 截图批量生成：各核心功能页 1600×940 截图 → public/screenshots/
 * 运行：node screenshots/_gen_readme_shots.mjs（需 dev server 127.0.0.1:5177 在线）
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5177';
const OUT = 'public/screenshots';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 }, deviceScaleFactor: 2 });

async function shotNav(navId, file, waitMs = 5200, extra) {
  const page = await ctx.newPage();
  await page.addInitScript((id) => {
    localStorage.setItem('meridian_onboarded', '1');
    localStorage.setItem('sidebarCollapsed', 'false');
    localStorage.setItem('nav', id);
  }, navId);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);
  if (extra) await extra(page);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log('✓', file);
  await page.close();
}

/* 首页 AI 工作站 */
await shotNav('home', 'main-interface.png');

/* 全部动态 */
await shotNav('all', 'all-news.png');

/* 全球大屏（卫星地球 + 点位） */
await shotNav('all', 'globe-view.png', 4500, async (page) => {
  await page.locator('.globe-entry-btn').first().click({ timeout: 8000 });
  let markers = 0;
  for (let i = 0; i < 20; i++) {
    markers = await page.evaluate(() => document.querySelectorAll('.gs-marker').length);
    if (markers >= 8) break;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2500);
});

/* 全球大屏两级弹窗（点位弹窗展开态） */
await shotNav('all', 'globe-popup.png', 4500, async (page) => {
  await page.locator('.globe-entry-btn').first().click({ timeout: 8000 });
  let markers = 0;
  for (let i = 0; i < 20; i++) {
    markers = await page.evaluate(() => document.querySelectorAll('.gs-marker').length);
    if (markers >= 8) break;
    await page.waitForTimeout(700);
  }
  const mc = await page.evaluate(() => {
    const m = document.querySelector('.gs-marker');
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(mc.x, mc.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(900);
});

/* 股市动向（K 线 + AI 大师） */
await shotNav('stock', 'stock-analysis.png', 6500);

/* GitHub 热门 */
await shotNav('github', 'github-trending.png', 5500);

/* 无限画布（智能体工作流） */
await shotNav('canvas', 'creative-canvas.png', 6000);

/* 用户广场 */
await shotNav('square', 'community-square.png', 5500);

/* 团队群聊 */
await shotNav('chat', 'team-chat.png', 5500);

await b.close();
console.log('done');
