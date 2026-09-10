/**
 * 粒子不可见深度诊断：
 * 1) 三大面板 computed background（确认覆盖层是否生效）
 * 2) 画布内容统计（alpha>0 像素数 / 平均 alpha）——确认画布上真的有东西
 * 3) 画布强制 z-index:9999 置顶后截图 → 统计亮色像素——证明可见绘制能力
 */
import { chromium } from 'playwright';

const BASE = process.env.PW_BASE || 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('meridian_onboarded', '1'));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('canvas.visual-particle-layer', { state: 'attached', timeout: 20000 });
await page.waitForFunction(() => !document.querySelector('.entrance'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

// 1) 面板 computed background
const bgs = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: (不存在)`;
    const cs = getComputedStyle(el);
    return `${sel}: ${cs.backgroundColor} | backdrop=${cs.backdropFilter}`;
  };
  return [pick('.sidebar'), pick('.ai-chat-panel-main'), pick('.chat-messages'), pick('.agent-tabs')].join('\n');
});
console.log('--- 面板背景 ---\n' + bgs);

// 2) 画布内容统计
const content = await page.evaluate(() => {
  const c = document.querySelector('canvas.visual-particle-layer');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let nonzero = 0, sum = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) { nonzero++; sum += d[i]; } }
  return { nonzero, avgAlpha: nonzero ? (sum / nonzero).toFixed(1) : 0, total: d.length / 4 };
});
console.log('--- 画布内容 ---');
console.log(`alpha>0 像素: ${content.nonzero} / ${content.total}（avgAlpha=${content.avgAlpha}）`);

// 3) 置顶截图测试
await page.addStyleTag({ content: 'canvas.visual-particle-layer{z-index:9999!important;opacity:1!important}' });
await page.waitForTimeout(600);
const shot = await page.screenshot({ type: 'png', timeout: 60000 });
const bright = await page.evaluate(async (buf) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${buf}`; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) lit++;
  }
  return lit;
}, shot.toString('base64'));
console.log('--- 置顶测试 ---');
console.log(`z-index:9999 后截图中亮色采样像素: ${bright}（>500 = 画布内容确实能被看到）`);

await browser.close();
