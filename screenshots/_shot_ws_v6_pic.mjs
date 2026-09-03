import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1050 } })).newPage();
const now = Date.now();
await page.route('**/api/ai-generate', route => route.fulfill({
  status: 200, headers: { 'Content-Type': 'text/event-stream' },
  body: 'data: {"delta":"## 调研结论\\n- **要点A**：端侧模型推理速度持续提升\\n- 要点B：小模型成本下降明显\\n\\n> 结论：端侧趋势向好，建议持续跟踪。\\n"}\n\ndata: [DONE]\n\n',
}));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://mock.local/v1', apiKey: 'k', selectedModel: 'mock-model', provider: 'custom', manualModels: [], webSearchEnabled: true }));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify({ chats: [
    { id: 'gc_a', name: '调研团队', createdAt: now, roster: ['explorer', 'writer'], messages: [] },
    { id: 'gc_b', name: '创作团队', createdAt: now, roster: ['writer'], messages: [] },
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
await page.evaluate(() => { [...document.querySelectorAll('.session-tab')].find(t => t.textContent.trim().startsWith('团队'))?.click(); });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '@探索者 调研端侧模型现状，@撰写者 整理成简报');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => document.querySelector('.gtc-send:not(.is-stop)')?.click());
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.chat-mode-chip')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelectorAll('link[media="print"]').forEach(l => { l.media = 'all'; }); }); await page.waitForTimeout(2500); await page.screenshot({ path: 'screenshots/ws-v6-final.png', timeout: 15000 });
console.log('saved');
await browser.close();
