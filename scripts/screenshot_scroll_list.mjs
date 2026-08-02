// 验证优先级列表滚动：注入多条伪造行，截图确认滚动容器生效
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

  // 往领域优先级列表注入 20 条伪造行（仅用于验证滚动，不持久化）
  await page.evaluate(() => {
    const lists = document.querySelectorAll('.priority-list');
    lists.forEach((list, li) => {
      for (let i = 0; i < 20; i++) {
        const row = document.createElement('div');
        row.className = 'priority-row';
        row.style.cssText = 'padding:8px 12px;border:1px solid #888;display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;';
        row.innerHTML = `<span>测试信号 ${li + 1}-${i + 1}</span><div class="profile-tier-control"><button class="active">一级</button><button>二级</button><button>三级</button></div><strong>一级</strong>`;
        list.appendChild(row);
      }
    });
  });
  await page.waitForTimeout(800);

  // 滚动到领域优先级区域
  await page.locator('#profile-domain-tiers').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/hud-scroll-list.png' });

  console.log('OK');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}
