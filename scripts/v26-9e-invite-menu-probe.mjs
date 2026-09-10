/**
 * v26.9e 探针：团队群聊「＋邀请」下拉不再被面板裁剪
 *
 * 复现路径：AI 工作站 → 左侧「团队」tab → 顶栏 ⓘ 打开群信息面板 → 点「＋ 邀请」
 * 断言：
 *   1. 菜单出现在 DOM 且已 portal 到 body（脱离 .gtc-panel 的 overflow-y:auto）
 *   2. 菜单完整落在视口内、无裁剪祖先
 *   3. 菜单中心可被命中（真正可见可点）
 *   4. 菜单里的「创建自定义角色」按钮可点（点击后打开角色卡、菜单关闭）
 *   5. 全程 pageerror 为空
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
await page.addInitScript(() => {
  try {
    localStorage.setItem('meridian_onboarded', '1');
    localStorage.setItem('sidebarCollapsed', 'false');
    localStorage.removeItem('teamOfficePanelCollapsed');
  } catch {}
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // AI 工作站
  const navBtn = page.locator('.nav-primary-item', { hasText: 'AI 工作站' }).first();
  if (await navBtn.count()) await navBtn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // 左侧「团队」tab
  const teamTab = page.locator('.session-tab', { hasText: '团队' }).first();
  await teamTab.waitFor({ state: 'visible', timeout: 10000 });
  await teamTab.click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  check('进入团队群聊页', (await page.locator('.gtc-main, .team-center-col').count()) > 0);

  // 顶栏 ⓘ 打开群信息面板
  const panelToggle = page.locator('.gtc-panel-toggle').first();
  await panelToggle.waitFor({ state: 'visible', timeout: 8000 });
  await panelToggle.click({ timeout: 8000 });
  await page.waitForTimeout(800);
  const panel = page.locator('.gtc-panel').first();
  check('群信息面板已打开', (await panel.count()) > 0 && await panel.isVisible());

  // 「＋ 邀请」按钮
  const inviteBtn = page.locator('.gtc-panel-member-add').first();
  await inviteBtn.waitFor({ state: 'visible', timeout: 8000 });
  const disabled = await inviteBtn.isDisabled();
  check('「＋邀请」按钮可用（未因满员/运行中禁用）', !disabled, `disabled=${disabled}`);

  await inviteBtn.click({ timeout: 8000 });
  await page.waitForTimeout(600);

  const menuInfo = await page.evaluate(() => {
    const menu = document.querySelector('.gtc-invite-menu');
    if (!menu) return { exists: false };
    const r = menu.getBoundingClientRect();
    let clippedBy = null;
    let p = menu.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1) {
          clippedBy = { cls: String(p.className).slice(0, 60), overflow: `${cs.overflowX}/${cs.overflowY}` };
        }
        break;
      }
      p = p.parentElement;
    }
    const cx = r.x + r.width / 2;
    const cy = r.y + Math.min(r.height / 2, r.height - 8);
    const hit = document.elementFromPoint(cx, cy);
    // 面板自身的裁剪情况（修复前菜单就是被它切掉的）
    const panel = document.querySelector('.gtc-panel');
    const panelOverflow = panel ? getComputedStyle(panel).overflowY : null;
    return {
      exists: true,
      parent: menu.parentElement.tagName,
      box: { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right },
      clippedBy,
      hitInMenu: hit ? menu.contains(hit) : null,
      hitTag: hit ? hit.tagName : null,
      panelOverflow,
      itemCount: menu.querySelectorAll('button').length,
    };
  });

  check('「＋邀请」菜单已渲染', menuInfo.exists === true);
  if (menuInfo.exists) {
    check('菜单已 portal 到 body（脱离 .gtc-panel 裁剪）', menuInfo.parent === 'BODY', `parent=${menuInfo.parent} panelOverflow=${menuInfo.panelOverflow}`);
    check('菜单有可选项', menuInfo.itemCount > 0, `buttons=${menuInfo.itemCount}`);
    check('菜单可见（宽高 > 0）', menuInfo.box.w > 0 && menuInfo.box.h > 0, `box=${JSON.stringify(menuInfo.box)}`);
    check('菜单完整落在视口内且无裁剪祖先',
      menuInfo.box.bottom <= 901 && menuInfo.box.y >= 0 && !menuInfo.clippedBy,
      `bottom=${menuInfo.box.bottom?.toFixed(0)} clippedBy=${menuInfo.clippedBy ? JSON.stringify(menuInfo.clippedBy) : '无'}`);
    check('菜单中心可被命中（真正可见可点）', menuInfo.hitInMenu === true, `hit=${menuInfo.hitTag} inMenu=${menuInfo.hitInMenu}`);
  }

  // 「＋ 创建自定义角色」可点 → 角色卡打开、菜单关闭
  const createBtn = page.locator('.gtc-invite-create').first();
  if (await createBtn.count()) {
    await createBtn.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    const afterClick = await page.evaluate(() => ({
      menuGone: !document.querySelector('.gtc-invite-menu'),
      roleCardOpen: !!document.querySelector('.gtc-rolecard, .gtc-role-card, .gtc-modal, .role-card'),
    }));
    check('点击「创建自定义角色」→ 菜单关闭', afterClick.menuGone === true);
    check('点击「创建自定义角色」→ 角色卡/弹窗打开', afterClick.roleCardOpen === true, `roleCardOpen=${afterClick.roleCardOpen}`);
  }

  check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check(`探针执行异常：${err.message}`, false);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== v26.9e 邀请菜单：${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length) { console.log('失败项：'); failed.forEach((f) => console.log(` - ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
