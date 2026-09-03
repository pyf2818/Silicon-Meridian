// 认知星图视觉验证：注入 mock 行为数据 → 打开用户画像 → 浅/深双模截图
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:5175/';
const errors = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());

// ---- 注入 mock 行为数据 ----
await page.evaluate(() => {
  const CATS = ['ai-models', 'chips-compute', 'robotics', 'policy', 'business'];
  const SOURCES = ['机器之心', '量子位', 'TechCrunch', 'The Verge', '半导体行业观察', 'Ars Technica'];
  const TAGS = ['大模型', 'GPU', '端侧推理', 'Agent', '具身智能', '出口管制', '融资', '开源', '多模态', '算力', 'RAG', '芯片制程'];
  const pick = (arr, i) => arr[i % arr.length];
  const iso = (daysAgo, hour) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 10 + (daysAgo % 40), 0, 0);
    return d.toISOString();
  };

  const bookmarks = [];
  for (let i = 0; i < 64; i++) {
    const daysAgo = Math.floor((i * 0.47) % 30);
    const hour = [0, 1, 8, 9, 12, 13, 20, 21, 22, 23][i % 10];
    bookmarks.push({
      id: `bm${i}`,
      title: `资讯样本 ${i}`,
      category: pick(CATS, i * 3),
      source: pick(SOURCES, i * 5),
      readAt: iso(daysAgo, hour),
      isRead: i % 3 !== 0,
      tags: [pick(TAGS, i), pick(TAGS, i + 4)],
      summary: i % 2 ? 'x'.repeat(240) : 'y'.repeat(80),
    });
  }
  localStorage.setItem('bookmarks', JSON.stringify(bookmarks));

  const materials = Array.from({ length: 17 }, (_, i) => ({
    id: `mt${i}`, title: `素材 ${i}`, category: pick(CATS, i), source: pick(SOURCES, i + 1), tags: [pick(TAGS, i + 2)],
  }));
  localStorage.setItem('materials', JSON.stringify(materials));

  const readingHistory = Array.from({ length: 148 }, (_, i) => ({
    id: `rh${i}`,
    title: `已读 ${i}`,
    category: pick(CATS, i * 7),
    source: pick(SOURCES, i * 3),
    readAt: iso(i % 30, [7, 9, 11, 14, 19, 21, 23][i % 7]),
    tags: [pick(TAGS, i + 1)],
  }));
  localStorage.setItem('siliconstream-behavior-store', JSON.stringify({
    state: {
      readingHistory,
      recommendationFeedback: {
        hiddenIds: ['h1', 'h2'], boostedCategories: { 'ai-models': 3 }, mutedSources: { '某营销号': 2 }, trackedTerms: { GPU: 4, Agent: 3 },
      },
      recommendationFeedbackEvents: [],
      followKeywords: ['芯片', '端侧模型'],
      trackTargets: [],
    },
    version: 0,
  }));

  localStorage.setItem('selectedInterests', JSON.stringify(['ai-models', 'chips-compute', 'robotics', 'policy']));

  localStorage.setItem('learnedProfile', JSON.stringify({
    frequentTopics: [
      { topic: '大模型推理', count: 9, lastAt: Date.now(), weight: 3.2 },
      { topic: '端侧部署', count: 6, lastAt: Date.now(), weight: 2.4 },
      { topic: '算力供给', count: 5, lastAt: Date.now(), weight: 2.0 },
      { topic: 'Agent 编排', count: 4, lastAt: Date.now(), weight: 1.8 },
    ],
    interestDomains: { ai: 12, chips: 9, business: 4, policy: 3 },
    questionPatterns: { compare: 6, analyze: 5, summarize: 3, predict: 2 },
    preferredFormat: { table: 5, list: 3, paragraph: 1 },
    preferredDepth: { concise: 2, standard: 6, deep: 3 },
    preferredLength: { short: 2, medium: 5, long: 2 },
    preferredLanguage: { zh: 9, en: 2, mixed: 1 },
    timePreference: { morning: 2, afternoon: 4, evening: 6, night: 5 },
    toolUsage: { search_news: 7, fetch_page: 3 },
    negativeSignals: [],
    recentEntities: [{ entity: '英伟达', count: 5, lastAt: Date.now() }],
    sessionStats: { totalSessions: 12, totalRounds: 48, avgRounds: 4, maxRounds: 9 },
    learningEnabled: true,
    updatedAt: Date.now(),
  }));
});

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
await page.waitForTimeout(600);

// 导航到用户画像（带重试）
for (let attempt = 0; attempt < 3; attempt++) {
  const ok = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, a, [role=button]')]
      .find(el => (el.textContent || '').trim().startsWith('用户画像'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(2400);
  if (ok && await page.locator('.pa-atlas').count()) break;
  const diag = await page.evaluate(() => ({
    navCount: document.querySelectorAll('button').length,
    hasError: !!document.querySelector('.error-boundary, [class*="error"]'),
    firstNavs: [...document.querySelectorAll('button, a')].map(b => (b.textContent || '').trim()).filter(t => t && t.length < 10).slice(0, 12),
  })).catch(() => null);
  console.log(`attempt ${attempt} diag:`, JSON.stringify(diag), 'errors:', errors);
  if (attempt === 1) await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.querySelector('.onb-skip')?.click());
}

const probe = await page.evaluate(() => {
  const root = document.querySelector('.pa-atlas');
  return {
    hasAtlas: !!root,
    panels: root ? root.querySelectorAll('.pa-panel').length : 0,
    compassSvg: !!document.querySelector('.pa-compass-svg'),
    compassBars: document.querySelectorAll('.pa-layer-day path').length,
    spiralDots: document.querySelectorAll('.pa-layer-time circle').length,
    bubbles: document.querySelectorAll('.pa-bubble').length,
    funnelRows: document.querySelectorAll('.pa-funnel-row').length,
    trustRows: document.querySelectorAll('.pa-trust-row').length,
    spectrumRows: document.querySelectorAll('.pa-spectrum-row').length,
    tele: document.querySelectorAll('.pa-tele').length,
    chips: document.querySelectorAll('.pa-log-chip').length,
    coreValue: document.querySelector('.pa-core-value')?.textContent,
  };
});
console.log('probe:', JSON.stringify(probe));

// 浅色模式截图
await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/atlas-light.png', fullPage: true });

// 悬停罗盘中层（领域力场）验证 tooltip
const box = await page.locator('.pa-compass-svg').boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.24);
  await page.waitForTimeout(500);
  const tip = await page.evaluate(() => document.querySelector('.pa-compass-tip')?.textContent || null);
  console.log('tooltip(day ring):', tip);
  await page.screenshot({ path: 'screenshots/atlas-tooltip.png' });
}

// 深色模式
await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/atlas-dark.png', fullPage: true });

// 窄屏
await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
await page.setViewportSize({ width: 760, height: 1100 });
await page.waitForTimeout(700);
await page.screenshot({ path: 'screenshots/atlas-narrow.png', fullPage: true });

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
