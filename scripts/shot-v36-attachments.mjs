// v36 附件链路 E2E：选择→上传→随消息发送→气泡渲染→图片悬停预览
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 造测试文件：1x1 PNG + 文本
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
writeFileSync('.workbuddy/e2e-att-test.png', PNG_1PX);
writeFileSync('.workbuddy/e2e-att-test.txt', '这是附件测试文本：关键数据点 A=42，B=hello。'.repeat(20));

const doLogin = async () => fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
});
let loginRes = await doLogin();
if (loginRes.status === 401) {
  // 内存认证模式下账号随 dev server 重启丢失——自动重建
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'editor-demo', password: 'E2eTest#2026' }),
  });
  loginRes = await doLogin();
}
const setCookie = loginRes.headers.get('set-cookie') || '';
const sessionValue = setCookie.split(';')[0].split('=').slice(1).join('=');
if (!sessionValue) { console.error('登录失败', loginRes.status); process.exit(1); }
log('登录 OK');

const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addCookies([{ name: 'meridian_session', value: sessionValue, domain: 'localhost', path: '/' }]);
await context.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ baseUrl: 'http://127.0.0.1:9100/v1', apiKey: 'local-gateway', selectedModel: 'mock-fast', provider: 'custom' }));
});
const page = await context.newPage();
const diagLogs = [];
page.on('pageerror', e => diagLogs.push(`[pageerror] ${String(e).slice(0, 300)}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
// 新注册用户会弹首访引导——跳过
const onboarding = page.getByRole('dialog', { name: '新用户引导' });
if (await onboarding.isVisible().catch(() => false)) {
  await onboarding.getByRole('button', { name: '跳过引导' }).click();
  await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
}
const input = page.locator('textarea.chat-input');
try {
  await input.waitFor({ state: 'visible', timeout: 15_000 });
} catch {
  await page.screenshot({ path: 'v36-debug-landing.png', timeout: 10_000 }).catch(() => {});
  log('诊断 URL:', page.url());
  const dialogs = await page.locator('[role="dialog"], .onboarding, .modal-overlay').allTextContents().catch(() => []);
  log('可见弹层:', JSON.stringify(dialogs.map(t => t.slice(0, 80))).slice(0, 400));
  await browser.close();
  process.exit(4);
}
await page.waitForFunction(() => !document.querySelector('textarea.chat-input')?.disabled, null, { timeout: 20_000 });
log('工作站就绪');

// 1. 通过文件选择器加附件（input 无 multiple 属性 → 分两次传）
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles('.workbuddy/e2e-att-test.png');
await page.waitForTimeout(300);
await fileInput.setInputFiles('.workbuddy/e2e-att-test.txt');
log('附件已选择，等待上传完成…');

// 2. 等两个 chip 都变「就绪」
try {
  await page.waitForFunction(() => {
    const states = [...document.querySelectorAll('.chat-attachment-state')];
    return states.length >= 2 && states.every(s => s.textContent.includes('就绪'));
  }, null, { timeout: 20_000 });
  log('✅ 两个附件均上传就绪');
} catch {
  const chipTexts = await page.locator('.chat-attachment-chip').allTextContents().catch(() => []);
  log('❌ 附件未就绪。chips:', JSON.stringify(chipTexts));
  await page.screenshot({ path: 'v36-att-fail-chips.png', timeout: 10_000 }).catch(() => {});
  await browser.close();
  process.exit(2);
}
await page.screenshot({ path: 'v36-1-chips-ready.png', timeout: 10_000 });

// 3. 发送消息
await input.fill('请分析我上传的这两个附件');
await input.press('Enter');
log('消息已发送');

// 4. 等完成（折叠摘要或用户气泡附件渲染）
try { await page.waitForSelector('.chat-msg-attachments', { timeout: 20_000 }); log('✅ 用户气泡出现附件区'); }
catch { log('❌ 用户气泡无附件区'); }

// 5. 断言：图片缩略图 + 文件卡片
const thumbCount = await page.locator('.chat-att-image').count();
const fileCount = await page.locator('.chat-att-file').count();
log(`气泡附件：图片缩略图=${thumbCount}（须>0） 文件卡片=${fileCount}（须>0）`);
await page.waitForTimeout(1200); // 等 mock 回复完成
await page.screenshot({ path: 'v36-2-msg-attachments.png', timeout: 10_000 });

// 6. 悬停图片缩略图 → 预览小窗
let previewOk = false;
if (thumbCount > 0) {
  await page.locator('.chat-att-image').first().hover();
  await page.waitForTimeout(400);
  previewOk = await page.locator('.chat-img-preview-pop').count() > 0;
  log(`悬停预览小窗=${previewOk ? '出现 ✅' : '未出现 ❌'}`);
  await page.screenshot({ path: 'v36-3-hover-preview.png', timeout: 10_000 });
}

// 7. dump assistant 气泡 DOM（定位「0」节点）+ 「0」复现探测（最多 3 轮）
for (let round = 0; round < 3; round += 1) {
  await input.fill(`zero 复现探测第 ${round + 1} 轮`);
  await input.press('Enter');
  await page.waitForTimeout(3500);
  const probe = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('.chat-msg-assistant .chat-bubble');
    const b = bubbles[bubbles.length - 1];
    if (!b) return { no: 1 };
    const hasZero = [...b.querySelectorAll('.chat-bubble-content > *')].some(el => {
      const t = (el.textContent || '').trim();
      return t === '0' || /^(0)$/.test(t);
    });
    return { hasZero, html: hasZero ? b.querySelector('.chat-bubble-content').innerHTML.slice(0, 600) : '' };
  });
  log(`探测第 ${round + 1} 轮：${JSON.stringify(probe).slice(0, 300)}`);
  if (probe.hasZero) break;
}

await browser.close();
const ok = thumbCount > 0 && fileCount > 0 && previewOk;
log(ok ? 'PASS ✅' : `FAIL ❌ thumb=${thumbCount} file=${fileCount} preview=${previewOk}`);
if (diagLogs.length) log('诊断:', diagLogs.slice(-5).join(' | '));
process.exit(ok ? 0 : 3);
