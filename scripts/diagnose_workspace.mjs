// 检查工作空间面板祖先链：是否有 transform/filter/contain 让 fixed 失效
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // 切换到"工作空间" tab（AI 工作站左栏）
  const wsTab = page.locator('.session-tab', { hasText: '工作空间' }).first();
  if (await wsTab.count()) {
    await wsTab.click();
    await page.waitForTimeout(1200);
  }

  // 找到 workspace-panel 并检查祖先链
  const info = await page.evaluate(() => {
    const el = document.querySelector('.workspace-panel');
    if (!el) return { found: false };
    const chain = [];
    let node = el;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      chain.push({
        tag: node.tagName,
        cls: (node.className && node.className.toString ? node.className.toString() : '') || '',
        transform: cs.transform !== 'none' ? cs.transform : null,
        filter: cs.filter !== 'none' ? cs.filter : null,
        contain: cs.contain,
        willChange: cs.willChange,
        perspective: cs.perspective !== 'none' ? cs.perspective : null,
        position: cs.position,
        overflow: cs.overflow,
        zIndex: cs.zIndex,
      });
      node = node.parentElement;
    }
    return { found: true, chain };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('DONE');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}
