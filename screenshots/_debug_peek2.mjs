import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://api.test/v1', apiKey: 'sk-test', selectedModel: 'test-model', webSearchEnabled: true }));
});
const page = await ctx.newPage();
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.waitForTimeout(800);
await page.evaluate(() => {
  [...document.querySelectorAll('button, a')].find(el => /AI 工作站/.test(el.textContent || ''))?.click();
});
await page.waitForTimeout(1500);
await page.locator('.chat-context-pill-peek').first().click();
await page.waitForTimeout(400);
const diag = await page.evaluate(() => {
  const p = document.querySelector('.chat-context-peek');
  const cs = getComputedStyle(p);
  // 找出所有祖先的 overflow 与 opacity
  const chain = [];
  let el = p;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    chain.push({ cls: (el.className || el.tagName).toString().slice(0, 40), overflow: s.overflow, opacity: s.opacity, display: s.display, zIndex: s.zIndex, position: s.position });
    el = el.parentElement;
  }
  const rect = p.getBoundingClientRect();
  const painted = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return { opacity: cs.opacity, visibility: cs.visibility, bg: cs.backgroundColor, chain, paintedAtCenter: painted ? `${painted.className || painted.tagName}`.slice(0, 60) : 'none' };
});
console.log(JSON.stringify(diag, null, 1));
await browser.close();
