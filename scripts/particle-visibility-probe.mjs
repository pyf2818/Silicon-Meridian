/**
 * 背景粒子可见性 A/B 取证：
 * A 组：正常页面两张截图（间隔 1s）→ 差异像素数 = 页面动态总量
 * B 组：隐藏粒子画布后同样两张 → 差异像素数
 * diffA >> diffB ⇒ 粒子可见且在动；diffA ≈ diffB ≈ 0 ⇒ 粒子不可见或不动
 * 另按上/中/下三等分报告差异分布，判断动态出现在页面哪个区域。
 */
import { chromium } from 'playwright';

const BASE = process.env.PW_BASE || 'http://127.0.0.1:5175';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 拦截 webfont：截图前 Playwright 会等字体加载，外网抖动会卡死探针；diff 用途无需字体
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
await page.addInitScript(() => localStorage.setItem('meridian_onboarded', '1'));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('canvas.visual-particle-layer', { state: 'attached', timeout: 20000 });
// 等开场动画完全卸载（.entrance 移除），最长 20s
await page.waitForFunction(() => !document.querySelector('.entrance'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

async function shotDiff(label) {
  const a = await page.screenshot({ type: 'png', timeout: 60000, animations: 'allow' });
  await page.waitForTimeout(1000);
  const b = await page.screenshot({ type: 'png', timeout: 60000, animations: 'allow' });
  const result = await page.evaluate(([bufA, bufB]) => {
    // 在页面内用 canvas 解码两段 PNG 并做像素 diff
    return Promise.all([bufA, bufB].map(buf => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0);
        res(cx.getImageData(0, 0, c.width, c.height).data);
      };
      img.src = `data:image/png;base64,${buf}`;
    }))).then(([da, db]) => {
      const w = 1440, h = 900, ch = 4;
      let total = 0;
      const thirds = [0, 0, 0];
      for (let y = 0; y < h; y += 3) {
        const band = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2;
        for (let x = 0; x < w; x += 3) {
          const i = (y * w + x) * ch;
          if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) {
            total++; thirds[band]++;
          }
        }
      }
      return { total, thirds };
    });
  }, [a.toString('base64'), b.toString('base64')]);
  console.log(`${label}: diffPixels=${result.total} (上/中/下 = ${result.thirds.join(' / ')})`);
  return result.total;
}

const diffA = await shotDiff('A 正常页面   ');
await page.addStyleTag({ content: 'canvas.visual-particle-layer{display:none!important}' });
await page.waitForTimeout(400);
const diffB = await shotDiff('B 隐藏粒子层 ');

console.log(diffA > diffB * 2 && diffA > 100
  ? `>> 结论：粒子可见且在动（A=${diffA} vs B=${diffB}）`
  : `>> 结论：粒子在合成页面上几乎不可见或不动（A=${diffA} vs B=${diffB}），需要修复可见性/显著性`);

await browser.close();
