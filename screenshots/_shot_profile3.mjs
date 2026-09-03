// 三分区升级验证：行为洞察 / 我的社交 / 偏好设置（含空态）
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5175/';
const errors = [];
const browser = await chromium.launch({ headless: true });

async function openProfile(page) {
  await page.evaluate(() => document.querySelector('.onb-skip')?.click());
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a')].find(el => (el.textContent || '').trim().startsWith('用户画像'));
      btn?.click();
    });
    await page.waitForTimeout(2200);
    if (await page.locator('.profile-center-page').count()) return true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
  return false;
}

async function gotoSection(page, label) {
  await page.evaluate(l => {
    const btn = [...document.querySelectorAll('.profile-section-rail-item')]
      .find(el => (el.textContent || '').includes(l));
    btn?.click();
  }, label);
  await page.waitForTimeout(1500);
}

// ---- 场景 1：完整数据（浅色）----
const ctx1 = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const p1 = await ctx1.newPage();
p1.on('pageerror', e => errors.push('s1:' + e.message));
await p1.goto(BASE, { waitUntil: 'domcontentloaded' });
await p1.waitForTimeout(4200);
await p1.evaluate(() => {
  const iso = (daysAgo, hour) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 15, 0, 0); return d.toISOString(); };
  localStorage.setItem('bookmarks', JSON.stringify(Array.from({ length: 58 }, (_, i) => ({
    id: `b${i}`, title: `t${i}`, category: ['ai-models', 'chips-compute'][i % 2], source: '量子位',
    readAt: iso(i % 30, [7, 9, 12, 20, 21, 22, 23][i % 7]), tags: ['大模型', 'GPU'], summary: 'x'.repeat(150),
  }))));
  localStorage.setItem('learnedProfile', JSON.stringify({
    frequentTopics: [{ topic: '大模型推理', count: 8, lastAt: Date.now(), weight: 3 }],
    interestDomains: { ai: 10, chips: 6 },
    preferredFormat: { table: 5, list: 2 }, preferredDepth: { standard: 6, deep: 2 },
    preferredLength: { medium: 5 }, preferredLanguage: { zh: 9 },
    timePreference: { evening: 6, night: 4 },
    questionPatterns: { compare: 12, analyze: 8, what: 5, why: 3 },
    recentEntities: [
      { entity: 'GLM-5', count: 6, lastAt: Date.now() - 3600e3 },
      { entity: 'Blackwell', count: 3, lastAt: Date.now() - 3 * 86400e3 },
    ],
    sessionStats: { totalSessions: 14, totalRounds: 63, avgRounds: 4.5, maxRounds: 11 },
    toolUsage: {}, negativeSignals: [],
    learningEnabled: true, updatedAt: Date.now(),
  }));
  localStorage.setItem('selectedInterests', JSON.stringify(['ai-models', 'chips-compute']));
});
await p1.reload({ waitUntil: 'domcontentloaded' });
await p1.waitForTimeout(4200);
console.log('s1 opened:', await openProfile(p1));
await p1.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
await p1.waitForTimeout(600);

// 行为洞察
await gotoSection(p1, '行为洞察');
await p1.waitForTimeout(900);
const insProbe = await p1.evaluate(() => ({
  tele: document.querySelectorAll('.pa-tele').length,
  trendPanel: !!document.querySelector('.pi-panel-trend svg'),
  barPanels: document.querySelectorAll('.pi-bars').length,
  barRows: document.querySelectorAll('.pi-bar-row').length,
  meters: document.querySelectorAll('.pi-meter-row').length,
  chips: document.querySelectorAll('.pi-chip').length,
  sessions: document.querySelectorAll('.pi-session').length,
}));
console.log('s1 insights:', JSON.stringify(insProbe));
await p1.screenshot({ path: 'screenshots/insights-light.png', timeout: 10000 }).catch(() => {});

// 我的社交
await gotoSection(p1, '我的社交');
await p1.waitForTimeout(900);
const socProbe = await p1.evaluate(() => ({
  tele: document.querySelectorAll('.pa-tele').length,
  avatar: !!document.querySelector('.ps-avatar'),
  rings: document.querySelectorAll('.pi-ring').length,
  tags: document.querySelectorAll('.ps-tag').length,
}));
console.log('s1 social:', JSON.stringify(socProbe));
await p1.screenshot({ path: 'screenshots/social-light.png', timeout: 10000 }).catch(() => {});

// 偏好设置：学习引擎（默认第一个模块）→ 领域优先级
await gotoSection(p1, '偏好设置');
await p1.waitForTimeout(900);
const prefProbe = await p1.evaluate(() => ({
  learningRing: !!document.querySelector('.profile-learning-score .pi-ring'),
  learningText: document.querySelector('.profile-learning-score-text strong')?.textContent || null,
}));
console.log('s1 preferences(learning):', JSON.stringify(prefProbe));
await p1.screenshot({ path: 'screenshots/prefs-learning.png', timeout: 10000 }).catch(() => {});
await p1.evaluate(() => {
  const btn = [...document.querySelectorAll('.profile-module-nav-item')].find(el => (el.textContent || '').includes('领域优先级'));
  btn?.click();
});
await p1.waitForTimeout(900);
const tierProbe = await p1.evaluate(() => ({
  rows: document.querySelectorAll('.priority-row').length,
  rails: document.querySelectorAll('.tier-rail').length,
  focusRails: document.querySelectorAll('.tier-rail[data-tier="focus"]').length,
}));
console.log('s1 preferences(tiers):', JSON.stringify(tierProbe));
await p1.screenshot({ path: 'screenshots/prefs-tiers.png', timeout: 10000 }).catch(() => {});
await ctx1.close();

// ---- 场景 2：全新用户空态 ----
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errors.push('s2:' + e.message));
await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(4200);
console.log('s2 opened:', await openProfile(p2));
await p2.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
await p2.waitForTimeout(700);
await gotoSection(p2, '行为洞察');
const insEmpty = await p2.evaluate(() => ({
  empties: [...document.querySelectorAll('.pa-atlas .pa-empty')].map(e => e.textContent.slice(0, 14)),
  teleValues: [...document.querySelectorAll('.pa-tele-value')].map(e => e.textContent),
}));
console.log('s2 insights empty:', JSON.stringify(insEmpty));
await gotoSection(p2, '我的社交');
const socEmpty = await p2.evaluate(() => ({
  name: document.querySelector('.ps-id-main h3')?.textContent || null,
  statVals: [...document.querySelectorAll('.ps-id-stats b')].map(e => e.textContent),
}));
console.log('s2 social empty:', JSON.stringify(socEmpty));
await ctx2.close();

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
