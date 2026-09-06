import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
// 已完成引导的老用户视角（测 #2/#6/#7），另开新 context 测 #8 tour
const oldUser = ctx;
const page = await oldUser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,150)));
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
try { const s = await page.$('button.collapse-btn'); if (s) await s.click(); } catch {}

/* 5. 背景粒子：浅色模式透明度适配 */
const particleLight = await page.evaluate(() => {
  document.documentElement.setAttribute('data-mode', 'light');
  const el = document.querySelector('.visual-particle-layer');
  const o = el ? getComputedStyle(el).opacity : null;
  document.documentElement.setAttribute('data-mode', 'dark');
  const oDark = el ? getComputedStyle(el).opacity : null;
  return { lightOpacity: o, darkOpacity: oDark };
});
console.log('5 粒子深浅适配:', JSON.stringify(particleLight));

/* 2. 竞争监测：添加监测词 → 点卡片 → 详情抽屉 */
await page.locator('.nav-primary-item', { hasText: '竞争监测' }).first().click();
await page.waitForTimeout(900);
const hasAdd = await page.evaluate(() => Boolean(document.querySelector('.monitor-add .monitor-input')));
if (hasAdd) {
  await page.fill('.monitor-input', 'AI');
  await page.locator('.monitor-add-btn').click();
  await page.waitForTimeout(400);
  await page.locator('.monitor-card').first().click();
  await page.waitForTimeout(400);
  const drawer = await page.evaluate(() => {
    const d = document.querySelector('.monitor-drawer');
    return { open: Boolean(d), title: d?.querySelector('.monitor-drawer-title')?.textContent, items: d?.querySelectorAll('.monitor-drawer-item').length || 0 };
  });
  console.log('2 监测详情抽屉:', JSON.stringify(drawer));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.querySelector('.monitor-drawer'));
  console.log('2 Esc 关闭抽屉:', closed ? 'OK' : 'FAIL');
} else console.log('2 监测页未渲染，跳过');

/* 6. 画布节点面板收起/展开 */
await page.locator('.nav-primary-item', { hasText: '无限画布' }).first().click();
await page.waitForTimeout(900);
const paletteBefore = await page.evaluate(() => Boolean(document.querySelector('.wf-palette')));
await page.locator('.wf-palette-collapse').click();
await page.waitForTimeout(300);
const railShown = await page.evaluate(() => Boolean(document.querySelector('.wf-palette-rail')));
await page.locator('.wf-palette-rail').click();
await page.waitForTimeout(300);
const paletteBack = await page.evaluate(() => Boolean(document.querySelector('.wf-palette')));
console.log('6 面板收起/展开:', paletteBefore && railShown && paletteBack ? 'OK' : JSON.stringify({ paletteBefore, railShown, paletteBack }));
// 持久化验证
const persisted = await page.evaluate(() => localStorage.getItem('wfPaletteOpen'));
console.log('6 状态持久化:', persisted);

/* 7. 画像预选 chips */
await page.locator('.nav-primary-item', { hasText: '用户画像' }).first().click();
await page.waitForTimeout(900);
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '偏好设置')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => [...document.querySelectorAll('.profile-module-nav-item')].find(b => b.textContent.includes('领域优先级'))?.click());
await page.waitForTimeout(400);
const chips = await page.evaluate(() => ({
  domainChips: [...document.querySelectorAll('.priority-preset-chip')].map(c => c.textContent.replace('+ ', '')),
}));
console.log('7 领域预选 chips:', JSON.stringify(chips.domainChips));
// 点第一个 chip → 行中出现
const chipText = chips.domainChips[0];
if (chipText) {
  await page.evaluate((t) => {
    [...document.querySelectorAll('.priority-preset-chip')].find(c => c.textContent.includes(t))?.click();
  }, chipText);
  await page.waitForTimeout(500);
  const added = await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid="profile-domain-row"]')];
    return { found: rows.some(r => r.textContent.includes(t)), total: rows.length };
  }, chipText);
  console.log('7 点击 chip 添加:', JSON.stringify(added));
  // 清理
  await page.evaluate((t) => {
    const row = [...document.querySelectorAll('[data-testid="profile-domain-row"]')].find(r => r.textContent.includes(t));
    row?.querySelector('.priority-remove-btn')?.click();
  }, chipText);
}
/* 信号源 chips */
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.profile-module-nav-item')].find(b => b.textContent.includes('信号源优先级'));
  item?.click();
});
await page.waitForTimeout(600);
const srcChips = await page.evaluate(() => ({
  active: document.querySelector('.profile-module-nav-item.active')?.textContent?.trim(),
  chips: [...(document.querySelector('[data-module="sources"]')?.querySelectorAll('.priority-preset-chip') || [])].map(c => c.textContent.replace('+ ', '')).slice(0, 4),
}));
console.log('7 信息源预选 chips:', JSON.stringify(srcChips));

/* 1. 快捷键面板更新（? 打开） */
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
// 触发快捷键面板：直接从 uiStore 难 → 用快捷键 ?（可能需要非输入焦点）
await page.keyboard.press('Backspace');
await page.keyboard.press('?');
await page.waitForTimeout(500);
let sc = await page.evaluate(() => document.querySelector('.shortcuts-list')?.textContent || '');
if (!sc) { await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))); await page.waitForTimeout(400); sc = await page.evaluate(() => document.querySelector('.shortcuts-list')?.textContent || ''); }
console.log('1 快捷键面板含画布撤销:', sc.includes('撤销节点变更') && sc.includes('重做') ? 'OK' : 'MISS');

/* 8. 新手引导 + 功能导览（新 context = 新用户） */
const ctx2 = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
const p2 = await ctx2.newPage();
const errs2 = []; p2.on('pageerror', e => errs2.push(e.message.slice(0,150)));
await p2.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(2400);
const onbShown = await p2.evaluate(() => Boolean(document.querySelector('.onb-overlay')));
// 欢迎步 → 兴趣步（兴趣步需选 1 个领域，否则下一步禁用）
const nextBtn = p2.locator('.onb-btn-primary');
if (await nextBtn.isEnabled().catch(() => false)) await nextBtn.click().catch(() => {});
await p2.waitForTimeout(300);
await p2.locator('.onb-chip').first().click();
await p2.waitForTimeout(200);
for (let i = 0; i < 3; i++) {
  const btn = p2.locator('.onb-btn-primary');
  if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
  await p2.waitForTimeout(250);
}
const tour = await p2.evaluate((shown) => ({
  shown,
  grid: Boolean(document.querySelector('.onb-tour-grid')),
  groups: document.querySelectorAll('.onb-tour-group').length,
}), onbShown);
console.log('8 引导显示 + 功能导览步:', JSON.stringify(tour));
// 跳过引导清理
await p2.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('跳过'))?.click());
await p2.waitForTimeout(300);

console.log('PAGEERRORS:', JSON.stringify(errs));
console.log('PAGEERRORS2:', JSON.stringify(errs2));
await b.close();
