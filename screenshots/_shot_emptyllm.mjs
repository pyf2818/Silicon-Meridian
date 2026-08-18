import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5175/';
const browser = await chromium.launch({ headless: true });
// 全新上下文：无 localStorage → 无 LLM 配置 → 应渲染无 LLM 行动型空态
const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-warn:', e.message));
await page.waitForTimeout(2800);

const info = await page.evaluate(() => {
  const empty = document.querySelector('.chat-empty-llm');
  const welcome = document.querySelector('.chat-welcome');
  return {
    url: location.href,
    hasEmptyLlm: !!empty,
    hasWelcome: !!welcome,
    hasPrimaryCta: !!document.querySelector('.app-btn--primary'),
    hasGhostCta: !!document.querySelector('.app-btn--ghost'),
    hasLinkCta: !!document.querySelector('.app-btn--link'),
    emptyText: empty ? empty.innerText.replace(/\s+/g, ' ').slice(0, 360) : null,
    loginGate: !!document.querySelector('input[type="password"], .login-form, [data-testid="login"]'),
    bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
  };
});
console.log('DOM_INFO=' + JSON.stringify(info, null, 2));
console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 8), null, 2));

await page.screenshot({ path: 'screenshots/empty-llm-real.png', fullPage: false });
console.log('screenshot saved: screenshots/empty-llm-real.png');
await browser.close();
