/** 验收：AI 精灵窗口布局（单栏：头部/消息流/输入框不互相挤兑） */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
  // 预置几条对话，验证消息流布局
  localStorage.setItem('ai-elf-agent-messages', JSON.stringify([
    { role: 'user', content: '这个项目怎么配置大模型？', timestamp: Date.now() - 60000 },
    { role: 'assistant', content: '打开「设置 → 大模型」：填 Base URL 和 API Key，点「拉取模型」选择模型，最后「测试连接」确认连通。', timestamp: Date.now() - 50000 },
    { role: 'user', content: '画布做的工作流在哪里用？', timestamp: Date.now() - 40000 },
    { role: 'assistant', content: '在 AI 工作站输入框左下角的「工作流」按钮里选择画布搭建的工作流，蓝图会自动填入输入框。', timestamp: Date.now() - 30000 },
  ]));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

await page.locator('.ai-elf-avatar').first().click();
await page.waitForTimeout(700);

const checks = await page.evaluate(() => {
  const win = document.querySelector('.ai-elf-chat-window');
  const header = document.querySelector('.ai-elf-header');
  const body = document.querySelector('.ai-elf-chat-body');
  const input = document.querySelector('.ai-elf-chat-input-area');
  const wr = win?.getBoundingClientRect();
  const hr = header?.getBoundingClientRect();
  const br = body?.getBoundingClientRect();
  const ir = input?.getBoundingClientRect();
  const dir = win ? getComputedStyle(win).flexDirection : null;
  return {
    flexDirection: dir, // 应为 column
    stacked: hr && br && ir ? (hr.bottom <= br.top + 2 && br.bottom <= ir.top + 2) : false, // 头上/中/下依次堆叠
    headerInside: hr && wr ? hr.top >= wr.top && hr.bottom <= wr.bottom : false,
    inputInside: ir && wr ? ir.bottom <= wr.bottom + 2 : false,
    msgCount: document.querySelectorAll('.ai-elf-message').length,
    headerButtons: document.querySelectorAll('.ai-elf-header .ai-elf-btn').length,
    windowSize: wr ? `${Math.round(wr.width)}x${Math.round(wr.height)}` : null,
  };
});
console.log('ELF LAYOUT:', JSON.stringify(checks, null, 2));
await page.screenshot({ path: 'screenshots/v14/v14-elf-fixed.png' });
console.log('PAGEERRORS:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
