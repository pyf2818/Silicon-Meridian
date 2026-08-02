// 设置页关键改造区块截图（设大 viewport + scrollIntoView 定位）
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 4400 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('text=用户画像').first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.locator('.profile-tab', { hasText: '设置' }).first().click();
  await page.waitForTimeout(1500);

  // 滚到校准台并截图
  await page.locator('.profile-calibration-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/hud-calibration-fixed.png' });

  // 全页截图（用大 viewport）
  await page.screenshot({ path: 'screenshots/hud-settings-tall.png' });

  console.log('OK');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}