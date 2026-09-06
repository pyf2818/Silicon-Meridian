import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,120)));
page.on('dialog', d => d.accept('流程B'));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(800);

const state = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('siliconstream-workflow-store')||'{}').state || {};
  return { tpl: (s.workflowTemplates||[]).map(t => `${t.name}:${t.nodes.length}`), draft: `${s.agentWorkflowDraft?.name}:${s.agentWorkflowDraft?.nodes?.length}` };
});
console.log('1 初始:', JSON.stringify(await state()));

// 另存为 -> 第二个工作流
await page.locator('.canvas-act-btn', { hasText: '另存为' }).first().click();
await page.waitForTimeout(700);
console.log('2 另存为后:', JSON.stringify(await state()));

// 在流程B里加两个节点
await page.locator('.wf-palette-item').nth(1).click();
await page.waitForTimeout(300);
await page.locator('.wf-palette-item').nth(2).click();
await page.waitForTimeout(400);
console.log('3 加节点后:', JSON.stringify(await state()));
await page.locator('.canvas-act-btn', { hasText: '保存' }).first().click();
await page.waitForTimeout(500);
console.log('4 保存后:', JSON.stringify(await state()));

// 切回第一个工作流
await page.locator('.canvas-flow-caret').click();
await page.waitForTimeout(300);
const items = await page.evaluate(() => [...document.querySelectorAll('.canvas-flows-item-main')].map(e => e.textContent));
console.log('5 列表:', JSON.stringify(items));
await page.locator('.canvas-flows-item-main').nth(1).click();
await page.waitForTimeout(600);
console.log('6 切换后:', JSON.stringify(await state()));
console.log('7 画布节点数:', await page.evaluate(() => document.querySelectorAll('.wf-node').length));
console.log('errors:', JSON.stringify(errs));
await b.close();
