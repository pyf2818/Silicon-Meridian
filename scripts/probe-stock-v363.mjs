// v36.3 股市页三改 E2E：
// ① 顶部仅「AI 早报」直开按钮（下拉消失）+ 主图卡右上角 AI 诊断入口
// ② 早报历史预览渲染个股数据图卡（种子 meta.snapshots）
// ③ 诊断历史只读视图重现图表（种子 metrics/klinesSnapshot → .pro-chart-svg）
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const doLogin = async () => fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
let loginRes = await doLogin();
if (loginRes.status === 401) {
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
  });
  loginRes = await doLogin();
}
const setCookie = loginRes.headers.get('set-cookie') || '';
const sessionValue = setCookie.split(';')[0].split('=').slice(1).join('=');
if (!sessionValue) { console.error('登录失败', loginRes.status); process.exit(1); }
log('登录 OK');

// 种子数据：诊断历史（含图表快照）+ 早报历史（含个股图卡快照）
const seedKlines = Array.from({ length: 60 }, (_, i) => ({
  date: `2026-08-${String((i % 30) + 1).padStart(2, '0')}`,
  close: Math.round((100 + i * 0.8 + Math.sin(i) * 2) * 100) / 100,
  volume: 90000 + i * 500,
}));
const diagSeed = [{
  id: 'e2e-diag-seed', code: 'sz300502', name: '新易盛', mode: 'ai', status: 'ready',
  rating: '强势', risk: 'medium', price: 147, tokens: 888,
  content: '## 结论\n测试用诊断内容：处于第二阶段上升趋势，回踩 MA20 企稳可关注。\n\n## 买卖参考价和时间\n| 动作 | 参考价 |\n| 买入触发 | 150.5 |',
  metrics: { price: 147, ma5: 145.2, ma10: 143.1, ma20: 140.5, atr14: 3.2, momentum5: 2.4, assetReturn20: 12.5, benchmarkReturn20: 4.2, excessReturn20: 8.3, drawdown: 6.1, volatility: 28.4, position20: 88, volumeTrend: 'expanding', support: 138.5, resistance: 152 },
  bullCase: ['站上 MA20 且多头排列', '20期超额收益 +8.3%'],
  bearCase: ['RSI(14) 68 接近超买'],
  invalidation: ['收盘跌破 138.5 支撑'],
  riskSignals: ['年化波动率 28.4%'],
  dataQuality: { bars: 60, benchmark: { code: 'sh000001', name: '上证指数' } },
  klinesSnapshot: seedKlines,
  at: Date.now() - 3600_000,
}];
const briefSeed = [{
  id: 'e2e-brief-seed', content: '## 一、执行摘要\n测试早报内容。市场整体偏暖。\n## 四、重点个股操作建议\n### 新易盛(sz300502)｜建议：持有\n判断：趋势向上但短线超买（倾向于）。\n数据依据：MA5 145.2 上穿 MA20 140.5。\n触发价位：回踩 145 附近可加仓，跌破 138.5 作废。', at: Date.now() - 7200_000,
  generatedAt: new Date(Date.now() - 7200_000).toISOString(),
  meta: {
    coverage: '行情样本', stockCount: 30, sectorCount: 12, tokens: 1500,
    snapshots: [
      { code: 'sz300502', name: '新易盛', fromWatchlist: true, price: 453.66, changePct: -0.29, amount: '85.3亿', closes: seedKlines.map(k => k.close), volumes: seedKlines.map(k => k.volume), rating: '强势', risk: 'medium', ma5: 145.2, ma10: 143.1, ma20: 140.5, rsi14: 61.3, momentum5: 2.4, support: 138.5, resistance: 152, volumeTrend: 'expanding', volatility: 28.4 },
      { code: 'sh600519', name: '中际旭创', fromWatchlist: false, price: 930, changePct: 0.25, amount: '62.1亿', closes: seedKlines.map(k => Math.round(k.close * 6.2 * 100) / 100), volumes: seedKlines.map(k => k.volume), rating: '强势', risk: 'low', ma5: 921, ma10: 915, ma20: 908, rsi14: 55, momentum5: 1.2, support: 890, resistance: 960, volumeTrend: 'stable', volatility: 22 },
    ],
  },
}];

const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, reducedMotion: 'reduce' });
await context.addCookies([{ name: 'meridian_session', value: sessionValue, domain: 'localhost', path: '/' }]);
await context.addInitScript(({ diag, brief }) => {
  localStorage.setItem('stockDiagnosisHistoryV1', JSON.stringify(diag));
  localStorage.setItem('stockBriefingHistoryV1', JSON.stringify(brief));
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', selectedModel: 'mock-fast', provider: 'custom' }));
}, { diag: diagSeed, brief: briefSeed });

const page = await context.newPage();
const diagLogs = [];
page.on('pageerror', e => diagLogs.push(`[pageerror] ${String(e).slice(0, 300)}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
const onboarding = page.getByRole('dialog', { name: '新用户引导' });
if (await onboarding.isVisible().catch(() => false)) {
  await onboarding.getByRole('button', { name: '跳过引导' }).click();
  await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
}

// 进入股市页
const stockNav = page.locator('[data-nav="stock"]').first();
try {
  await stockNav.click({ timeout: 10_000 });
} catch {
  // 兜底：快捷键 g→s（App.jsx 快捷导航）
  await page.keyboard.press('g');
  await page.keyboard.press('s');
}
await page.waitForTimeout(2500);
await page.screenshot({ path: 'v363-stock-1-landing.png', timeout: 10_000 });

// ── 断言 1：顶部只有「AI 早报」直开按钮，无下拉菜单 ──
const headerBriefBtn = await page.locator('header .stock-ai-action', { hasText: 'AI 早报' }).count();
const menuGone = await page.locator('.stock-ai-menu').count();
log(`① 顶部按钮：「AI 早报」× ${headerBriefBtn}（须=1）；旧下拉 .stock-ai-menu × ${menuGone}（须=0）`);

// ── 断言 2：主图卡右上角 AI 诊断入口存在且可打开抽屉 ──
const diagEntry = await page.locator('.stock3-chart-head .stock-diag-entry').count();
log(`② 主图卡右上角 AI 诊断入口 × ${diagEntry}（须=1）`);
if (diagEntry > 0) await page.locator('.stock3-chart-head .stock-diag-entry').first().click();
await page.waitForTimeout(600);
const drawerOpen = await page.locator('.stock-diag-drawer').count();
log(`② 点击入口 → 诊断抽屉打开 × ${drawerOpen}（须=1）`);
await page.screenshot({ path: 'v363-stock-2-drawer.png', timeout: 10_000 });

// ── 断言 3：诊断历史只读视图重现图表 ──
let historyCharts = 0;
let historyMetrics = 0;
if (drawerOpen > 0) {
  await page.locator('.stock-diag-tabs button', { hasText: '历史记录' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.stock-diag-history .stock-briefing-history-open').first().click();
  await page.waitForTimeout(600);
  historyCharts = await page.locator('.stock-diag-viewing .pro-chart-svg').count();
  historyMetrics = await page.locator('.stock-diag-viewing .stock-metrics-group').count();
  log(`③ 历史预览：ProCharts SVG × ${historyCharts}（须>0）指标网格组 × ${historyMetrics}（须>0）`);
  await page.screenshot({ path: 'v363-stock-3-history-charts.png', timeout: 10_000 });
  await page.locator('.stock-diag-close').first().click();
} else {
  log('③ 抽屉未打开，跳过历史图表断言');
}

// ── 断言 4：早报历史预览渲染个股数据图卡 ──
let bcardCount = 0;
let sparkCount = 0;
await page.locator('header .stock-ai-action').first().click();
await page.waitForTimeout(500);
await page.locator('.stock-briefing-tabs button', { hasText: '历史归档' }).first().click();
await page.waitForTimeout(300);
await page.locator('.stock-briefing-history .stock-briefing-history-open').first().click();
await page.waitForTimeout(600);
bcardCount = await page.locator('.stock-briefing-card').count();
sparkCount = await page.locator('.stock-bcard-spark').count();
log(`④ 早报历史预览：数据图卡 × ${bcardCount}（须=2）走势 sparkline × ${sparkCount}（须=2）`);
await page.screenshot({ path: 'v363-stock-4-briefing-cards.png', timeout: 10_000 });

await browser.close();
const ok = headerBriefBtn === 1 && menuGone === 0 && diagEntry === 1 && drawerOpen === 1
  && historyCharts > 0 && historyMetrics > 0 && bcardCount === 2 && sparkCount === 2;
log(ok ? 'PASS ✅' : `FAIL ❌ brief=${headerBriefBtn} menuGone=${menuGone} entry=${diagEntry} drawer=${drawerOpen} histCharts=${historyCharts} histMetrics=${historyMetrics} cards=${bcardCount} sparks=${sparkCount}`);
if (diagLogs.length) log('诊断:', diagLogs.slice(-5).join(' | '));
process.exit(ok ? 0 : 3);
