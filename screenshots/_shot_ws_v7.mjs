// v7 批次探针：① 工作区同步修复（按钮移除+遗留effect已删）② 三栏拖拽 ③ 导出条移除
// ④ composer 收纳 ⑤ 群聊两阶段广播流水线（mock SSE 全链路）
import { chromium } from 'playwright';
const BASE = process.env.PW_BASE || 'http://127.0.0.1:5176/';
const errors = [];
const consoleMsgs = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
page.on('console', m => { if (m.type() === 'error') consoleMsgs.push(`[console.error] ${m.text().slice(0, 200)}`); });

// ---- mock LLM：前 2 次返回认领声明，之后返回完整产出 ----
let llmCalls = 0;
await page.route('**/api/ai-generate', async route => {
  llmCalls += 1;
  const isClaim = llmCalls <= 2; // roster 2 人 → Phase 1 两次认领
  const delta = isClaim
    ? '【认领】（mock）我负责检索端侧模型资讯，产出线索清单。'
    : '### 端侧模型情报（mock）\n- Llama 3.2 1B/3B 已可端侧部署\n- 端侧推理成本下降 40%';
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: `data: {"delta":${JSON.stringify(delta)}}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n`,
  });
});

const now = Date.now();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate((now) => {
  localStorage.setItem('llmConfig', JSON.stringify({
    baseUrl: 'https://mock.local/v1', apiKey: 'mock-key', selectedModel: 'mock-model',
    provider: 'custom', manualModels: [], webSearchEnabled: true,
  }));
  localStorage.setItem('agentTeamGroupChat', JSON.stringify({ roster: ['explorer', 'writer'], messages: [] }));
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    { id: 's1', title: 't', spaceId: 'default', createdAt: now, updatedAt: now, messages: [] },
  ]));
}, now);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a')]
      .find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12)?.click();
  });
  await page.waitForTimeout(2200);
  opened = await page.locator('.session-sidebar').count() > 0;
  if (!opened) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3200); }
}
console.log('workstation opened:', opened);

/* ---- Probe ④：composer 收纳 ---- */
const composer = await page.evaluate(() => {
  const bottom = document.querySelectorAll('.chat-composer-bottom').length;
  const tools = document.querySelector('.chat-input-tools');
  return {
    composerBottomGone: bottom === 0,
    modelInTools: !!tools?.querySelector('.chat-model-wrap'),
    ringInTools: !!tools?.querySelector('.chat-ctx-ring'),
    modeChipInTools: !!tools?.querySelector('.chat-mode-chip'),
    attachInTools: !!tools?.querySelector('.chat-attach-mini'),
    pillsInTools: !!tools?.querySelector('.chat-context-group'),
  };
});
console.log('probe4 composer:', JSON.stringify(composer));

/* ---- Probe ②：三栏拖拽（分步执行，等 React 状态刷新） ---- */
const resize = { present: false };
{
  const present = await page.evaluate(() => ({
    ok: !!document.querySelector('.ai-chat-panel-main')
      && !!document.querySelector('.ws-resize-left')
      && !!document.querySelector('.ws-resize-right'),
    colsBefore: getComputedStyle(document.querySelector('.ai-chat-panel-main')).gridTemplateColumns,
  }));
  resize.present = present.ok;
  resize.colsBefore = present.colsBefore;
  if (present.ok) {
    // 左手柄：pointerdown @100 → move @160（left 200→260）
    await page.evaluate(() => document.querySelector('.ws-resize-left')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, pointerId: 1 })));
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 160, pointerId: 1 })));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 160, pointerId: 1 })));
    await page.waitForTimeout(250);
    resize.colsAfterLeft = await page.evaluate(() => getComputedStyle(document.querySelector('.ai-chat-panel-main')).gridTemplateColumns);
    // 右手柄：pointerdown @100 → move @60（right 260→300）
    await page.evaluate(() => document.querySelector('.ws-resize-right')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, pointerId: 2 })));
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 60, pointerId: 2 })));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 60, pointerId: 2 })));
    await page.waitForTimeout(250);
    resize.colsAfterRight = await page.evaluate(() => getComputedStyle(document.querySelector('.ai-chat-panel-main')).gridTemplateColumns);
    resize.saved = await page.evaluate(() => localStorage.getItem('aiWorkstationPanelWidths'));
    resize.leftDragged = resize.colsAfterLeft !== resize.colsBefore;
    resize.rightDragged = resize.colsAfterRight !== resize.colsAfterLeft;
  }
}
console.log('probe2 resize:', JSON.stringify(resize));
// 刷新后持久化生效
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3600);
await page.evaluate(() => document.querySelector('.onb-skip')?.click());
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a')]
      .find(el => /AI 工作站|工作站/.test((el.textContent || '').trim()) && (el.textContent || '').length < 12)?.click();
  });
  await page.waitForTimeout(2000);
  if (await page.locator('.ai-chat-panel-main').count() > 0) break;
}
const persistedCols = await page.evaluate(() => getComputedStyle(document.querySelector('.ai-chat-panel-main')).gridTemplateColumns);
console.log('probe2 persisted cols:', persistedCols);

/* ---- Probe ①③：文件 tab —— 导出条与「切换文件夹」已移除 ---- */
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.includes('文件'))?.click();
});
await page.waitForTimeout(1200);
const workspaceUi = await page.evaluate(() => ({
  exportBarGone: document.querySelectorAll('.workspace-export-bar').length === 0,
  switchFolderGone: ![...document.querySelectorAll('button')].some(b => b.title === '切换文件夹'),
  // 未绑定文件夹时空态（无头部按钮属正常）；绑定后才有 .workspace-top
  emptyOrBound: !!document.querySelector('.workspace-connect-btn') || !!document.querySelector('.workspace-top'),
  noCrash: !document.querySelector('.workspace-panel .app-state--error') && !document.querySelector('.workspace-panel .app-state__title'),
}));
console.log('probe1/3 workspace:', JSON.stringify(workspaceUi));

/* ---- Probe ⑤：群聊两阶段广播（无 @ 也全员响应） ---- */
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.includes('团队') || t.textContent.includes('Agent Team'))?.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const ta = document.querySelector('.gtc-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '发起任务：调研端侧模型的最新进展（mock）');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.gtc-send:not(.is-stop)')?.click());
let teamState = null;
for (let t = 0; t < 20; t++) {
  await page.waitForTimeout(1000);
  teamState = await page.evaluate(() => ({
    msgs: [...document.querySelectorAll('.gtc-msg')].map(el => ({
      user: el.className.includes('is-user'),
      running: el.className.includes('is-running'),
      claimTag: !!el.querySelector('.gtc-phase-tag'),
      text: (el.querySelector('.gtc-bubble-text')?.textContent || '').slice(0, 30),
    })),
    pipelineHint: !!document.querySelector('.gtc-pipeline-hint'),
  }));
  const done = !teamState.pipelineHint && teamState.msgs.length >= 5 && teamState.msgs.every(m => !m.running);
  if (done) break;
}
const agentMsgs = (teamState?.msgs || []).filter(m => !m.user);
// dump 第一个 agent 气泡头，诊断 phase tag 渲染
const bubbleHeadDump = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.gtc-msg.is-agent .gtc-bubble-head')][0];
  return el ? el.innerHTML.slice(0, 300) : '(none)';
});
const summary = {
  totalMsgs: teamState?.msgs.length,
  userMsgs: (teamState?.msgs || []).filter(m => m.user).length,
  agentMsgs: agentMsgs.length,
  claimTagCount: agentMsgs.filter(m => m.claimTag).length,
  claimTexts: agentMsgs.filter(m => m.claimTag).map(m => m.text),
  workTexts: agentMsgs.filter(m => !m.claimTag).map(m => m.text),
  pipelineHint: teamState?.pipelineHint,
  llmCalls,
};
console.log('bubble head dump:', bubbleHeadDump);
console.log('probe5 team:', JSON.stringify(summary, null, 1));
console.log('PASS_CHECKS:', JSON.stringify({
  composer: composer.composerBottomGone && composer.modelInTools && composer.ringInTools && composer.modeChipInTools && composer.attachInTools && composer.pillsInTools,
  resize: resize.present && resize.leftDragged && resize.rightDragged && !!resize.saved,
  resizePersisted: persistedCols.includes('260px') && persistedCols.includes('300px'),
  workspace: workspaceUi.exportBarGone && workspaceUi.switchFolderGone && workspaceUi.emptyOrBound && workspaceUi.noCrash,
  team: summary.userMsgs === 1 && summary.agentMsgs === 4 && summary.claimTagCount === 2 && summary.llmCalls === 4 && !summary.pipelineHint,
}));
console.log('console errors:', consoleMsgs.length ? consoleMsgs.slice(0, 6) : 'none');
console.log('pageerrors:', errors.length ? errors : 'none');

// 字体激活后截图（headless 等字体加载会卡住）
await page.evaluate(() => document.querySelectorAll('link[media="print"]').forEach(l => { l.media = 'all'; }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'screenshots/ws-v7-final.png', timeout: 10000 }).catch(() => {});
await browser.close();
