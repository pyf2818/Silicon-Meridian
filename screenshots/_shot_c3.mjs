// C3 列表与滚动节奏统一验证：
// 1) 修复静默失效——@keyframes fadeUp 必须已定义（此前仅 styles.css.bak 存在，当前生效 CSS 缺失）
// 2) 列表/卡片/行内揭示的 animation 时长+缓动收敛到 C1 token，保留各自 animation-name
// 3) 主信息流首屏 nth-child 错落生效
// 4) 全站 7 页游走 0 异常
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const results = {};
const pageErrors = [];
const norm = (s) => (s || '').replace(/\s+/g, '');
const EASE = 'cubic-bezier(0.16,1,0.3,1)';

const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push('c3:' + e));
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// 1) 证明 @keyframes fadeUp 已被定义（修复静默失效的根因）
const fadeUpDefined = await page.evaluate(() => {
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'fadeUp') return true;
    }
  }
  return false;
});

// 2) 注入列表/卡片节点，在浏览器上下文内读取收敛后的 animation 属性
const s = await page.evaluate(() => {
  const rd = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { dur: cs.animationDuration, timing: cs.animationTimingFunction, name: cs.animationName, fill: cs.animationFillMode, delay: cs.animationDelay };
  };
  const host = document.createElement('div');
  host.id = 'c3-host';
  host.style.cssText = 'position:fixed;left:-9999px;top:0;';
  host.innerHTML = `
    <div class="news-item news-item-visible"></div>
    <div class="github-card"></div>
    <div class="chat-msg"></div>
    <div class="approval-card"></div>
    <div class="ai-summary"></div>
    <div class="st-pipe-node"></div>
    <div class="feed-list">
      <div class="news-item news-item-visible"></div>
      <div class="news-item news-item-visible"></div>
      <div class="news-item news-item-visible"></div>
    </div>`;
  document.body.appendChild(host);
  return {
    newsItem: rd('#c3-host .news-item.news-item-visible'),
    githubCard: rd('#c3-host .github-card'),
    chatMsg: rd('#c3-host .chat-msg'),
    approvalCard: rd('#c3-host .approval-card'),
    aiSummary: rd('#c3-host .ai-summary'),
    stNode: rd('#c3-host .st-pipe-node'),
    feed2: rd('#c3-host .feed-list .news-item.news-item-visible:nth-child(2)'),
    feed3: rd('#c3-host .feed-list .news-item.news-item-visible:nth-child(3)'),
  };
});

const easeOk = (x) => x && norm(x.timing).includes(norm(EASE));
const checks = {
  fadeUpDefined,
  newsItem: s.newsItem && s.newsItem.name === 'fadeUp' && s.newsItem.dur === '0.32s' && easeOk(s.newsItem) && s.newsItem.fill === 'both',
  githubCard: s.githubCard && s.githubCard.name === 'fadeUp' && s.githubCard.dur === '0.32s' && easeOk(s.githubCard),
  chatMsg: s.chatMsg && s.chatMsg.name === 'chatMsgIn' && s.chatMsg.dur === '0.22s' && easeOk(s.chatMsg),
  approvalCard: s.approvalCard && s.approvalCard.name === 'approval-card-in' && s.approvalCard.dur === '0.14s' && easeOk(s.approvalCard),
  aiSummary: s.aiSummary && s.aiSummary.name === 'fadeUp' && s.aiSummary.dur === '0.14s' && easeOk(s.aiSummary),
  stNode: s.stNode && s.stNode.name === 'stNodeIn' && s.stNode.dur === '0.5s' && easeOk(s.stNode),
  feedStagger: s.feed2 && s.feed2.delay === '0.05s' && s.feed3 && s.feed3.delay === '0.1s',
};

results.fadeUpDefined = fadeUpDefined;
results.samples = s;
results.checks = checks;

// 3) 真实 GitHub 卡片页截图（验证卡片网格入场已修复且生效）
const pG = await browser.newContext().then((c) => c.newPage());
pG.on('pageerror', (e) => pageErrors.push('gh:' + e));
await pG.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await pG.goto(`${BASE}/?view=github`, { waitUntil: 'networkidle' });
await pG.waitForTimeout(1200);
await pG.screenshot({ path: 'screenshots/c3-github.png' });
await pG.context().close();

// 4) 全站走查无异常
const ctx3 = await browser.newContext();
const p3 = await ctx3.newPage();
p3.on('pageerror', (e) => pageErrors.push('walk:' + e));
await p3.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
for (const v of ['home', 'all', 'stock', 'github', 'studio', 'profile-center', 'monitor']) {
  await p3.goto(`${BASE}/?view=${v}`, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(700);
}
results.walk = { pages: 7 };
await ctx3.close();

await browser.close();
results.pageErrors = pageErrors.slice(0, 5);
results.allPass = Object.values(checks).every(Boolean) && pageErrors.length === 0;
console.log('=== C3 RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('ALL_PASS=' + results.allPass + ' ERRORS=' + pageErrors.length);
process.exit(results.allPass ? 0 : 1);
