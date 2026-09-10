/**
 * v27 探针：阅读画像 / 资讯趋势 重构后的渲染回归
 *
 * 覆盖本轮两处重构的**运行时**路径（单测只覆盖纯函数，渲染链必须 UI 验证）：
 *  1. App.jsx 的 trendData 抽到 domain/intelligence/trendAnalytics.js
 *  2. useIntelligenceMemos 里 105 行的阅读画像复制版 → profileModel.computeReadingProfile，
 *     展示层 label 映射 → profileModel.withInterestLabels
 *
 * 验证链：
 *  A. 用户画像 →「行为洞察」→ ProfileInsightsSection（computeReadingProfile 的直接消费者）
 *  B. 资讯页 → .news-item（trendAnalytics.computeNewsTrends 的消费方 App.jsx trendData 不受影响）
 *  C. 全局健康（pageerror / 降级卡片 / console）
 *
 * ⚠️ 为什么没有「链路：InsightDashboardPage」：
 *  该页（692 行 / 37.6KB）只由 App.jsx:2695 的
 *  `nav === 'briefing' || 'tracker' | 'trends' | 'reading-stats'` 分支渲染，而 nav 的
 *  全部写入点（?view= 白名单校验、goNav、setNav 字面量）都不可能产出这四个值
 *  —— NAV_ITEMS（12 项）不含它们，NAV_GROUPS（唯一列这四个值的常量）零引用。
 *  即该页当前**不可达**，无法用 UI 探针验证（尝试过：侧栏不存在对应入口）。
 *  故 withInterestLabels 改由 src/utils/__tests__/profileModel.test.js 的 4 条单测覆盖。
 *
 * 关键设计：先注入 8 条书签（localStorage 'bookmarks'），否则各区块因无数据不渲染，
 * 探针会「假通过」（已实测：注入后 MARKS 指标由 0 变 8）。注入数据是**确定性**的，
 * 因此下列画像断言可以写死期望值，而不是「> 0」这种软断言。
 *
 * 用法：PROBE_BASE=http://127.0.0.1:5176 node scripts/v27-profile-trend-refactor-probe.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5176';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// ---------------------------------------------------------------------------
// 注入数据 → 期望值的推导（全部可手算，探针里写死用于交叉验证）
// daysAgo = i % 5，hour = 8 + i（i = 1..8）：
//   day0: 1 条   day1: 2 条   day2: 2 条   day3: 2 条   day4: 1 条
//   → streak = 5（day0..day4 连续，day5 断）
//   hour 覆盖 9..16 各一次 → peakHour = 9（'09'）
//   category: ai×3 / dev×2 / chip×2 / web×1 → topInterests 4 项，首位 ai
//   source: Anthropic×3 / Rust×3 / OpenAI×2 → topSources 3 项
//   isRead: i % 3 !== 0 → 6/8 → readRate = 75%
// ---------------------------------------------------------------------------
const EXPECT = { streak: '5', peak: '09', interestDims: '4', readRate: '75%' };

await page.addInitScript(() => {
  try {
    localStorage.setItem('meridian_onboarded', '1');
    localStorage.setItem('sidebarCollapsed', 'false');
    const at = (daysAgo, hour) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, 15, 0, 0);
      return d.toISOString();
    };
    const rows = [];
    for (let i = 1; i <= 8; i += 1) {
      rows.push({
        itemId: `probe-${i}`, id: `probe-${i}`, title: `探针条目 ${i}`,
        category: ['ai', 'ai', 'dev', 'chip', 'web', 'ai', 'dev', 'chip'][i - 1],
        source: ['OpenAI Blog', 'Anthropic News', 'Rust Blog'][i % 3],
        tags: ['gpu', 'llm'], isRead: i % 3 !== 0,
        readAt: at(i % 5, 8 + i), summary: 'x'.repeat(80 + i * 30),
        url: `https://example.com/${i}`,
      });
    }
    localStorage.setItem('bookmarks', JSON.stringify(rows));
  } catch { /* ignore */ }
});

const waitFor = async (selector, timeout = 15000) => {
  try { await page.waitForSelector(selector, { timeout }); return true; } catch { return false; }
};
const clickRole = async (name, timeout = 15000) => {
  try {
    await page.getByRole('button', { name, exact: true }).first().click({ timeout });
    return true;
  } catch { return false; }
};
const count = (sel) => page.locator(sel).count();
const texts = async (sel) => (await page.locator(sel).allTextContents()).map((t) => t.trim());

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);
  check('首屏渲染出 .app 根容器', (await count('.app')) > 0);

  // ══════ 链路 A：ProfileInsightsSection（computeReadingProfile 直接消费） ══════
  await page.locator('text=用户画像').first().click({ timeout: 10000 }).catch(() => {});
  check('进入用户画像页', await waitFor('.profile-center-page'));
  check('画像分区导航已渲染', await waitFor('.profile-section-rail-item'));

  const railClicked = await clickRole('行为洞察');
  const insightsOk = await waitFor('.profile-insights');
  check('切到「行为洞察」并渲染 ProfileInsightsSection', railClicked && insightsOk);

  const teleCells = await count('.pa-tele-grid > *');
  check('行为洞察遥测带渲染 5 格', teleCells === 5, `${teleCells} 格`);

  // —— 硬断言：注入数据的期望值，逐项对照 ——
  const teleValues = await texts('.pa-tele-value');
  check(`遥测『连续阅读』= 注入数据的真实 streak（${EXPECT.streak}）`, teleValues[0] === EXPECT.streak,
    `实际 ${teleValues[0]}`);
  check(`遥测『峰值时段』= 注入数据的真实 peakHour（${EXPECT.peak}）`, teleValues[1] === EXPECT.peak,
    `实际 ${teleValues[1]}`);
  check(`遥测『兴趣维度』= 注入的 4 个赛道（${EXPECT.interestDims}）`, teleValues[2] === EXPECT.interestDims,
    `实际 ${teleValues[2]}`);

  // 阅读趋势面板：有数据时必须画图，而不是落「空态」（这是 hasData 分支的判据）
  const trendEmpty = await count('.pi-panel-trend .pa-empty');
  const trendSvg = await count('.pi-panel-trend .hud-linechart-svg');
  check('阅读趋势面板未落空态（hasData 分支生效）', trendEmpty === 0);
  check('阅读趋势 30 天折线图已渲染（trendData/day30）', trendSvg === 1, `${trendSvg} 个 svg`);

  const trendMeta = (await page.locator('.pi-panel-trend .pa-panel-meta').first().textContent().catch(() => '')) || '';
  const metaStreak = Number((trendMeta.match(/连续\s*(\d+)\s*天/) || [])[1]);
  check('趋势面板抬头显示真实 streak（非「等待数据」）', metaStreak === Number(EXPECT.streak),
    trendMeta.trim() || '（空）');

  // 兴趣分布三联条：证明 topInterests 有真实内容，且不是空态
  const interestRows = await count('.pa-grid-trio > .pa-panel:nth-child(1) .pi-bar-row');
  const interestNames = await texts('.pa-grid-trio > .pa-panel:nth-child(1) .pi-bar-name');
  check('兴趣分布渲染 4 条加权条（topInterests 非空）', interestRows === 4, `${interestRows} 条`);
  check('兴趣分布首位为 ai（排序正确）', interestNames[0] === 'ai', interestNames.join('、') || '（空）');

  // 会话派生区块仍然是空态——这是**预期**的（没有对话数据），
  // 用它反证上面的断言没有把整页空态误判成「有数据」
  const conversationEmpties = await count('.pa-empty');
  check('对话派生区块仍为空态（无对话数据，符合预期）', conversationEmpties > 0, `${conversationEmpties} 处`);

  // ══════ 链路 B：资讯主链（trendAnalytics 抽取后不受影响） ══════
  await page.locator('text=全部动态').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const newsCards = await count('.news-item');
  check('资讯页渲染出 .news-item 卡片', newsCards > 0, `${newsCards} 张`);

  check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || ') || '无');
  check('无降级错误卡片（.app-state--error）', (await count('.app-state--error')) === 0);
  const fatal = consoleErrors.filter((t) => !/401|403|Failed to load resource|ERR_/i.test(t));
  check('无（非鉴权/网络类）console error', fatal.length === 0, fatal.slice(0, 2).join(' || ') || '无');
} catch (err) {
  check('探针执行未抛异常', false, err?.message || String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) console.log('失败项：\n' + failed.map((f) => `  - ${f.name} (${f.detail})`).join('\n'));
process.exit(failed.length ? 1 : 0);
