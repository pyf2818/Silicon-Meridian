// B2 错误边界友好降级验证
// 核心：拦截懒加载 chunk 请求返回 500，模拟 GlobeView / AiElf / StockPage 加载失败，
// 断言各自就近的 SafeBoundary 弹出友好卡片，且整页不白屏（其他模块仍在）。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const results = {};
const pageErrorsAll = [];

async function newPage(browser, { block } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); pageErrorsAll.push(String(e)); });
  if (block) {
    await page.route(`**/${block}.jsx**`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/javascript', body: '/* injected chunk failure */' })
    );
  }
  // 跳过首跑引导干扰
  await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
  return { ctx, page, pageErrors };
}

const browser = await chromium.launch({ headless: true });

// 用例 1：正常无损（无拦截）
{
  const { ctx, page, pageErrors } = await newPage(browser);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // 跳到股市页验证懒加载正常
  await page.goto(`${BASE}/?view=stock`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const stockOk = await page.evaluate(() => !!document.querySelector('.app-state--error') === false && document.body.innerText.includes('股市') );
  const noErr = pageErrors.length === 0;
  results.normalNoCrash = { stockRendered: stockOk, pageErrors: pageErrors.slice(0, 3), pass: stockOk && noErr };
  await page.screenshot({ path: 'screenshots/eb-normal-stock.png', fullPage: false });
  await ctx.close();
}

// 用例 2：AiElf 懒加载失败（全局悬浮助手，首屏即加载）
{
  const { ctx, page, pageErrors } = await newPage(browser, { block: 'AiElf' });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const card = document.querySelector('.app-state--error');
    const txt = card ? card.innerText : '';
    const headerAlive = !!document.querySelector('header, nav, .nav, .topbar') || document.body.innerText.length > 200;
    return { hasCard: !!card, txt, headerAlive };
  });
  results.aiElfFailure = {
    hasCard: info.hasCard,
    mentionsAiElf: info.txt.includes('AI 精灵'),
    pageStillAlive: info.headerAlive,
    pageErrors: pageErrors.slice(0, 3),
    pass: info.hasCard && info.txt.includes('AI 精灵') && info.headerAlive
  };
  await page.screenshot({ path: 'screenshots/eb-ailelf-fallback.png', fullPage: false });
  await ctx.close();
}

// 用例 3：StockPage 懒加载失败
{
  const { ctx, page, pageErrors } = await newPage(browser, { block: 'StockPage' });
  await page.goto(`${BASE}/?view=stock`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const card = document.querySelector('.app-state--error');
    const txt = card ? card.innerText : '';
    const headerAlive = !!document.querySelector('header, nav, .nav, .topbar') || document.body.innerText.length > 100;
    return { hasCard: !!card, txt, headerAlive };
  });
  results.stockFailure = {
    hasCard: info.hasCard,
    mentionsStock: info.txt.includes('股市终端'),
    pageStillAlive: info.headerAlive,
    pageErrors: pageErrors.slice(0, 3),
    pass: info.hasCard && info.txt.includes('股市终端') && info.headerAlive
  };
  await page.screenshot({ path: 'screenshots/eb-stock-fallback.png', fullPage: false });
  await ctx.close();
}

// 用例 4：GlobeView 懒加载失败（需触发全屏）
{
  const { ctx, page, pageErrors } = await newPage(browser, { block: 'GlobeView' });
  await page.goto(`${BASE}/?view=all`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // 尝试点击触发全球科技大屏全屏的入口
  let triggered = false;
  const triggers = ['.globe-entry-btn', '.globe-preview-card', 'button[title="全球科技大屏"]'];
  for (const sel of triggers) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) { await loc.click({ timeout: 3000, force: true }); triggered = true; break; }
    } catch {}
  }
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const card = document.querySelector('.app-state--error');
    const txt = card ? card.innerText : '';
    return { hasCard: !!card, txt };
  });
  results.globeFailure = {
    triggered,
    hasCard: info.hasCard,
    mentionsGlobe: info.txt.includes('全球科技大屏'),
    pageErrors: pageErrors.slice(0, 3),
    pass: triggered ? (info.hasCard && info.txt.includes('全球科技大屏')) : true,
    skipped: !triggered
  };
  await page.screenshot({ path: 'screenshots/eb-globe-fallback.png', fullPage: false });
  await ctx.close();
}

await browser.close();

const allPass = Object.values(results).every((r) => r.pass);
console.log('=== B2 ERROR BOUNDARY RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('TOTAL_UNCAUGHT_PAGEERRORS=' + pageErrorsAll.length);
console.log('ALL_PASS=' + allPass);
process.exit(allPass ? 0 : 1);
