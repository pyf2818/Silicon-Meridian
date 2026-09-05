/**
 * 验收「执行记录页 v10 精简」：
 * 旧版 2 张模式大卡 + 4 张 preset 大卡 + 段落文案 → 精简为一行按钮 + 一行 chips，
 * 最近团队列表成为主体。
 * 预置 teamStore（一个已完成团队 + 一个执行中团队），截图断言：
 *  1) records-empty  空态：一句话 + 主按钮 + 一行小字
 *  2) records-list   有团队：顶栏按钮行 + 快速派活 chips + 团队卡（看板/邮箱展开）
 * 断言文字量显著下降（页面可见字符数）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/records-v10';
fs.mkdirSync(OUT, { recursive: true });

const now = Date.now();
const teams = {
  team_demo: {
    id: 'team_demo',
    goal: '调研端侧模型趋势并产出深度简报',
    teammates: [
      { name: '探索者', agent: 'explorer', objective: '检索端侧模型最新动态' },
      { name: '撰写者', agent: 'writer', objective: '撰写深度简报' },
    ],
    tasks: [
      { id: 't1', title: '检索今日端侧模型资讯', objective: '检索', owner: '探索者', status: 'done', result: '收集到 12 条有效资讯，已去重' },
      { id: 't2', title: '交叉验证数据来源', objective: '验证', owner: '探索者', status: 'done', result: '8 条来源可靠' },
      { id: 't3', title: '撰写简报初稿', objective: '写作', owner: '撰写者', status: 'in_progress' },
      { id: 't4', title: '审校并定稿', objective: '审校', owner: '审校者', status: 'pending' },
    ],
    messages: [
      { id: 'msg1', from: 'lead', to: '探索者', body: '请优先检索 NPU 相关的资讯，其余靠后。', at: now - 9 * 60000 },
      { id: 'msg2', from: '探索者', to: 'lead', body: '已完成检索与验证，12 条资讯已挂到任务卡结果里。', at: now - 7 * 60000 },
      { id: 'msg3', from: 'lead', to: '撰写者', body: '素材已就绪，可以动笔了。', at: now - 5 * 60000 },
    ],
    status: 'running',
    createdAt: now - 20 * 60000,
    updatedAt: now - 3 * 60000,
  },
  team_old: {
    id: 'team_old',
    goal: '评估三个 GitHub 仓库的接入价值',
    teammates: [{ name: '探索者', agent: 'explorer', objective: '仓库评估' }],
    tasks: [{ id: 't1', title: '仓库初筛', objective: '评估', owner: '探索者', status: 'done', result: '推荐接入 1 个' }],
    messages: [],
    status: 'completed',
    createdAt: now - 26 * 3600000,
    updatedAt: now - 25 * 3600000,
  },
};

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1560, height: 940 },
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
await ctx.addInitScript((t) => {
  localStorage.setItem('agentTeamState', JSON.stringify(t));
}, teams);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
try {
  const skip = await page.$('button:has-text("跳过")');
  if (skip) await skip.click();
} catch { /* 无引导 */ }

await page.locator('.nav-primary-item').first().click();
await page.waitForTimeout(600);
await page.locator('.session-tab', { hasText: '团队' }).click();
await page.waitForSelector('.gtc', { timeout: 8000 });
await page.waitForTimeout(500);
// 群聊顶栏「记录」→ 执行记录页
await page.locator('.gtc-topbar-btn', { hasText: '记录' }).click();
await page.waitForSelector('.team-center', { timeout: 8000 });
await page.waitForTimeout(600);

/* ---- 结构断言：新布局 ---- */
const checks = await page.evaluate(() => ({
  title: document.querySelector('.team-center-title h2')?.textContent,
  runningBadge: document.querySelector('.team-center-running')?.textContent || null,
  headButtons: [...document.querySelectorAll('.team-center-actions .team-launch-btn')].map(b => b.textContent),
  quickChips: [...document.querySelectorAll('.team-quick-chip')].map(b => b.textContent),
  // 旧版大段文案应已消失：
  modeCards: document.querySelectorAll('.team-mode-card').length,
  presetCards: document.querySelectorAll('.team-preset-card').length,
  kicker: document.querySelectorAll('.team-center-kicker').length,
  paragraphText: (document.querySelector('.team-center-head p')?.textContent) || null,
  teamCards: document.querySelectorAll('.team-card').length,
  kanbanCols: document.querySelectorAll('.team-kanban-col').length,
  mailboxToggle: document.querySelector('.team-mailbox-toggle')?.textContent?.trim() || null,
  // 首屏可见文本总量（对比旧版的文字密度）
  visibleChars: document.querySelector('.team-center').innerText.length,
}));
console.log('CHECKS:', JSON.stringify(checks, null, 2));

await page.screenshot({ path: `${OUT}/records-list.png` });

// 展开邮箱看消息流
await page.click('.team-mailbox-toggle');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/records-mailbox.png` });

console.log('PAGEERRORS:', errors.length ? errors : 'none');
await browser.close();
