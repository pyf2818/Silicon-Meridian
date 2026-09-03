// v4 验证：① 新建空间=选文件夹按钮文案 ② 快捷指令收纳弹层+自定义 ③ Ctrl+多选批量注入/排除 ④ 波浪节点导航
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5175/';
const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));

const now = Date.now();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3800);
await page.evaluate((now) => {
  // 带用户消息的会话（喂波浪节点导航）+ 素材（喂 Ctrl 多选弹层）
  const mk = (role, content) => ({ role, content });
  localStorage.setItem('aiCopilotSessions', JSON.stringify([
    {
      id: 's1', title: 'v4 验证会话', spaceId: 'default', createdAt: now, updatedAt: now,
      messages: [
        mk('user', '帮我分析一下当前 AI 芯片市场的最新格局和主要玩家的动向'),
        mk('assistant', '好的，从公开数据看……'),
        mk('user', '那国产替代的进度呢？列出关键时间点'),
        mk('assistant', '国产替代近年明显加速……'),
        mk('user', '短'),
        mk('assistant', '……'),
      ],
    },
  ]));
  localStorage.setItem('materials', JSON.stringify([
    { id: 'mat_a', title: 'AI 芯片周报素材A', content: '内容A', type: 'report', source: '内部' },
    { id: 'mat_b', title: '英伟达财报速览B', content: '内容B', type: 'news', source: '外部' },
    { id: 'mat_c', title: '端侧模型观察C', content: '内容C', type: 'note', source: '内部' },
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
  await page.waitForTimeout(2500);
  opened = await page.locator('.session-sidebar').count() > 0;
  if (!opened) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500); }
}
console.log('workstation opened:', opened);

// ---- ② 快捷指令收纳 ----
const quickBtn = await page.evaluate(() => ({
  btn: !!document.querySelector('.chat-quick-btn'),
  legacyBar: !!document.querySelector('.chat-quick-bar'),
}));
console.log('quick button present / legacy bar gone:', JSON.stringify(quickBtn));
await page.evaluate(() => document.querySelector('.chat-quick-btn')?.click());
await page.waitForTimeout(500);
let menuOpen = await page.evaluate(() => ({
  menu: !!document.querySelector('.chat-quick-menu'),
  addBtn: !!document.querySelector('.chat-quick-add'),
}));
console.log('quick menu open:', JSON.stringify(menuOpen));
// 新建自定义快捷指令
await page.evaluate(() => document.querySelector('.chat-quick-add')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const setV = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setV(document.querySelector('.chat-quick-form input'), '周报生成');
  setV(document.querySelector('.chat-quick-form textarea'), '把本轮对话要点整理成周报格式输出');
});
await page.evaluate(() => document.querySelector('.chat-quick-form-save')?.click());
await page.waitForTimeout(500);
const customProbe = await page.evaluate(() => ({
  saved: JSON.parse(localStorage.getItem('aiWorkstationQuickCommands') || '[]'),
  rows: [...document.querySelectorAll('.chat-quick-menu-row strong')].map(e => e.textContent),
}));
console.log('custom quick command:', JSON.stringify(customProbe));
await page.evaluate(() => document.querySelector('.chat-quick-btn')?.click()); // 关闭
await page.waitForTimeout(300);

// ---- ④ 波浪节点导航 ----
const railProbe1 = await page.evaluate(() => ({
  rail: !!document.querySelector('.chat-side-rail'),
  nodes: document.querySelectorAll('.chat-side-rail-node').length,
  widths: [...document.querySelectorAll('.chat-side-rail-node')].map(n => Math.round(n.getBoundingClientRect().width)),
  legacyNum: !!document.querySelector('.chat-side-rail-num'),
}));
console.log('side rail (wave):', JSON.stringify(railProbe1));
// hover 第一个节点 → tip 悬浮显示内容 + 条变长
await page.hover('.chat-side-rail-node >> nth=0');
await page.waitForTimeout(450);
const railProbe2 = await page.evaluate(() => {
  const tip = document.querySelector('.chat-side-rail-tip');
  const node = document.querySelector('.chat-side-rail-node');
  return {
    tipShown: !!tip,
    tipText: tip?.querySelector('.chat-side-rail-tip-text')?.textContent?.slice(0, 24) || null,
    tipNum: tip?.querySelector('.chat-side-rail-tip-num')?.textContent || null,
    hoveredWidth: Math.round(node.getBoundingClientRect().width),
  };
});
console.log('rail hover tip:', JSON.stringify(railProbe2));
await page.mouse.move(400, 400); // 移开鼠标
await page.waitForTimeout(350);

// ---- ③ 情报/素材弹层 Ctrl+多选 ----
const pillProbe = await page.evaluate(() => {
  const pill = [...document.querySelectorAll('.chat-context-pill-peek')].find(p => p.textContent.includes('素材'));
  return { pillText: pill?.textContent?.trim() || null };
});
console.log('material pill:', JSON.stringify(pillProbe));
await page.evaluate(() => {
  const pill = [...document.querySelectorAll('.chat-context-pill-peek')].find(p => p.textContent.includes('素材'));
  pill?.click();
});
await page.waitForTimeout(500);
// Ctrl+点击选中两条
const itemsBefore = await page.evaluate(() => document.querySelectorAll('.chat-context-peek-item').length);
console.log('peek items:', itemsBefore);
await page.keyboard.down('Control');
for (const idx of [0, 1]) {
  await page.evaluate((i) => {
    const el = document.querySelectorAll('.chat-context-peek-item')[i];
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  }, idx);
  await page.waitForTimeout(200);
}
await page.keyboard.up('Control');
await page.waitForTimeout(300);
const selProbe = await page.evaluate(() => ({
  selected: document.querySelectorAll('.chat-context-peek-item.selected').length,
  actions: [...document.querySelectorAll('.chat-context-peek-act')].map(a => a.textContent.trim()),
}));
console.log('ctrl multi-select:', JSON.stringify(selProbe));
// 批量注入
await page.evaluate(() => [...document.querySelectorAll('.chat-context-peek-act')].find(a => a.textContent.includes('注入'))?.click());
await page.waitForTimeout(400);
const injected = await page.evaluate(() => document.querySelector('.chat-input')?.value || '');
console.log('batch inject ->', JSON.stringify(injected));
await page.evaluate(() => { const el = document.querySelector('.chat-input'); const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; s.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
// 再次打开，Ctrl 选两条 → 批量排除
await page.evaluate(() => {
  const pill = [...document.querySelectorAll('.chat-context-pill-peek')].find(p => p.textContent.includes('素材'));
  pill?.click();
});
await page.waitForTimeout(400);
await page.keyboard.down('Control');
for (const idx of [0, 2]) {
  await page.evaluate((i) => {
    const el = document.querySelectorAll('.chat-context-peek-item')[i];
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  }, idx);
  await page.waitForTimeout(180);
}
await page.keyboard.up('Control');
await page.evaluate(() => [...document.querySelectorAll('.chat-context-peek-act')].find(a => a.textContent.includes('排除'))?.click());
await page.waitForTimeout(400);
const exclProbe = await page.evaluate(() => {
  const firstExcluded = document.querySelector('.chat-context-peek-item.excluded');
  return {
    excluded: document.querySelectorAll('.chat-context-peek-item.excluded').length,
    pillExcludedBadge: [...document.querySelectorAll('.chat-context-pill-peek')].find(p => p.textContent.includes('素材'))?.querySelector('.chat-context-pill-excluded')?.textContent || null,
    opacity: firstExcluded ? getComputedStyle(firstExcluded).opacity : null,
  };
});
console.log('batch exclude (dim):', JSON.stringify(exclProbe));
await page.screenshot({ path: 'screenshots/ws-v4-composer.png', timeout: 10000 }).catch(() => {});
// 单击已排除条目恢复
await page.evaluate(() => document.querySelector('.chat-context-peek-item.excluded')?.click());
await page.waitForTimeout(300);
const restoreProbe = await page.evaluate(() => ({ excluded: document.querySelectorAll('.chat-context-peek-item.excluded').length }));
console.log('click excluded to restore:', JSON.stringify(restoreProbe));

// ---- ① 新建空间按钮文案（选文件夹流；无头环境点开系统选择器前仅验证按钮与降级路径） ----
await page.evaluate(() => {
  [...document.querySelectorAll('.session-tab')].find(t => t.textContent.trim() === '对话')?.click();
});
await page.waitForTimeout(300);
const spaceBtn = await page.evaluate(() => document.querySelector('.space-create-btn')?.textContent?.trim() || null);
console.log('space create button:', JSON.stringify(spaceBtn));

await ctx.close();
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
