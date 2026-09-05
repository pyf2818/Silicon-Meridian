/**
 * 验收 v13 五项大改：
 * ② 素材管理（原智创中心）：导航更名、无 agents/editor 子模块、知识图谱视图、素材↔本地资产关联
 * ③ AI 精灵极简：单栏窗口、无会话历史/侧栏
 * ④ 无限画布独立模块（导航+页面）+ 工作站输入框工作流选择器
 * ⑤ 清理残留（侧栏智能体生态组已删、G-W 快捷键、设置文案）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/v13';
fs.mkdirSync(OUT, { recursive: true });

const now = Date.now();
const spaces = {
  spaces: [
    { id: 'default', name: '默认空间', createdAt: now, files: [
      { name: '端侧模型调研报告.md', path: 'reports/端侧模型调研报告.md', content: '本周围绕「端侧模型趋势」整理：推理速度提升明显，小模型成本下降。结论：端侧趋势向好。', spaceName: '默认空间' },
      { name: '简报草稿.md', path: 'notes/简报草稿.md', content: '承接 股票市场周报 的结论，补充数据来源核对。', spaceName: '默认空间' },
    ] },
  ],
  activeSpaceId: 'default',
};
const groupSeed = { chats: [], activeId: '' };
const materials = { materials: [
  { id: 'm1', type: 'viewpoint', title: '端侧模型趋势', content: '端侧推理速度持续提升', tags: ['端侧', '趋势'], source: '手动', createdAt: now - 1000, starred: false },
  { id: 'm2', type: 'data', title: '股票市场周报', content: '本周尾盘杀跌后企稳', tags: ['股市'], source: '手动', createdAt: now - 2000, starred: false },
] };

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript((s) => {
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify(s.spaces));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify(s.groupSeed));
  localStorage.setItem('materials', JSON.stringify(s.materials.materials || s.materials));
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
}, { spaces, groupSeed, materials });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 250)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

/* ---- ② 素材管理：导航 + 图谱视图 ---- */
const studioNav = page.locator('.nav-primary-item', { hasText: '素材管理' }).first();
const navReady = await studioNav.isVisible().catch(() => false);
if (!navReady) {
  console.log('PAGEERRORS SO FAR:', errors);
  console.log('BODY TEXT:', await page.evaluate(() => document.body.innerText.slice(0, 200)));
  await page.screenshot({ path: `${OUT}/v13-debug-nav.png` });
}
await studioNav.click();
await page.waitForTimeout(800);
const studioChecks = await page.evaluate(() => ({
  navLabels: [...document.querySelectorAll('.nav-primary-item .nav-label, .nav-primary-item span')].map(x => x.textContent).filter(t => /素材管理|无限画布|智能体|内容创作/.test(t)),
  hasGraphToggle: Boolean(document.querySelector('button[title*="知识图谱"]')),
}));
console.log('STUDIO:', JSON.stringify(studioChecks, null, 2));
await page.locator('button[title*="知识图谱"]').click();
await page.waitForTimeout(1500);
const graphChecks = await page.evaluate(() => {
  const canvas = document.querySelector('.material-graph canvas');
  const legend = [...document.querySelectorAll('.material-graph-legend-item')].map(x => x.textContent.trim());
  return { graphCanvas: Boolean(canvas), legend };
});
console.log('GRAPH:', JSON.stringify(graphChecks));
await page.screenshot({ path: `${OUT}/v13-materials-graph.png` });

/* ---- ④ 无限画布模块 ---- */
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(900);
const canvasChecks = await page.evaluate(() => ({
  heading: document.querySelector('.agent-home-hero h1')?.textContent,
  canvas: Boolean(document.querySelector('.wf-canvas')),
  palette: document.querySelectorAll('.wf-palette-item').length,
}));
console.log('CANVAS:', JSON.stringify(canvasChecks));
await page.screenshot({ path: `${OUT}/v13-canvas.png` });

/* ---- ④b 工作站输入框工作流选择器 ---- */
await page.locator('.nav-primary-item', { hasText: 'AI 工作站' }).first().click();
await page.waitForTimeout(900);
const wfBtn = page.locator('.chat-wf-wrap .chat-attach-mini');
const wfBtnCount = await wfBtn.count();
console.log('WF button count:', wfBtnCount);
if (wfBtnCount > 0) {
  await wfBtn.first().click();
  await page.waitForTimeout(400);
  const wfPop = await page.evaluate(() => ({
    options: [...document.querySelectorAll('.chat-wf-pop b')].map(b => b.textContent),
  }));
  console.log('WF POP:', JSON.stringify(wfPop));
  await page.screenshot({ path: `${OUT}/v13-wf-picker.png` });
  const opt = page.locator('.chat-wf-pop button').first();
  if (await opt.count()) {
    await opt.click();
    await page.waitForTimeout(300);
    const filled = await page.evaluate(() => (document.querySelector('.chat-composer textarea, .chat-input-area textarea, textarea')?.value || '').slice(0, 60));
    console.log('WF FILL:', JSON.stringify(filled));
  }
}

/* ---- ③ AI 精灵：悬浮球 + 简单窗口 ---- */
const elfBall = page.locator('.ai-elf-avatar').first();
if (await elfBall.count()) {
  await elfBall.click();
  await page.waitForTimeout(600);
  const elfChecks = await page.evaluate(() => ({
    window: Boolean(document.querySelector('.ai-elf-chat-window')),
    header: document.querySelector('.ai-elf-header')?.textContent?.slice(0, 30) || null,
    hasSidebar: Boolean(document.querySelector('.ai-elf-chat-window > .ai-elf-sidebar, .ai-elf-sidebar')),
    sessionList: document.querySelectorAll('.ai-elf-session, [class*="history"]').length,
  }));
  console.log('ELF:', JSON.stringify(elfChecks));
  await page.screenshot({ path: `${OUT}/v13-elf.png` });
} else {
  console.log('ELF: floating ball not found');
}

console.log('PAGEERRORS:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
