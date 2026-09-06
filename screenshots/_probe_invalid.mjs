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
console.log('初始 chip:', await page.locator('.canvas-validate-chip').textContent(), '| invalid节点:', await page.evaluate(()=>document.querySelectorAll('.wf-node.sim-invalid').length));
// 选中首个节点，清空标题与 prompt
await page.locator('.wf-node').first().click();
await page.waitForTimeout(300);
await page.locator('.canvas-node-editor .workflow-node-editor-grid input').first().fill('');
await page.waitForTimeout(400);
console.log('清空标题后 chip:', await page.locator('.canvas-validate-chip').textContent(), '| invalid节点:', await page.evaluate(()=>document.querySelectorAll('.wf-node.sim-invalid').length));
console.log('配置卡提示:', await page.evaluate(()=>[...document.querySelectorAll('.canvas-node-issues span')].map(e=>e.textContent.slice(0,40))));
// 校验面板可定位
await page.locator('.canvas-validate-chip').click();
await page.waitForTimeout(300);
console.log('校验面板阻塞项:', await page.evaluate(()=>document.querySelectorAll('.canvas-validate-item.blocking').length));
// 恢复
await page.locator('.canvas-node-editor .workflow-node-editor-grid input').first().fill('恢复标题');
await page.waitForTimeout(400);
console.log('恢复后 chip:', await page.locator('.canvas-validate-chip').textContent(), '| invalid节点:', await page.evaluate(()=>document.querySelectorAll('.wf-node.sim-invalid').length));
console.log('errors:', JSON.stringify(errs));
await b.close();
