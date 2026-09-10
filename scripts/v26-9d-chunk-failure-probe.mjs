/**
 * v26.9d 实证：股市终端「暂未就绪」触发条件 + 数据是否真的不丢
 * 步骤：
 * 1. 预置 localStorage（素材 / 画像 / 阅读历史 / 会话历史）后加载页面
 * 2. 拦截 StockPage 动态 chunk 请求（模拟网络波动/版本更新导致 chunk 404）
 * 3. 点击「股市动向」→ 断言出现「股市终端暂未就绪 / 资源加载中断」
 * 4. 断言四类本地数据仍然完好（chunk 失败不会清数据）
 * 5. 放开拦截 + 重新加载 → 断言股市终端正常挂载、数据依旧完好
 */
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

const SEED = {
  materials: JSON.stringify([{ id: 'm1', title: '测试素材A' }, { id: 'm2', title: '测试素材B' }]),
  // 注意：readingHistory 真实形状是**数组**（{id, depth} 列表）
  'siliconstream-behavior-store': JSON.stringify({ state: { readingHistory: [{ id: 'a', depth: 'full' }, { id: 'b', depth: 'preview' }], previewHistory: [{ id: 'b', previewCount: 1 }] }, version: 0 }),
  'siliconstream-profile-store': JSON.stringify({ state: { persona: { tone: 'sharp' }, learnedPreferences: { topics: ['AI 大模型'] } }, version: 0 }),
  'siliconstream-ai-store': JSON.stringify({ state: { sessions: [] }, version: 0 }),
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const aborted = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.addInitScript((seed) => {
  try {
    localStorage.setItem('meridian_onboarded', '1');
    localStorage.setItem('sidebarCollapsed', 'false'); // 侧栏展开，导航项才有文字
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  } catch {}
}, SEED);

try {
  // 关键：拦截必须装在 goto 之前 —— 应用会对懒加载路由做 prefetch，
  // 先加载再拦截会导致 chunk 已缓存、复现不到失败。
  await page.route('**StockPage*', (route) => { aborted.push(route.request().url()); route.abort('failed'); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const stockNav = page.locator('.nav-item', { hasText: /股市动向|股市终端/ }).first();
  const navCount = await stockNav.count();
  check('侧栏展开且「股市动向」导航项可见（复现前提）', navCount > 0, `nav count=${navCount}`);
  await stockNav.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(4500);

  const txt = await page.evaluate(() => document.body.innerText || '');
  check('StockPage chunk 请求确被拦截（复现前提）', aborted.length > 0, aborted.join(','));
  check('股市终端显示「暂未就绪」兜底卡片', txt.includes('股市终端暂未就绪'));
  check('文案命中 chunk 失败分支（资源加载中断）', txt.includes('资源加载中断'));
  check('chunk 分支只给「重新加载页面」（无「再试一次」）', txt.includes('重新加载页面') && !txt.includes('再试一次'));

  // ===== 数据完好性（chunk 失败不触发任何清库逻辑）=====
  // 注：zustand persist store 会按自身状态回写 localStorage，故只有应用自有格式的
  //     materials 能做字节级比对；其余三类断言「键仍在 + 仍是合法 JSON（未被清空）」。
  check('素材数据字节级完好（materials 未被清空/改写）', await page.evaluate((s) => localStorage.getItem('materials') === s, SEED.materials));
  check('画像/历史/会话三类键仍存在且为合法 JSON', await page.evaluate(() => ['siliconstream-behavior-store', 'siliconstream-profile-store', 'siliconstream-ai-store'].every((k) => {
    const raw = localStorage.getItem(k);
    if (!raw) return false;
    try { JSON.parse(raw); return true; } catch { return false; }
  })));

  // ===== 放开拦截 + 重新加载 =====
  await page.unroute('**StockPage*');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // 重新点击股市终端
  const stockNav2 = page.locator('.nav-item', { hasText: /股市动向|股市终端/ }).first();
  await stockNav2.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(4500);
  const txt2 = await page.evaluate(() => document.body.innerText || '');
  check('重新加载后股市终端正常挂载（不再显示兜底卡片）', !txt2.includes('股市终端暂未就绪'));

  check('重新加载后素材/画像/历史数据依旧完好', await page.evaluate((s) => {
    if (localStorage.getItem('materials') !== s.materials) return false;
    return ['siliconstream-behavior-store', 'siliconstream-profile-store', 'siliconstream-ai-store'].every((k) => {
      const raw = localStorage.getItem(k);
      if (!raw) return false;
      try { JSON.parse(raw); return true; } catch { return false; }
    });
  }, SEED));

  check('素材内容可读回（2 条）', await page.evaluate(() => (JSON.parse(localStorage.getItem('materials') || '[]')).length === 2));

  // ===== 场景 2：脏持久化数据不再导致整站崩溃（v26.9c 修复回归）=====
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page2.addInitScript(() => {
    try {
      localStorage.setItem('meridian_onboarded', '1');
      // 曾经的崩溃载荷：readingHistory 被写成对象 map → 下游 .filter 抛 TypeError → 整站兜底
      localStorage.setItem('siliconstream-behavior-store', JSON.stringify({ state: { readingHistory: { a: { depth: 'full' } } }, version: 0 }));
    } catch {}
  });
  await page2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page2.waitForTimeout(3000);
  const app2 = await page2.evaluate(() => ({
    hasApp: !!document.querySelector('.app'),
    navItems: document.querySelectorAll('.nav-item').length,
    fallback: (document.body.innerText || '').includes('暂未就绪'),
  }));
  check('脏 behavior 数据下 App 仍正常渲染（不再整站兜底）', app2.hasApp && app2.navItems > 0 && !app2.fallback, `app=${app2.hasApp} nav=${app2.navItems} 兜底=${app2.fallback}`);
  await page2.close();
} catch (err) {
  check('探针执行完成（未抛出致命异常）', false, String(err));
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== 探针汇总: ${pass}/${results.length} PASS =====`);
process.exit(pass === results.length ? 0 : 1);
