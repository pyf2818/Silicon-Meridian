// v6 验证：三模式收进输入框+真实现、附件迷你按钮、群聊 Markdown 渲染、侧栏群聊列表
import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1050 } })).newPage();
page.on('pageerror', e => errors.push(e.message));
const now = Date.now();
await page.route('**/api/ai-generate', route => route.fulfill({
  status: 200, headers: { 'Content-Type': 'text/event-stream' },
  body: 'data: {"delta":"## 调研结论\\n- **要点A**：端侧模型提速\\n- 要点B：成本下降\\n\\n> 结论：趋势向好\\n\\n```json\\n{\\"ok\\": true}\\n```\\n"}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":30,"total_tokens":42}}\n\ndata: [DONE]\n\n',
}));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://mock.local/v1', apiKey: 'k', selectedModel: 'mock-model', provider: 'custom', manualModels: [], webSearchEnabled: true }));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify({ chats: [
    { id: 'gc_a', name: '调研团队', createdAt: now, roster: ['explorer'], messages: [] },
    { id: 'gc_b', name: '创作团队', createdAt: now, roster: ['writer'], messages: [{ id: 'gm_x', role: 'user', agentId: '', agentName: '', content: '历史消息', at: now, status: 'done', meta: null }] },
  ], activeId: 'gc_a' }));
  localStorage.setItem('aiCopilotSessions', JSON.stringify([{ id: 's1', title: 'v6', spaceId: 'default', createdAt: now, updatedAt: now, messages: [] }]));
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

// ---- ① 三模式收进输入框 ----
const modeProbe1 = await page.evaluate(() => ({
  oldPills: !!document.querySelector('.chat-permission-mode'),
  modeChip: document.querySelector('.chat-mode-chip')?.textContent?.trim() || null,
  inInputArea: !!document.querySelector('.chat-input-area .chat-input-tools .chat-mode-chip'),
  attachMini: !!document.querySelector('.chat-input-tools .chat-attach-mini'),
  oldAttach: !!document.querySelector('.chat-input-main-row > .chat-attach-btn'),
}));
console.log('mode chip v6:', JSON.stringify(modeProbe1));
await page.evaluate(() => document.querySelector('.chat-mode-chip')?.click());
await page.waitForTimeout(400);
const modeMenu = await page.evaluate(() => [...document.querySelectorAll('.chat-mode-item strong')].map(e => e.textContent));
console.log('mode menu items:', JSON.stringify(modeMenu));
await page.evaluate(() => { [...document.querySelectorAll('.chat-mode-item strong')].find(e => e.textContent === '全自动')?.closest('button')?.click(); });
await page.waitForTimeout(350);
const modeProbe2 = await page.evaluate(() => ({
  chip: document.querySelector('.chat-mode-chip')?.textContent?.trim() || null,
  menuClosed: !document.querySelector('.chat-mode-pop'),
}));
console.log('after pick 全自动:', JSON.stringify(modeProbe2));
// 切回半自动（默认）
await page.evaluate(() => document.querySelector('.chat-mode-chip')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => { [...document.querySelectorAll('.chat-mode-item strong')].find(e => e.textContent === '半自动')?.closest('button')?.click(); });
await page.waitForTimeout(300);

// ---- ③ 侧栏群聊列表 ----
await page.evaluate(() => { [...document.querySelectorAll('.session-tab')].find(t => t.textContent.trim().startsWith('团队'))?.click(); });
await page.waitForTimeout(1000);
const sideChats = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.agents-chat-item .agents-chat-name')].map(e => e.textContent),
  active: document.querySelector('.agents-chat-item.active .agents-chat-name')?.textContent || null,
  counts: [...document.querySelectorAll('.agents-chat-item em')].map(e => e.textContent),
  hasNew: !!document.querySelector('.agents-chat-new'),
}));
console.log('sidebar chats:', JSON.stringify(sideChats));
// 切到创作团队 → 打开群聊页
await page.evaluate(() => { [...document.querySelectorAll('.agents-chat-item .agents-chat-name')].find(e => e.textContent === '创作团队')?.click(); });
await page.waitForTimeout(1200);
const switchProbe = await page.evaluate(() => ({
  gtc: !!document.querySelector('.gtc'),
  activeChip: document.querySelector('.gtc-chat-chip.active .gtc-chat-chip-name')?.textContent || null,
  msgCount: document.querySelectorAll('.gtc-msg').length,
}));
console.log('switch to 创作团队:', JSON.stringify(switchProbe));

// ---- ② 群聊 Markdown 渲染 ----
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '@撰写者 写一段总结');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-send:not(.is-stop)')?.click());
await page.waitForTimeout(3500);
const mdProbe = await page.evaluate(() => {
  const md = document.querySelector('.gtc-msg.is-agent .gtc-markdown');
  return {
    markdownRendered: !!md,
    hasH2: !!md?.querySelector('h2'),
    hasList: !!md?.querySelector('li'),
    hasBlockquote: !!md?.querySelector('blockquote'),
    hasCode: !!md?.querySelector('pre code'),
    plainTextBubbles: [...document.querySelectorAll('.gtc-msg.is-agent .gtc-bubble-text:not(.gtc-markdown)')].length,
  };
});
console.log('markdown in bubble:', JSON.stringify(mdProbe));
// 布局：stream 应占 flex 主体
const layoutProbe = await page.evaluate(() => {
  const gtc = document.querySelector('.gtc');
  const stream = document.querySelector('.gtc-stream');
  const head = document.querySelector('.gtc-head');
  return {
    streamH: Math.round(stream?.getBoundingClientRect().height || 0),
    headH: Math.round(head?.getBoundingClientRect().height || 0),
    gtcH: Math.round(gtc?.getBoundingClientRect().height || 0),
  };
});
console.log('layout heights:', JSON.stringify(layoutProbe));

await page.screenshot({ path: 'screenshots/ws-v6-final.png', timeout: 12000 }).catch(() => {});
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
