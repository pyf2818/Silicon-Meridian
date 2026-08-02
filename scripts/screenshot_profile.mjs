// 截图验证 HUD 重构效果（临时脚本）
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // 尝试进入用户画像
  const navTarget = page.locator('text=用户画像').first();
  if (await navTarget.count()) {
    await navTarget.click({ timeout: 10000 });
  } else {
    // 兜底：通过侧边栏图标（target icon）所在按钮
    await page.locator('button:has-text("用户画像"), [data-nav="profile-center"], a:has-text("用户画像")').first().click({ timeout: 10000 });
  }
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'screenshots/hud-dashboard.png' });

  // 切到设置 Tab
  const settingsTab = page.locator('.profile-tab', { hasText: '设置' }).first();
  if (await settingsTab.count()) {
    await settingsTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/hud-settings.png' });
    await page.screenshot({ path: 'screenshots/hud-settings-full.png', fullPage: true });
  }

  // 切回仪表盘截图（完整长页）
  const dashTab = page.locator('.profile-tab', { hasText: '仪表盘' }).first();
  if (await dashTab.count()) {
    await dashTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/hud-dashboard-full.png', fullPage: true });
  }

  console.log('OK: screenshots saved');
} catch (err) {
  console.error('ERR:', err.message);
  await page.screenshot({ path: 'screenshots/hud-error.png' });
} finally {
  await browser.close();
}
