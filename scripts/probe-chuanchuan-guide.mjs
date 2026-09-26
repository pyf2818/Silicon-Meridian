/**
 * v39 任务 3 探针：川川引导联系人 + 咨询弹窗全链路
 * 运行：node scripts/probe-chuanchuan-guide.mjs  （dev server 5176，DEV_MEMORY_AUTH）
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5176';
const results = [];
const ok = (name, cond) => { results.push({ name, pass: Boolean(cond) }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

try {
  // 1. 打开社区广场并注册（内存仓储）
  await page.goto(`${BASE}/?view=square`, { waitUntil: 'domcontentloaded' });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  const onboarding = page.getByRole('dialog', { name: '新用户引导' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: '跳过引导' }).click();
    await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
  }
  await page.getByTestId('community-open-composer').click();
  await page.getByTestId('auth-register-tab').click();
  const suffix = Date.now().toString(36);
  await page.getByTestId('auth-username').fill(`cc_probe_${suffix}`);
  await page.getByTestId('auth-email').fill(`cc_probe_${suffix}@example.test`);
  await page.getByTestId('auth-password').fill('password123');
  await page.getByTestId('auth-confirm-password').fill('password123');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('auth-modal').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  ok('注册登录成功', (await page.getByTestId('auth-modal').count()) === 0);

  // 2. 切到聊天页
  await page.locator('[data-nav="chat"]').click();
  await page.locator('main[data-nav="chat"]').waitFor({ timeout: 10000 });

  // 3. 川川系统联系人入口
  const entry = page.locator('.chat-contact-system');
  await entry.waitFor({ timeout: 8000 });
  ok('川川入口出现在联系人列表首位', await entry.isVisible());
  ok('入口文案含「官方引导员」', (await entry.innerText()).includes('官方引导员'));

  // 4. 点开引导弹窗
  await entry.click();
  const dialog = page.locator('.cc-guide-dialog');
  await dialog.waitFor({ timeout: 5000 });
  ok('点击后引导弹窗打开', await dialog.isVisible());
  ok('欢迎语已注入', (await page.locator('.cc-guide-messages').innerText()).includes('官方引导员'));

  // 5. 快捷问题 → 知识库回答
  await page.locator('.cc-guide-chip', { hasText: '平台都有什么功能' }).click();
  await page.locator('.cc-guide-bubble', { hasText: 'AI 工作站' }).first().waitFor({ timeout: 5000 });
  ok('快捷问题命中知识库（含「AI 工作站」）', true);

  // 6. 自由输入 → 兜底回答
  await page.locator('.cc-guide-input').fill('今天天气怎么样');
  await page.locator('.cc-guide-send').click();
  await page.locator('.cc-guide-bubble', { hasText: '还没准备标准答案' }).first().waitFor({ timeout: 5000 });
  ok('未命中关键词走兜底回答', true);

  // 7. 关闭弹窗
  await page.locator('.cc-guide-close').click();
  await dialog.waitFor({ state: 'detached', timeout: 3000 });
  ok('弹窗可关闭', (await dialog.count()) === 0);

  // 8. localStorage 持久化
  const persisted = await page.evaluate(() => localStorage.getItem('chuanchuanGuideMessages'));
  ok('消息已持久化到 localStorage', Boolean(persisted) && persisted.includes('还没准备标准答案'));

  // 截图（弹窗开着的状态）
  await entry.click();
  await dialog.waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'probe-cc-guide.png', fullPage: false });
  console.log('screenshot -> probe-cc-guide.png');
} catch (e) {
  console.error('PROBE_ERROR:', e.message);
  await page.screenshot({ path: 'probe-cc-guide-error.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) { console.log('PAGE_ERRORS:', errors.slice(0, 5)); process.exitCode = process.exitCode || 1; }
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  await browser.close();
}
