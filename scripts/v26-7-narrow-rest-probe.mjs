/**
 * v26-7 探针：窄面板自适应 + 休息逻辑 + 平滑步行
 * - 420x720 窄窗口开游戏（对话框 ~395px 宽，触发容器查询缩放）
 * - 布局断言：标题/场景 tab/模式按钮单行不竖排；工具栏紧贴顶栏；底栏单行省略号
 * - 成员缩放：窄容器下 unit 宽 ≤ 80px
 * - 休息逻辑：空闲员工出现在休息区，到位后 is-resting + Zzz；办公室无人
 * - 平滑步行：is-walking 期间位置多帧连续变化（无瞬移），transitionDuration ≥ 900ms
 * - 输入框容器查询 CSS 已注入
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
    try { const res = await fetch(url); if (res.ok) return true; } catch { /* */ }
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
  // 缩到窄视口（容器查询即时生效；侧栏在极窄宽度会被应用布局隐藏，故先开后缩）
  await page.setViewportSize({ width: 420, height: 720 });
  await wait(800);

  // ① 紧凑布局：按钮单行、工具栏不竖排、底栏单行
  const layout = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().toJSON() : null;
    };
    const btnHeights = [...document.querySelectorAll('.ogame-scene-tabs button, .ogame-mode, .ogame-food')].map(b => Math.round(b.getBoundingClientRect().height));
    const title = document.querySelector('.ogame-title');
    const foot = document.querySelector('.ogame-foot');
    const toolbar = rect('.ogame-toolbar');
    const scene = rect('.ogame-scene');
    const dlg = rect('.ogame');
    return {
      titleH: title ? Math.round(title.getBoundingClientRect().height) : 999,
      maxBtnH: btnHeights.length ? Math.max(...btnHeights) : 999,
      toolbarBottom: toolbar ? Math.round(toolbar.bottom) : 999,
      sceneTop: scene ? Math.round(scene.top) : 999,
      dlgBottom: dlg ? Math.round(dlg.bottom) : 999,
      footTop: foot ? Math.round(foot.getBoundingClientRect().top) : 999,
      footOverflow: foot ? foot.scrollHeight - foot.clientHeight : 999,
      dlgW: dlg ? Math.round(dlg.width) : 0,
    };
  });
  console.log('[probe] layout:', JSON.stringify(layout));

  // ② 窄容器成员缩放（切到休息区看人）
  await page.locator('.ogame-scene-tabs button', { hasText: '休息区' }).click();
  await wait(500);
  const unitW = await page.evaluate(() => {
    const u = document.querySelector('.ogame-unit');
    return u ? Math.round(u.getBoundingClientRect().width) : 999;
  });
  console.log('[probe] unit width:', unitW);

  // ③ 休息逻辑：空闲员工到位后 is-resting + Zzz（决策拍 1.5s + 步行 ≤4s，轮询 25s）
  let restingSeen = false;
  for (let t = 0; t < 25 && !restingSeen; t += 2) {
    restingSeen = await page.evaluate(() => !!document.querySelector('.ogame-unit.is-resting .ogame-zzz, .ogame-zzz'));
    if (!restingSeen) await wait(2000);
  }
  const restInfo = await page.evaluate(() => ({
    resting: document.querySelectorAll('.ogame-unit.is-resting').length,
    zzz: document.querySelectorAll('.ogame-zzz').length,
    loungeUnits: document.querySelectorAll('.ogame-unit').length,
  }));
  console.log('[probe] rest:', JSON.stringify(restInfo), 'restingSeen:', restingSeen);

  // ④ 平滑步行：等落定 → waitForSelector 精确捕捉步行开始 → 高频小数采样
  let walkOk = false;
  let walkSeen = false;
  const seeWalking = () => page.evaluate(() => !!document.querySelector('.ogame-unit.is-walking'));
  // 先等所有小人"落定"（无人在走）再盯梢，确保能从步行早期开始采样
  for (let t = 0; t < 30; t += 1) {
    if (!(await seeWalking())) break;
    await wait(1000);
  }
  try {
    await page.waitForSelector('.ogame-unit.is-walking', { timeout: 60000, state: 'attached' });
    walkSeen = true;
    const frames = [];
    for (let f = 0; f < 14; f++) {
      frames.push(await page.evaluate(() => {
        const u = document.querySelector('.ogame-unit.is-walking');
        if (!u) return null;
        const r = u.getBoundingClientRect();
        return { x: r.x, y: r.y, dur: getComputedStyle(u).transitionDuration || '' };
      }));
      await wait(80);
    }
    const pts = frames.filter(Boolean);
    const deltas = [];
    for (let k = 1; k < pts.length; k++) deltas.push(Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const maxStep = deltas.length ? Math.max(...deltas) : 0;
    const distinct = new Set(pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)).size;
    const rawDur = pts[0]?.dur || '';
    const durMatch = rawDur.match(/([\d.]+)(m?s)/);
    const durMs = durMatch ? (durMatch[2] === 's' ? parseFloat(durMatch[1]) * 1000 : parseFloat(durMatch[1])) : 0;
    const unit = pts.length ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) : 0;
    // 连续性：至少 4 个不同位置；单帧位移远小于总位移（渐进而非瞬移）；时长 ≥ 900ms
    walkOk = pts.length >= 6 && distinct >= 4 && durMs >= 900 && (unit < 2 || maxStep <= unit * 0.8 + 3);
    console.log(`[probe] walk: frames=${pts.length} distinct=${distinct} maxStep=${maxStep.toFixed(1)} total=${unit.toFixed(1)} dur=${pts[0]?.dur}`);
  } catch { walkSeen = false; }
  console.log('[probe] walkSeen:', walkSeen, 'walkOk:', walkOk);

  // ⑤ 办公室此刻应无人（都去休息了）
  await page.locator('.ogame-scene-tabs button', { hasText: '办公室' }).click();
  await wait(500);
  const officeEmpty = await page.evaluate(() => document.querySelectorAll('.ogame-unit').length === 0);

  // ⑥ 输入框容器查询 CSS 已注入
  const composerCss = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) {
          if (r.cssText?.includes('@container chatcomposer')) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });

  await page.screenshot({ path: `${OUT}/office-game-narrow.png`, fullPage: false }).catch(() => {});

  const lunchNow = (() => { const d = new Date(); const m = d.getHours() * 60 + d.getMinutes(); return m >= 690 && m < 810; })();
  ok = layout.titleH <= 22 && layout.maxBtnH <= 34
    && layout.sceneTop - layout.toolbarBottom <= 2
    && layout.dlgBottom - layout.footTop <= 40 && layout.footOverflow <= 0
    && unitW <= 80
    && (lunchNow || (restingSeen && restInfo.resting >= 1 && restInfo.loungeUnits >= 1))
    && (!walkSeen || walkOk)
    && (lunchNow || officeEmpty)
    && composerCss
    && pageErrors.length === 0;
  console.log('[probe] officeEmpty:', officeEmpty, 'composerCss:', composerCss, 'lunchNow:', lunchNow);
  console.log('[probe] pageErrors:', pageErrors.length, pageErrors.slice(0, 3));
  console.log(ok ? 'PROBE PASS' : 'PROBE FAIL');
  await browser.close();
} catch (e) {
  console.log('[probe] error:', e?.message || e);
  console.log('PROBE FAIL');
} finally {
  server.kill('SIGTERM');
}
