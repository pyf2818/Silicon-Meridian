/**
 * 验收 v15 四项：
 * ① 无限画布点击后侧栏聚焦（.active）
 * ② 画布/广场/团队聊天顶部无语言切换器（.lang-switcher）
 * ③ 多会话并行流式：A 会话生成中可切到 B 发消息并行跑；侧栏双运行标记；切回 A 仍在跑
 * ④ 停/发单按钮；排队按钮在输入框上方；弹层可编辑/排序/删除排队消息
 * 用 Playwright 路由拦截 /api/ai-generate，回延迟 SSE，行为完全确定。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/v15';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });

// 模拟流式接口：6 秒后才结束的 SSE（给并行测试留足时间）
await page.route('**/api/ai-generate', async (route) => {
  await new Promise(r => setTimeout(r, 6000));
  const body = 'data: ' + JSON.stringify({ delta: '模拟回复。' }) + '\n\n';
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: body + 'data: [DONE]\n\n',
  });
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
// 自愈：vite 冷启动首屏偶发资源未就绪，检测到未渲染导航则重载一次
let navCount = await page.evaluate(() => document.querySelectorAll('.nav-primary-item').length);
if (!navCount) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  navCount = await page.evaluate(() => document.querySelectorAll('.nav-primary-item').length);
  if (!navCount) {
    console.log('STILL EMPTY. BODY:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
    console.log('CONSOLE ERRORS:', errors);
    await page.screenshot({ path: `${OUT}/v15-debug-boot.png` });
  }
}
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

/* ---- ① 侧栏聚焦 ---- */
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(600);
const focusCheck = await page.evaluate(() => {
  const active = document.querySelector('.nav-primary-item.active');
  return { activeLabel: active?.textContent?.trim() || null };
});
console.log('FOCUS:', JSON.stringify(focusCheck));

/* ---- ② 语言切换器 ---- */
const langCheck = {};
for (const nav of ['无限画布', '用户广场', '团队聊天']) {
  await page.locator('.nav-primary-item', { hasText: nav }).first().click();
  await page.waitForTimeout(500);
  langCheck[nav] = await page.evaluate(() => document.querySelectorAll('.lang-switcher').length);
}
console.log('LANG SWITCHER (应全为 0):', JSON.stringify(langCheck));

/* ---- ③④ 并行流式 + 队列 ---- */
await page.locator('.nav-primary-item', { hasText: 'AI 工作站' }).first().click();
await page.waitForTimeout(800);

// 会话 A：发第一条（走 8s 慢流）→ 进入生成中
await page.locator('.chat-input').fill('会话A的问题');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const aRunning = await page.evaluate(() => ({
  stopBtn: Boolean(document.querySelector('.chat-stop-btn')),
  sendBtn: Boolean(document.querySelector('.chat-send-btn')),
  sidebarRunning: document.querySelectorAll('.session-dot.running').length,
}));
console.log('A RUNNING:', JSON.stringify(aRunning));

// 排队一条到 A（生成中输入自动排队）
await page.locator('.chat-input').fill('会话A排队消息一');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
// 再排一条
await page.locator('.chat-input').fill('会话A排队消息二');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);

// 队列按钮在输入框上方 + 弹层管理
const queueBtn = page.locator('.chat-queue-btn');
console.log('QUEUE BTN visible:', await queueBtn.isVisible(), '| text:', await queueBtn.textContent());
await queueBtn.click();
await page.waitForTimeout(400);
const queuePop = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.chat-queue-item-text')].map(x => x.textContent),
  aboveInput: (() => {
    const btn = document.querySelector('.chat-queue-btn')?.getBoundingClientRect();
    const input = document.querySelector('.chat-input')?.getBoundingClientRect();
    return btn && input ? btn.bottom <= input.top + 2 : false;
  })(),
}));
console.log('QUEUE POP:', JSON.stringify(queuePop));
await page.screenshot({ path: `${OUT}/v15-queue-pop.png` });

// 编辑第一条 + 上移第二条
await page.locator('.chat-queue-item-acts button[title="二次编辑"]').first().click();
await page.locator('.chat-queue-item-edit').fill('会话A排队消息一（已改）');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.locator('.chat-queue-item-acts button[title="下移（延后发送）"]').first().click();
await page.waitForTimeout(300);
const queueAfter = await page.evaluate(() => [...document.querySelectorAll('.chat-queue-item-text')].map(x => x.textContent));
console.log('QUEUE AFTER EDIT/REORDER:', JSON.stringify(queueAfter));
await page.keyboard.press('Escape');

// 切到新会话 B（新对话按钮）→ B 发消息 → 并行：A、B 双运行标记
await page.locator('.session-new-btn').click();
await page.waitForTimeout(500);
await page.locator('.chat-input').fill('会话B的问题');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const parallelCheck = await page.evaluate(() => ({
  sidebarRunningDots: document.querySelectorAll('.session-dot.running').length,
  stopInB: Boolean(document.querySelector('.chat-stop-btn')),
}));
console.log('PARALLEL:', JSON.stringify(parallelCheck));
await page.screenshot({ path: `${OUT}/v15-parallel.png` });

// 切回 A：A 仍在生成（stop 可见）→ 停止 → A 的队列被清空
const sessionItems = page.locator('.session-item');
const count = await sessionItems.count();
for (let i = 0; i < count; i += 1) {
  const title = await sessionItems.nth(i).locator('.session-item-title').textContent();
  if (title?.includes('会话A的问题')) {
    await sessionItems.nth(i).click();
    break;
  }
}
await page.waitForTimeout(500);
const backInA = await page.evaluate(() => ({
  stopVisible: Boolean(document.querySelector('.chat-stop-btn')),
  runningDots: document.querySelectorAll('.session-dot.running').length,
}));
console.log('BACK IN A:', JSON.stringify(backInA));
await page.locator('.chat-stop-btn').click();
await page.waitForTimeout(500);
const afterStop = await page.evaluate(() => ({
  runningDots: document.querySelectorAll('.session-dot.running').length,
  queueBtnGone: !Boolean(document.querySelector('.chat-queue-btn')),
  stoppedMark: Boolean(document.querySelector('.chat-stopped-mark')),
  sendBack: Boolean(document.querySelector('.chat-send-btn')),
}));
console.log('AFTER STOP:', JSON.stringify(afterStop));
await page.screenshot({ path: `${OUT}/v15-stopped.png` });

console.log('PAGEERRORS:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
