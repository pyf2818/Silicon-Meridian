import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5176/';
const OUT = 'screenshots/entrance-refine';
const errors = [];

async function run(mode) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: mode,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${mode}] ${e.message}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance.is-run', { timeout: 9000 }).catch(() => {});
  await page.evaluate((m) => { document.documentElement.dataset.mode = m; }, mode);

  // 单次合并 $eval：趁 entrance 还在 DOM 上抓全结构/动效/纸纹数据
  const data = await page.evaluate(() => {
    const chars = [...document.querySelectorAll('.entrance__brand-char')].map((e) => ({
      text: e.textContent,
      anim: getComputedStyle(e).animationName,
      delay: getComputedStyle(e).animationDelay,
    }));
    const grain = (() => {
      const e = document.querySelector('.entrance__grain');
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { opacity: cs.opacity, display: cs.display, blend: cs.mixBlendMode, blur: cs.filter };
    })();
    const bg = document.querySelector('.entrance') ? getComputedStyle(document.querySelector('.entrance')).backgroundImage : '';
    return { chars, grain, bgRadial: bg.includes('radial-gradient') };
  });

  // 紧接其后起 t0，单次 $eval 让 t0 ≈ is-run + ~0.3s
  const t0 = Date.now();
  // 偏移基于 is-run 估算（t0 延迟约 0.3s）：墨滴→涟漪→逐字→印章→离场→落定
  const shots = [0, 700, 1200, 1700, 2200, 2900, 4900];
  for (const ms of shots) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/entrance-${mode}-${String(ms).padStart(4, '0')}.png` });
  }

  const delays = data.chars.map((c) => c.delay);
  const increasing = delays.every((d, i, a) => i === 0 || parseFloat(d) > parseFloat(a[i - 1]));
  console.log(`MODE=${mode}`);
  console.log(`  chars=${JSON.stringify(data.chars.map((c) => c.text))}`);
  console.log(`  anims=${JSON.stringify(data.chars.map((c) => c.anim))}`);
  console.log(`  delays=${JSON.stringify(delays)} staggerIncreasing=${increasing}`);
  console.log(`  grain=${JSON.stringify(data.grain)}`);
  console.log(`  bgRadial=${data.bgRadial}`);

  await browser.close();
}

await run('light');
await run('dark');
console.log('PAGEERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
