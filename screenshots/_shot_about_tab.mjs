/**
 * 验证「设置面板 → 关于」Tab
 * 1) 打开命令面板（Ctrl+K）
 * 2) 点击"打开设置"
 * 3) 切换到"关于" Tab
 * 4) 抓截图：产品卡 + 作者卡 + 微信 QR 缩略图
 * 5) 点击 QR 缩略图 → 抓放大浮层截图
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5179/';
const OUT = 'screenshots/about-tab';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// 跳过入场动画 + 首跑引导
await page.waitForTimeout(500);
// 直接 click "skip" 跳过引导（如有）
try {
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) await skipBtn.click();
} catch {}

// 打开命令面板（Ctrl+K）
await page.keyboard.press('Control+K');
await page.waitForSelector('.cmd-palette', { timeout: 4000 }).catch(() => {});
// 找到"打开设置"并点击
const openSettings = await page.$('.cmd-palette-item:has-text("打开设置"), .cmd-palette-item:has-text("设置")');
if (openSettings) {
  await openSettings.click();
} else {
  // 备选：直接查找命令项
  const items = await page.$$('.cmd-palette-item');
  for (const it of items) {
    const txt = (await it.textContent()) || '';
    if (txt.includes('设置') || txt.includes('settings')) { await it.click(); break; }
  }
}

await page.waitForSelector('.settings-modal', { timeout: 4000 }).catch(() => {});
await page.waitForTimeout(200);

// 切换到"关于" Tab
const aboutTabBtn = await page.$('button.settings-nav-item:has-text("关于"), button.settings-nav-item:has-text("About")');
if (aboutTabBtn) await aboutTabBtn.click();
await page.waitForSelector('.about-tab', { timeout: 3000 }).catch(() => {});

// 结构断言
const checks = await page.evaluate(() => {
  const out = {};
  out.productName = document.querySelector('.about-product-name')?.textContent || null;
  out.productTagline = document.querySelector('.about-product-tagline')?.textContent || null;
  out.productDesc = (document.querySelector('.about-product-desc')?.textContent || '').slice(0, 60);
  out.version = document.querySelector('.about-version-pill')?.textContent || null;
  out.authorName = document.querySelector('.about-author-name')?.textContent || null;
  out.authorRole = document.querySelector('.about-author-role')?.textContent || null;
  out.emailLink = document.querySelector('.about-contact-row a[href^="mailto:"]')?.textContent || null;
  out.emailHref = document.querySelector('.about-contact-row a[href^="mailto:"]')?.getAttribute('href') || null;
  out.phoneLink = document.querySelector('.about-contact-row a[href^="tel:"]')?.textContent || null;
  out.phoneHref = document.querySelector('.about-contact-row a[href^="tel:"]')?.getAttribute('href') || null;
  out.wechatNick = document.querySelector('.about-wechat-nick')?.textContent || null;
  out.qrImgSrc = document.querySelector('.about-qr-thumb img')?.getAttribute('src') || null;
  out.qrLoaded = (() => {
    const img = document.querySelector('.about-qr-thumb img');
    return img ? img.complete && img.naturalWidth > 0 : false;
  })();
  out.copyBtns = document.querySelectorAll('.about-copy-btn').length;
  out.featureItems = document.querySelectorAll('.about-feature-list li').length;
  return out;
});

console.log('STRUCTURE CHECKS:');
for (const [k, v] of Object.entries(checks)) console.log(`  ${k} = ${JSON.stringify(v)}`);

// 抓 about Tab 主截图
await page.screenshot({ path: `${OUT}/about-light.png`, fullPage: false });

// 测复制按钮：点邮箱复制
const emailCopyBtn = await page.$('.about-contact-row:has(a[href^="mailto:"]) .about-copy-btn');
if (emailCopyBtn) {
  await emailCopyBtn.click();
  await page.waitForTimeout(300);
  try {
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`  clipboardAfterEmailCopy = "${clip}"`);
  } catch (e) { console.log(`  clipboard read skipped: ${e.message}`); }
}

// 测 QR 放大
const qrThumb = await page.$('.about-qr-thumb');
if (qrThumb) {
  await qrThumb.click();
  await page.waitForSelector('.about-qr-modal', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  const modalImgLoaded = await page.evaluate(() => {
    const img = document.querySelector('.about-qr-modal-img');
    return img ? img.complete && img.naturalWidth > 0 : false;
  });
  console.log(`  qrModalImageLoaded = ${modalImgLoaded}`);
  await page.screenshot({ path: `${OUT}/about-qr-modal.png`, fullPage: false });
  // 关闭
  const closeBtn = await page.$('.about-qr-modal-close');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(200);
}

// 深色模式
await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/about-dark.png`, fullPage: false });

console.log('\nPAGEERRORS:', errors.length ? errors : 'none');
await browser.close();
