// 把 panel 注入到 workspace-panel 内部（模拟真实 DOM 结构），
// 一步步上溯祖先链找哪个有 transform/filter/contain
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const wsTab = page.locator('.session-tab', { hasText: '工作空间' }).first();
  if (await wsTab.count()) {
    await wsTab.click();
    await page.waitForTimeout(1000);
  }

  // 注入 panel 到 workspace-panel 内部（真实 DOM 位置）
  const result = await page.evaluate(() => {
    const wp = document.querySelector('.workspace-panel');
    if (!wp) return { err: 'no workspace-panel' };
    const panel = document.createElement('aside');
    panel.className = 'workspace-side-panel';
    panel.style.cssText = 'background:#222;color:#eee;';
    panel.innerHTML = '<div style="padding:20px"><h3 style="margin:0">TEST.md (in workspace-panel)</h3></div>';
    wp.appendChild(panel);

    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);

    // 上溯祖先链找第一个创建层叠上下文的元素（包含 backdrop-filter！）
    const culprits = [];
    let node = panel.parentElement;
    while (node && node !== document.body.parentElement) {
      const c = getComputedStyle(node);
      const t = c.transform;
      const f = c.filter;
      const ct = c.contain;
      const wc = c.willChange;
      const p = c.perspective;
      const bf = c.backdropFilter && c.backdropFilter !== 'none' ? c.backdropFilter : null;
      if (t !== 'none' || f !== 'none' || ct !== 'none' || (wc && wc !== 'auto') || p !== 'none' || bf) {
        culprits.push({
          tag: node.tagName, cls: (node.className || '').toString().slice(0, 60),
          transform: t !== 'none' ? t.slice(0, 80) : null,
          filter: f !== 'none' ? f.slice(0, 80) : null,
          contain: ct !== 'none' ? ct : null,
          willChange: wc !== 'auto' ? wc : null,
          perspective: p !== 'none' ? p : null,
          backdropFilter: bf ? bf.slice(0, 80) : null,
        });
      }
      node = node.parentElement;
    }

    return {
      panel: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), position: cs.position, right: cs.right, width: cs.width, zIndex: cs.zIndex },
      culprits,
    };
  });
  console.log(JSON.stringify(result, null, 2));

  await page.screenshot({ path: 'screenshots/hud-workspace-inside.png' });
  console.log('DONE');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}