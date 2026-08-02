// 仪表盘下方区域特写
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('text=用户画像').first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'screenshots/hud-dashboard-tall.png' });
  console.log('OK');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}