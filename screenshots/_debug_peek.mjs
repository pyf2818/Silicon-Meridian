import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'https://api.test/v1', apiKey: 'sk-test', selectedModel: 'test-model', webSearchEnabled: true }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.waitForTimeout(800);
await page.evaluate(() => {
  [...document.querySelectorAll('button, a')].find(el => /AI 工作站/.test(el.textContent || ''))?.click();
});
await page.waitForTimeout(1500);

const pillCount = await page.locator('.chat-context-pill-peek').count();
console.log('peek pills:', pillCount);
if (pillCount > 0) {
  await page.locator('.chat-context-pill-peek').first().click();
  await page.waitForTimeout(300);
  const peekCount = await page.locator('.chat-context-peek').count();
  console.log('popover rendered:', peekCount);
  const info = await page.evaluate(() => {
    const p = document.querySelector('.chat-context-peek');
    if (!p) return 'no element';
    const cs = getComputedStyle(p);
    const rect = p.getBoundingClientRect();
    return { display: cs.display, position: cs.position, zIndex: cs.zIndex, rect: `${rect.x},${rect.y},${rect.width}x${rect.height}`, items: p.querySelectorAll('.chat-context-peek-item').length };
  });
  console.log('popover info:', JSON.stringify(info));
  await page.screenshot({ path: 'screenshots/workstation-refine-peek.png' });
}
await browser.close();
