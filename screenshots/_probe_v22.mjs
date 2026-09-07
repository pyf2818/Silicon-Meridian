/**
 * v22 视觉探针 —— 3 项需求结构化验证
 *  #1 画像敏感度：预览入 readingHistory（depth=preview）→ 8s 升级 full → profileModel 统计
 *  #2 知识图谱：工具条/搜索框/类型筛选/枢纽列表/常驻标签/强关联边 + 点击枢纽定位
 *  #3 简化登录：登录弹窗「体验模式」按钮 → 一键登录 → 广场可见帖子（内存模式）
 * 运行：PW_OUT=.pw-v22 node screenshots/_probe_v22.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('meridian_onboarding_done', 'true');
  localStorage.setItem('onboarding_done', 'true');
  localStorage.setItem('hasSeenOnboarding', 'true');
  // 预置素材库数据（#2 图谱）
  localStorage.setItem('materials', JSON.stringify([
    { id: 'm1', title: 'GPT-5 观点笔记', type: 'viewpoint', tags: ['AI', '大模型'], source: '探针', content: 'x', createdAt: Date.now() },
    { id: 'm2', title: 'Agent 框架调研', type: 'case', tags: ['AI', 'Agent'], source: '探针', content: 'x', createdAt: Date.now() },
    { id: 'm3', title: '芯片产能数据', type: 'data', tags: ['芯片', 'AI'], source: '探针', content: 'x', createdAt: Date.now() },
    { id: 'm4', title: '推理成本金句', type: 'quote', tags: ['成本'], source: '探针', content: 'x', createdAt: Date.now() },
    { id: 'm5', title: '大模型榜单', type: 'chart', tags: ['大模型'], source: '探针', content: 'x', createdAt: Date.now() },
  ]));
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
try { const c = await page.$('button.collapse-btn'); if (c) await c.click(); } catch {}

/* ===== #3 体验模式登录（先登录，画像/广场才能看） ===== */
const p3 = {};
await page.evaluate(() => {
  [...document.querySelectorAll('button, a, [class*="nav"]')].find(el => el.textContent.trim() === '登录' || el.textContent.includes('登录'))?.click();
});
await page.waitForTimeout(600);
p3.guestBtnVisible = await page.evaluate(() => Boolean(document.querySelector('.auth-guest-btn, [data-testid="auth-guest"]')));
await page.click('.auth-guest-btn, [data-testid="auth-guest"]').catch(() => {});
await page.waitForTimeout(1500);
p3.loggedIn = await page.evaluate(() => {
  const t = document.body.textContent || '';
  return !document.querySelector('.auth-shell') && (t.includes('体验用户') || t.includes('退出'));
});
console.log('#3 体验模式登录:', JSON.stringify(p3));

/* ===== #1 预览行为入画像 ===== */
const p1 = await page.evaluate(async () => {
  const preview = await import('/src/store/newsPreviewStore.js');
  const behavior = await import('/src/store/behaviorStore.js');
  preview.useNewsPreviewStore.getState().open({
    id: 'probe-p1', title: '画像探针文章', summary: '摘要', source: '探针源',
    url: 'https://probe.example.com/p1', publishedAt: new Date().toISOString(), imageUrl: '',
    tags: ['AI', '芯片'],
  });
  await new Promise(r => setTimeout(r, 500));
  const hist1 = behavior.useBehaviorStore.getState().readingHistory.find(x => x.id === 'probe-p1');
  return { recorded: Boolean(hist1), depth1: hist1?.depth, via: hist1?.via, tags: hist1?.tags };
});
console.log('#1 预览即时入账:', JSON.stringify(p1));
// 停留 8s 等升级 full
await page.waitForTimeout(8300);
const p1b = await page.evaluate(async () => {
  const behavior = await import('/src/store/behaviorStore.js');
  const profile = await import('/src/utils/profileModel.js');
  const entry = behavior.useBehaviorStore.getState().readingHistory.find(x => x.id === 'probe-p1');
  const engine = profile.computeProfileLearningEngine({
    readingHistory: behavior.useBehaviorStore.getState().readingHistory,
    bookmarks: [], materials: [], selectedInterests: [], recommendationFeedback: {}, followKeywords: [],
  });
  return { depth2: entry?.depth, previewCount: entry?.previewCount, enginePreviewCount: engine.previewCount, engineFullCount: engine.fullReadCount, confidence: engine.confidence, topTags: engine.topTags.slice(0, 3).map(t => t.name) };
});
console.log('#1 停留升级+画像统计:', JSON.stringify(p1b));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ===== #2 知识图谱 ===== */
await page.locator('.nav-primary-item', { hasText: '素材管理' }).first().click().catch(async () => {
  await page.evaluate(() => { [...document.querySelectorAll('button, a')].find(el => el.textContent.includes('素材管理') || el.textContent.includes('智创中心'))?.click(); });
});
await page.waitForTimeout(1200);
await page.evaluate(() => { [...document.querySelectorAll('button')].find(el => el.getAttribute('title')?.includes('知识图谱'))?.click(); });
await page.waitForTimeout(1800); // 等力导向布局
const p2 = await page.evaluate(() => {
  const graph = document.querySelector('.material-graph');
  return {
    graphRendered: Boolean(graph?.querySelector('canvas')),
    toolbar: Boolean(graph?.querySelector('.material-graph-toolbar')),
    searchInput: Boolean(graph?.querySelector('.material-graph-search input')),
    statsText: graph?.querySelector('.material-graph-stats')?.textContent || '',
    filterChips: graph?.querySelectorAll('.material-graph-filters button').length || 0,
    hubButtons: [...(graph?.querySelectorAll('.material-graph-hubs button') || [])].map(x => x.textContent.trim().slice(0, 14)),
    labelToggle: graph?.querySelector('.material-graph-actions button')?.textContent || '',
    legendHasStrongLink: (graph?.querySelector('.material-graph-legend')?.textContent || '').includes('强关联'),
  };
});
console.log('#2 图谱结构:', JSON.stringify(p2));
// 枢纽点击定位 + 类型筛选
const p2b = await page.evaluate(async () => {
  const graph = document.querySelector('.material-graph');
  const hubs = graph.querySelectorAll('.material-graph-hubs button');
  const hubBefore = hubs.length;
  if (hubs[0]) hubs[0].click();
  await new Promise(r => setTimeout(r, 500));
  // 类型筛选：点第二个 chip（第一个是“全部类型”）
  const chips = graph.querySelectorAll('.material-graph-filters button');
  if (chips[1]) chips[1].click();
  await new Promise(r => setTimeout(r, 700));
  const statsAfter = graph.querySelector('.material-graph-stats')?.textContent || '';
  // 搜索
  const input = graph.querySelector('.material-graph-search input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'GPT');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  return { hubBefore, statsAfter, searchOk: Boolean(input) };
});
console.log('#2 图谱交互:', JSON.stringify(p2b));

/* ===== #3 广场可见内存帖子 ===== */
await page.locator('.nav-primary-item', { hasText: '广场' }).first().click().catch(() => {});
await page.waitForTimeout(2000);
const p3b = await page.evaluate(() => ({
  squareContent: (document.body.textContent || '').includes('体验模式首帖'),
}));
console.log('#3 广场内存帖子可见:', JSON.stringify(p3b));

console.log('PAGEERRORS:', JSON.stringify(errs));
await b.close();
