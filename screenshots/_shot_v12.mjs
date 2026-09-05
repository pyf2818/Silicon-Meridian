/**
 * 验收 v12 五项：
 * ① 群头像稳定（群名四宫格，不随成员变化）+ 成员色相按 id 稳定
 * ② 顶栏居中群名（无下拉菜单）；侧栏团队 tab 承担 新建/重命名/解散
 * ④ 聊天用户消息条 hover 出现 复制/重写；重写把内容填回输入框
 * ⑤ 设置-大模型 tab：一卡式（无服务商模板区、无大段说明），预设 chips + 折叠联网搜索
 * （③ 文件预览依赖 File System Access API 的用户手势，headless 无法端到端，代码层已验证）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/v12';
fs.mkdirSync(OUT, { recursive: true });

const now = Date.now();
const groupSeed = {
  chats: [
    { id: 'gc_a', name: '股票市场', createdAt: now, announcement: '', roster: ['researcher', 'explorer', 'critic', 'writer'], profiles: {}, messages: [
      { id: 'gm1', role: 'user', agentId: '', agentName: '', content: '晚上好', at: now - 60000, status: 'done', meta: null },
    ] },
    { id: 'gc_b', name: '调研团队', createdAt: now - 1000, announcement: '', roster: ['explorer'], profiles: {}, messages: [] },
  ],
  activeId: 'gc_a',
};
const sessions = [
  { id: 's1', title: '测试会话', spaceId: 'default', pinned: false, createdAt: now, updatedAt: now, messages: [
    { role: 'user', content: '帮我总结一下端侧模型的三个要点', at: now - 50000 },
    { role: 'assistant', content: '好的，三点：1) 推理速度提升；2) 成本下降；3) 端云协同。', at: now - 40000 },
  ] },
];
const llmSeed = {
  llmConfig: { provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini', manualModels: [], webSearchEnabled: true },
  presets: [
    { id: 'p1', name: '日常写作', provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-1', selectedModel: 'gpt-4o', updatedAt: now - 1000 },
    { id: 'p2', name: '便宜快速', provider: 'custom', baseUrl: 'https://backup.example.com', apiKey: 'sk-2', selectedModel: 'mini-model', updatedAt: now - 2000 },
  ],
  activePreset: null,
};

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript((s) => {
  localStorage.setItem('agentTeamGroupChat', JSON.stringify(s.groupSeed));
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify({ spaces: [{ id: 'default', name: '默认空间', createdAt: Date.now() }], activeSpaceId: 'default' }));
  localStorage.setItem('aiCopilotSessions', JSON.stringify(s.sessions));
  localStorage.setItem('llmConfig', JSON.stringify(s.llmSeed.llmConfig));
  localStorage.setItem('llmPresets:v1', JSON.stringify(s.llmSeed.presets));
}, { groupSeed, sessions, llmSeed });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

await page.locator('.nav-primary-item').first().click();
await page.waitForTimeout(700);
await page.locator('.session-tab', { hasText: '团队' }).click();
await page.waitForSelector('.gtc', { timeout: 8000 });
await page.waitForTimeout(600);

/* ---- ①② 群聊顶栏 + 侧栏管理 ---- */
const chatChecks = await page.evaluate(() => ({
  centerTitle: document.querySelector('.gtc-topbar-title h3')?.textContent,
  centerTitleVisible: (() => {
    const el = document.querySelector('.gtc-topbar-title h3');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const bar = el.closest('.gtc-topbar').getBoundingClientRect();
    const center = r.left + r.width / 2 - bar.left;
    return Math.abs(center - bar.width / 2) < 40; // 大致居中
  })(),
  oldChatmenu: document.querySelectorAll('.gtc-chatmenu-btn, .gtc-chatmenu-pop').length,
  gavatarCells: [...document.querySelectorAll('.agents-chat-gavatar')].map(g => [...g.querySelectorAll('i')].map(i => i.textContent).join('')),
  sidebarChatActions: document.querySelectorAll('.agents-chat-acts button').length,
}));
console.log('CHAT:', JSON.stringify(chatChecks, null, 2));
await page.screenshot({ path: `${OUT}/v12-group-topbar.png` });

// 侧栏重命名流程：悬停第一行 → ✎ → 改名 → Enter
const firstRow = page.locator('.agents-chat-row').first();
await firstRow.hover();
await firstRow.locator('.agents-chat-acts button').first().click();
await page.locator('.agents-chat-rename').fill('美股频道');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const renamed = await page.evaluate(() => ({
  sidebarName: document.querySelector('.agents-chat-row .agents-chat-name')?.textContent,
  topbarTitle: document.querySelector('.gtc-topbar-title h3')?.textContent,
  avatarCells: [...(document.querySelector('.agents-chat-gavatar')?.querySelectorAll('i') || [])].map(i => i.textContent).join(''),
}));
console.log('RENAME:', JSON.stringify(renamed));
await page.screenshot({ path: `${OUT}/v12-sidebar-rename.png` });

/* ---- ④ 用户消息 复制/重写 ---- */
await page.locator('.session-tab', { hasText: '对话' }).first().click();
// 中心区还在群聊视图 → 点「← 返回对话」切回对话
const backBtn = await page.$('.team-center-back');
if (backBtn) { await backBtn.click(); await page.waitForTimeout(500); }
await page.waitForTimeout(800);
const msgChecks = await page.evaluate(() => ({
  userActionBars: [...document.querySelectorAll('.chat-msg-actions-user button')].map(b => b.textContent.trim()),
}));
console.log('USER MSG ACTIONS:', JSON.stringify(msgChecks));
const userMsg = page.locator('.chat-msg-user').first();
await userMsg.hover();
await page.screenshot({ path: `${OUT}/v12-user-msg-hover.png` });
await page.locator('.chat-msg-actions-user button', { hasText: '重写' }).click();
await page.waitForTimeout(300);
const rewrite = await page.evaluate(() => ({
  inputValue: document.querySelector('.chat-input, textarea')?.value,
}));
console.log('REWRITE fill:', JSON.stringify(rewrite));

/* ---- ⑤ 设置-大模型 tab ---- */
// 侧栏底部「设置」按钮；弹层根是 .modal-overlay，导航项是 .sc-nav-item
await page.locator('.sidebar .sidebar-action').last().click();
await page.waitForSelector('.modal-overlay', { timeout: 4000 });
await page.locator('.sc-nav-item', { hasText: '大模型' }).click();
await page.waitForTimeout(500);
const llmChecks = await page.evaluate(() => ({
  providerSelect: document.querySelectorAll('.llm-provider-select').length,
  presetChips: [...document.querySelectorAll('.llm-preset-chip-main')].map(b => b.textContent.trim()),
  inUseChip: document.querySelectorAll('.llm-preset-chip.in-use').length,
  urlInput: Boolean(document.querySelector('.llm-input.url-input')),
  fetchBtn: document.querySelector('.fetch-models-btn')?.textContent,
  testBtn: document.querySelector('.test-llm-btn')?.textContent,
  saveAsBtn: document.querySelector('.llm-btn-save-as')?.textContent,
  websearchDetails: document.querySelectorAll('.llm-websearch-details').length,
  longHints: document.querySelectorAll('.llm-section-hint').length, // 应为 0（大段说明已删）
  visibleChars: document.querySelector('.llm-tab-root')?.innerText.length,
}));
console.log('LLM TAB:', JSON.stringify(llmChecks, null, 2));
await page.screenshot({ path: `${OUT}/v12-llm-tab.png` });

console.log('PAGEERRORS:', errors.length ? errors : 'none');
await browser.close();
