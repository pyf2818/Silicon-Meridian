/** 复现：工作站 文件/团队 tab 崩溃 —— 用多种真实旧数据形态探测 */
import { chromium } from 'playwright';

const VARIANTS = {
  empty: {},
  legacyChats: { agentTeamGroupChat: JSON.stringify({ chats: [
    { id: 'gc_old', name: '股票市场', createdAt: 1757000000000, roster: ['researcher', 'explorer', 'critic', 'writer'], messages: [
      { id: 'gm1', role: 'user', content: '晚上好', at: 1757000100000, status: 'done' },
      { id: 'gm2', role: 'agent', agentId: 'researcher', agentName: '研究员', content: '【旁观】晚上好。', at: 1757000200000, status: 'done' },
    ] },
  ], activeId: 'gc_old' }) },
  legacyArticles: { articles: JSON.stringify([
    { id: 'a1', title: '测试文章', content: '内容', createdAt: Date.now(), updatedAt: Date.now() },
  ]), materials: JSON.stringify([
    { id: 'm1', type: 'viewpoint', title: '端侧模型趋势', content: 'x', tags: ['端侧'], source: '手动', createdAt: Date.now(), starred: false },
  ]) },
  spaceFiles: { aiWorkstationSpaces: JSON.stringify({ spaces: [
    { id: 'default', name: '默认空间', createdAt: Date.now(), files: [{ name: 'a.md', path: 'a.md', content: 'x' }] },
  ], activeSpaceId: 'default' }) },
};

const browser = await chromium.launch({ headless: true });
for (const [name, seeds] of Object.entries(VARIANTS)) {
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.addInitScript((s) => {
    localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seeds);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 260)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('401') && !m.text().includes('503') && !m.text().includes('429') && !m.text().includes('preventDefault')) errs.push('console: ' + m.text().slice(0, 260)); });
  await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  let nav = await page.evaluate(() => document.querySelectorAll('.nav-primary-item').length);
  if (!nav) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2200); }
  try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
  await page.locator('.nav-primary-item').first().click();
  await page.waitForTimeout(600);

  for (const tabName of ['文件', '团队']) {
    errs.length = 0;
    await page.locator('.session-tab', { hasText: tabName }).first().click();
    await page.waitForTimeout(1000);
    const broken = await page.evaluate(() => document.body.innerText.includes('暂未就绪'));
    console.log(`[${name}] TAB ${tabName}: crashed=${broken}${broken ? '' : ' ok'}`);
    if (broken && errs.length) console.log('   └', errs[0]);
    if (broken) {
      await page.screenshot({ path: `screenshots/v16-${name}-${tabName}.png` });
    }
  }
  await ctx.close();
}
await browser.close();
