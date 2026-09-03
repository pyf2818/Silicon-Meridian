// v5 验证：多群聊管理 + 模型切换弹层 + 上下文进度环 + 点状节点 + 当前任务卡移除
import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1050 } })).newPage();
page.on('pageerror', e => errors.push(e.message));
const now = Date.now();
await page.route('**/api/ai-generate', route => route.fulfill({
  status: 200, headers: { 'Content-Type': 'text/event-stream' },
  body: 'data: {"delta":"（mock）回复。"}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n',
}));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://mock.local/v1', apiKey: 'k', selectedModel: 'mock-model', provider: 'custom', manualModels: ['gpt-4o', 'claude-sonnet-4'], webSearchEnabled: true }));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify({ roster: ['explorer', 'writer'], messages: [] }));
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    { id: 's1', title: 'v5', spaceId: 'default', createdAt: now, updatedAt: now,
      messages: [
        { role: 'user', content: '第一条用户消息，用于验证点状节点导航是否正常渲染' },
        { role: 'assistant', content: '回复一' },
        { role: 'user', content: '第二条消息' },
        { role: 'assistant', content: '回复二' },
      ] },
  ]));
}, now);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { [...document.querySelectorAll('button, a')].find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12)?.click(); });
  await page.waitForTimeout(2300);
  if (await page.locator('.session-sidebar').count() > 0) break;
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3200);
}

// ---- ② 当前任务卡移除 + ③ 模型胶囊/进度环 ----
const composerProbe = await page.evaluate(() => ({
  topcard: !!document.querySelector('.agent-topcard'),
  modelChip: document.querySelector('.chat-model-name')?.textContent || null,
  ringPct: document.querySelector('.chat-ctx-ring em')?.textContent || null,
  composerPad: getComputedStyle(document.querySelector('.chat-composer')).padding,
}));
console.log('composer v5:', JSON.stringify(composerProbe));
// 模型切换弹层
await page.evaluate(() => document.querySelector('.chat-model-chip')?.click());
await page.waitForTimeout(450);
const modelMenu = await page.evaluate(() => ({
  open: !!document.querySelector('.chat-model-menu'),
  models: [...document.querySelectorAll('.chat-model-item-name')].map(e => e.textContent),
  selected: document.querySelector('.chat-model-item.selected .chat-model-item-name')?.textContent || null,
  manage: !!document.querySelector('.chat-model-manage'),
}));
console.log('model menu:', JSON.stringify(modelMenu));
await page.evaluate(() => { [...document.querySelectorAll('.chat-model-item-name')].find(e => e.textContent === 'gpt-4o')?.closest('button')?.click(); });
await page.waitForTimeout(400);
const afterSwitch = await page.evaluate(() => ({
  chip: document.querySelector('.chat-model-name')?.textContent || null,
  stored: JSON.parse(localStorage.getItem('llmConfig') || '{}')?.selectedModel,
  menuClosed: !document.querySelector('.chat-model-menu'),
}));
console.log('after model switch:', JSON.stringify(afterSwitch));

// ---- ④ 点状节点 ----
const railProbe = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.chat-side-rail-node')];
  const first = nodes[0];
  const bar = first?.querySelector('.chat-side-rail-bar');
  const bs = bar ? getComputedStyle(bar) : null;
  return {
    nodes: nodes.length,
    dotShape: bs ? { w: bs.width, h: bs.height, radius: bs.borderRadius } : null,
    uniform: nodes.every(n => Math.round(n.getBoundingClientRect().width) === Math.round(nodes[0].getBoundingClientRect().width)),
  };
});
console.log('rail dots:', JSON.stringify(railProbe));
await page.hover('.chat-side-rail-node >> nth=0');
await page.waitForTimeout(400);
const railTip = await page.evaluate(() => ({
  tip: !!document.querySelector('.chat-side-rail-tip'),
  text: document.querySelector('.chat-side-rail-tip-text')?.textContent?.slice(0, 20) || null,
}));
console.log('rail hover tip:', JSON.stringify(railTip));
await page.mouse.move(500, 400);

// ---- ① 多群聊管理 + 接力回复 ----
await page.evaluate(() => { [...document.querySelectorAll('.session-tab')].find(t => t.textContent.trim().startsWith('团队'))?.click(); });
await page.waitForTimeout(1300);
// 新建第二个群聊
await page.evaluate(() => document.querySelector('.gtc-chat-new')?.click());
await page.waitForTimeout(500);
const chatsProbe1 = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.gtc-chat-chip-name')].map(e => e.textContent),
  active: document.querySelector('.gtc-chat-chip.active .gtc-chat-chip-name')?.textContent || null,
  members: [...document.querySelectorAll('.gtc-member-name')].map(e => e.textContent),
}));
console.log('after create chat2:', JSON.stringify(chatsProbe1));
// 群聊2 里 @探索者 发送 → mock 回复
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '@探索者 测试接力');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-send:not(.is-stop)')?.click());
await page.waitForTimeout(3500);
const relayProbe = await page.evaluate(() => ({
  msgs: [...document.querySelectorAll('.gtc-msg')].map(el => ({
    user: el.className.includes('is-user'),
    text: (el.querySelector('.gtc-bubble-text')?.textContent || '').slice(0, 24),
  })),
}));
console.log('relay in chat2:', JSON.stringify(relayProbe));
// 切回群聊1（隔离验证：消息不串）
await page.evaluate(() => { [...document.querySelectorAll('.gtc-chat-chip-name')].find(e => e.textContent === '团队群聊')?.click(); });
await page.waitForTimeout(500);
const chat1Probe = await page.evaluate(() => ({
  active: document.querySelector('.gtc-chat-chip.active .gtc-chat-chip-name')?.textContent || null,
  msgCount: document.querySelectorAll('.gtc-msg').length,
}));
console.log('switch back chat1:', JSON.stringify(chat1Probe));
// 重命名群聊2
await page.evaluate(() => { [...document.querySelectorAll('.gtc-chat-chip-name')].find(e => e.textContent === '新团队群聊 2')?.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.gtc-chat-chip.active .gtc-chat-chip-act')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const input = document.querySelector('.gtc-chat-chip.is-editing input');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '创作团队');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
});
await page.waitForTimeout(400);
const renameProbe = await page.evaluate(() => [...document.querySelectorAll('.gtc-chat-chip-name')].map(e => e.textContent));
console.log('after rename:', JSON.stringify(renameProbe));
// 删除群聊2（两次点击确认）
await page.evaluate(() => document.querySelector('.gtc-chat-chip.active .gtc-chat-chip-act.is-danger')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-chat-chip.active .gtc-chat-chip-act.is-danger')?.click());
await page.waitForTimeout(500);
const delProbe = await page.evaluate(() => [...document.querySelectorAll('.gtc-chat-chip-name')].map(e => e.textContent));
console.log('after delete:', JSON.stringify(delProbe));

await page.screenshot({ path: 'screenshots/ws-v5-final.png', timeout: 12000 }).catch(() => {});
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
