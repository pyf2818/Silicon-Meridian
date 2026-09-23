// 重新生成 readme 的 10 张截图，每页套一套不同主题（data-mode × data-palette）。
// 防御式：内容校验通过才覆盖旧图；旧图先备份到 .workbuddy/readme-shot-bak/。
//
// 关键落点（2026-09-23 实测）：
// - 主题注入：App.jsx 只在 themeMode/palette 变化时写 dataset，导航不会重置 →
//   切页后直接 evaluate 设 documentElement.dataset.mode/palette 即可稳定生效。
// - 全球态势大屏不是导航页！是「全部动态」顶栏 .globe-entry-btn 打开的全屏 overlay
//   （uiStore.globeFullscreenOpen）。nav 'monitor' 是竞争情报监测，别搞混。
// - 地球点位 .gs-marker 根元素是 0×0 锚点，命中热区是 .gs-marker-hit(48×48)；
//   先点一下地图暂停自转（mouseup 6s 后恢复），再对正面 marker dispatchEvent('click')。
// - AI 精灵面板：点击 .ai-elf-avatar 展开（.ai-elf-slot 里没有 button）。
// - 股市页默认选中 sh000001 自动出 K 线，无需选股；图卡头选择器 .stock3-chart-head。
import { chromium } from 'playwright';
import { mkdirSync, existsSync, copyFileSync, statSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:5175';
const OUT = 'public/screenshots';
const BAK = '.workbuddy/readme-shot-bak';
mkdirSync(OUT, { recursive: true });
mkdirSync(BAK, { recursive: true });

const log = [];
const note = (m) => { log.push(m); console.log(m); };
const summary = {};

async function applyTheme(page, mode, palette) {
  await page.evaluate(({ mode, palette }) => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.palette = palette;
  }, { mode, palette });
  await page.waitForTimeout(1300);
}

async function saveShot(page, file) {
  const target = `${OUT}/${file}`;
  const backup = `${BAK}/${file}`;
  if (existsSync(target) && !existsSync(backup)) copyFileSync(target, backup);
  await page.screenshot({ path: target, timeout: 20000 });
  note(`✅ ${file} (${(statSync(target).size / 1024).toFixed(0)}KB)`);
  summary[file] = 'updated';
}
const keepOld = (file, why) => { note(`⚠️ ${file} 保留旧图: ${why}`); summary[file] = 'kept-old'; };

async function goNav(page, nav) {
  await page.locator(`[data-nav="${nav}"]`).first().click({ timeout: 12000 });
  await page.waitForTimeout(2800);
}

async function doLogin() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
  });
  if (r.status === 401) {
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
    });
    return doLogin();
  }
  const sc = r.headers.get('set-cookie') || '';
  const v = sc.split(';')[0].split('=').slice(1).join('=');
  if (!v) throw new Error(`登录失败 ${r.status}`);
  return v;
}

try {
  const session = await doLogin();
  note('登录 OK');
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'meridian_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => note(`  [pageerror] ${String(e).slice(0, 160)}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  const onboarding = page.getByRole('dialog', { name: '新用户引导' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: '跳过引导' }).click();
    await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
  }

  const check = async (sel) => (await page.locator(sel).first().count() > 0);

  // ── 1. AI 工作站（dark/champagne）──
  await applyTheme(page, 'dark', 'champagne');
  if (await check('.feed-workbench')) await saveShot(page, 'main-interface.png');
  else keepOld('main-interface.png', '工作台未渲染');

  // ── 2. 全球态势大屏（dark/cosmos）：全部动态页顶栏入口 → 全屏 overlay ──
  await goNav(page, 'all');
  await applyTheme(page, 'dark', 'cosmos');
  const globeEntry = page.locator('.globe-entry-btn').first();
  if (await globeEntry.count() > 0) {
    await globeEntry.click({ timeout: 8000 });
    await page.locator('.gs-map-host canvas').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(8000); // 等卫星瓦片
    if (await check('.gs-map-host canvas')) await saveShot(page, 'globe-view.png');
    else keepOld('globe-view.png', '地球 canvas 未渲染');

    // ── 3. 大屏弹窗（dark/neon）：暂停自转 + 对正面 marker 派发 click ──
    await applyTheme(page, 'dark', 'neon');
    const canvas = page.locator('.gs-map-host canvas').first();
    const box = await canvas.boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + 60); // 暂停自转
    const picked = await page.evaluate(() => {
      for (const m of document.querySelectorAll('.gs-marker')) {
        const hit = m.querySelector('.gs-marker-hit') || m; // 根元素 0×0，看命中热区
        const r = hit.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top > 80 && r.bottom < innerHeight - 40
          && r.left > 40 && r.right < innerWidth - 40 && getComputedStyle(m).display !== 'none') {
          m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return m.title || 'ok';
        }
      }
      return '';
    });
    note(`点位: ${picked || '(无可视 marker)'}`);
    if (picked) {
      await page.locator('.gs-popup-wrap').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const st = await page.evaluate(() => {
        const w = document.querySelector('.gs-popup-wrap');
        if (!w) return { opacity: '0', w: 0 };
        const s = getComputedStyle(w);
        return { opacity: s.opacity, w: w.getBoundingClientRect().width };
      });
      if (Number(st.opacity) > 0.5 && st.w > 100) await saveShot(page, 'globe-popup.png');
      else keepOld('globe-popup.png', '弹窗不可见');
    } else keepOld('globe-popup.png', '无可视点位');
  } else keepOld('globe-view.png', '找不到 .globe-entry-btn（须在全部动态页）');

  // 重载关闭地球 overlay，回到干净状态
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});

  // ── 4. 全部动态（light/arctic）──
  await goNav(page, 'all');
  await applyTheme(page, 'light', 'arctic');
  if (await check('.news-item')) await saveShot(page, 'all-news.png');
  else keepOld('all-news.png', '无资讯数据');

  // ── 5. 股市动向（dark/forest）：默认 sh000001 自动出 K 线 ──
  await goNav(page, 'stock');
  await applyTheme(page, 'dark', 'forest');
  if (await check('.stock3-chart-head')) await saveShot(page, 'stock-analysis.png');
  else keepOld('stock-analysis.png', '图卡未渲染');

  // ── 6. GitHub 热门（dark/aurora）──
  await goNav(page, 'github');
  await applyTheme(page, 'dark', 'aurora');
  if (await check('.github-card')) await saveShot(page, 'github-trending.png');
  else keepOld('github-trending.png', '无 GitHub 数据');

  // ── 7. 无限画布（light/bamboo）──
  await goNav(page, 'canvas');
  await applyTheme(page, 'light', 'bamboo');
  if (await check('canvas')) await saveShot(page, 'creative-canvas.png');
  else keepOld('creative-canvas.png', '画布未渲染');

  // ── 8. 团队群聊（dark/twilight）──
  await goNav(page, 'chat');
  await applyTheme(page, 'dark', 'twilight');
  if (await check('.chat-main, .chat-list')) await saveShot(page, 'team-chat.png');
  else keepOld('team-chat.png', '聊天页未渲染');

  // ── 9. 用户画像中心（light/champagne）──
  await goNav(page, 'profile-center');
  await applyTheme(page, 'light', 'champagne');
  if (await check('text=用户画像')) await saveShot(page, 'profile-center.png');
  else keepOld('profile-center.png', '画像页未渲染');

  // ── 10. AI 精灵（dark/coral）：点击 .ai-elf-avatar 展开面板 ──
  await goNav(page, 'home');
  await applyTheme(page, 'dark', 'coral');
  const avatar = page.locator('.ai-elf-avatar').first();
  if (await avatar.count() > 0) {
    await avatar.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  if ((await page.locator('.ai-elf-slot').innerText().catch(() => '')).includes('待命中')) {
    await saveShot(page, 'ai-elf-interface.png');
  } else keepOld('ai-elf-interface.png', '精灵面板未展开');

  await browser.close();
} catch (err) {
  note(`FATAL: ${err.message}`);
}

writeFileSync('scripts/.readme-themes-summary.log', log.join('\n'), 'utf8');
console.log('\n===== SUMMARY =====');
console.log(JSON.stringify(summary, null, 2));
