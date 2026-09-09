/**
 * v26-4 探针：像素办公室协作监测面板
 * - addInitScript 预置群聊状态（两成员：一个 work running、一个 work done）
 * - 断言：面板挂载、墙/地板/两个小人单元、状态徽章（执行中/已交付）、折叠按钮可用
 * - 只收集 pageerror
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

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore',
});

const pageErrors = [];
let ok = false;
try {
  if (!await waitForServer(BASE)) throw new Error('dev server 未就绪');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('meridian_onboarded', '1');
      const now = Date.now();
      const chat = {
        id: 'gc_probe', name: '探针团队', createdAt: now - 86400000,
        announcement: '探针目标', goal: { status: 'idle', round: 0, maxRounds: 8, updatedAt: now },
        roster: ['scout', 'writer'], profiles: {},
        messages: [
          { id: 'gm1', role: 'user', agentId: '', agentName: '', content: '开始任务', at: now - 300000, status: 'done', meta: null },
          { id: 'gm2', role: 'agent', agentId: 'scout', agentName: '探索者', content: '检索中…', at: now - 20000, status: 'running', meta: { phase: 'work' } },
          { id: 'gm3', role: 'agent', agentId: 'writer', agentName: '撰写者', content: '简报已完成', at: now - 30000, status: 'done', meta: { phase: 'work' } },
        ],
      };
      localStorage.setItem('agentTeamGroupChat', JSON.stringify({ chats: [chat], activeId: 'gc_probe' }));
    } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(6500);

  const state = await page.evaluate(() => {
    const panel = document.querySelector('.team-office');
    const units = Array.from(document.querySelectorAll('.ofc-unit')).map(u => ({
      cls: u.className.replace('ofc-unit', '').trim(),
      chip: u.querySelector('.ofc-chip')?.textContent || '',
      name: u.querySelector('.ofc-name')?.textContent || '',
      hasPerson: !!u.querySelector('.ofc-person-svg'),
      hasDesk: !!u.querySelector('.ofc-desk-svg'),
    }));
    const wall = !!document.querySelector('.ofc-wall');
    const floor = !!document.querySelector('.ofc-floor');
    return {
      hasPanel: !!panel,
      live: panel?.querySelector('.team-office-live')?.textContent?.trim() || '',
      wall, floor, units,
    };
  });
  console.log('[probe] office:', JSON.stringify(state, null, 1));

  // 折叠/展开
  await page.locator('.team-office-fold').click();
  await wait(600);
  const collapsed = await page.evaluate(() => document.querySelector('.team-office')?.classList.contains('is-collapsed'));
  await page.locator('.team-office-fold').click();
  await wait(600);
  const expanded = await page.evaluate(() => !document.querySelector('.team-office')?.classList.contains('is-collapsed'));

  await page.screenshot({ path: `${OUT}/office-panel.png`, fullPage: false }).catch(() => {});

  const units = state.units;
  // 注意：持久化加载时 sanitizeMessages 会把历史 running 占位落定为 done（崩溃恢复设计），
  // 故探针预置的「running」必然显示为已交付——执行中/思考中等真实运行态由 officeScene 单测覆盖。
  const hasDelivered = units.some(u => u.chip === '已交付');
  const hasName = units.some(u => u.name === '撰写者'); // preset 解析链路（resolveMemberPreset）
  ok = state.hasPanel && state.wall && state.floor
    && units.length === 2
    && units.every(u => u.hasPerson && u.hasDesk)
    && hasDelivered && hasName
    && collapsed === true && expanded === true
    && pageErrors.length === 0;
  console.log('[probe] fold collapsed/expanded:', collapsed, expanded);
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
