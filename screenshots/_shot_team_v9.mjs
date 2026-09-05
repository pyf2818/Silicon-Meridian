/**
 * 验收「团队群聊 v9」：微信化消息语义 + 右侧群信息面板
 * 预置 localStorage 群聊数据（系统行/认领标签/引用块/失败气泡/时间分隔），
 * 打开工作站 → 团队 tab，做结构断言 + 截图：
 *  1) team-v9-stream   消息流全景（居中系统行、时间分隔线、引用块、失败重试）
 *  2) team-v9-hover    hover 气泡 → 时间/轮数/操作浮现
 *  3) team-v9-panel    右侧群信息面板（公告/成员网格/筛选/快捷入口）
 *  4) team-v9-filter   记录筛选 = 产出
 *  5) team-v9-quote-jump 引用块点击 → 定位+闪烁原消息
 *  6) sidebar-gavatar  侧栏群聊四宫格合成头像
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5175/';
const OUT = 'screenshots/team-v9';
fs.mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const now = Date.now();
const mk = (id, over) => ({ id, role: 'agent', agentId: '', agentName: '', content: '', at: now, status: 'done', meta: null, ...over });

const seed = {
  chats: [{
    id: 'gc_demo',
    name: '调研团队',
    createdAt: now - 30 * MIN,
    announcement: '本周目标：产出一期「端侧模型趋势」深度简报，覆盖推理速度、成本与落地案例。',
    roster: ['explorer', 'writer'],
    profiles: {},
    messages: [
      mk('m1', { role: 'system', content: '创建了群聊「调研团队」', at: now - 30 * MIN }),
      mk('m2', { role: 'system', content: '邀请了「撰写者」加入群聊', at: now - 29 * MIN }),
      mk('m3', { role: 'user', content: '@探索者 检索今天端侧模型的资讯，@撰写者 整理成简报', at: now - 28 * MIN }),
      mk('m4', { role: 'agent', agentId: 'explorer', agentName: '探索者', content: '【认领】这就去检索端侧推理的最新动态，10 分钟内回群。', at: now - 27 * MIN, meta: { phase: 'claim', kind: 'claim', runId: 'run_demo', turns: 1, tokens: 812 } }),
      mk('m5', { role: 'agent', agentId: 'writer', agentName: '撰写者', content: '【关注】素材一到我就动笔，标题已经在想了。', at: now - 27 * MIN + 20_000, meta: { phase: 'claim', kind: 'watch', runId: 'run_demo', turns: 1, tokens: 640 } }),
      mk('m6', { role: 'system', content: '探索者、撰写者 接下了任务，开始接力产出', at: now - 26 * MIN }),
      mk('m7', { role: 'agent', agentId: 'explorer', agentName: '探索者', content: '## 调研结论\n\n- **要点 A**：端侧模型推理速度持续提升，NPU 利用率成为关键指标\n- **要点 B**：小模型成本下降明显，端云协同成主流架构\n\n> 结论：端侧趋势向好，建议持续跟踪。', at: now - 25 * MIN, meta: { phase: 'work', runId: 'run_demo', turns: 3, tokens: 2140 } }),
      // 与上一条间隔 7 分钟 → 应出现时间分隔线
      mk('m8', { role: 'agent', agentId: 'writer', agentName: '撰写者', content: '## 简报初稿\n\n**标题**：端侧模型进入「快车道」\n\n1. 推理速度：NPU 加持下端侧时延进入毫秒级\n2. 成本：小模型单位推理成本同比下降约 60%\n3. 落地：手机、汽车、IoT 三线并进\n\n> 承接探索者的调研：数据已交叉核对，可发布。', at: now - 18 * MIN, meta: { phase: 'work', runId: 'run_demo', turns: 2, tokens: 1730, quote: { from: '探索者', mid: 'm7', text: '要点 A：端侧模型推理速度持续提升 要点 B：小模型成本下降明显 结论：端侧趋势向好，建议持续跟踪。' } } }),
      mk('m9', { role: 'agent', agentId: 'explorer', agentName: '探索者', content: '⚠️ 检索超时：Tavily 上游 504，任务中止', at: now - 12 * MIN, status: 'failed', meta: { phase: 'work', runId: 'run_demo2', turns: 1, tokens: 0 } }),
    ],
  }],
  activeId: 'gc_demo',
};

const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1560, height: 940 },
  colorScheme: 'dark',
  reducedMotion: 'reduce', // 入场动画直接跳过
});
await ctx.addInitScript((s) => {
  localStorage.setItem('agentTeamGroupChat', JSON.stringify(s));
}, seed);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
// 首跑引导如出现则跳过
try {
  const skip = await page.$('button:has-text("跳过")');
  if (skip) await skip.click();
} catch { /* 无引导 */ }

// 进入工作站 → 团队 tab
await page.locator('.nav-primary-item').first().click();
await page.waitForTimeout(700);
await page.locator('.session-tab', { hasText: '团队' }).click();
await page.waitForSelector('.gtc', { timeout: 8000 });
await page.waitForTimeout(900);

// ---- 结构断言 ----
const checks = await page.evaluate(() => ({
  systemLines: [...document.querySelectorAll('.gtc-system-line')].map(x => x.textContent),
  timeDividers: document.querySelectorAll('.gtc-time-divider').length,
  quotes: [...document.querySelectorAll('.gtc-quote')].map(x => x.querySelector('.gtc-quote-from')?.textContent),
  founderAvatars: document.querySelectorAll('.gtc-avatar-founder').length,
  mentions: document.querySelectorAll('.gtc-mention').length,
  avatarStack: document.querySelectorAll('.gtc-avatar-stack').length,
  avatarStackCount: document.querySelector('.gtc-avatar-stack-count')?.textContent,
  phaseTags: [...document.querySelectorAll('.gtc-phase-tag')].map(x => x.textContent),
  retryBtns: document.querySelectorAll('.gtc-retry-btn').length,
  nicknames: [...document.querySelectorAll('.gtc-bubble-head b')].slice(0, 2).map(x => x.textContent),
  persistentFootTime: (() => {
    const t = document.querySelector('.gtc-bubble-foot time');
    return t ? getComputedStyle(t).opacity : null; // 未 hover 应为 0
  })(),
  userMsgAtRight: (() => {
    const el = document.querySelector('.gtc-msg.is-user');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const parent = el.parentElement.getBoundingClientRect();
    return (parent.right - r.right) < (r.left - parent.left); // 更靠右 = true
  })(),
  gavatar: document.querySelectorAll('.agents-chat-gavatar i').length,
}));
console.log('CHECKS:', JSON.stringify(checks, null, 2));

await page.screenshot({ path: `${OUT}/team-v9-stream.png` });

// ---- hover 气泡：时间/元数据/操作浮现 ----
await page.hover('.gtc-msg.is-agent[data-mid="m7"]');
await page.waitForTimeout(400);
const hoverOpacity = await page.evaluate(() => {
  const t = document.querySelector('.gtc-msg[data-mid="m7"] .gtc-bubble-foot time');
  const meta = document.querySelector('.gtc-msg[data-mid="m7"] .gtc-bubble-meta');
  return { time: t && getComputedStyle(t).opacity, meta: meta && getComputedStyle(meta).opacity };
});
console.log('HOVER:', JSON.stringify(hoverOpacity));
await page.screenshot({ path: `${OUT}/team-v9-hover.png` });
await page.mouse.move(10, 10);

// ---- 打开右侧群信息面板 ----
await page.click('.gtc-avatar-stack');
await page.waitForSelector('.gtc-panel', { timeout: 3000 });
await page.waitForTimeout(500);
const panelChecks = await page.evaluate(() => ({
  ann: document.querySelector('.gtc-ann-body')?.textContent?.slice(0, 30),
  members: [...document.querySelectorAll('.gtc-panel-member-info b')].map(x => x.textContent),
  filterChips: [...document.querySelectorAll('.gtc-filter-chips button')].map(x => x.textContent),
  entries: [...document.querySelectorAll('.gtc-panel-entry')].map(x => x.textContent.trim()),
}));
console.log('PANEL:', JSON.stringify(panelChecks, null, 2));
await page.screenshot({ path: `${OUT}/team-v9-panel.png` });

// ---- 记录筛选：只看产出（用户消息/认领/系统行隐藏，2 条产出） ----
await page.click('.gtc-filter-chips button:has-text("产出")');
await page.waitForTimeout(400);
const filterChecks = await page.evaluate(() => ({
  visibleMsgs: document.querySelectorAll('.gtc-msg').length,
  systemLines: document.querySelectorAll('.gtc-system-line').length,
}));
console.log('FILTER work:', JSON.stringify(filterChecks));
await page.screenshot({ path: `${OUT}/team-v9-filter-work.png` });

// ---- 还原筛选 + 引用块跳转闪烁 ----
await page.click('.gtc-filter-chips button:has-text("全部")');
await page.waitForTimeout(200);
await page.click('.gtc-quote');
await page.waitForTimeout(500);
const flashOn = await page.evaluate(() => Boolean(document.querySelector('.gtc-flash')));
console.log('QUOTE JUMP flash =', flashOn);
await page.screenshot({ path: `${OUT}/team-v9-quote-jump.png` });

console.log('\nPAGEERRORS:', errors.length ? errors : 'none');
await browser.close();
