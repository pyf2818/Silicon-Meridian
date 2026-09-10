/**
 * v26-6 探针：养成游戏自主行动 + 家具布置 + 迷你属性条
 * - 预置群聊（2 成员）→ 点「养成」开游戏大屏
 * - 迷你属性条：.ogame-stats 宽 ≤46px、.ogame-bar 高 ≤5px
 * - 自主漫步：静置观察成员 left/top 自行变化（午休时段自动跳过该项）
 * - 布置模式：目录 5 件 → 点地板摆绿植（经费 -15）→ 拖动挪位 → 点击收回（+8）
 * - 全程 0 pageError
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5176;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.PW_OUT || `.pw-${Date.now()}`;
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url); if (res.ok) return true; } catch { /* not yet */ }
    await wait(1000);
  }
  return false;
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
const pageErrors = [];
let ok = false;
try {
  if (!await waitForServer(BASE)) throw new Error('dev server 未就绪');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('meridian_onboarded', '1');
      const now = Date.now();
      const chat = {
        id: 'gc_probe', name: '探针团队', createdAt: now - 86400000,
        announcement: '', goal: { status: 'idle', round: 0, maxRounds: 8, updatedAt: now },
        roster: ['scout', 'writer'], profiles: {}, messages: [],
      };
      localStorage.setItem('agentTeamGroupChat', JSON.stringify({ chats: [chat], activeId: 'gc_probe' }));
      localStorage.removeItem('officeGameState');
    } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(6500);

  await page.locator('.team-office-game').click();
  await wait(1000);

  // ① 迷你属性条
  const mini = await page.evaluate(() => {
    const stats = document.querySelector('.ogame-stats');
    const bar = document.querySelector('.ogame-bar');
    return {
      statsW: stats ? parseFloat(getComputedStyle(stats).width) : 999,
      barH: bar ? parseFloat(getComputedStyle(bar).height) : 999,
    };
  });
  console.log('[probe] mini stats:', JSON.stringify(mini));

  // ② 自主漫步：静置 14s 观察成员自行移动（午休时段跳过）
  const lunchNow = (() => { const d = new Date(); const m = d.getHours() * 60 + d.getMinutes(); return m >= 690 && m < 810; })();
  const posT0 = await page.evaluate(() => {
    const u = document.querySelector('.ogame-unit');
    return { left: u?.style.left || '', top: u?.style.top || '' };
  });
  await wait(14000);
  const posT1 = await page.evaluate(() => {
    const u = document.querySelector('.ogame-unit');
    return { left: u?.style.left || '', top: u?.style.top || '' };
  });
  const wandered = posT0.left !== posT1.left || posT0.top !== posT1.top;
  console.log('[probe] wander:', lunchNow ? 'SKIP(午休)' : `${posT0.left},${posT0.top} -> ${posT1.left},${posT1.top}`);

  // ③ 布置模式
  await page.locator('.ogame-mode', { hasText: '布置' }).click();
  await wait(400);
  const decor = await page.evaluate(() => ({
    catalog: document.querySelectorAll('.ogame-toolbar .ogame-food').length,
    coins: document.querySelector('.ogame-coins')?.textContent?.trim() || '',
    furnCount: document.querySelectorAll('.ogame-furn').length,
  }));
  // 点地板空处摆绿植（默认选中 plant，成本 15）；先 elementFromPoint 避让游走小人
  const floor = await page.locator('.ofc-floor-big').boundingBox();
  let placedOk = false;
  outer:
  for (const fx of [0.72, 0.6, 0.82, 0.5, 0.68]) {
    for (const fy of [0.3, 0.4, 0.5, 0.62]) {
      const px = floor.x + floor.width * fx;
      const py = floor.y + floor.height * fy;
      const top = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (el?.closest('.ogame-unit') || el?.closest('.ogame-furn')) return 'blocked';
        return 'ok';
      }, [px, py]);
      if (top !== 'ok') continue;
      await page.mouse.click(px, py);
      await wait(500);
      if (await page.evaluate(() => document.querySelectorAll('.ogame-furn').length) > 0) { placedOk = true; break outer; }
    }
  }
  if (!placedOk) throw new Error('未能摆放家具');
  const placed = await page.evaluate(() => ({
    coins: document.querySelector('.ogame-coins')?.textContent?.trim() || '',
    furnCount: document.querySelectorAll('.ogame-furn').length,
  }));
  // 拖动家具挪位：在 furn 盒内找一个真正命中家具的点
  const furnBox = await page.locator('.ogame-furn').first().boundingBox();
  const furnLeft0 = await page.evaluate(() => document.querySelector('.ogame-furn')?.style.left || '');
  let grab = null;
  for (const [rx, ry] of [[0.5, 0.85], [0.5, 0.6], [0.3, 0.7], [0.7, 0.7], [0.5, 0.4]]) {
    const px = furnBox.x + furnBox.width * rx;
    const py = furnBox.y + furnBox.height * ry;
    const hitFurn = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ogame-furn'), [px, py]);
    if (hitFurn) { grab = { px, py }; break; }
  }
  if (!grab) throw new Error('家具被遮挡，找不到可抓取点');
  await page.mouse.move(grab.px, grab.py);
  await page.mouse.down();
  await page.mouse.move(grab.px - 140, grab.py, { steps: 8 });
  await page.mouse.up();
  await wait(500);
  const furnLeft1 = await page.evaluate(() => document.querySelector('.ogame-furn')?.style.left || '');
  // 点击收回（返一半 = 8）：同样找可点位置
  const furnBox2 = await page.locator('.ogame-furn').first().boundingBox();
  let clickPt = null;
  for (const [rx, ry] of [[0.5, 0.85], [0.5, 0.6], [0.3, 0.7], [0.7, 0.7], [0.5, 0.4]]) {
    const px = furnBox2.x + furnBox2.width * rx;
    const py = furnBox2.y + furnBox2.height * ry;
    const hitFurn = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ogame-furn'), [px, py]);
    if (hitFurn) { clickPt = { px, py }; break; }
  }
  if (!clickPt) throw new Error('家具被遮挡，找不到可点击点');
  await page.mouse.click(clickPt.px, clickPt.py);
  await wait(600);
  const removed = await page.evaluate(() => ({
    coins: document.querySelector('.ogame-coins')?.textContent?.trim() || '',
    furnCount: document.querySelectorAll('.ogame-furn').length,
  }));
  console.log('[probe] decor:', JSON.stringify(decor), 'placed:', JSON.stringify(placed));
  console.log('[probe] furn move:', furnLeft0, '->', furnLeft1, 'removed:', JSON.stringify(removed));

  // ④ 思考气泡 CSS 就位（结构由真实工作状态触发，这里验证样式已注入）
  const thinkCss = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) {
          if (r.selectorText && r.selectorText.includes('.ogame-think')) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });

  const coins0 = parseInt(decor.coins.replace(/\D/g, ''), 10);
  const coins1 = parseInt(placed.coins.replace(/\D/g, ''), 10);
  const coins2 = parseInt(removed.coins.replace(/\D/g, ''), 10);
  ok = mini.statsW <= 46 && mini.barH <= 5
    && (lunchNow || wandered)
    && decor.catalog === 5 && decor.furnCount === 0
    && placed.furnCount === 1 && coins1 === coins0 - 15
    && furnLeft0 !== furnLeft1
    && removed.furnCount === 0 && coins2 === coins1 + 8
    && thinkCss
    && pageErrors.length === 0;
  console.log('[probe] thinkCss:', thinkCss, 'coins:', coins0, '->', coins1, '->', coins2);
  console.log('[probe] pageErrors:', pageErrors.length, pageErrors.slice(0, 3));
  console.log(ok ? 'PROBE PASS' : 'PROBE FAIL');
  await browser.close();
} catch (e) {
  console.log('[probe] error:', e?.message || e);
  console.log('PROBE FAIL');
} finally {
  server.kill('SIGTERM');
}
process.exit(ok ? 0 : 1);
