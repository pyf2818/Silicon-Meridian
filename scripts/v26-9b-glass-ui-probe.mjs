/**
 * v26.9b 探针：侧栏/顶栏毛玻璃透粒子 + 体验模式 SVG 巨型图标修复 + 资料卡超高滚动
 * 1. 深色：.sidebar backdrop-filter 含 blur 且 alpha≈0.46；浅色 alpha≈0.30
 * 2. 登录弹窗 .auth-guest-btn 高度正常(<60px)、svg 精确 16px（此前被拉伸成巨型星形）
 * 3. 体验模式登录后打开资料卡：.profile-modal 高度 ≤ 85vh、body overflow-y=auto 可滚动
 * 4. 全程 pageerror 为空
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

const extractAlpha = (bg) => bg ? parseFloat(bg.match(/\/\s*([\d.]+)\s*\)/)?.[1] ?? '1') : null;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('meridian_onboarded', '1'); } catch {} });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ===== 1a. 深色侧栏毛玻璃 =====
  const darkGlass = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    const cs = getComputedStyle(el);
    return { bf: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor };
  });
  check('深色侧栏启用毛玻璃(backdrop-filter 含 blur)', /blur\(/.test(darkGlass.bf || ''), darkGlass.bf);
  const darkAlpha = extractAlpha(darkGlass.bg);
  check('深色侧栏底色 alpha≈0.38（粒子可透出）', darkAlpha !== null && Math.abs(darkAlpha - 0.38) < 0.06, `bg=${darkGlass.bg}`);

  // ===== 1b. 浅色侧栏 =====
  await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'light'));
  await page.waitForTimeout(400);
  const lightGlass = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.sidebar'));
    return { bf: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor };
  });
  const lightAlpha = extractAlpha(lightGlass.bg);
  check('浅色侧栏 alpha≈0.24 + blur 保持', lightAlpha !== null && Math.abs(lightAlpha - 0.24) < 0.06 && /blur\(/.test(lightGlass.bf || ''), `bg=${lightGlass.bg} bf=${lightGlass.bf}`);
  await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));
  await page.waitForTimeout(300);

  // ===== 2. 登录弹窗体验模式按钮 =====
  // 侧栏可能处于折叠态（按钮无文字），登录入口=非 user-info 的第一个 sidebar-action
  const loginBtn = page.locator('.sidebar-action').first();
  if ((await loginBtn.count()) && (await page.locator('.sidebar-user-info').count()) === 0) {
    await loginBtn.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(1200);
    const guest = page.locator('.auth-guest-btn').first();
    if (await guest.count()) {
      const g = await guest.boundingBox();
      const svgBox = await page.evaluate(() => {
        const svg = document.querySelector('.auth-guest-btn svg');
        if (!svg) return null;
        const r = svg.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      check('体验模式按钮高度正常(<60px，无巨型图标撑爆)', g && g.height > 20 && g.height < 60, `h=${g?.height?.toFixed(1)}`);
      check('guest 按钮 SVG 精确 16x16', svgBox && Math.abs(svgBox.w - 16) < 1 && Math.abs(svgBox.h - 16) < 1, `svg=${svgBox ? `${svgBox.w}x${svgBox.h}` : 'null'}`);

      // ===== 3. 体验模式登录 → 资料卡滚动 =====
      await guest.click({ force: true });
      await page.waitForTimeout(2500);
      const userInfo = page.locator('.sidebar-user-info').first();
      if (await userInfo.count()) {
        await userInfo.click({ force: true, timeout: 5000 });
        await page.waitForTimeout(1500);
        const pm = await page.evaluate(() => {
          const modal = document.querySelector('.profile-modal');
          if (!modal) return null;
          const r = modal.getBoundingClientRect();
          const body = modal.querySelector('.profile-modal-body');
          const bcs = body ? getComputedStyle(body) : null;
          return {
            h: r.height, vh: window.innerHeight,
            overflowY: bcs?.overflowY,
            scrollable: body ? body.scrollHeight > body.clientHeight : false,
            scrollHeight: body?.scrollHeight, clientHeight: body?.clientHeight,
          };
        });
        check('资料卡存在且高度 ≤ 85vh', pm && pm.h <= pm.vh * 0.85 + 8, `h=${pm?.h?.toFixed(0)} vs 85vh=${((pm?.vh || 0) * 0.85).toFixed(0)}`);
        check('资料卡 body 可滚动(overflow-y=auto)', pm && pm.overflowY === 'auto', `overflowY=${pm?.overflowY} scrollable=${pm?.scrollable} (${pm?.scrollHeight}/${pm?.clientHeight})`);
      } else {
        check('体验模式登录成功(侧栏出现用户按钮)', false, '未找到 .sidebar-user-info');
      }
    } else {
      check('登录弹窗打开且含体验模式按钮', false, '未找到 .auth-guest-btn');
    }
  } else {
    check('侧栏存在登录入口', false, '未找到登录按钮（可能已登录态）');
  }

  check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '));
} catch (err) {
  check('探针执行完成（未抛出致命异常）', false, String(err));
} finally {
  await browser.close();
}

const passCount = results.filter((r) => r.ok).length;
console.log(`\n===== 探针汇总: ${passCount}/${results.length} PASS =====`);
process.exit(passCount === results.length ? 0 : 1);
