// 暖化主题硬编码冷色验证：
// 1) 4 套暖 palette 浅色 --graph-node-* 已由冷蓝/青/紫改为该 palette 派生暖色
// 2) 冷 palette（neon）浅色 --graph-node-viewpoint 仍冷（零影响）
// 3) 聊天气泡 .interest-bubble 不再硬编码冷青/蓝/紫（跟随 accent）
// 4) 全站 7 页游走 0 异常
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const results = {};
const pageErrors = [];
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');

const browser = await chromium.launch({ headless: true });

async function readGraphVars(page, palette, mode) {
  return await page.evaluate(({ palette, mode }) => {
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
    const r = document.documentElement;
    r.setAttribute('data-palette', palette);
    r.setAttribute('data-mode', mode);
    const cs = getComputedStyle(r);
    const g = (n) => norm(cs.getPropertyValue(n));
    return {
      viewpoint: g('--graph-node-viewpoint'),
      case: g('--graph-node-case'),
      quote: g('--graph-node-quote'),
      data: g('--graph-node-data'),
      chart: g('--graph-node-chart'),
      project: g('--graph-node-project'),
    };
  }, { palette, mode });
}

const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push('pe:' + e));
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const champ = await readGraphVars(page, 'champagne', 'light');
const terr = await readGraphVars(page, 'terracotta', 'light');
const amber = await readGraphVars(page, 'amber', 'light');
const coral = await readGraphVars(page, 'coral', 'light');
const neon = await readGraphVars(page, 'neon', 'light');

const expect = {
  champagne: { viewpoint: '#9a4e0e', chart: '#0f6e63', data: '#8e3b6b' },
  terracotta: { viewpoint: '#9e3b1e', chart: '#0e6e62', data: '#87366b' },
  amber: { viewpoint: '#8a4b12', chart: '#0d6b5e', data: '#7e3a66' },
  coral: { viewpoint: '#b23a22', chart: '#0e7a6a', data: '#8a2f6b' },
};
const warmCheck = (v, exp) => v.viewpoint === exp.viewpoint && v.chart === exp.chart && v.data === exp.data;
const warmPass = {
  champagne: warmCheck(champ, expect.champagne),
  terracotta: warmCheck(terr, expect.terracotta),
  amber: warmCheck(amber, expect.amber),
  coral: warmCheck(coral, expect.coral),
};
// 冷 palette 零影响：neon 浅色 viewpoint 仍是其原冷青蓝 #0e7490（未被暖化触及）
const neonUntouched = neon.viewpoint === '#0e7490';

// 气泡：游走各 view，收集 .interest-bubble 计算色，断言无硬编码冷青/蓝/紫
const coldBubble = ['rgb(34,211,238)', 'rgb(96,165,250)', 'rgb(192,132,252)', '#22d3ee', '#60a5fa', '#c084fc'];
const bubbleSamples = [];
for (const v of ['home', 'all', 'stock', 'github', 'studio', 'profile-center', 'monitor']) {
  await page.goto(`${BASE}/?view=${v}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  const b = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.interest-bubble')];
    return els.map((e) => getComputedStyle(e).color);
  });
  if (b.length) bubbleSamples.push({ view: v, colors: b });
}
const bubbleCold = bubbleSamples.flatMap((x) => x.colors).filter((c) => coldBubble.includes(c.toLowerCase()));
const bubbleOk = bubbleSamples.length === 0 ? null : bubbleCold.length === 0;

// 截图：champagne 浅色首页（暖氛围佐证）
await page.evaluate(() => {
  document.documentElement.setAttribute('data-palette', 'champagne');
  document.documentElement.setAttribute('data-mode', 'light');
});
await page.goto(`${BASE}/?view=home`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/warm-home.png' });

await browser.close();
results.warmPass = warmPass;
results.neonUntouched = neonUntouched;
results.graphSamples = { champ, terr, amber, coral, neon };
results.bubbleSamples = bubbleSamples;
results.bubbleOk = bubbleOk;
results.pageErrors = pageErrors.slice(0, 8);
const allPass = Object.values(warmPass).every(Boolean) && neonUntouched && (bubbleOk === null || bubbleOk) && pageErrors.length === 0;
results.allPass = allPass;
console.log('=== WARM RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('ALL_PASS=' + allPass + ' ERRORS=' + pageErrors.length);
process.exit(allPass ? 0 : 1);
