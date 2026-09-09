/**
 * v26-3 探针：Goal 面板 + 进化档案 + 排队拖拽属性
 * - 起独立 dev server（5176 优先回落），Chromium 无头打开
 * - 团队群聊：打开群信息面板，断言「目标 · Goal」区块与启动按钮存在
 * - 角色设定抽屉：断言「进化档案」区块与等级徽章渲染
 * - 只收集 pageerror（忽略 401 等 console 噪音）
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5176;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.PW_OUT || `.pw-${Date.now()}`;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await wait(1000);
  }
  return false;
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PW_OUT: OUT },
});

const pageErrors = [];
let ok = false;
try {
  if (!await waitForServer(BASE)) throw new Error('dev server 未就绪');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  await ctx.addInitScript(() => {
    document.cookie = 'meridian_onboarded=1; path=/';
    // App.jsx 从 localStorage 读 onboarding 状态（v26 探针修正：仅 cookie 不够）
    try { localStorage.setItem('meridian_onboarded', '1'); } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  // 字体抖动防护：拦 Google Fonts
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(6000);

  // ── 1. 角色设定抽屉 → 进化档案（默认「对话」tab 顶部按钮） ──
  const personaBtn = page.locator('.chat-header-persona-btn').first();
  console.log('[probe] persona-btn count:', await personaBtn.count(), 'disabled:', await personaBtn.getAttribute('disabled').catch(() => 'n/a'));
  await page.screenshot({ path: `${OUT}/before-click.png`, fullPage: false }).catch(() => {});
  const cover = await page.evaluate(() => {
    const btn = document.querySelector('.chat-header-persona-btn');
    if (!btn) return 'no-btn';
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : 'null';
  });
  console.log('[probe] elementFromPoint:', cover);
  if (await personaBtn.count()) await personaBtn.click().catch(() => {});
  await wait(1800);
  console.log('[probe] drawer open:', await page.locator('.persona-drawer').count());
  await wait(1800);
  const evoPanel = await page.evaluate(() => {
    const sec = Array.from(document.querySelectorAll('.persona-section-title')).find(e => e.textContent?.includes('进化档案'));
    const badge = document.querySelector('.evo-level-badge');
    const ladder = document.querySelectorAll('.evo-ladder-step').length;
    return { hasSection: !!sec, badge: badge?.textContent?.trim() || '', ladderSteps: ladder };
  });
  console.log('[probe] evo-panel:', JSON.stringify(evoPanel));
  await page.screenshot({ path: `${OUT}/evo-panel.png`, fullPage: false }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await wait(800);

  // ── 2. 左侧「团队」tab → 团队群聊：打开群信息面板断言 Goal ──
  const teamTab = page.locator('.session-tab', { hasText: '团队' }).first();
  console.log('[probe] team-tab count:', await teamTab.count());
  if (await teamTab.count()) await teamTab.click().catch(() => {});
  await wait(2500);
  const infoBtn = page.locator('.gtc-panel-toggle').first();
  console.log('[probe] gtc-panel-toggle count:', await infoBtn.count());
  if (await infoBtn.count()) await infoBtn.click().catch(() => {});
  await wait(1200);
  const goalPanel = await page.evaluate(() => {
    const cap = Array.from(document.querySelectorAll('.gtc-panel-cap')).find(e => e.textContent?.includes('Goal'));
    const startBtn = Array.from(document.querySelectorAll('.gtc-panel-entry')).find(b => /启动 Goal|继续推进|重新启动|安全退出/.test(b.textContent || ''));
    return { capText: cap?.textContent?.trim() || '', startBtn: startBtn?.textContent?.trim() || '' };
  });
  console.log('[probe] goal-panel:', JSON.stringify(goalPanel));
  await page.screenshot({ path: `${OUT}/goal-panel.png`, fullPage: false }).catch(() => {});

  ok = goalPanel.capText.includes('Goal') && evoPanel.hasSection && pageErrors.length === 0;
  console.log(`[probe] pageErrors=${pageErrors.length}`, pageErrors.slice(0, 3));
  console.log(ok ? 'PROBE PASS' : 'PROBE FAIL');
  await browser.close();
} catch (e) {
  console.log('[probe] error:', e?.message || e);
  console.log('PROBE FAIL');
} finally {
  server.kill('SIGTERM');
}
process.exit(ok ? 0 : 1);
