import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 } })).newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[console.${msg.type()}]`, msg.text().slice(0, 500));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  document.querySelector('.onb-skip')?.click();
  document.querySelector('.onb-overlay')?.remove();
  const btn = [...document.querySelectorAll('button, a, [role=button]')]
    .find(el => /AI 工作站/.test(el.textContent || ''));
  if (btn) btn.click();
});
await page.waitForTimeout(3000);
console.log('boundary:', await page.evaluate(() => document.body.textContent.includes('应用暂未就绪')));
await browser.close();
