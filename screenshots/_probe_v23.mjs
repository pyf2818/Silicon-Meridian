/**
 * v23 视觉探针（确定性引导版）—— 5 项需求结构化验证
 *  #1 划词翻译：程序化选区 → 气泡出现（未配 LLM 显示引导错误）→ Esc 关闭；
 *     精灵协作默认配置（elfCollab subagent/team=true）；头像压缩 util 2000px→192px JPEG
 *  #2 素材类型：MATERIAL_TYPES 9 类（含 方法教程/论文研究/资讯事件）
 *  #3 无限画布连线：boot 直入画布 → out 端口拖到目标节点 → .wf-edge-explicit 出现
 *     → store 持久化 → 点选边出现弧度手柄+断开按钮 → 断开恢复 0
 *  #4 侧边栏收起：boot 显式展开 → 点击折叠 → collapsed + nav-label 隐藏 + 无短标签
 *  #5 预览段落缩进：content 两段 → .news-preview-para computed textIndent=2em、lede=0
 * 运行：PW_OUT=.pw-v23 node screenshots/_probe_v23.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5176';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('meridian_onboarding_done', 'true');
  localStorage.setItem('onboarding_done', 'true');
  localStorage.setItem('hasSeenOnboarding', 'true');
  localStorage.setItem('meridian_onboarded', '1');
  localStorage.setItem('sidebarCollapsed', 'false'); // #4 确定性：起始为展开态
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

/* ===== #1a 划词翻译 ===== */
const p1a = await page.evaluate(async () => {
  const target = [...document.querySelectorAll('p, span, h1, h2, b')]
    .find(el => el.offsetParent && el.textContent.trim().length > 20 && !el.closest('input, textarea, .ai-elf'));
  if (!target) return { selected: false, reason: 'no-target' };
  const range = document.createRange();
  range.selectNodeContents(target);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 500, clientY: 400 }));
  await new Promise(r => setTimeout(r, 250));
  const bubble = document.querySelector('.sel-translate-bubble');
  return {
    selected: true,
    bubbleShown: Boolean(bubble),
    errorHint: bubble?.querySelector('.sel-translate-error')?.textContent || '',
    askElfBtn: Boolean(bubble?.querySelector('.sel-translate-actions button:nth-child(2)')),
  };
});
console.log('#1a 划词翻译气泡:', JSON.stringify(p1a));
const p1a2 = await page.evaluate(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  return { closedByEsc: !document.querySelector('.sel-translate-bubble') };
});
console.log('#1a Esc 关闭:', JSON.stringify(p1a2));

/* ===== #1b 精灵协作默认配置 ===== */
const p1b = await page.evaluate(async () => {
  const mod = await import('/src/store/elfStore.js');
  return { elfCollab: mod.useElfStore.getState().elfCollab || null };
});
console.log('#1b 精灵协作配置:', JSON.stringify(p1b));

/* ===== #1c 头像压缩 util ===== */
const p1c = await page.evaluate(async () => {
  const mod = await import('/src/utils/imageCompress.js');
  const c = document.createElement('canvas');
  c.width = 2000; c.height = 1200;
  const g = c.getContext('2d');
  g.fillStyle = '#3366aa'; g.fillRect(0, 0, 2000, 1200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'probe.png', { type: 'image/png' });
  const out = await mod.compressImageFile(file, { maxSize: 192, quality: 0.85 });
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = out; });
  return { isJpeg: out.startsWith('data:image/jpeg'), maxSide: Math.max(img.width, img.height), kb: Math.round(out.length / 1024) };
});
console.log('#1c 头像压缩:', JSON.stringify(p1c));

/* ===== #2 素材类型 9 类 ===== */
const p2 = await page.evaluate(async () => {
  const mod = await import('/src/constants/appConstants.jsx');
  const types = mod.MATERIAL_TYPES || {};
  return { count: Object.keys(types).length, has: ['tutorial', 'paper', 'news'].map(k => Boolean(types[k])) };
});
console.log('#2 素材类型:', JSON.stringify(p2));

/* ===== #4 侧边栏收起仅图标（boot 已显式展开 → 点击折叠） ===== */
const before = await page.evaluate(() => {
  const sb = document.querySelector('.sidebar');
  const label = sb?.querySelector('.nav-label');
  return { collapsed: sb?.classList.contains('collapsed'), labelVisible: label ? getComputedStyle(label).display !== 'none' : false };
});
await page.evaluate(() => document.querySelector('.sidebar .collapse-btn')?.click());
await page.waitForTimeout(400);
const p4 = await page.evaluate(() => {
  const sb = document.querySelector('.sidebar');
  const label = sb?.querySelector('.nav-label');
  const shortLabel = sb?.querySelector('.nav-short-label');
  return {
    collapsed: sb?.classList.contains('collapsed'),
    labelHidden: label ? getComputedStyle(label).display === 'none' : true,
    shortGone: !shortLabel,
  };
});
console.log('#4 侧边栏收起:', JSON.stringify({ before, after: p4 }));
await page.evaluate(() => document.querySelector('.sidebar .collapse-btn')?.click());
await page.waitForTimeout(300);

/* ===== #5 预览段落缩进（url 为空跳过抓取，content 直渲两段） ===== */
const p5 = await page.evaluate(async () => {
  const preview = await import('/src/store/newsPreviewStore.js');
  preview.useNewsPreviewStore.getState().open({
    id: 'probe-v23-p5', title: '缩进探针文章', summary: '摘要', source: '探针源',
    content: '第一段：人工智能技术的演进从来不是单点突破，而是算力、数据与算法三者长期积累之后的涌现结果。过去十年间，模型参数规模从百万级跃升到万亿级，训练成本的下降与推理效率的提升共同推动了这一进程，也让产业界对通用能力的预期不断被重新校准，相关观察值得持续跟踪与验证。\n\n第二段：与此同时，开源生态的繁荣正在改变竞争格局。社区驱动的模型迭代速度惊人，评测基准快速刷新，企业选型时需要在性能、成本、合规与可控性之间反复权衡，任何单一指标的优势都不足以构成决策依据，系统性的评估框架才是关键所在，这也是本段用来验证段落缩进的原因。',
    url: '', publishedAt: new Date().toISOString(), imageUrl: '',
    tags: ['AI'],
  });
  let paras = [];
  for (let i = 0; i < 10; i += 1) {
    await new Promise(r => setTimeout(r, 300));
    paras = [...document.querySelectorAll('.news-preview-para')];
    if (paras.length >= 2) break;
  }
  return {
    paraCount: paras.length,
    firstIndent: paras[0] ? getComputedStyle(paras[0]).textIndent : null,
    firstIsLede: paras[0]?.classList.contains('lede'),
    secondIndent: paras[1] ? getComputedStyle(paras[1]).textIndent : null,
  };
});
console.log('#5 预览缩进:', JSON.stringify(p5));
await page.evaluate(() => { document.querySelector('.news-preview-close')?.click(); });

/* ===== #3 画布连线：独立全新 context（init 直入画布，无需登录） ===== */
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
console.log('#3 画布就绪:', JSON.stringify({ canvasReady, nodes: await page2.evaluate(() => document.querySelectorAll('.wf-node').length) }));

let p3 = { skipped: !canvasReady };
if (canvasReady) {
  const box1 = await page2.evaluate(() => {
    const port = document.querySelector('.wf-port-out');
    const node = port.closest('[data-node-id]');
    const r = port.getBoundingClientRect();
    return { id: node.getAttribute('data-node-id'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const box2 = await page2.evaluate((fromId) => {
    const target = [...document.querySelectorAll('[data-node-id]')].find(n => n.getAttribute('data-node-id') !== fromId);
    const r = target.getBoundingClientRect();
    return { id: target.getAttribute('data-node-id'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, box1.id);
  await page2.mouse.move(box1.x, box1.y);
  await page2.mouse.down();
  await page2.mouse.move((box1.x + box2.x) / 2, (box1.y + box2.y) / 2, { steps: 8 });
  await page2.mouse.move(box2.x, box2.y, { steps: 8 });
  await page2.mouse.up();
  await page2.waitForTimeout(500);
  const afterConnect = await page2.evaluate(() => ({
    explicit: document.querySelectorAll('.wf-edge-explicit').length,
    edgesInStore: JSON.parse(localStorage.getItem('siliconstream-workflow-store') || '{}')?.state?.agentWorkflowDraft?.edges?.length ?? 0,
  }));
  const hitPath = await page2.$('.wf-edge-hit');
  if (hitPath) {
    const hb = await hitPath.boundingBox();
    if (hb) { await page2.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await page2.waitForTimeout(300); }
  }
  const afterSelect = await page2.evaluate(() => ({
    bendHandle: Boolean(document.querySelector('.wf-edge-bend-handle')),
    delBtn: Boolean(document.querySelector('.wf-edge-del')),
  }));
  const del = await page2.$('.wf-edge-del circle');
  if (del) {
    const db = await del.boundingBox();
    if (db) { await page2.mouse.click(db.x + db.width / 2, db.y + db.height / 2); await page2.waitForTimeout(400); }
  }
  const afterDisconnect = await page2.evaluate(() => ({ explicit: document.querySelectorAll('.wf-edge-explicit').length }));
  p3 = { from: box1.id, to: box2.id, afterConnect, afterSelect, afterDisconnect };
}
console.log('#3 画布连线:', JSON.stringify(p3));

/* ===== 汇总 ===== */
console.log('PAGE_ERRORS:', errs.length + errs2.length, errs.concat(errs2).slice(0, 5));
console.log('PROBE_V23_DONE');
await ctx2.close().catch(() => {});
await b.close();
process.exit(0);
