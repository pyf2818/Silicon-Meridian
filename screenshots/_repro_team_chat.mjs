// 复现：团队群聊 @ 发送不回复 —— mock /api/ai-generate SSE，驱动完整接力链路
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5175/';
const errors = [];
const consoleMsgs = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });

// mock LLM：一轮纯文本回复（无 tool_calls → 直接收敛出报告）
await page.route('**/api/ai-generate', async route => {
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: 'data: {"delta":"（mock）收到任务，这是探索者的回复。"}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n',
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
// 进团队群聊
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.includes('团队') || t.textContent.includes('Agent Team'))?.click();
});
await page.waitForTimeout(1200);
const inChat = await page.evaluate(() => ({
  gtc: !!document.querySelector('.gtc'),
  members: [...document.querySelectorAll('.gtc-member-name')].map(e => e.textContent),
}));
console.log('team chat opened:', JSON.stringify(inChat));

// 输入 @探索者 测试 并发送（模拟用户操作：原生 setter 触发 React onChange）
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '@探索者 检索一下端侧模型资讯');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(400);
// 从 mention 补全选一个（真实用户路径），或直接发送
const mentionPop = await page.evaluate(() => !!document.querySelector('.gtc-mention-pop'));
console.log('mention pop open:', mentionPop);
if (mentionPop) {
  await page.evaluate(() => document.querySelector('.gtc-mention-pop button')?.click());
  await page.waitForTimeout(300);
}
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, `${ta.value} 检索一下端侧模型资讯`.trim());
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.gtc-send:not(.is-stop)')?.click());

// 观测 6 秒内气泡变化
for (let t = 0; t < 6; t++) {
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => ({
    msgs: [...document.querySelectorAll('.gtc-msg')].map(el => ({
      cls: el.className.includes('is-user') ? 'user' : 'agent',
      running: el.className.includes('is-running'),
      text: (el.querySelector('.gtc-bubble-text')?.textContent || el.querySelector('.gtc-typing') ? (el.querySelector('.gtc-bubble-text')?.textContent || '(typing)') : '').slice(0, 40),
    })),
    pipelineHint: !!document.querySelector('.gtc-pipeline-hint'),
    sendDisabled: document.querySelector('.gtc-input')?.disabled ?? null,
  }));
  console.log(`t+${t + 1}s:`, JSON.stringify(state));
  if (state.msgs.length >= 3 && !state.pipelineHint) break;
}
console.log('console errors:', consoleMsgs.length ? consoleMsgs.slice(0, 6) : 'none');
console.log('pageerrors:', errors.length ? errors : 'none');
await page.screenshot({ path: 'screenshots/ws-team-repro.png', timeout: 10000 }).catch(() => {});
await browser.close();
