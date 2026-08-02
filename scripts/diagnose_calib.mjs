// 诊断手动纠错输入框为何无法输入
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

  const input = page.locator('.calibration-console-input');
  console.log('input count:', await input.count());
  if (await input.count() === 0) {
    console.log('NO INPUT FOUND — 校准台输入框不存在!');
    // 检查校准台是否存在
    console.log('calibration-console count:', await page.locator('.calibration-console').count());
    console.log('profile-calibration-panel count:', await page.locator('.profile-calibration-panel').count());
    await page.screenshot({ path: 'screenshots/hud-calib-diagnose.png' });
  } else {
    const box = await input.boundingBox();
    console.log('input bbox:', JSON.stringify(box));
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const hit = await page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el ? { tag: el.tagName, cls: el.className, id: el.id } : null;
      }, [x, y]);
      console.log('elementFromPoint at input center:', JSON.stringify(hit));

      // 点击输入框
      await input.click({ timeout: 5000 });
      const isFocused = await input.evaluate(el => document.activeElement === el);
      console.log('focused after click:', isFocused);

      // 尝试输入
      await page.keyboard.type('芯片');
      const val = await input.inputValue();
      console.log('value after typing:', JSON.stringify(val));

      // 计算样式
      const style = await input.evaluate(el => {
        const cs = getComputedStyle(el);
        return {
          pointerEvents: cs.pointerEvents,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          position: cs.position,
          zIndex: cs.zIndex,
          clipPath: cs.clipPath,
        };
      });
      console.log('input computed style:', JSON.stringify(style));
    }
  }

  await page.screenshot({ path: 'screenshots/hud-calib-diagnose.png' });
  console.log('DONE');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}
