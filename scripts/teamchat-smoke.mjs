/**
 * teamchat-smoke.mjs — 团队群聊（AgentTeamChat）冒烟探针
 *
 * 验证：进入 AI 工作站 → 点侧边栏「团队」→ AgentTeamChat 正常挂载渲染，
 * 且无 ReferenceError / SafeBoundary 崩溃。
 *
 * 背景：AgentTeamChat 曾出现 TDZ —— useEffect 依赖数组在渲染阶段读取
 * 声明靠后的 anchorToBottom（Cannot access 'anchorToBottom' before initialization），
 * 导致整个团队模式被 SafeBoundary 捕获、白屏。
 *
 * 用法：node scripts/teamchat-smoke.mjs [url]
 */
import { chromium } from 'playwright';

const EXE =
  'C:\\Users\\anlan0725\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = process.argv[2] || 'http://127.0.0.1:5175/?view=home';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 标记已看过引导，避开新用户引导遮罩（它会拦截所有点击）
await page.addInitScript(() => {
  try { localStorage.setItem('meridian_onboarded', '1'); } catch { /* ignore */ }
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
// 关键：崩溃被 SafeBoundary 吞掉后不会触发 pageerror，只有 console.error 会留下痕迹
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// 跳过入场动画（splash 会挡住点击）
const splash = page.locator('.entrance');
await splash.waitFor({ timeout: 15000 }).catch(() => {});
if (await splash.count()) await splash.click().catch(() => {});
await page.waitForSelector('.entrance', { state: 'detached', timeout: 15000 }).catch(() => {});

// 进入团队模式
await page.waitForSelector('.session-tab', { timeout: 20000 });
await page.getByRole('button', { name: /团队/ }).first().click();
await page.waitForSelector('.team-center-crumb', { timeout: 10000 }).catch(() => {});

const result = await page.evaluate(() => {
  const crumb = document.querySelector('.team-center-crumb')?.textContent ?? null;
  // .gtc-topbar 是 AgentTeamChat 的根区域：它存在才说明组件真的渲染成功了
  const rendered = !!document.querySelector('.gtc-topbar');
  return {
    teamMounted: !!crumb,
    crumb,
    componentRendered: rendered,
    // SafeBoundary 降级卡片：.app-state--error（含「重新加载」/「再试一次」）
    fallbackShown: !!document.querySelector('.app-state--error'),
    fallbackText: document.querySelector('.app-state--error')?.textContent?.slice(0, 80) ?? null,
  };
});

const crashed = [...errors, ...consoleErrors].filter((e) =>
  /ReferenceError|before initialization|Cannot access|SafeBoundary/.test(e)
);
console.log(JSON.stringify(
  { result, crashed, errorCount: errors.length, consoleErrorCount: consoleErrors.length },
  null,
  2
));
await browser.close();

const bad = crashed.length > 0 || !result.componentRendered || result.fallbackShown;
console.log(bad ? 'TEAM SMOKE: FAIL' : 'TEAM SMOKE: PASS');
process.exit(bad ? 1 : 0);
