// 决定性实验：手动注入 workspace-side-panel，验证 fixed 定位实际位置
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

  // 手动注入预览面板 DOM（让 CSS 类真实生效）
  await page.evaluate(() => {
    const panel = document.createElement('aside');
    panel.className = 'workspace-side-panel';
    panel.style.cssText = 'background:#222;border-left:1px solid #444;';  // 不写 width/position，让 CSS 类生效
    panel.innerHTML = '<div style="padding:20px;border-bottom:1px solid #555"><h3 style="margin:0;color:#eee">TEST.md (大区域预览)</h3></div><div style="padding:20px;color:#ccc;flex:1">preview content —— 新的更宽布局</div>';
    document.body.appendChild(panel);
  });
  await page.waitForTimeout(400);

  // 截图（验证面板位置）
  await page.screenshot({ path: 'screenshots/hud-workspace-preview-injected.png' });

  // 输出面板的实际位置
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.workspace-side-panel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      width: Math.round(r.width), height: Math.round(r.height),
      position: cs.position, right: cs.right, zIndex: cs.zIndex,
      viewportW: window.innerWidth, viewportH: window.innerHeight,
    };
  });
  console.log('panel rect:', JSON.stringify(rect));
  console.log('DONE');
} catch (err) {
  console.error('ERR:', err.message);
} finally {
  await browser.close();
}
