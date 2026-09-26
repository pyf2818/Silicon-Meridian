// scripts/gen-icon.mjs — 应用图标渲染管线：SVG → 512px PNG（Playwright 离屏渲染）
// 用法：node scripts/gen-icon.mjs
// 产出：build/icon-512.png（后续由 scripts/icon-to-ico.py 转 ICO）
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = path.join(ROOT, 'build', 'icon-source.svg');
const OUT_PNG = path.join(ROOT, 'build', 'icon-512.png');

// 本机 chromium 版本与依赖声明不匹配（chromium-1234 vs 1243），显式指定已装版本
const CHROME = path.join(
  process.env.LOCALAPPDATA || '',
  'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe',
);

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`chromium not found: ${CHROME}`);
  const svg = fs.readFileSync(SVG_PATH, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0} html,body{width:512px;height:512px;overflow:hidden;background:#000}
    svg{display:block;width:512px;height:512px}
  </style></head><body>${svg}</body></html>`;
  const htmlPath = path.join(ROOT, 'build', '.icon-render.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--force-color-profile=srgb', '--disable-lcd-text'],
  });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
  await page.waitForTimeout(400); // 等渐变/滤镜稳定
  await page.screenshot({ path: OUT_PNG, clip: { x: 0, y: 0, width: 512, height: 512 } });
  await browser.close();
  fs.unlinkSync(htmlPath);
  console.log('[gen-icon] OK →', OUT_PNG);
}

main().catch((err) => { console.error('[gen-icon] FAIL:', err); process.exit(1); });
