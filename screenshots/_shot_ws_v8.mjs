// v8 探针：① 角色卡（查看/编辑/创建自定义角色）+ 灵魂注入 ② 群聊重命名/解散 + 复制/存素材
// ③ 顶栏重构（群名下拉/成员/清空/导出）+ 今日速报固定底部；含 v7 两阶段广播回归
import { chromium } from 'playwright';
const BASE = process.env.PW_BASE || 'http://127.0.0.1:5176/';
const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));

let llmCalls = 0;
await page.route('**/api/ai-generate', async route => {
  llmCalls += 1;
  const isClaim = llmCalls <= 2;
  const delta = isClaim
    ? '【认领】（mock）这个任务归我，我去检索端侧模型的一手资料。'
    : '### 端侧模型情报（mock）\n- Llama 3.2 1B/3B 已可端侧部署';
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: `data: {"delta":${JSON.stringify(delta)}}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n`,
  });
});

const now = Date.now();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  localStorage.setItem('llmConfig', JSON.stringify({
    baseUrl: 'https://mock.local/v1', apiKey: 'mock-key', selectedModel: 'mock-model',
    provider: 'custom', manualModels: [], webSearchEnabled: true,
  }));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify({ roster: ['explorer', 'writer'], messages: [] }));
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    { id: 's1', title: 't', spaceId: 'default', createdAt: now, updatedAt: now, messages: [] },
  ]));
}, now);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a')]
      .find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12)?.click();
  });
  await page.waitForTimeout(2200);
  opened = await page.locator('.session-sidebar').count() > 0;
  if (!opened) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3200); }
}
console.log('workstation opened:', opened);
// 进团队 tab
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.includes('团队'))?.click();
});
await page.waitForTimeout(1200);

/* ---- Probe ③：顶栏结构 + 今日速报固定 ---- */
const topbar = await page.evaluate(() => ({
  topbar: !!document.querySelector('.gtc-topbar'),
  oldHeadGone: !document.querySelector('.gtc-head'),
  oldChatsBarGone: !document.querySelector('.gtc-chats-bar'),
  chatmenu: !!document.querySelector('.gtc-chatmenu-btn'),
  memberChips: document.querySelectorAll('.gtc-member-chip').length,
  inviteBtn: !!document.querySelector('.gtc-invite-btn'),
  exportBtn: [...document.querySelectorAll('.gtc-topbar-btn')].some(b => b.title.includes('导出')),
  clearBtn: [...document.querySelectorAll('.gtc-topbar-btn')].some(b => b.title.includes('清空')),
  // 今日速报固定底部：侧栏底栏应在视口内
  briefingBottom: (() => {
    const el = document.querySelector('.session-sidebar-bottom');
    return el ? Math.round(el.getBoundingClientRect().bottom) : null;
  })(),
  viewportH: window.innerHeight,
  agentsTabFlex: getComputedStyle(document.querySelector('.agents-tab')).flex,
}));
console.log('probe3 topbar:', JSON.stringify(topbar));

/* ---- Probe ①a：成员角色卡（查看/编辑内置成员性格） ---- */
await page.evaluate(() => document.querySelector('.gtc-member-chip')?.click());
await page.waitForTimeout(500);
const cardOpen = await page.evaluate(() => !!document.querySelector('.gtc-role-card'));
await page.evaluate(() => {
  const tas = document.querySelectorAll('.gtc-role-card textarea');
  const styleTa = tas[tas.length - 1];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(styleTa, '（mock）毒舌但心软，发言简短犀利，爱用反问句');
  styleTa.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  [...document.querySelectorAll('.gtc-role-card-btn')].find(b => b.textContent.includes('保存'))?.click();
});
await page.waitForTimeout(500);
const profileSaved = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('agentTeamGroupChat') || '{}');
  const chat = (raw.chats || [])[0] || {};
  return { profile: chat.profiles?.explorer || null };
});
// 重开卡片验证回显
await page.evaluate(() => document.querySelector('.gtc-member-chip')?.click());
await page.waitForTimeout(400);
const cardEcho = await page.evaluate(() => {
  const tas = document.querySelectorAll('.gtc-role-card textarea');
  return tas.length ? tas[tas.length - 1].value.slice(0, 20) : '(none)';
});
await page.evaluate(() => document.querySelector('.gtc-role-card-close')?.click());
await page.waitForTimeout(300);
console.log('probe1a card:', JSON.stringify({ cardOpen, profileSaved, cardEcho }));

/* ---- Probe ①b：创建自定义角色 ---- */
await page.evaluate(() => document.querySelector('.gtc-invite-btn')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-invite-create')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const input = document.querySelector('.gtc-role-card input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '情报官');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const tas = document.querySelectorAll('.gtc-role-card textarea');
  const dSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  dSetter.call(tas[0], '负责汇总每日情报增量');
  tas[0].dispatchEvent(new Event('input', { bubbles: true }));
  dSetter.call(tas[1], '（mock）冷静克制，用编号汇报');
  tas[1].dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  [...document.querySelectorAll('.gtc-role-card-btn')].find(b => b.textContent.includes('保存并邀请'))?.click();
});
await page.waitForTimeout(500);
const customSaved = await page.evaluate(() => {
  const roles = JSON.parse(localStorage.getItem('agentTeamCustomRoles') || '[]');
  const raw = JSON.parse(localStorage.getItem('agentTeamGroupChat') || '{}');
  const roster = (raw.chats || [])[0]?.roster || [];
  return {
    roleCount: roles.length,
    role: roles[roles.length - 1] ? { id: roles[roles.length - 1].id, name: roles[roles.length - 1].name, hasStyle: !!roles[roles.length - 1].style } : null,
    invited: roster.some(id => String(id).startsWith('cr_')),
    memberChips: document.querySelectorAll('.gtc-member-chip').length,
  };
});
console.log('probe1b custom role:', JSON.stringify(customSaved));

/* ---- Probe ②a：群名下拉 → 重命名 ---- */
await page.evaluate(() => document.querySelector('.gtc-chatmenu-btn')?.click());
await page.waitForTimeout(300);
const menuOpen = await page.evaluate(() => ({
  pop: !!document.querySelector('.gtc-chatmenu-pop'),
  items: document.querySelectorAll('.gtc-chatmenu-item').length,
  renameBtn: [...document.querySelectorAll('.gtc-chatmenu-actions button')].some(b => b.textContent.includes('重命名')),
  dissolveBtn: [...document.querySelectorAll('.gtc-chatmenu-actions button')].some(b => b.textContent.includes('解散')),
  newBtn: [...document.querySelectorAll('.gtc-chatmenu-actions button')].some(b => b.textContent.includes('新建')),
}));
await page.evaluate(() => {
  [...document.querySelectorAll('.gtc-chatmenu-actions button')].find(b => b.textContent.includes('重命名'))?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const input = document.querySelector('.gtc-rename-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '端侧突击队');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await page.waitForTimeout(400);
const renamed = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('agentTeamGroupChat') || '{}');
  return (raw.chats || [])[0]?.name || null;
});
console.log('probe2a chatmenu+rename:', JSON.stringify({ menuOpen, renamed }));

/* ---- Probe ⑤ 回归：两阶段广播 + 气泡操作 ---- */
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '发起任务：调研端侧模型最新进展（mock）');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-send:not(.is-stop)')?.click());
let teamState = null;
for (let t = 0; t < 20; t++) {
  await page.waitForTimeout(1000);
  teamState = await page.evaluate(() => ({
    msgs: document.querySelectorAll('.gtc-msg').length,
    claimTags: document.querySelectorAll('.gtc-phase-tag').length,
    actions: document.querySelectorAll('.gtc-msg-actions button').length,
    hint: !!document.querySelector('.gtc-pipeline-hint'),
    running: document.querySelectorAll('.gtc-msg.is-running').length,
  }));
  if (!teamState.hint && teamState.msgs >= 7 && !teamState.running) break;
}
// 点第一个「存素材」
await page.evaluate(() => [...document.querySelectorAll('.gtc-msg-actions button')].find(b => b.textContent === '存素材')?.click());
await page.waitForTimeout(600);
const savedMat = await page.evaluate(() => {
  const mats = JSON.parse(localStorage.getItem('materials') || '[]');
  const fromChat = mats.filter(m => m.source === '团队群聊');
  return { total: mats.length, fromChat: fromChat.length, lastTitle: fromChat[fromChat.length - 1]?.title?.slice(0, 24) || null };
});
console.log('probe5 team+actions:', JSON.stringify({ ...teamState, llmCalls, savedMat }));

console.log('PASS_CHECKS:', JSON.stringify({
  topbar: topbar.topbar && topbar.oldHeadGone && topbar.oldChatsBarGone && topbar.chatmenu && topbar.memberChips === 2 && topbar.inviteBtn && topbar.exportBtn && topbar.clearBtn,
  briefingFixed: topbar.briefingBottom !== null && topbar.briefingBottom <= topbar.viewportH && topbar.agentsTabFlex !== 'none',
  roleCard: cardOpen && profileSaved.profile?.style?.includes('毒舌') && cardEcho.includes('毒舌'),
  customRole: customSaved.roleCount >= 1 && customSaved.role?.name === '情报官' && customSaved.role?.hasStyle && customSaved.invited && customSaved.memberChips === 3,
  chatManage: menuOpen.pop && menuOpen.items >= 1 && menuOpen.renameBtn && menuOpen.dissolveBtn && menuOpen.newBtn && renamed === '端侧突击队',
  // 3 成员（含自定义角色情报官）：1 用户 + 3 认领 + 2 产出 = 6 气泡、5 次 LLM 调用
  teamPipeline: teamState.msgs >= 6 && teamState.claimTags >= 3 && teamState.actions >= 6 && llmCalls === 5,
  saveMaterial: savedMat.fromChat >= 1,
}));
console.log('pageerrors:', errors.length ? errors : 'none');

await page.evaluate(() => document.querySelectorAll('link[media="print"]').forEach(l => { l.media = 'all'; }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'screenshots/ws-v8-final.png', timeout: 10000 }).catch(() => {});
await browser.close();
