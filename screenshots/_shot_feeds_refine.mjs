import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5175/';
const errors = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.waitForTimeout(800);

// 注入兴趣领域 + 注册登录（cookie 会话），以便看到精准推荐真实流
await page.evaluate(() => {
  localStorage.setItem('selectedInterests', JSON.stringify(['ai-models', 'chips-compute']));
});
const login = await page.request.post(`${BASE}api/auth/register`, {
  data: { username: `preview_${Date.now().toString(36)}`, password: 'Preview#2026', email: 'preview@test.local' },
}).catch(() => null);
console.log('register:', login ? login.status() : 'failed');
if (login && login.ok()) {
  const data = await login.json().catch(() => ({}));
  if (data?.token || data?.user) {
    // register 可能直接建立会话（Set-Cookie）；再补一个 interests 上报
    await page.request.post(`${BASE}api/user/interests`, { data: { interests: ['ai-models', 'chips-compute'] } }).catch(() => {});
  }
}
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());

const goto = async (label) => {
  await page.evaluate((text) => {
    const btn = [...document.querySelectorAll('button, a, [role=button]')]
      .find(el => (el.textContent || '').trim().startsWith(text));
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(2500);
};

await goto('精准推荐');
await page.screenshot({ path: 'screenshots/feeds-refine-precision.png' });

await goto('全部动态');
await page.screenshot({ path: 'screenshots/feeds-refine-discover.png' });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
