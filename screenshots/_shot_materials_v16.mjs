/** 素材管理网格截图（v16 卡片重设计验收） */
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('materials', JSON.stringify([
    { id: 'm1', type: 'viewpoint', title: '端侧模型趋势观察', content: '端侧推理速度持续提升，NPU 利用率成为关键指标。小模型成本下降明显，端云协同成为主流架构。', tags: ['端侧', '趋势'], source: '手动', createdAt: Date.now() - 1000, starred: true },
    { id: 'm2', type: 'data', title: '股票市场周报', content: '本周尾盘杀跌后企稳，量能萎缩。关注科技板块的反弹机会与风险提示。', tags: ['股市'], source: '手动', createdAt: Date.now() - 2000, starred: false },
    { id: 'm3', type: 'case', title: '端云协同落地案例', content: '手机、汽车、IoT 三线并进，头部厂商已在旗舰机型部署端侧大模型。', tags: ['案例', '端侧'], source: '手动', createdAt: Date.now() - 3000, starred: false },
  ]));
});
const page = await ctx.newPage();
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
try { const s = await page.$('button:has-text("跳过")'); if (s) await s.click(); } catch {}
await page.locator('.nav-primary-item', { hasText: '素材管理' }).first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/v16-materials-grid.png' });
console.log('materials shot done');
await browser.close();
