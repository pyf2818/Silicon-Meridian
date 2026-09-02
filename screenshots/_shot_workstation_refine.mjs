import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/workstation-refine';
const errors = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });

// 注入模拟数据：会话（含消息用于 hover 预览）、LLM 配置（启用输入与欢迎 chips）、素材
await ctx.addInitScript(() => {
  const now = Date.now();
  const mk = (id, title, mins, rounds) => ({
    id, title,
    createdAt: now - mins * 60000,
    updatedAt: now - mins * 60000,
    messages: [
      { role: 'user', content: `${title}——这是首条提问的完整内容，用于 hover 预览验证`, timestamp: now - mins * 60000 },
      ...Array.from({ length: rounds }, (_, i) => ({ role: 'assistant', content: `第 ${i + 1} 轮回复内容…`, timestamp: now - mins * 60000 + i * 1000 })),
    ],
  });
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    mk('s1', '今日情报总判断与机会雷达', 5, 2),
    mk('s2', 'OpenAI 因 Tumb… 分析素材库', 90, 3),
    mk('s3', '帮你总结本周 AI 竞争格局', 60 * 20, 1),
    mk('s4', '你是谁·分支', 60 * 24 * 3, 1),
    mk('s5', '今日识别到 3 个机会', 60 * 24 * 9, 2),
  ]));
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://api.test/v1', apiKey: 'sk-test', selectedModel: 'deepseek-v4-flash', webSearchEnabled: true }));
  localStorage.setItem('materials', JSON.stringify(
    Array.from({ length: 13 }, (_, i) => ({
      id: `mat_${i + 1}`,
      title: `素材条目 ${i + 1}：${['AI 芯片出口管制', '开源模型趋势', '竞争者定价策略', '供应链风险'][i % 4]}`,
      type: i % 2 ? 'knowledge' : 'material',
      source: ['AI精灵交接', '手动收藏', 'GitHub 评估'][i % 3],
      content: '示例内容摘要，用于弹层 title 预览。',
      createdAt: new Date(now - i * 3600_000).toISOString(),
    })),
  ));
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);

// 关闭新用户引导浮层（拦截点击）——只点 React 的跳过按钮，不能手动 remove DOM 节点
await page.evaluate(() => {
  document.querySelector('.onb-skip')?.click();
});
await page.waitForTimeout(1000);

// 直达 AI 工作站（home）
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button, a, [role=button]')]
    .find(el => /AI 工作站/.test(el.textContent || ''));
  if (btn) btn.click();
});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}-welcome.png` });

// 打开情报胶囊弹层
const intelPill = page.locator('.chat-context-pill-peek').first();
if (await intelPill.count()) {
  await intelPill.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}-peek.png` });
  // 切到素材弹层
  await page.locator('.chat-context-pill-peek').nth(1).click().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}-peek-material.png` });
  await page.keyboard.press('Escape');
}

// hover 会话项验证单行布局与操作浮层
const item = page.locator('.session-item').first();
if (await item.count()) await item.hover().catch(() => {});
await page.screenshot({ path: `${OUT}-final.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
