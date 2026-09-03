// v3 验证：空间×本地文件（文件模块跟随空间） + Agent Team 群聊
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5175/';
const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => {
  const now = Date.now();
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    { id: 's1', title: '空间A的会话', messages: [], createdAt: now, updatedAt: now, spaceId: 'default' },
    { id: 's2', title: '空间B的会话', messages: [], createdAt: now, updatedAt: now, spaceId: 'sp_b' },
  ]));
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify({
    spaces: [
      { id: 'default', name: '默认空间', createdAt: now },
      { id: 'sp_b', name: '创作空间', createdAt: now },
    ],
    activeSpaceId: 'default',
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a')]
      .find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12)?.click();
  });
  await page.waitForTimeout(2500);
  opened = await page.locator('.session-sidebar').count() > 0;
  if (!opened) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500); }
}
console.log('workstation opened:', opened);

// ---- A. 文件模块跟随空间 ----
const fileTab = async () => {
  await page.evaluate(() => {
    [...document.querySelectorAll('.session-tab')].find(t => t.textContent.trim() === '文件')?.click();
  });
  await page.waitForTimeout(700);
  return page.evaluate(() => ({
    spaceTag: document.querySelector('.workspace-space-tag')?.textContent || null,
    pathName: document.querySelector('.workspace-path-name')?.textContent || null,
    emptyTitle: document.querySelector('.workspace-empty-title')?.textContent || null,
  }));
};
const fileA = await fileTab();
console.log('files in 默认空间:', JSON.stringify(fileA));

// 切换到创作空间（对话 tab 点空间行切换激活）
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.trim() === '对话')?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  [...document.querySelectorAll('.space-row-main')].find(el => el.textContent.includes('创作空间'))?.click();
});
await page.waitForTimeout(500);
const fileB = await fileTab();
console.log('files in 创作空间:', JSON.stringify(fileB));

// ---- B. Agent Team 群聊 ----
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.includes('Agent Team'))?.click();
});
await page.waitForTimeout(1000);
const chatOpen = await page.evaluate(() => ({
  gtc: !!document.querySelector('.gtc'),
  empty: !!document.querySelector('.gtc-empty'),
  inviteBtn: !!document.querySelector('.gtc-invite-btn'),
}));
console.log('group chat opened:', JSON.stringify(chatOpen));

// 邀请两名成员
await page.evaluate(() => document.querySelector('.gtc-invite-btn')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  [...document.querySelectorAll('.gtc-invite-menu button')].find(b => b.textContent.includes('探索者'))?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-invite-btn')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  [...document.querySelectorAll('.gtc-invite-menu button')].find(b => b.textContent.includes('撰写者'))?.click();
});
await page.waitForTimeout(400);
const rosterProbe = await page.evaluate(() => ({
  members: [...document.querySelectorAll('.gtc-member-name')].map(e => e.textContent),
}));
console.log('roster:', JSON.stringify(rosterProbe));

// @ 补全：输入 @ 弹出成员选择
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '你好 @');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(400);
const mentionProbe = await page.evaluate(() => ({
  pop: !!document.querySelector('.gtc-mention-pop'),
  options: [...document.querySelectorAll('.gtc-mention-pop b')].map(e => e.textContent),
}));
console.log('mention pop:', JSON.stringify(mentionProbe));

// 点选成员补全
await page.evaluate(() => {
  [...document.querySelectorAll('.gtc-mention-pop button')].find(b => b.textContent.includes('探索者'))?.click();
});
await page.waitForTimeout(300);
const filled = await page.evaluate(() => document.querySelector('.gtc-input')?.value);
console.log('after pick mention:', JSON.stringify(filled));

// 执行记录视图切换
await page.evaluate(() => [...document.querySelectorAll('.gtc-records-btn')].find(el => el.offsetParent !== null)?.click());
await page.waitForTimeout(900);
const recordsProbe = await page.evaluate(() => ({
  records: !!document.querySelector('.team-center'),
  presets: document.querySelectorAll('.team-preset-card').length,
}));
console.log('records view:', JSON.stringify(recordsProbe));
await page.screenshot({ path: 'screenshots/ws-team-records-v3.png', timeout: 10000 }).catch(() => {});

// 返回群聊截图
await page.evaluate(() => {
  [...document.querySelectorAll('.team-center-back')].find(b => b.textContent.includes('返回群聊'))?.click();
});
await page.waitForTimeout(600);
const backProbe = await page.evaluate(() => ({ gtc: !!document.querySelector('.gtc'), members: document.querySelectorAll('.gtc-member').length }));
console.log('back to chat:', JSON.stringify(backProbe));
await page.evaluate(() => document.querySelector('.gtc-stream')?.scrollIntoView());
await page.screenshot({ path: 'screenshots/ws-team-chat.png', timeout: 10000 }).catch(() => {});

await ctx.close();
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
