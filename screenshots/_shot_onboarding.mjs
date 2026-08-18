// 首跑引导（B2 首跑引导）验证：走完 欢迎→兴趣→信源→智能引擎→生成简报 全流程
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5175/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const facts = {};
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext(); // 全新上下文：无 localStorage，确保首跑触发
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });

// 等待引导出现
await page.waitForSelector('.onb-overlay', { timeout: 15000 });
facts.welcomeShown = await page.isVisible('.onb-overlay');
facts.welcomeTitle = (await page.textContent('.onb-title'))?.trim().slice(0, 40);
facts.stepCount = await page.locator('.onb-step-item').count();

// Step 0 -> 下一步
await page.click('.onb-btn-primary');
await page.waitForSelector('.onb-interests', { timeout: 8000 });
facts.interestChips = await page.locator('.onb-chip').count();

// 选 3 个兴趣
const chips = page.locator('.onb-chip');
await chips.nth(0).click();
await chips.nth(3).click();
await chips.nth(6).click();
facts.interestsSelected = await page.locator('.onb-chip.sel').count();
await page.screenshot({ path: 'screenshots/onb-step1-interests.png' });

// -> 下一步（信源）
await page.click('.onb-btn-primary');
await page.waitForSelector('.onb-sources', { timeout: 8000 });
facts.sourceCards = await page.locator('.onb-source-card').count();
await page.locator('.onb-source-card').nth(0).click();
facts.sourcesSelected = await page.locator('.onb-source-card.sel').count();

// -> 下一步（智能引擎）
await page.click('.onb-btn-primary');
await page.waitForSelector('.onb-llm', { timeout: 8000 });
facts.llmOptions = await page.locator('.onb-llm-opt').count();
facts.llmPathDefault = await page.locator('.onb-llm-opt.sel').count();

// 切到「配置大模型」验证内联表单出现
await page.locator('.onb-llm-opt').nth(1).click();
await page.waitForSelector('.onb-llm-form', { timeout: 5000 });
facts.llmFormShown = await page.isVisible('.onb-llm-form');
facts.llmPresets = await page.locator('.onb-preset').count();
// 填一段（不真连，验证受控写入）
await page.fill('.onb-field input[placeholder*="openai"]', 'https://api.openai.com/v1');
facts.llmBaseUrlFilled = await page.inputValue('.onb-field input[placeholder*="openai"]');
// 回到算法模式（默认最稳路径）
await page.locator('.onb-llm-opt').nth(0).click();
await page.screenshot({ path: 'screenshots/onb-step3-llm.png' });

// 生成首份简报并进入
await page.click('.onb-btn-primary');
// 等待引导消失
await page.waitForSelector('.onb-overlay', { state: 'detached', timeout: 15000 });
facts.onboardingClosed = true;
facts.onboardedFlag = await page.evaluate(() => localStorage.getItem('meridian_onboarded'));
facts.interestsSaved = await page.evaluate(() => localStorage.getItem('selectedInterests'));
facts.sourcesSaved = await page.evaluate(() => localStorage.getItem('meridian_source_prefs'));
facts.nav = await page.evaluate(() => new URL(window.location.href).searchParams.get('view'));
await page.screenshot({ path: 'screenshots/onb-final.png' });

facts.ERRORS = errors;

console.log(JSON.stringify(facts, null, 2));
await browser.close();
