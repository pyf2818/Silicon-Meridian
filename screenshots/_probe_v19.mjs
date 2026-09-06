import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.invalid/v1', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini', doubaoSearchKey: 'dsk-test-123' }));
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,150)));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

/* 1. 侧边栏分组（默认折叠是设计如此 → 先展开再验） */
await page.evaluate(() => document.querySelector('.collapse-btn')?.click());
await page.waitForTimeout(300);
const groups = await page.evaluate(() => [...document.querySelectorAll('.nav-group-title-static')].map(e => e.textContent));
console.log('1 侧栏分组:', JSON.stringify(groups));
const navCount = await page.evaluate(() => document.querySelectorAll('.nav-primary-item').length);
console.log('1 导航项数:', navCount);

/* 2. 资讯标题点击 → 预览抽屉 */
await page.locator('.nav-primary-item', { hasText: '全部动态' }).first().click();
await page.waitForTimeout(1500);
const hasCard = await page.evaluate(() => document.querySelectorAll('.news-item').length);
if (hasCard > 0) {
  await page.locator('.item-title.clickable').first().click();
  await page.waitForTimeout(1200);
  const preview = await page.evaluate(() => {
    const p = document.querySelector('.news-preview-panel');
    return { open: Boolean(p), state: p?.querySelector('.news-preview-state') ? 'loading/failed' : (p?.querySelectorAll('.news-preview-para').length || 0) + ' paras', title: p?.querySelector('.news-preview-title')?.textContent?.slice(0, 24) };
  });
  console.log('2 预览抽屉:', JSON.stringify(preview));
  await page.screenshot({ path: 'screenshots/v18-canvas/v19-preview.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
} else console.log('2 无资讯卡片（feed 可能为空），跳过预览测试');

/* 3. 画布：节点工具条 / 撤销 / 无限网格 / 成果预览 */
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(900);
const gridInfo = await page.evaluate(() => {
  const c = document.querySelector('.wf-canvas'), g = document.querySelector('.wf-grid-layer');
  if (!c || !g) return null;
  const cb = c.getBoundingClientRect(), gb = g.getBoundingClientRect();
  return { layerCovers: Math.abs(cb.width - gb.width) < 2 && Math.abs(cb.height - gb.height) < 2 };
});
console.log('3 网格层铺满视口:', JSON.stringify(gridInfo));
await page.locator('.wf-node').first().click();
await page.waitForTimeout(300);
const toolbar = await page.evaluate(() => {
  const t = document.querySelector('.wf-node-toolbar');
  return t ? { open: true, btns: [...t.querySelectorAll('button')].map(b => b.textContent) } : { open: false };
});
console.log('3 节点工具条:', JSON.stringify(toolbar));
const nBefore = await page.evaluate(() => document.querySelectorAll('.wf-node').length);
await page.locator('.wf-node-toolbar button', { hasText: '复制' }).click();
await page.waitForTimeout(400);
const nAfter = await page.evaluate(() => document.querySelectorAll('.wf-node').length);
console.log('3 复制节点:', nBefore, '->', nAfter);
await page.locator('.canvas-act-btn', { hasText: '撤销' }).click();
await page.waitForTimeout(300);
const nUndo = await page.evaluate(() => document.querySelectorAll('.wf-node').length);
console.log('3 撤销后:', nUndo);

/* 模拟运行 → 报告 → 成果预览 */
await page.locator('.canvas-sim-btn').click();
await page.waitForTimeout(6500);
const report = await page.evaluate(() => {
  const r = document.querySelector('.canvas-sim-report');
  return { open: Boolean(r), steps: r?.querySelectorAll('.canvas-sim-step').length || 0 };
});
console.log('3 模拟报告:', JSON.stringify(report));
await page.locator('.canvas-sim-deliverable-btn').click();
await page.waitForTimeout(400);
const deliverable = await page.evaluate(() => {
  const d = document.querySelector('.canvas-sim-deliverable pre');
  return { open: Boolean(d), head: d?.textContent?.slice(0, 40) };
});
console.log('3 成果预览:', JSON.stringify(deliverable));

/* 4. 精灵聊天记录 */
await page.evaluate(() => document.querySelector('.ai-elf-avatar')?.click());
await page.waitForTimeout(700);
const elfWindow = await page.evaluate(() => Boolean(document.querySelector('.ai-elf-chat-window')));
console.log('4 精灵窗口:', elfWindow);
await page.evaluate(() => [...document.querySelectorAll('.ai-elf-btn')].find(b => b.title === '聊天记录')?.click());
await page.waitForTimeout(300);
const history = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.ai-elf-history')),
  saveBtn: Boolean([...document.querySelectorAll('.ai-elf-history-head button')].find(b => b.textContent.includes('保存当前对话'))),
}));
console.log('4 聊天记录面板:', JSON.stringify(history));
// 收起精灵窗口（历史面板会遮挡后续侧栏点击）
await page.evaluate(() => {
  [...document.querySelectorAll('.ai-elf-btn')].find(b => b.title === '收起')?.click();
});
await page.waitForTimeout(400);

/* 5. 设置 → 大模型 → 豆包状态条 */
await page.evaluate(() => [...document.querySelectorAll('.sidebar-action')].find(b => b.textContent.includes('设置'))?.click());
await page.waitForTimeout(600);
await page.evaluate(() => [...document.querySelectorAll('.sc-nav-item, [class*=nav-item]')].find(b => b.textContent.includes('大模型'))?.click());
await page.waitForTimeout(500);
const doubao = await page.evaluate(() => {
  const bar = document.querySelector('.llm-websearch-status');
  if (!bar) return { open: false };
  return {
    open: true,
    text: bar.querySelector('b')?.textContent,
    provider: bar.className.includes('provider-doubao'),
  };
});
console.log('5 豆包状态条:', JSON.stringify(doubao));
await page.evaluate(() => document.querySelector('.llm-websearch-status-btn')?.click());
await page.waitForTimeout(500);
const jumped = await page.evaluate(() => {
  const d = document.querySelector('.llm-websearch-details');
  const input = document.querySelector('.llm-doubao-row input');
  return { detailsOpen: d?.open, inputVisible: Boolean(input), focused: document.activeElement === input };
});
console.log('5 快速跳转:', JSON.stringify(jumped));
// 关闭设置弹窗（Esc 可能不生效，优先点关闭按钮）
await page.evaluate(() => {
  const btn = document.querySelector('.modal-overlay .modal-close, .modal-overlay [class*=close], .modal-close');
  if (btn) btn.click();
});
await page.waitForTimeout(300);
if (await page.evaluate(() => Boolean(document.querySelector('.modal-overlay')))) await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* 6. 画像：偏好设置 → 领域优先级 → 添加自定义领域 */
await page.locator('.nav-primary-item', { hasText: '用户画像' }).first().click();
await page.waitForTimeout(900);
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '偏好设置')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => [...document.querySelectorAll('.profile-module-nav-item')].find(b => b.textContent.includes('领域优先级'))?.click());
await page.waitForTimeout(400);
await page.locator('.priority-add-row input').first().fill('具身智能');
await page.locator('.priority-add-row button', { hasText: '添加领域' }).click();
await page.waitForTimeout(500);
const customRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="profile-domain-row"]')];
  const row = rows.find(r => r.textContent.includes('具身智能'));
  return { total: rows.length, found: Boolean(row), tag: Boolean(row?.querySelector('.priority-custom-tag')), del: Boolean(row?.querySelector('.priority-remove-btn')) };
});
console.log('6 自定义领域:', JSON.stringify(customRow));
// 删除
await page.evaluate(() => {
  const row = [...document.querySelectorAll('[data-testid="profile-domain-row"]')].find(r => r.textContent.includes('具身智能'));
  row?.querySelector('.priority-remove-btn')?.click();
});
await page.waitForTimeout(400);
const afterDel = await page.evaluate(() => [...document.querySelectorAll('[data-testid="profile-domain-row"]')].some(r => r.textContent.includes('具身智能')));
console.log('6 删除自定义领域:', afterDel ? 'FAIL 仍在' : 'OK');

console.log('PAGEERRORS:', JSON.stringify(errs));
await b.close();
