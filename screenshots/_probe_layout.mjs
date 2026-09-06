import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,120)));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(800);
// 选中一个节点让配置卡出现
await page.locator('.wf-node').first().click();
await page.waitForTimeout(300);

const boxes = () => page.evaluate(() => {
  const sel = ['.canvas-float-name','.wf-palette','.wf-zoombar','.canvas-node-editor','.canvas-ai-panel','.canvas-float-actions'];
  const out = {};
  sel.forEach(s => { const el = document.querySelector(s); out[s] = el ? el.getBoundingClientRect().toJSON() : null; });
  return out;
});
const hit = (a, c) => a && c && !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top);

let bx = await boxes();
console.log('A 关闭AI时 name×palette:', hit(bx['.canvas-float-name'], bx['.wf-palette']));
console.log('A 关闭AI时 editor×zoombar:', hit(bx['.canvas-node-editor'], bx['.wf-zoombar']));
console.log('A 关闭AI时 palette×zoombar:', hit(bx['.wf-palette'], bx['.wf-zoombar']));
console.log('A editor 在视口内:', bx['.canvas-node-editor'] && bx['.canvas-node-editor'].top >= 0 && bx['.canvas-node-editor'].bottom <= 940);

await page.locator('.canvas-ai-btn').click();
await page.waitForTimeout(500);
bx = await boxes();
console.log('B 开AI时 aiPanel×actions:', hit(bx['.canvas-ai-panel'], bx['.canvas-float-actions']));
console.log('B 开AI时 aiPanel×editor:', hit(bx['.canvas-ai-panel'], bx['.canvas-node-editor']));
await page.locator('.canvas-ai-close').click();
await page.waitForTimeout(300);

// 保存行为：改名 -> 保存 -> 模板数量不变且名字同步
const tplBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('siliconstream-workflow-store')||'{}').state?.workflowTemplates?.length ?? -1);
await page.locator('.canvas-name-chip').click();
await page.waitForTimeout(200);
await page.locator('.canvas-name-input').fill('我的测试流程');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.locator('.canvas-act-btn', { hasText: '保存' }).first().click();
await page.waitForTimeout(600);
const after = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('siliconstream-workflow-store')||'{}').state;
  return { count: s?.workflowTemplates?.length ?? -1, names: (s?.workflowTemplates||[]).map(t=>t.name), draft: s?.agentWorkflowDraft?.name };
});
console.log('C 保存 前模板数:', tplBefore, '后:', after.count, '名字:', JSON.stringify(after.names), '草稿名:', after.draft);
console.log('errors:', JSON.stringify(errs));
await b.close();
