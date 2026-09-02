import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5175/';
const errors = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(() => {
  const now = Date.now();
  const spaces = [{ id: 1001, name: 'AI 素材', createdAt: new Date().toISOString() }, { id: 1002, name: '产品灵感', createdAt: new Date().toISOString() }];
  const types = ['quote', 'data', 'case', 'viewpoint', 'chart'];
  const materials = Array.from({ length: 12 }, (_, i) => ({
    id: 2000 + i,
    title: `素材条目 ${i + 1}：${['GPT-5 发布要点', '芯片出口管制数据', '竞品定价案例', '创始人观点摘录', '增长趋势图'][i % 5]}`,
    type: types[i % 5],
    source: ['TechCrunch', 'AI 精灵', '手动添加', 'GitHub'][i % 4],
    spaceId: i % 3 === 0 ? 1001 : (i % 3 === 1 ? 1002 : null),
    starred: i % 4 === 0,
    tags: [['AI', '大模型'], ['芯片', '政策'], ['商业'], []][i % 4],
    content: '这是一段素材内容摘要，用于验证仓库卡片与详情抽屉的渲染效果。',
    fullContent: '完整的素材正文内容，详情抽屉中应完整展示，包括换行与标点。第二条测试句子。',
    createdAt: new Date(now - i * 86400_000 / 2).toISOString(),
  }));
  localStorage.setItem('materialSpaces', JSON.stringify(spaces));
  localStorage.setItem('materials', JSON.stringify(materials));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.waitForTimeout(800);

// 进入智创中心
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button, a, [role=button]')]
    .find(el => (el.textContent || '').trim().startsWith('智创中心'));
  if (btn) btn.click();
});
await page.waitForTimeout(2000);
await page.screenshot({ path: 'screenshots/repo-grid.png' });

// 切换列表视图
await page.locator('.repo-view-toggle button').nth(1).click().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/repo-list.png' });

// 打开详情抽屉
await page.locator('.repo-list-row').first().click().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/repo-drawer.png' });
await page.keyboard.press('Escape');

// 回收站
await page.locator('.repo-rail-bottom .repo-rail-item').click().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/repo-trash.png' });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
