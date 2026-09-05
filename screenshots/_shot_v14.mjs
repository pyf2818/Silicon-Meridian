/**
 * 验收 v14 两项：
 * ① 素材管理无下拉子模块（activeContextItems ≤ 1，无 素材库/智能体/内容创作 子项）
 * ② 无限画布 = 纯画布独占：无 hero/任务表单/输出面板，只有画布内浮动（名称/动作/节点配置卡）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/v14';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

/* ---- ① 素材管理：无子模块下拉 ---- */
await page.locator('.nav-primary-item', { hasText: '素材管理' }).first().click();
await page.waitForTimeout(700);
const studioChecks = await page.evaluate(() => ({
  contextItems: [...document.querySelectorAll('.nav-sub-item, .nav-context-group .nav-item')].map(x => x.textContent.trim()),
  hasExpander: Boolean(document.querySelector('.nav-primary-entry.active .nav-context-toggle, .nav-primary-entry.active [class*="expand"]')),
  bodyHas: {
    agentsSub: document.body.innerText.includes('智能体\n') && Boolean(document.querySelector('.nav-sub-item')),
    editorPage: document.body.innerText.includes('创作中心'),
  },
}));
console.log('STUDIO:', JSON.stringify(studioChecks, null, 2));
await page.screenshot({ path: `${OUT}/v14-materials.png` });

/* ---- ② 无限画布：纯画布 ---- */
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(900);
const canvasChecks = await page.evaluate(() => {
  const canvas = document.querySelector('.canvas-page .wf-canvas');
  const cr = canvas?.getBoundingClientRect();
  const feed = document.querySelector('.feed');
  return {
    canvasFull: canvas && cr ? (cr.width > feed.clientWidth * 0.95 && cr.height > feed.clientHeight * 0.9) : false,
    canvasSize: cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : null,
    palette: document.querySelectorAll('.wf-palette-item').length,
    zoombar: Boolean(document.querySelector('.wf-zoombar')),
    // 旧 AgentsPage 的重物应全部消失：
    hero: Boolean(document.querySelector('.agent-home-hero')),
    removedTexts: ['工作流任务', '个性化上下文', '工作流输出'].filter(x => document.body.innerText.includes(x)),
    nameChip: document.querySelector('.canvas-name-chip')?.textContent?.trim() || null,
    actions: [...document.querySelectorAll('.canvas-float-actions button')].map(b => b.textContent.trim()),
  };
});
console.log('CANVAS:', JSON.stringify(canvasChecks, null, 2));
await page.screenshot({ path: `${OUT}/v14-canvas.png` });

// 拖一个节点 → 节点配置卡出现
await page.locator('.wf-palette-item').first().dragTo(page.locator('.wf-canvas'), { targetPosition: { x: 400, y: 300 } });
await page.waitForTimeout(500);
const nodeChecks = await page.evaluate(() => ({
  nodes: document.querySelectorAll('.wf-node').length,
  editorCard: Boolean(document.querySelector('.canvas-node-editor')),
  editorTitle: document.querySelector('.canvas-node-editor .workflow-node-tools b')?.textContent,
}));
console.log('NODE:', JSON.stringify(nodeChecks));
await page.screenshot({ path: `${OUT}/v14-canvas-node.png` });

console.log('PAGEERRORS:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
