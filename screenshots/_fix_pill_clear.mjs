// 修复验证：文件胶囊「清除」按钮（原 setWorkspaceFiles 未定义崩溃）→ clearSpaceFiles
import { chromium } from 'playwright';
const BASE = process.env.PW_BASE || 'http://127.0.0.1:5176/';
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1050 } })).newPage();
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
const now = Date.now();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://mock.local/v1', apiKey: 'k', selectedModel: 'm', provider: 'custom', manualModels: [], webSearchEnabled: true }));
  localStorage.setItem('aiCopilotSessions', JSON.stringify([{ id: 's1', title: 't', spaceId: 'default', createdAt: now, updatedAt: now, messages: [] }]));
  localStorage.setItem('aiWorkstationSpaces', JSON.stringify({
    spaces: [{ id: 'default', name: '默认空间', createdAt: now, files: [
      { name: 'a.md', path: 'a.md', content: '# A' },
      { name: 'b.md', path: 'b.md', content: '# B' },
    ] }],
    activeSpaceId: 'default',
  }));
}, now);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a')]
      .find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12)?.click();
  });
  await page.waitForTimeout(2000);
  if (await page.locator('.session-sidebar').count() > 0) break;
}
await page.waitForTimeout(800);
const before = await page.evaluate(() => ({
  pill: [...document.querySelectorAll('.chat-context-pill-file')].map(p => p.textContent.trim().slice(0, 10)),
}));
// 点清除按钮（原崩溃点）
await page.evaluate(() => document.querySelector('.chat-context-pill-clear')?.click());
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({
  pillGone: document.querySelectorAll('.chat-context-pill-file').length === 0,
  pills: [...document.querySelectorAll('.chat-context-pill-file')].map(p => ({
    text: p.textContent.trim().slice(0, 10),
    visible: !!p.offsetParent,
    panelCls: p.closest('.ai-chat-panel')?.className?.slice(0, 80) || null,
  })),
  filesInStore: (JSON.parse(localStorage.getItem('aiWorkstationSpaces') || '{}').spaces?.[0]?.files || []).length,
  toast: document.querySelector('.workspace-toast')?.textContent || [...document.querySelectorAll('[class*="toast"]')].map(t => t.textContent).join('|').slice(0, 40) || null,
}));
console.log('before:', JSON.stringify(before));
console.log('after:', JSON.stringify(after));
console.log('PASS:', before.pill.length === 1 && after.pillGone && after.filesInStore === 0);
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
