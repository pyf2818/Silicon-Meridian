/**
 * v24 视觉探针（确定性引导版）—— 4 项需求结构化验证
 *  #1 股市AI大师：prompt 单测已覆盖（老舵主 persona / 两层级输出），此处跳过 UI
 *  #2 用户广场：紧凑头 + 侧边抽屉详情 + 发布资源导入（CommunityPage 单文件重写）
 *  #3/#5 联系人页：紧凑头部无长描述 + chat-page-full 满屏 + 从社区发现 + 删除确认 + 火花常量
 *  #4 无限画布：边 data-edge-key 直写跟随拖拽（d 变化）+ 路由规则行（算子下拉）
 *     + 并行视角提示 + skill 卡片与执行模式 + 类型导语
 * 运行：PW_OUT=.pw-v24 node screenshots/_probe_v24.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5177';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('meridian_onboarding_done', 'true');
  localStorage.setItem('onboarding_done', 'true');
  localStorage.setItem('hasSeenOnboarding', 'true');
  localStorage.setItem('meridian_onboarded', '1');
  localStorage.setItem('sidebarCollapsed', 'false');
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}

/* ===== 体验模式登录 ===== */
await page.evaluate(() => {
  [...document.querySelectorAll('button, a, [class*="nav"]')].find(el => el.textContent.trim() === '登录' || el.textContent.includes('登录'))?.click();
});
await page.waitForTimeout(600);
await page.click('.auth-guest-btn, [data-testid="auth-guest"]').catch(() => {});
await page.waitForTimeout(1500);
const loggedIn = await page.evaluate(() => {
  const t = document.body.textContent || '';
  return !document.querySelector('.auth-shell') && (t.includes('体验用户') || t.includes('退出'));
});
console.log('登录(体验模式):', JSON.stringify({ loggedIn }));

/* ===== #5 联系人页 ===== */
await page.evaluate(() => {
  const item = [...document.querySelectorAll('button, a, [class*="nav-item"], [class*="nav"] [role="button"]')]
    .filter(el => el.offsetParent)
    .find(el => (el.getAttribute('aria-label') || el.textContent || '').trim().includes('联系人'));
  item?.click();
});
await page.waitForTimeout(1500);
const p5 = await page.evaluate(() => {
  const header = document.querySelector('.chat-header-compact');
  const h1 = header?.querySelector('h1')?.textContent || '';
  const hasOldDesc = !!document.querySelector('.chat-header p');
  const full = !!document.querySelector('.chat-page-full');
  const layoutFills = (() => {
    const el = document.querySelector('.chat-layout');
    if (!el) return false;
    return el.getBoundingClientRect().height > 500;
  })();
  const discoverBtn = [...document.querySelectorAll('.chat-contacts button')].some(btn => btn.textContent.includes('从社区发现'));
  const groupCreate = !!document.querySelector('.chat-group-create');
  return { h1, hasOldDesc, full, layoutFills, discoverBtn, groupCreate };
});
console.log('#5 联系人页结构:', JSON.stringify(p5));
// 打开「从社区发现」面板（无社区数据时也应渲染空态提示 + 手动添加输入）
await page.evaluate(() => {
  [...document.querySelectorAll('.chat-contacts button')].find(btn => btn.textContent.includes('从社区发现'))?.click();
});
await page.waitForTimeout(900);
const p5b = await page.evaluate(() => ({
  discoverPanel: !!document.querySelector('.chat-discover'),
  manualInput: !!document.querySelector('.chat-discover-manual input'),
}));
console.log('#5 好友发现面板:', JSON.stringify(p5b));

/* ===== #2 用户广场 ===== */
await page.evaluate(() => {
  const item = [...document.querySelectorAll('button, a, [class*="nav-item"], [class*="nav"] [role="button"]')]
    .filter(el => el.offsetParent)
    .find(el => (el.getAttribute('aria-label') || el.textContent || '').trim().includes('用户广场'));
  item?.click();
});
await page.waitForTimeout(1500);
const p2pre = await page.evaluate(() => {
  const openBtn = document.querySelector('[data-testid="community-open-composer"]');
  openBtn?.click();
  return { openBtnFound: !!openBtn };
});
await page.waitForTimeout(600);
const p2 = await page.evaluate(() => {
  const header = document.querySelector('.community-header-compact');
  const composerImport = !!document.querySelector('.community-compose-import');
  const feedCards = document.querySelectorAll('.community-post-excerpt').length;
  return { compactHeader: !!header, openComposer: Boolean(document.querySelector('[data-testid="community-open-composer"]')), composerImport, feedCards };
});
console.log('#2 用户广场结构:', JSON.stringify({ ...p2, ...p2pre }));

/* ===== #4 无限画布（独立 context，直入画布） ===== */
const ctx2 = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
await ctx2.addInitScript(() => {
  localStorage.setItem('meridian_onboarding_done', 'true');
  localStorage.setItem('onboarding_done', 'true');
  localStorage.setItem('hasSeenOnboarding', 'true');
  localStorage.setItem('meridian_onboarded', '1');
  localStorage.setItem('nav', 'canvas');
  localStorage.setItem('sidebarCollapsed', 'false');
});
const page2 = await ctx2.newPage();
const errs2 = [];
page2.on('pageerror', e => errs2.push(String(e.message).slice(0, 160)));
await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(3500);
const canvasReady = await page2.evaluate(() => Boolean(document.querySelector('.wf-canvas')) && document.querySelectorAll('.wf-node').length >= 2);
console.log('#4 画布就绪:', JSON.stringify({ canvasReady, nodes: await page2.evaluate(() => document.querySelectorAll('.wf-node').length) }));

/* 4a-1：边带 data-edge-key */
const p4keys = await page2.evaluate(() => ({
  edgeKeyPaths: document.querySelectorAll('.wf-edges path[data-edge-key]').length,
}));
console.log('#4a 边 key 注入:', JSON.stringify(p4keys));

/* 4a-2：拖拽节点时边 d 实时变化（松手前读取） */
let p4drag = { skipped: true };
if (canvasReady && p4keys.edgeKeyPaths > 0) {
  const nodeBox = await page2.evaluate(() => {
    const nodes = [...document.querySelectorAll('.wf-node')];
    const target = nodes[1];
    const r = target.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: target.getAttribute('data-node-id') };
  });
  const dBefore = await page2.evaluate(() => document.querySelector('.wf-edges path[data-edge-key]')?.getAttribute('d'));
  await page2.mouse.move(nodeBox.x, nodeBox.y);
  await page2.mouse.down();
  await page2.mouse.move(nodeBox.x + 120, nodeBox.y + 80, { steps: 8 });
  await page2.waitForTimeout(220); // 等 rAF 落帧
  const dDuring = await page2.evaluate(() => document.querySelector('.wf-edges path[data-edge-key]')?.getAttribute('d'));
  await page2.mouse.up();
  await page2.waitForTimeout(400);
  const dAfter = await page2.evaluate(() => document.querySelector('.wf-edges path[data-edge-key]')?.getAttribute('d'));
  p4drag = {
    skipped: false,
    changedDuringDrag: dBefore !== dDuring,
    consistentAfterCommit: dDuring === dAfter || dBefore !== dAfter,
  };
}
console.log('#4a 边跟随拖拽:', JSON.stringify(p4drag));

/* 4b/4c：路由节点 → 配置卡（类型导语 + 规则行 + 算子下拉） */
async function createAndSelect(typeLabel) {
  await page2.evaluate((label) => {
    const item = [...document.querySelectorAll('.wf-palette-item')].find(el => el.textContent.includes(label));
    item?.click();
  }, typeLabel);
  await page2.waitForTimeout(500);
  // 选中新建节点：节点列表的最后一个
  await page2.evaluate(() => {
    const nodes = [...document.querySelectorAll('.wf-node')];
    nodes[nodes.length - 1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    nodes[nodes.length - 1]?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
  await page2.waitForTimeout(400);
}
await createAndSelect('路由');
const p4router = await page2.evaluate(() => {
  const editor = document.querySelector('.canvas-node-editor');
  const guide = editor?.querySelector('.canvas-node-guide')?.textContent || '';
  const ruleRows = editor?.querySelectorAll('.canvas-router-rule').length || 0;
  const operatorSelect = !!editor?.querySelector('.canvas-router-rule select');
  const addBtn = !!editor?.querySelector('.canvas-router-add');
  return { editorShown: !!editor, guideShown: guide.length > 0, guideText: guide.slice(0, 30), ruleRows, operatorSelect, addBtn };
});
console.log('#4c 路由面板:', JSON.stringify(p4router));

await createAndSelect('并行');
const p4parallel = await page2.evaluate(() => {
  const editor = document.querySelector('.canvas-node-editor');
  const hint = editor?.querySelector('.canvas-node-hint-wide')?.textContent || '';
  return { editorShown: !!editor, perspectiveHint: hint.includes('视角') && hint.includes('事实核查'), branchInput: !!editor?.querySelector('input[type="number"]') };
});
console.log('#4c 并行面板:', JSON.stringify(p4parallel));

await createAndSelect('工具 Skills');
const p4skill = await page2.evaluate(() => {
  const editor = document.querySelector('.canvas-node-editor');
  const cards = editor?.querySelectorAll('.canvas-skill-card').length || 0;
  const modeSelect = [...(editor?.querySelectorAll('select') || [])].some(sel => [...sel.options].some(o => o.value === 'ai'));
  return { editorShown: !!editor, skillCards: cards, modeSelect };
});
console.log('#4d 技能面板:', JSON.stringify(p4skill));

/* ===== 汇总 ===== */
console.log('PAGE_ERRORS_MAIN:', JSON.stringify(errs));
console.log('PAGE_ERRORS_CANVAS:', JSON.stringify(errs2));
await b.close();
