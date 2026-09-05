/**
 * 验收 v11 四项反馈：
 * ① 执行记录页「＋组建团队/快速派活」→ 切到团队群聊并预填 @ 指派（不再进单人对话）
 * ② 侧栏：无跨空间移动按钮、无全局置顶区；置顶会话浮到所属空间顶部
 * ③ 侧栏编排能力为纯文本行（无卡片）；群成员 chip 带色相头像
 * ④ 群信息面板无「快捷入口」；保存公告 → 公告内容以系统行发进群
 * 附加断言：公告作为环境设定注入（通过 UI 无法直测 LLM 上下文，由代码审查保证）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/v11';
fs.mkdirSync(OUT, { recursive: true });

const now = Date.now();
const spaces = {
  spaces: [
    { id: 'default', name: '默认空间', createdAt: now },
    { id: 'sp_work', name: '调研空间', createdAt: now },
  ],
  activeSpaceId: 'default',
};
const sessions = [
  { id: 's1', title: '普通会话 A', spaceId: 'sp_work', pinned: false, messages: [], createdAt: now - 3000, updatedAt: now - 3000 },
  { id: 's2', title: '置顶会话 B（应在空间顶部）', spaceId: 'sp_work', pinned: true, messages: [], createdAt: now - 6000, updatedAt: now - 6000 },
  { id: 's3', title: '普通会话 C', spaceId: 'sp_work', pinned: false, messages: [], createdAt: now - 1000, updatedAt: now - 1000 },
];
const groupSeed = {
  chats: [{
    id: 'gc_demo', name: '调研团队', createdAt: now, announcement: '',
    roster: ['explorer', 'writer'], profiles: {}, messages: [],
  }],
  activeId: 'gc_demo',
};

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(({ spaces, sessions, groupSeed }) => {
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify(spaces));
  localStorage.setItem('aiCopilotSessions', JSON.stringify(sessions));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify(groupSeed));
}, { spaces, sessions, groupSeed });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

await page.locator('.nav-primary-item').first().click();
await page.waitForTimeout(700);

/* ---- ②③ 侧栏：对话 tab ---- */
await page.locator('.session-tab', { hasText: '对话' }).click();
await page.locator('.space-section', { hasText: '调研空间' }).locator('.space-row-main').click();
await page.waitForTimeout(400);
const sidebarChecks = await page.evaluate(() => {
  const workSection = [...document.querySelectorAll('.space-section')].find(x => x.textContent.includes('调研空间'));
  const titles = [...(workSection?.querySelectorAll('.session-item-title') || [])].map(x => x.textContent);
  const firstItem = workSection?.querySelector('.session-item');
  return {
    orderInSpace: titles,
    pinnedFirst: titles[0]?.includes('置顶'),
    pinMarkVisible: Boolean(firstItem?.querySelector('.session-pin-mark')),
    moveButtons: document.querySelectorAll('.session-item-move').length,
    moveMenus: document.querySelectorAll('.session-move-menu').length,
    globalPinnedSection: document.querySelectorAll('.session-group-pinned').length,
  };
});
console.log('SIDEBAR:', JSON.stringify(sidebarChecks, null, 2));
await page.screenshot({ path: `${OUT}/v11-sidebar-spaces.png` });

/* ---- ③ 侧栏团队 tab：编排能力无卡片 + 成员带头像 ---- */
await page.locator('.session-tab', { hasText: '团队' }).click();
await page.waitForSelector('.gtc', { timeout: 8000 });
await page.waitForTimeout(600);
const agentsChecks = await page.evaluate(() => ({
  modeCards: document.querySelectorAll('.agents-mode-item').length,
  modeHintLines: [...document.querySelectorAll('.agents-mode-hints p')].map(p => p.textContent.trim()),
  rosterAvatars: document.querySelectorAll('.agents-roster-avatar').length,
  rosterChipTexts: [...document.querySelectorAll('.agents-roster-chip')].map(x => x.textContent.trim()),
  gavatarCells: document.querySelectorAll('.agents-chat-gavatar i').length,
}));
console.log('AGENTS TAB:', JSON.stringify(agentsChecks, null, 2));
await page.screenshot({ path: `${OUT}/v11-agents-tab.png` });

/* ---- ① 执行记录发起 → 群聊预填 ---- */
await page.locator('.gtc-topbar-btn', { hasText: '记录' }).click();
await page.waitForSelector('.team-center', { timeout: 8000 });
await page.locator('.team-launch-btn', { hasText: '组建团队' }).first().click();
await page.waitForSelector('.gtc', { timeout: 8000 });
await page.waitForTimeout(400);
const injectChecks = await page.evaluate(() => ({
  backInView: document.querySelector('.gtc') !== null,
  inputValue: document.querySelector('.gtc-input')?.value,
  focused: document.activeElement === document.querySelector('.gtc-input'),
}));
console.log('INJECT 组建团队:', JSON.stringify(injectChecks));
await page.screenshot({ path: `${OUT}/v11-inject-team.png` });

// 快速派活 chip → 群聊 @撰写者
await page.locator('.gtc-topbar-btn', { hasText: '记录' }).click();
await page.waitForSelector('.team-center', { timeout: 8000 });
await page.locator('.team-quick-chip', { hasText: '撰写者' }).click();
await page.waitForSelector('.gtc', { timeout: 8000 });
await page.waitForTimeout(300);
const injectChip = await page.evaluate(() => document.querySelector('.gtc-input')?.value);
console.log('INJECT chip 撰写者:', JSON.stringify(injectChip));

/* ---- ④ 面板：无快捷入口；公告发进群 ---- */
await page.locator('.gtc-topbar-btn', { hasText: 'ⓘ' }).click();
await page.waitForSelector('.gtc-panel', { timeout: 3000 });
const panelChecks = await page.evaluate(() => ({
  quickEntries: [...document.querySelectorAll('.gtc-panel-entry')].map(x => x.textContent.trim()),
}));
console.log('PANEL (无快捷入口):', JSON.stringify(panelChecks));

// 编辑并保存公告
await page.locator('.gtc-panel-cap-act', { hasText: '编辑' }).click();
await page.fill('.gtc-ann-editor textarea', '本周只做端侧模型简报，其他话题先放一放');
await page.locator('.gtc-panel-entry', { hasText: '保存公告' }).click();
await page.waitForTimeout(500);
const annChecks = await page.evaluate(() => ({
  annBody: document.querySelector('.gtc-ann-body')?.textContent,
  lastSystemLine: [...document.querySelectorAll('.gtc-system-line')].pop()?.textContent,
}));
console.log('ANNOUNCE:', JSON.stringify(annChecks, null, 2));
await page.screenshot({ path: `${OUT}/v11-announce.png` });

console.log('PAGEERRORS:', errors.length ? errors : 'none');
await browser.close();
