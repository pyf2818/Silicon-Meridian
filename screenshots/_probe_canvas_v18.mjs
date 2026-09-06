import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5175/';
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });

async function open(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.invalid/v1', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
  await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
  await page.waitForTimeout(900);
  return { page, errors };
}

const { page, errors } = await open('light');

/* 1. 基础渲染 */
log('1 渲染:', JSON.stringify(await page.evaluate(() => ({
  nodes: document.querySelectorAll('.wf-node').length,
  edges: document.querySelectorAll('.wf-edge').length,
  palette: document.querySelectorAll('.wf-palette-item').length,
  zoombar: Boolean(document.querySelector('.wf-zoombar')),
  flowSwitch: Boolean(document.querySelector('.canvas-flow-caret')),
}))));

/* 2. 主题跟随：画布背景 + 网格颜色 */
const themeInfo = async () => page.evaluate(() => {
  const c = document.querySelector('.wf-canvas');
  const w = document.querySelector('.wf-world');
  return { mode: document.documentElement.dataset.mode, bg: getComputedStyle(c).backgroundColor, gridSize: getComputedStyle(w).backgroundSize.slice(0, 24) };
});
log('2 主题(light):', JSON.stringify(await themeInfo()));

/* 3. 缩放 */
const zoomBefore = await page.locator('.wf-zoom-value').textContent();
await page.locator('.wf-zoombar button[title="放大"]').click();
await page.waitForTimeout(420);
const zoomAfter = await page.locator('.wf-zoom-value').textContent();
log('3 缩放:', zoomBefore, '->', zoomAfter);
await page.locator('.wf-zoombar button[title="重置视图（0）"]').click();
await page.waitForTimeout(420);

/* 4. 拖拽节点（提交 position） */
const before = await page.evaluate(() => document.querySelector('.wf-node').style.left + ',' + document.querySelector('.wf-node').style.top);
const box = await page.locator('.wf-node').first().boundingBox();
await page.mouse.move(box.x + 100, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + 240, box.y + 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const after = await page.evaluate(() => document.querySelector('.wf-node').style.left + ',' + document.querySelector('.wf-node').style.top);
log('4 拖拽:', before, '->', after, before !== after ? 'OK' : 'FAIL');

/* 5. 模拟运行：逐步点亮 + 连线流动 */
await page.locator('.canvas-sim-btn').click();
const samples = [];
for (let i = 0; i < 7; i += 1) {
  await page.waitForTimeout(650);
  samples.push(await page.evaluate(() => ({
    run: document.querySelectorAll('.wf-node.sim-running').length,
    done: document.querySelectorAll('.wf-node.sim-done').length,
    flow: document.querySelectorAll('.wf-edge.flow').length,
    doneEdge: document.querySelectorAll('.wf-edge.done').length,
    dot: document.querySelectorAll('.wf-edge-dot').length,
  })));
}
log('5 模拟采样:', JSON.stringify(samples));
await page.waitForTimeout(1200);
log('5 报告:', JSON.stringify(await page.evaluate(() => {
  const r = document.querySelector('.canvas-sim-report');
  return r ? { open: true, steps: r.querySelectorAll('.canvas-sim-step').length, head: r.querySelector('.canvas-sim-report-head b')?.textContent } : { open: false };
})));

/* 6. AI 搭建（无可用模型 → 本地兜底 → 应用） */
await page.locator('.canvas-ai-btn').click();
await page.waitForTimeout(500);
await page.locator('.canvas-ai-hint button').first().click();
await page.waitForTimeout(300);
await page.locator('.canvas-ai-send').click();
await page.waitForTimeout(2500);
const aiState = await page.evaluate(() => ({
  msgs: document.querySelectorAll('.canvas-ai-msg').length,
  apply: document.querySelectorAll('.canvas-ai-apply button').length,
  note: document.querySelector('.canvas-ai-msg-note')?.textContent?.slice(0, 40) || '',
}));
log('6 AI:', JSON.stringify(aiState));
const nBefore = await page.evaluate(() => document.querySelectorAll('.wf-node').length);
await page.locator('.canvas-ai-apply button.is-primary').first().click();
await page.waitForTimeout(600);
const nAfter = await page.evaluate(() => document.querySelectorAll('.wf-node').length);
log('6 应用节点:', nBefore, '->', nAfter);
await page.locator('.canvas-ai-close').click();
await page.waitForTimeout(300);

/* 7. 多工作流：新建 / 切换 */
await page.locator('.canvas-flow-caret').click();
await page.waitForTimeout(300);
log('7 工作流列表:', await page.evaluate(() => document.querySelectorAll('.canvas-flows-item').length));
await page.locator('.canvas-flows-head button').click();
await page.waitForTimeout(600);
log('7 新建后节点数:', await page.evaluate(() => document.querySelectorAll('.wf-node').length));

/* 8. 校验面板 */
await page.locator('.canvas-validate-chip').click();
await page.waitForTimeout(300);
log('8 校验项:', await page.evaluate(() => ({
  items: document.querySelectorAll('.canvas-validate-item').length,
  blocking: document.querySelectorAll('.canvas-validate-item.blocking').length,
})));
await page.screenshot({ path: 'screenshots/v18-canvas/light.png' });

/* 9. 深色模式 */
await page.evaluate(() => {
  const el = document.querySelector('.theme-toggle, [data-mode-toggle]');
  if (el) el.click();
});
await page.waitForTimeout(500);
log('9 主题(dark):', JSON.stringify(await themeInfo()));
await page.screenshot({ path: 'screenshots/v18-canvas/dark.png' });

log('PAGEERRORS:', JSON.stringify(errors));
await browser.close();
