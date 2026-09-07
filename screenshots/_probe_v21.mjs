/**
 * v21 视觉探针 v3 —— 结构化验证
 *  #19 资讯预览排版（mock /api/fetch-page：lede/分段/图片穿插）+ 情报解读块
 *  #20 情报雷达（真实数据）
 *  #21 竞争监测条目 clickable + hover + 点击开预览（多关键词轮询）
 *  #22 股票专业模式（研究工具弹窗 3 个 AI 按钮 + 诊断后 pro-charts 含走势图）
 * 运行：PW_OUT=.pw-v21 node screenshots/_probe_v21.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'http://127.0.0.1:9', apiKey: 'probe-key', selectedModel: 'probe-model' }));
  localStorage.setItem('stockExperienceMode', 'pro');
  localStorage.setItem('meridian_onboarding_done', 'true');
  localStorage.setItem('onboarding_done', 'true');
  localStorage.setItem('hasSeenOnboarding', 'true');
});
// mock 正文抓取 + mock 图片（保证 hero/穿插图稳定渲染）
const articleText = Array.from({ length: 8 }, (_, i) =>
  `第${i + 1}段：这是一段用于验证资讯预览排版层级的正文内容，行距、字号、首段强调与配图穿插都应当在此正确体现，内容长度足够被聚合成段落。`
).join('　');
await ctx.route('**/api/fetch-page*', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: articleText, images: ['https://mockimg.example/hero.png', 'https://mockimg.example/extra.png'] }),
}));
await ctx.route('**mockimg.example**', route => route.fulfill({
  status: 200, contentType: 'image/png',
  body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
}));

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
try { const c = await page.$('button.collapse-btn'); if (c) await c.click(); } catch {}

/* ===== #19 资讯预览排版 + 情报解读块 ===== */
const p19 = await page.evaluate(async () => {
  const mod = await import('/src/store/newsPreviewStore.js');
  mod.useNewsPreviewStore.getState().open({
    id: 'probe-19',
    title: '探针测试：长文排版验证',
    summary: '摘要段落',
    source: '探针源',
    url: 'https://probe.example.com/article-19',
    publishedAt: new Date().toISOString(),
    imageUrl: '',
    insight: {
      headline: '综合评分 88 ｜ 影响 90 · 热度 72',
      lines: ['影响力 90 高于热度 72：实质导向信号。', '已有 4 家独立信源报道，交叉验证充分。'],
      entities: ['探针实体A', '探针实体B'],
    },
  });
  await new Promise(r => setTimeout(r, 900));
  const lede = document.querySelector('.news-preview-para.lede');
  const insight = document.querySelector('.news-preview-insight');
  return {
    paraCount: document.querySelectorAll('.news-preview-para').length,
    ledeBorder: lede ? getComputedStyle(lede).borderLeftWidth : null,
    paraFont: document.querySelector('.news-preview-para') ? getComputedStyle(document.querySelector('.news-preview-para')).fontSize : null,
    paraLineHeight: document.querySelector('.news-preview-para') ? getComputedStyle(document.querySelector('.news-preview-para')).lineHeight : null,
    heroFigure: Boolean(document.querySelector('.news-preview-figure.hero')),
    insightHead: insight?.querySelector('.news-preview-insight-score')?.textContent || '',
    insightLines: insight?.querySelectorAll('p').length || 0,
    insightEntities: insight?.querySelectorAll('.news-preview-insight-entities span').length || 0,
  };
});
console.log('#19 预览排版+解读块:', JSON.stringify(p19));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ===== #20 情报雷达 ===== */
await page.locator('.nav-primary-item', { hasText: '精准推荐' }).first().click().catch(() => {});
for (let i = 0; i < 9; i++) {
  const has = await page.evaluate(() => Boolean(document.querySelector('.intel-radar-lead') || document.querySelector('.intelligence-feed-empty')));
  if (has) break;
  await page.waitForTimeout(2000);
}
const p20 = await page.evaluate(() => {
  const lead = document.querySelector('.intel-radar-lead');
  const rows = [...document.querySelectorAll('.intel-radar-row')];
  const ring = lead?.querySelector('.intel-radar-lead-score');
  return {
    panelExists: Boolean(document.querySelector('.intelligence-feed-panel')),
    leadTitle: lead?.querySelector('.intel-radar-lead-title')?.textContent?.slice(0, 30) || '',
    hasRing: Boolean(ring),
    ringConic: ring ? getComputedStyle(ring).background.includes('conic-gradient') : false,
    listRows: rows.length,
    barsInRow: rows[0]?.querySelectorAll('.intel-radar-bar').length || 0,
  };
});
console.log('#20 情报雷达:', JSON.stringify(p20));
if (p20.leadTitle) {
  const p20click = await page.evaluate(async () => {
    document.querySelector('.intel-radar-lead').click();
    await new Promise(r => setTimeout(r, 600));
    return {
      opened: Boolean(document.querySelector('[class*="news-preview"]')),
      head: document.querySelector('.news-preview-insight-score')?.textContent || '',
    };
  });
  console.log('#20 榜首点击→预览+解读:', JSON.stringify(p20click));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

/* ===== #21 竞争监测：多关键词轮询找到有匹配的卡 ===== */
await page.locator('.nav-primary-item', { hasText: '竞争监测' }).first().click();
await page.waitForTimeout(1200);
let p21 = { skipped: true };
const hasAdd = await page.evaluate(() => Boolean(document.querySelector('.monitor-add .monitor-input')));
if (hasAdd) {
  const keywords = ['AI', 'OpenAI', '大模型', '模型', '芯片', '智能', '数据', '芯片'];
  for (const kw of keywords) {
    await page.fill('.monitor-input', kw); await page.waitForTimeout(1400);
    await page.locator('.monitor-add-btn').click();
    await page.waitForTimeout(700);
    const cards = await page.evaluate(() => document.querySelectorAll('.monitor-card').length);
    if (cards === 0) continue;
    // 卡片级验证：先点卡片头部（中心点可能落在 match 上，那是 match 预览行为，也有效）
    p21 = await page.evaluate(async () => {
      const card = document.querySelector('.monitor-card');
      const match = card.querySelector('.monitor-match.clickable');
      if (!match) return { note: '该卡无 match', cardTitle: card.querySelector('.monitor-card-keyword')?.textContent };
      match.click();
      await new Promise(r => setTimeout(r, 800));
      const previewOpened = Boolean(document.querySelector('[class*="news-preview"]'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise(r => setTimeout(r, 400));
      return { cardTitle: card.querySelector('.monitor-card-keyword')?.textContent, matchCount: card.querySelectorAll('.monitor-match.clickable').length, matchClickOpensPreview: previewOpened };
    });
    if (p21.matchClickOpensPreview !== undefined) {
      // 抽屉验证：点卡片头部开抽屉 → 点抽屉条目开预览
      await page.locator('.monitor-card-head').first().click();
      await page.waitForTimeout(900);
      const drawer = await page.evaluate(async () => {
        const items = [...document.querySelectorAll('.monitor-drawer-item')];
        const clickable = items.filter(i => i.classList.contains('clickable'));
        let hover = null;
        let clickOpens = false;
        if (clickable[0]) {
          const before = getComputedStyle(clickable[0]).transform;
          window.__probeHoverTarget = clickable[0];
          hover = { pending: true };
          clickable[0].click();
          await new Promise(r => setTimeout(r, 800));
          clickOpens = Boolean(document.querySelector('[class*="news-preview"]'));
        }
        return { drawerItems: items.length, clickableCount: clickable.length, hint: Boolean(clickable[0]?.querySelector('.monitor-drawer-item-hint')), hover, clickOpens };
      });
      p21 = { ...p21, ...drawer };
      // 样式表断言：.monitor-drawer-item:hover 与 .monitor-match:hover 存在 transform/背景变化
      p21.hoverCss = await page.evaluate(() => {
        const find = (sel) => {
          for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            for (const r of rules) {
              if (r.selectorText && r.selectorText.includes(sel) && r.selectorText.includes(':hover') && /transform|background/.test(r.cssText)) return r.selectorText;
            }
          }
          return null;
        };
        return { drawerItemHover: find('.monitor-drawer-item'), matchHover: find('.monitor-match') };
      });
      break;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  if (p21.skipped) p21 = { note: '所有关键词均无匹配条目（新闻池数据依赖）' };
} else p21 = { note: '监测页未渲染输入框' };
console.log('#21 监测条目点击预览:', JSON.stringify(p21));
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(250);

/* ===== #22 股票专业模式 ===== */
await page.locator('.nav-primary-item', { hasText: '股市' }).first().click().catch(() => {});
await page.waitForTimeout(1600);
await page.evaluate(() => { [...document.querySelectorAll('button[role="tab"]')].find(t => t.textContent === '专业')?.click(); });
await page.waitForTimeout(600);
const modalOpened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(el => el.textContent.includes('研究工具'));
  if (btn) { btn.click(); return true; }
  return false;
});
await page.waitForTimeout(700);
const p22modal = { modalOpened };
if (modalOpened) {
  for (const tabName of ['情景推演', '研究清单', '假设账本']) {
    const r = await page.evaluate(async (name) => {
      const tab = [...document.querySelectorAll('.stock-research-modal-tabs button')].find(t => t.textContent === name);
      if (!tab) return { found: false };
      tab.click();
      await new Promise(r2 => setTimeout(r2, 350));
      const btn = document.querySelector('.stock-ai-fill-btn');
      return { found: true, btnText: btn?.textContent.trim() || '', disabled: btn ? btn.disabled : null };
    }, tabName);
    p22modal[tabName] = JSON.stringify(r);
  }
}
console.log('#22 研究工具弹窗:', JSON.stringify(p22modal));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// 诊断 + 图表（分时周期下也应出走势图：diagKlines 修复验证）
await page.evaluate(() => { document.querySelector('.stock-ai-run')?.click(); });
await page.waitForTimeout(9000);
const p22charts = await page.evaluate(() => {
  const charts = document.querySelector('.pro-charts');
  return {
    diagnosisReady: Boolean(document.querySelector('.stock-ai-text')?.textContent?.trim()),
    chartsRendered: Boolean(charts),
    chartBlocks: document.querySelectorAll('.pro-chart-block').length,
    trendSvg: Boolean(charts?.querySelector('.pro-chart-svg')),
    trendLineStroke: charts?.querySelector('polyline')?.getAttribute('style')?.slice(0, 50) || '',
    trendColorIsSignal: /--signal-(critical|positive)/.test(charts?.querySelector('.pro-chart-svg')?.getAttribute('style') || ''),
    evidenceTrack: Boolean(document.querySelector('.pro-evidence-track')),
    benchRows: Boolean(document.querySelector('.pro-bench-rows')),
  };
});
console.log('#22 专业图表:', JSON.stringify(p22charts));

console.log('PAGEERRORS:', JSON.stringify(errs));
await b.close();
