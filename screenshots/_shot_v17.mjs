/** 验收 v17：单复选框、选中态、左栏固定、抽屉 Markdown 渲染 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('llmConfig', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com', apiKey: 'sk-test', selectedModel: 'gpt-4o-mini' }));
  localStorage.setItem('materials', JSON.stringify([
    { id: 'm1', type: 'viewpoint', title: '端侧模型趋势观察：推理速度与成本拐点', content: '# 核心判断\n\n- **推理速度**：端侧 NPU 利用率成为关键指标\n- **成本**：小模型单位推理成本同比下降约 60%\n\n## 落地场景\n\n1. 手机端实时翻译\n2. 座舱语音助手\n3. 工业质检边缘盒子\n\n> 结论：端云协同是未来两年的主流架构。', tags: ['端侧', '趋势'], source: '手动', createdAt: Date.now() - 1000, starred: true },
    { id: 'm2', type: 'data', title: '股票市场周报', content: '本周尾盘杀跌后企稳，量能萎缩。关注科技板块反弹机会。', tags: ['股市'], source: '手动', createdAt: Date.now() - 2000, starred: false },
    { id: 'm3', type: 'case', title: '端云协同落地案例集', content: '手机、汽车、IoT 三线并进，头部厂商已在旗舰机型部署端侧大模型。', tags: ['案例', '端侧'], source: '手动', createdAt: Date.now() - 3000, starred: false },
    { id: 'm4', type: 'note', title: '研究员对账笔记', content: '对账完成，连扳网页面已亲自抓取全文核对（非转述），资金流向也拿到了增量证据。', tags: ['群聊'], source: '团队群聊', createdAt: Date.now() - 4000, starred: false },
    { id: 'mx0', type: 'quote', title: '批量素材 0', content: '填充内容用于滚动测试 0。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 0, starred: false },
    { id: 'mx1', type: 'quote', title: '批量素材 1', content: '填充内容用于滚动测试 1。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 1, starred: false },
    { id: 'mx2', type: 'quote', title: '批量素材 2', content: '填充内容用于滚动测试 2。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 2, starred: false },
    { id: 'mx3', type: 'quote', title: '批量素材 3', content: '填充内容用于滚动测试 3。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 3, starred: false },
    { id: 'mx4', type: 'quote', title: '批量素材 4', content: '填充内容用于滚动测试 4。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 4, starred: false },
    { id: 'mx5', type: 'quote', title: '批量素材 5', content: '填充内容用于滚动测试 5。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 5, starred: false },
    { id: 'mx6', type: 'quote', title: '批量素材 6', content: '填充内容用于滚动测试 6。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 6, starred: false },
    { id: 'mx7', type: 'quote', title: '批量素材 7', content: '填充内容用于滚动测试 7。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 7, starred: false },
    { id: 'mx8', type: 'quote', title: '批量素材 8', content: '填充内容用于滚动测试 8。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 8, starred: false },
    { id: 'mx9', type: 'quote', title: '批量素材 9', content: '填充内容用于滚动测试 9。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 9, starred: false },
    { id: 'mx10', type: 'quote', title: '批量素材 10', content: '填充内容用于滚动测试 10。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 10, starred: false },
    { id: 'mx11', type: 'quote', title: '批量素材 11', content: '填充内容用于滚动测试 11。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 11, starred: false },
    { id: 'mx12', type: 'quote', title: '批量素材 12', content: '填充内容用于滚动测试 12。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 12, starred: false },
    { id: 'mx13', type: 'quote', title: '批量素材 13', content: '填充内容用于滚动测试 13。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 13, starred: false },
    { id: 'mx14', type: 'quote', title: '批量素材 14', content: '填充内容用于滚动测试 14。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 14, starred: false },
    { id: 'mx15', type: 'quote', title: '批量素材 15', content: '填充内容用于滚动测试 15。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 15, starred: false },
    { id: 'mx16', type: 'quote', title: '批量素材 16', content: '填充内容用于滚动测试 16。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 16, starred: false },
    { id: 'mx17', type: 'quote', title: '批量素材 17', content: '填充内容用于滚动测试 17。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 17, starred: false },
    { id: 'mx18', type: 'quote', title: '批量素材 18', content: '填充内容用于滚动测试 18。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 18, starred: false },
    { id: 'mx19', type: 'quote', title: '批量素材 19', content: '填充内容用于滚动测试 19。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 19, starred: false },
    { id: 'mx20', type: 'quote', title: '批量素材 20', content: '填充内容用于滚动测试 20。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 20, starred: false },
    { id: 'mx21', type: 'quote', title: '批量素材 21', content: '填充内容用于滚动测试 21。', tags: ['测试'], source: '手动', createdAt: Date.now() - 5000 - 21, starred: false },
  ]));
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
await page.locator('.nav-primary-item', { hasText: '素材管理' }).first().click();
await page.waitForTimeout(900);

// 布局断言：左栏不随内容滚动（repo-main 自滚动）
const layout = await page.evaluate(() => {
  const rail = document.querySelector('.repo-rail');
  const main = document.querySelector('.repo-main');
  return {
    railFullHeight: rail && Math.abs(rail.getBoundingClientRect().height - document.querySelector('.repo-page').getBoundingClientRect().height) < 2,
    mainScrollable: main && main.scrollHeight > main.clientHeight,
    dupCheckbox: document.querySelectorAll('.material-card .material-checkbox-row').length,
    checkboxPerCard: document.querySelectorAll('.material-card .material-checkbox-label').length === document.querySelectorAll('.material-card').length,
  };
});
console.log('LAYOUT:', JSON.stringify(layout));

// 选中一张卡片（点左上角复选框）→ 选中态
await page.locator('.material-card').first().locator('.material-checkbox-label').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/v17-card-selected.png' });

// 打开详情抽屉 → Markdown 渲染（应有 h2/strong/li 元素）
await page.locator('.material-card').first().click();
await page.waitForTimeout(600);
const drawer = await page.evaluate(() => ({
  renderedH2: document.querySelectorAll('.repo-drawer-content h2, .repo-drawer-content h1').length,
  renderedLi: document.querySelectorAll('.repo-drawer-content li').length,
  renderedStrong: document.querySelectorAll('.repo-drawer-content strong').length,
}));
console.log('DRAWER:', JSON.stringify(drawer));
await page.screenshot({ path: 'screenshots/v17-drawer.png' });

// 滚动 main，左栏应保持位置（fixed 布局验证）
await page.evaluate(() => { document.querySelector('.repo-main').scrollTop = 200; });
await page.waitForTimeout(300);
const railTop = await page.evaluate(() => document.querySelector('.repo-rail').getBoundingClientRect().top);
console.log('RAIL TOP after main scroll (应与之前一致):', Math.round(railTop));

console.log('PAGEERRORS:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
