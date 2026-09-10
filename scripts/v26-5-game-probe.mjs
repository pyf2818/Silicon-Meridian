/**
 * v26-5 探针：像素养成模拟游戏 OfficeGame
 * - 预置群聊（2 成员）→ 点「养成」开游戏大屏
 * - 断言：顶栏经费/场景 tab/成员+三维属性条渲染
 * - 投喂链路：切投喂模式 → 选饭团 → 点成员 → 经费 240→230 且饱食条变宽
 * - 拖拽：按住成员移动 → 位置变化且松手后保留
 * - 场景切换：休息区（无人提示）→ 切回办公室
 * - 关闭覆盖层
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
      localStorage.removeItem('officeGameState'); // 干净开局（默认经费 240）
    } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(6500);

  // 开游戏
  await page.locator('.team-office-game').click();
  await wait(1000);
  const opened = await page.evaluate(() => ({
    overlay: !!document.querySelector('.ogame-overlay'),
    coins: document.querySelector('.ogame-coins')?.textContent?.trim() || '',
    tabs: document.querySelectorAll('.ogame-scene-tabs button').length,
    units: document.querySelectorAll('.ogame-unit').length,
    barsPerUnit: document.querySelector('.ogame-unit')?.querySelectorAll('.ogame-bar').length || 0,
  }));
  console.log('[probe] opened:', JSON.stringify(opened));

  // 投喂链路
  await page.locator('.ogame-mode', { hasText: '投喂' }).click();
  await wait(300);
  await page.locator('.ogame-food', { hasText: '饭团' }).click();
  await wait(300);
  const before = await page.evaluate(() => {
    const u = document.querySelector('.ogame-unit');
    return {
      coins: document.querySelector('.ogame-coins')?.textContent?.trim() || '',
      hungerW: u?.querySelector('.ogame-bar.is-hunger i')?.style.width || '',
    };
  });
  await page.locator('.ogame-unit').first().click();
  await wait(700);
  const after = await page.evaluate(() => {
    const u = document.querySelector('.ogame-unit');
    return {
      coins: document.querySelector('.ogame-coins')?.textContent?.trim() || '',
      hungerW: u?.querySelector('.ogame-bar.is-hunger i')?.style.width || '',
      bubble: document.querySelector('.ogame-unit .ofc-bubble')?.textContent || '',
    };
  });
  console.log('[probe] feed before:', JSON.stringify(before), 'after:', JSON.stringify(after));

  // 拖拽第一个成员（自主漫步会让小人走动：动态找抓取点 + 重试）
  const leftBefore = await page.evaluate(() => document.querySelector('.ogame-unit')?.style.left || '');
  let leftAfter = leftBefore;
  for (let attempt = 0; attempt < 5 && leftAfter === leftBefore; attempt++) {
    const box = await page.locator('.ogame-unit').first().boundingBox();
    if (!box) break;
    let grab = null;
    for (const [rx, ry] of [[0.5, 0.25], [0.5, 0.4], [0.4, 0.3], [0.6, 0.3]]) {
      const px = box.x + box.width * rx;
      const py = box.y + box.height * ry;
      const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ogame-unit'), [px, py]);
      if (hit) { grab = { px, py }; break; }
    }
    if (!grab) { await wait(1500); continue; }
    await page.mouse.move(grab.px, grab.py);
    await page.mouse.down();
    await page.mouse.move(grab.px + 120, grab.py + 60, { steps: 8 });
    await page.mouse.up();
    await wait(400);
    leftAfter = await page.evaluate(() => document.querySelector('.ogame-unit')?.style.left || '');
    if (leftAfter === leftBefore) await wait(1500); // 可能正被漫步走位，稍等再试
  }
  console.log('[probe] drag left before/after:', leftBefore, '->', leftAfter);

  // 场景切换
  await page.locator('.ogame-scene-tabs button', { hasText: '休息区' }).click();
  await wait(600);
  const loungeEmpty = await page.evaluate(() => !!document.querySelector('.ogame-scene .ofc-empty'));
  await page.locator('.ogame-scene-tabs button', { hasText: '办公室' }).click();
  await wait(600);
  const backUnits = await page.evaluate(() => document.querySelectorAll('.ogame-unit').length);

  // 关闭
  await page.locator('.ogame-close').click();
  await wait(500);
  const closed = await page.evaluate(() => !document.querySelector('.ogame-overlay'));

  await page.screenshot({ path: `${OUT}/office-game.png`, fullPage: false }).catch(() => {});

  const coinsBefore = parseInt(before.coins.replace(/\D/g, ''), 10);
  const coinsAfter = parseInt(after.coins.replace(/\D/g, ''), 10);
  ok = opened.overlay && opened.coins.includes('240') && opened.tabs === 2
    && opened.units === 2 && opened.barsPerUnit === 3
    && coinsAfter === coinsBefore - 10
    && after.hungerW !== before.hungerW
    && leftBefore !== leftAfter
    && loungeEmpty && backUnits === 2 && closed
    && pageErrors.length === 0;
  console.log('[probe] loungeEmpty/backUnits/closed:', loungeEmpty, backUnits, closed);
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
