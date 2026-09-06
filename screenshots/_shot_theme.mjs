/** 方案 B 改造前基准截图：champagne dark/light + neon light（混搭现状存证）+ 改造后同位对比 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'screenshots/theme-b';
fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || 'before';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
  localStorage.setItem('materials', JSON.stringify([
    { id: 'm1', type: 'viewpoint', title: '端侧模型趋势观察', content: '端侧推理速度持续提升。', tags: ['端侧'], source: '手动', createdAt: Date.now(), starred: true },
  ]));
});
const page = await ctx.newPage();
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

const shoot = async (palette, mode, name) => {
  await page.evaluate(([p, m]) => {
    document.documentElement.dataset.palette = p;
    document.documentElement.dataset.mode = m;
  }, [palette, mode]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  // 取样关键 token 实际值，验证一致性
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      accent: cs.getPropertyValue('--accent-cyan').trim(),
      border: cs.getPropertyValue('--border-color').trim(),
      sidebarBg: getComputedStyle(document.querySelector('.sidebar') || document.body).background.slice(0, 60),
    };
  });
  console.log(`${tag}-${name}:`, JSON.stringify(tokens));
};

await shoot('champagne', 'dark', 'champagne-dark-home');
await shoot('champagne', 'light', 'champagne-light-home');
// 素材管理页 light（卡片/侧栏感知强）
await page.locator('.nav-primary-item', { hasText: '素材管理' }).first().click();
await page.waitForTimeout(700);
await shoot('champagne', 'light', 'champagne-light-materials');
// neon light —— 混搭重灾区
await shoot('neon', 'dark', 'neon-dark-home');
await shoot('neon', 'light', 'neon-light-materials');
// arctic light
await shoot('arctic', 'light', 'arctic-light-materials');

await browser.close();
console.log('done');
