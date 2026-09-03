// v2 打磨验证：时段条（阅读分布+偏好标记）与全新用户空态
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
    if (await page.locator('.pa-atlas').count()) return true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
  return false;
}

// ---- 场景 1：完整数据，验证时段条双信号 ----
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
    questionPatterns: { compare: 4 }, toolUsage: {}, negativeSignals: [], recentEntities: [],
    sessionStats: {}, learningEnabled: true, updatedAt: Date.now(),
  }));
  localStorage.setItem('selectedInterests', JSON.stringify(['ai-models', 'chips-compute']));
});
await p1.reload({ waitUntil: 'domcontentloaded' });
await p1.waitForTimeout(4200);
console.log('s1 opened:', await openProfile(p1));
await p1.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
await p1.waitForTimeout(600);
await p1.evaluate(() => document.querySelector('.pa-grid-trio')?.scrollIntoView({ block: 'center' }));
await p1.waitForTimeout(800);
const probe1 = await p1.evaluate(() => ({
  bars: document.querySelectorAll('.pa-timeband i').length,
  prefMarks: document.querySelectorAll('.pa-timeband i.is-pref').length,
  legend: document.querySelectorAll('.pa-timeband-legend span').length,
}));
console.log('s1 timeband:', JSON.stringify(probe1));
await p1.screenshot({ path: 'screenshots/atlas-timeband.png' });
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
const probe2 = await p2.evaluate(() => ({
  atlas: !!document.querySelector('.pa-atlas'),
  empties: [...document.querySelectorAll('.pa-atlas .pa-empty')].map(e => e.textContent.slice(0, 16)),
  compassHint: document.querySelector('.pa-core-hint')?.textContent || null,
  teleValues: [...document.querySelectorAll('.pa-tele-value')].map(e => e.textContent),
  logStatus: document.querySelector('.pa-log-status')?.textContent || null,
}));
console.log('s2 empty state:', JSON.stringify(probe2));
await p2.screenshot({ path: 'screenshots/atlas-empty.png', fullPage: true, timeout: 10000 })
  .catch(async () => {
    await p2.screenshot({ path: 'screenshots/atlas-empty.png', timeout: 10000 }).catch(() => {});
  });
await ctx2.close();

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
