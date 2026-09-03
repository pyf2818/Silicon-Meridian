// AI 工作站升级验证：多空间侧边栏 / 智能体 Tab / 团队中心
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5175/';
const errors = [];
const browser = await chromium.launch({ headless: true });

// ---- 注入 mock：会话（2 空间归属）+ 一个完整团队 ----
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => {
  const now = Date.now();
  const mk = (id, title, spaceId, pinned, minsAgo) => ({
    id, title, messages: [{ role: 'user', content: `${title} 的第一条提问` }], createdAt: now - minsAgo * 60000,
    updatedAt: now - minsAgo * 60000, spaceId, pinned,
  });
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    mk('s1', '大模型推理成本分析', 'default', true, 5),
    mk('s2', '端侧模型部署调研', 'default', false, 60),
    mk('s3', 'Pancode 迭代规划', 'sp_pancode', false, 120),
    mk('s4', '图表工具竞品对比', 'sp_pancode', true, 30),
  ]));
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify({
    spaces: [
      { id: 'default', name: '默认空间', createdAt: now },
      { id: 'sp_pancode', name: 'Pancode', createdAt: now },
    ],
    activeSpaceId: 'default',
  }));
  // teamStore 持久化结构：{ [teamId]: team }
  localStorage.setItem('agentTeamState', JSON.stringify({
    team_demo1: {
      id: 'team_demo1',
      goal: '调研端侧模型部署方案并产出选型建议',
      status: 'running',
      createdAt: now - 3600e3,
      updatedAt: now - 300e3,
      teammates: [
        { name: '侦察兵', agent: 'explorer', preset: { id: 'explorer' }, objective: '检索端侧部署生态' },
        { name: '研究员', agent: 'researcher', preset: { id: 'researcher' }, objective: '交叉验证性能数据' },
        { name: '笔杆子', agent: 'writer', preset: { id: 'writer' }, objective: '起草选型报告' },
      ],
      tasks: [
        { id: 't1', title: '检索主流端侧推理框架', objective: 'x', owner: '侦察兵', status: 'done', result: '找到 llama.cpp / MLC / ONNX Runtime 三条主线' },
        { id: 't2', title: '交叉验证量化损失数据', objective: 'x', owner: '研究员', status: 'in_progress', result: '' },
        { id: 't3', title: '起草选型报告初稿', objective: 'x', owner: '笔杆子', status: 'pending', result: '' },
        { id: 't4', title: '审校报告（预排）', objective: 'x', owner: '笔杆子', status: 'failed', result: '前置任务未完成' },
      ],
      messages: [
        { id: 'm1', teamId: 'team_demo1', from: '侦察兵', to: 'lead', body: '三条主线已确认，MLC 在 Apple Silicon 上最强。', at: now - 1800e3 },
        { id: 'm2', teamId: 'team_demo1', from: '研究员', to: '侦察兵', body: '量化损失数据缺 int4 在 x86 的实测，请补一个来源。', at: now - 900e3 },
      ],
    },
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);

// 进 AI 工作站
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, a')]
      .find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12);
    btn?.click();
  });
  await page.waitForTimeout(2500);
  opened = await page.locator('.session-sidebar').count() > 0;
  if (!opened) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500); }
}
console.log('workstation opened:', opened);

// ---- 探针 1：侧边栏多空间 ----
const sidebarProbe = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.session-tab')].map(t => t.textContent.trim()),
  spaces: [...document.querySelectorAll('.space-name')].map(e => e.textContent),
  spaceCounts: [...document.querySelectorAll('.space-count')].map(e => e.textContent),
  pinnedGroup: document.querySelector('.session-group-pinned .session-group-label')?.textContent || null,
  pinnedItems: document.querySelectorAll('.session-group-pinned .session-item').length,
  visibleSessions: [...document.querySelectorAll('.space-section.is-open .session-item-title')].map(e => e.textContent),
  createSpaceBtn: !!document.querySelector('.space-create-btn'),
}));
console.log('sidebar:', JSON.stringify(sidebarProbe));
await page.screenshot({ path: 'screenshots/ws-sidebar-spaces.png', timeout: 10000 }).catch(() => {});

// ---- 探针 2：新建空间 + 会话置顶切换 ----
await page.evaluate(() => document.querySelector('.space-create-btn')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const input = document.querySelector('.space-create-input');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Silicon Meridian');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const input = document.querySelector('.space-create-input');
  input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await page.waitForTimeout(500);
const afterCreate = await page.evaluate(() => [...document.querySelectorAll('.space-name')].map(e => e.textContent));
console.log('after create space:', JSON.stringify(afterCreate));

// 置顶切换：找第一条未置顶会话的 pin 按钮
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.space-section.is-open .session-item')]
    .find(el => !el.querySelector('.session-pin-mark'));
  item?.querySelector('.session-item-pin')?.click();
});
await page.waitForTimeout(400);
const pinProbe = await page.evaluate(() => ({
  pinnedNow: document.querySelectorAll('.session-group-pinned .session-item').length,
}));
console.log('after pin toggle:', JSON.stringify(pinProbe));

// ---- 探针 3：智能体 Tab + 团队中心 ----
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.session-tab')];
  tabs.find(t => t.textContent.includes('智能体'))?.click();
});
await page.waitForTimeout(600);
const agentsProbe = await page.evaluate(() => ({
  entry: !!document.querySelector('.agents-team-entry'),
  badge: document.querySelector('.agents-team-badge')?.textContent || null,
  running: document.querySelectorAll('.agents-running-item').length,
  caps: [...document.querySelectorAll('.agents-cap-name')].map(e => e.textContent),
  modes: document.querySelectorAll('.agents-mode-item code').length,
}));
console.log('agents tab:', JSON.stringify(agentsProbe));
await page.screenshot({ path: 'screenshots/ws-agents-tab.png', timeout: 10000 }).catch(() => {});

await page.evaluate(() => {
  [...document.querySelectorAll('.agents-team-entry, .agents-open-center')]
    .find(el => el.offsetParent !== null)?.click();
});
await page.waitForTimeout(900);
const teamProbe = await page.evaluate(() => ({
  centerOpen: !!document.querySelector('.team-center'),
  presets: [...document.querySelectorAll('.team-preset-name')].map(e => e.textContent),
  modeCards: document.querySelectorAll('.team-mode-card').length,
  teamCards: document.querySelectorAll('.team-card').length,
  kanbanCols: document.querySelectorAll('.team-kanban-col').length,
  taskCards: document.querySelectorAll('.team-task-card').length,
  members: [...document.querySelectorAll('.team-member-chip b')].map(e => e.textContent),
  mailboxMsgs: document.querySelectorAll('.team-mailbox-msg').length,
  statusBadge: document.querySelector('.team-status-badge')?.textContent || null,
}));
console.log('team center:', JSON.stringify(teamProbe));
await page.screenshot({ path: 'screenshots/ws-team-center.png', timeout: 10000 }).catch(() => {});

// 发起按钮 → 回到对话并填入 prompt
await page.evaluate(() => {
  [...document.querySelectorAll('.team-launch-btn')].find(el => el.textContent.includes('组建'))?.click();
});
await page.waitForTimeout(600);
const backProbe = await page.evaluate(() => ({
  backToChat: !!document.querySelector('.chat-messages'),
  inputFilled: document.querySelector('.chat-input-area textarea, .chat-input textarea, textarea')?.value?.slice(0, 20) || null,
}));
console.log('launch back to chat:', JSON.stringify(backProbe));
await page.screenshot({ path: 'screenshots/ws-chat-back.png', timeout: 10000 }).catch(() => {});

await ctx.close();
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
