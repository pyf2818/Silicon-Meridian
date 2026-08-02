// 主题适配截图：深色香槟金 / 深色樱花粉 / 浅色冰蓝
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('text=用户画像').first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);

  // 1. 深色 + 香槟金（默认）
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-mode', 'dark');
    document.documentElement.setAttribute('data-palette', 'champagne');
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/hud-theme-dark-champagne.png' });

  // 2. 深色 + 樱花粉
  await page.evaluate(() => document.documentElement.setAttribute('data-palette', 'sakura'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/hud-theme-dark-sakura.png' });

  // 3. 浅色 + 香槟金
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-mode', 'light');
    document.documentElement.setAttribute('data-palette', 'champagne');
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/hud-theme-light-champagne.png' });

  // 4. 浅色 + 樱花粉
  await page.evaluate(() => document.documentElement.setAttribute('data-palette', 'sakura'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/hud-theme-light-sakura.png' });

  console.log('OK');
} catch (err) {
  console.error('ERR:', err.message);
  await page.screenshot({ path: 'screenshots/hud-theme-error.png' });
} finally {
  await browser.close();
}
