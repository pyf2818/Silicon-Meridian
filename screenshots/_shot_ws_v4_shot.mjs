import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
const now = Date.now();
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  const mk = (role, content) => ({ role, content });
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    { id: 's1', title: 'v4 验证', spaceId: 'default', createdAt: now, updatedAt: now,
      messages: [mk('user','帮我分析一下当前 AI 芯片市场的最新格局和主要玩家的动向'), mk('assistant','好的……'), mk('user','那国产替代的进度呢？列出关键时间点'), mk('assistant','……'), mk('user','短消息节点')] }] ));
  localStorage.setItem('materials', JSON.stringify([
    { id: 'mat_a', title: 'AI 芯片周报素材A', content: '内容A', type: 'report', source: '内部' },
    { id: 'mat_b', title: '英伟达财报速览B', content: '内容B', type: 'news', source: '外部' },
    { id: 'mat_c', title: '端侧模型观察C', content: '内容C', type: 'note', source: '内部' }]));
  localStorage.setItem('aiWorkstationQuickCommands', JSON.stringify([
    { id: 'qc_demo', label: '周报生成', prompt: '把本轮对话要点整理成周报格式输出' }]));
}, now);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { [...document.querySelectorAll('button, a')].find(el => /AI 工作站|工作站/.test((el.textContent||'').trim()) && (el.textContent||'').length < 12)?.click(); });
  await page.waitForTimeout(2200);
  if (await page.locator('.session-sidebar').count() > 0) break;
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3200);
}
// 打开快捷指令弹层 + 素材弹层（排除态）
await page.evaluate(() => document.querySelector('.chat-quick-btn')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('.chat-quick-btn')?.click());
await page.evaluate(() => { [...document.querySelectorAll('.chat-context-pill-peek')].find(p => p.textContent.includes('素材'))?.click(); });
await page.waitForTimeout(500);
// 排除 1 条制造对比
await page.evaluate(() => {
  const el = document.querySelectorAll('.chat-context-peek-item')[0];
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
});
await page.evaluate(() => [...document.querySelectorAll('.chat-context-peek-act')].find(a => a.textContent.includes('排除'))?.click());
await page.waitForTimeout(400);
// hover 一个波浪节点
await page.hover('.chat-side-rail-node >> nth=0');
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/ws-v4-composer.png', timeout: 12000 });
console.log('shot saved');
await browser.close();
