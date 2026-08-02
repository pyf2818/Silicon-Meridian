// 深度诊断：打印校准台相关元素宽度
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('text=用户画像').first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.locator('.profile-tab', { hasText: '设置' }).first().click();
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const sel = ['.profile-calibration-panel', '.profile-calibration-grid', '.calibration-console',
      '.calibration-console-row', '.calibration-console-input',
      '.calibration-console-row .ai-primary-action'];
    const out = {};
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) { out[s] = 'NOT FOUND'; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[s] = {
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display,
        gridCol: cs.gridColumn,
        width: cs.width,
        maxWidth: cs.maxWidth,
      };
    }
    // 检查 section 的 grid 容器
    const grid = document.querySelector('.profile-settings-grid');
    if (grid) {
      const cs = getComputedStyle(grid);
      out['.profile-settings-grid'] = {
        w: Math.round(grid.getBoundingClientRect().width),
        cols: cs.gridTemplateColumns,
      };
    }
    // 检查 profile-calibration-grid 是否是 grid 且 console 是否被并进 grid
    const calGrid = document.querySelector('.profile-calibration-grid');
    if (calGrid) {
      const cs = getComputedStyle(calGrid);
      out['cal-grid-cols'] = cs.gridTemplateColumns;
      out['cal-grid-display'] = cs.display;
    }
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('DONE');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}
