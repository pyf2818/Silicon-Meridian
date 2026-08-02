// 用 playwright.route 拦截 API，注入 mock 数据，让仪表盘显示真实图表
import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';

function genSnapshots(n = 30) {
  const statuses = ['focus', 'explore', 'balanced', 'focus', 'balanced'];
  const today = new Date('2026-08-02');
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    const ds = d.toISOString().slice(0, 10);
    const base = 20 + i * 1.2 + Math.sin(i / 4) * 8;
    out.push({
      date: ds,
      algorithmVersion: 'v3.2',
      aiStatus: statuses[i % statuses.length],
      oneLine: `${Math.round(base + Math.random() * 6)} 条推荐`,
    });
  }
  return out;
}

function genPersonaHistory(nodeCount = 5) {
  // nodeCount 个节点（今天 + 每 -1 天），habits/traits/needs 数量递增（显示进化）
  const days = Array.from({ length: nodeCount }, (_, i) => i * 1);
  return days.map((d, idx) => {
    const date = new Date('2026-08-02');
    date.setDate(date.getDate() - d);
    const depth = nodeCount - idx;
    return {
      evolved_at: date.toISOString(),
      snapshot: {
        habits: Array.from({ length: Math.min(10, 2 + depth) }, (_, i) => `习惯 ${i + 1}`),
        traits: Array.from({ length: Math.min(10, 1 + depth) }, (_, i) => `性格 ${i + 1}`),
        needs: Array.from({ length: Math.min(10, depth) }, (_, i) => `需求 ${i + 1}`),
      },
    };
  });
}

function genPersona() {
  return {
    habits: ['深入阅读', '关注开源', '晚上工作', '喜欢技术博客'],
    traits: ['理性', '好奇心强', '独立思考', '追求效率'],
    needs: ['高质量技术资讯', '节省时间', '快速决策'],
    lastEvolvedAt: '2026-08-02T08:00:00Z',
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 拦截 API 返回 mock 数据（默认 5 节点：验证对齐）
  const snapshots = genSnapshots(30);
  const nodeCount = process.argv.includes('--scroll') ? 20 : 5;
  const history = genPersonaHistory(nodeCount);
  await page.route('**/api/profile/snapshots*', route => {
    const url = route.request().url();
    if (url.includes('/preheat')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, snapshots: [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, snapshots }) });
  });
  await page.route('**/api/agent-memory/persona**', route => {
    const url = route.request().url();
    if (url.includes('/history')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, history }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, persona: genPersona() }) });
  });

  await page.waitForTimeout(4500);
  await page.locator('text=用户画像').first().click({ timeout: 10000 });
  await page.waitForTimeout(3500);

  // 滚到仪表盘中部（radar + aistatus + evolution + reading 区域）
  await page.locator('.dash-main').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/hud-dashboard-with-data.png' });

  console.log('OK');
} catch (err) {
  console.error('ERR:', err.message);
  await page.screenshot({ path: 'screenshots/hud-dashboard-with-data-err.png' });
} finally {
  await browser.close();
}