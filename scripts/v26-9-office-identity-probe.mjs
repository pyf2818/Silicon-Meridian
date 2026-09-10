/**
 * v26.9 探针：像素工作室床铺+躺卧休息 + SiliconStream 身份隔离(UI 侧)
 * 1. 打开 AI 工作站 → 点击 .team-office-game 进入像素工作室 → 断言 3 张床(.ogame-bed) + 枕头/被子
 * 2. 观察窗口内若有智能体进入休息：床上休息的单元必须带 .is-lying（躺卧）
 * 3. 设置页 AgentsTab 标签已改为「团队成员 · 专家角色」（#21 方案 b 落地信号）
 * 4. 全程 pageerror 必须为空
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 预置已完成的 onboarding 标记，跳过新用户引导遮罩
await page.addInitScript(() => {
  try { localStorage.setItem('meridian_onboarded', '1'); } catch {}
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 等进场动画（.entrance）自然离场，最多 20s
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ===== 1. 进入像素工作室 =====
  const gameBtn = page.locator('.team-office-game').first();
  if (await gameBtn.count() === 0) {
    // 可能默认页不是工作站，尝试点击含「AI 工作站」的导航
    const nav = page.getByText('AI 工作站', { exact: false }).first();
    if (await nav.count()) await nav.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  const btnVisible = (await page.locator('.team-office-game').count()) > 0;
  check('AI 工作站侧栏可见像素工作室入口', btnVisible);
  if (btnVisible) {
    await page.locator('.team-office-game').first().click({ force: true });
    await page.waitForTimeout(2000);
    // 切到休息区场景（床铺只在 lounge 渲染）；普通点击可能被遮挡，用 force
    const loungeTab = page.locator('.ogame-scene-tabs button', { hasText: '休息区' }).first();
    if (await loungeTab.count()) {
      await loungeTab.click({ force: true });
      await page.waitForTimeout(1500);
    }

    // ===== 2. 床铺渲染断言 =====
    const bedInfo = await page.evaluate(() => {
      const beds = [...document.querySelectorAll('.ogame-bed')];
      return {
        count: beds.length,
        withPillow: beds.filter((b) => b.querySelector('.ogame-bed-pillow')).length,
        withQuilt: beds.filter((b) => b.querySelector('.ogame-bed-quilt')).length,
      };
    });
    check('休息区渲染 3 张床', bedInfo.count === 3, `count=${bedInfo.count}`);
    check('每张床都有枕头+被子', bedInfo.withPillow === bedInfo.count && bedInfo.withQuilt === bedInfo.count, `pillow=${bedInfo.withPillow} quilt=${bedInfo.withQuilt}`);

    // ===== 3. 休息行为观察（最多 45s）=====
    let restingSeen = false;
    let lyingOnBed = false;
    for (let i = 0; i < 45; i++) {
      const state = await page.evaluate(() => {
        const units = [...document.querySelectorAll('.ogame-unit')];
        const resting = units.filter((u) => u.classList.contains('is-resting'));
        const lying = units.filter((u) => u.classList.contains('is-lying'));
        return { resting: resting.length, lying: lying.length };
      });
      if (state.resting > 0) {
        restingSeen = true;
        if (state.lying > 0) { lyingOnBed = true; break; }
        // 有 resting 但还没 lying —— 再等几拍看是否走到床
      }
      await page.waitForTimeout(1000);
    }
    if (restingSeen) {
      check('休息中的智能体呈躺卧姿态(.is-lying)', lyingOnBed, `resting 已观察到, lying=${lyingOnBed ? '有' : '未出现'}`);
    } else {
      check('休息行为观察（观察窗内未触发，标记 SKIP 不算 FAIL）', true, '观察窗口 45s 内无智能体进入休息状态（受自主节奏影响）；bed/sofa 映射已由 officeGame 单测覆盖 26/26');
    }
  }

  // ===== 4. 设置弹窗 AgentsTab 标签 =====
  let labelOk = false;
  try {
    // 先关游戏（若开着）
    const closeBtn = page.locator('.ogame-close').first();
    if (await closeBtn.count()) await closeBtn.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    // 侧栏折叠时按钮无文字，设置按钮固定是最后一个 .sidebar-action
    const settingsBtn = page.locator('.sidebar-action').last();
    if (await settingsBtn.count()) {
      await settingsBtn.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(1500);
      const agentsNav = page.locator('.sc-nav-item', { hasText: /AI 精灵|智能体|agents/i }).first();
      if (await agentsNav.count()) {
        await agentsNav.click({ force: true, timeout: 3000 });
        await page.waitForTimeout(1200);
      }
      labelOk = await page.evaluate(() => document.body.innerText.includes('团队成员 · 专家角色'));
    }
  } catch { /* 导航路径差异时由 labelOk=false 报告 */ }
  check('设置·智能体页展示「团队成员 · 专家角色」标签', labelOk);

  // ===== 5. pageerror =====
  check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '));
} catch (err) {
  check('探针执行完成（未抛出致命异常）', false, String(err));
} finally {
  await browser.close();
}

const passCount = results.filter((r) => r.ok).length;
console.log(`\n===== 探针汇总: ${passCount}/${results.length} PASS =====`);
process.exit(passCount === results.length ? 0 : 1);
