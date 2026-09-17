import { expect } from '@playwright/test';

export const NEWS_FIXTURES = [
  { id: 'openai-agent-1', canonicalId: 'event-openai-agent', title: 'OpenAI releases a new agent platform today', source: 'OpenAI Blog', category: 'ai', publishedAt: '2026-07-14T01:00:00Z', summary: 'Official agent platform release.', url: 'https://openai.com/index/agents' },
  { id: 'openai-agent-2', canonicalId: 'event-openai-agent', title: 'OpenAI releases new Agent platform', source: 'TechCrunch', category: 'ai', publishedAt: '2026-07-14T02:00:00Z', summary: 'Media coverage of the same agent platform.', url: 'https://techcrunch.com/openai-agent' },
  { id: 'anthropic-safety', canonicalId: 'event-anthropic-safety', title: 'Anthropic publishes safety evaluation update', source: 'Anthropic News', category: 'ai', publishedAt: '2026-07-14T03:00:00Z', summary: 'Safety evaluation update.', url: 'https://anthropic.com/news/safety' },
  { id: 'nvidia-chip', canonicalId: 'event-nvidia-chip', title: 'NVIDIA expands AI accelerator supply', source: 'NVIDIA Blog', category: 'chips', publishedAt: '2026-07-14T04:00:00Z', summary: 'Accelerator supply update.', url: 'https://nvidia.com/blog/ai-chip' },
  { id: 'tsmc-capacity', canonicalId: 'event-tsmc-capacity', title: 'TSMC adds advanced packaging capacity', source: 'Reuters', category: 'chips', publishedAt: '2026-07-14T05:00:00Z', summary: 'Packaging capacity expands.', url: 'https://reuters.com/tsmc-packaging' },
  { id: 'google-cloud-ai', canonicalId: 'event-google-cloud-ai', title: 'Google Cloud adds enterprise AI controls', source: 'Google Cloud Blog', category: 'cloud', publishedAt: '2026-07-14T06:00:00Z', summary: 'Enterprise AI control plane.', url: 'https://cloud.google.com/blog/ai-controls' },
  { id: 'aws-agents', canonicalId: 'event-aws-agents', title: 'AWS launches managed agent workflows', source: 'AWS Blog', category: 'cloud', publishedAt: '2026-07-14T07:00:00Z', summary: 'Managed workflow launch.', url: 'https://aws.amazon.com/blogs/agents' },
  { id: 'robotics-foundation', canonicalId: 'event-robotics-foundation', title: 'Robotics foundation model reaches factories', source: 'MIT Technology Review', category: 'robotics', publishedAt: '2026-07-14T08:00:00Z', summary: 'Factory robotics adoption.', url: 'https://technologyreview.com/robotics-foundation' },
  { id: 'humanoid-supply', canonicalId: 'event-humanoid-supply', title: 'Humanoid robot suppliers report new orders', source: 'Bloomberg', category: 'robotics', publishedAt: '2026-07-14T09:00:00Z', summary: 'Supplier order signal.', url: 'https://bloomberg.com/humanoid-orders' },
  { id: 'github-framework', canonicalId: 'event-github-framework', title: 'GitHub trending AI framework gains adoption', source: 'GitHub Trending', category: 'ai', publishedAt: '2026-07-14T10:00:00Z', summary: 'Open-source adoption signal.', url: 'https://github.com/example/agent-framework' },
  { id: 'funding-aiops', canonicalId: 'event-funding-aiops', title: 'AIOps startup raises new funding', source: 'The Verge', category: 'funding', publishedAt: '2026-07-14T11:00:00Z', summary: 'Funding event.', url: 'https://theverge.com/aiops-funding' },
  { id: 'paper-eval', canonicalId: 'event-paper-eval', title: 'Researchers publish agent evaluation benchmark', source: 'arXiv', category: 'research', publishedAt: '2026-07-14T12:00:00Z', summary: 'Benchmark paper.', url: 'https://arxiv.org/abs/2607.00001' },
];

export function assertFixtureContract(items = NEWS_FIXTURES) {
  expect(new Set(items.map(item => item.id)).size).toBe(items.length);
  expect(items.filter(item => item.canonicalId === 'event-openai-agent')).toHaveLength(2);
  for (const item of items) {
    expect(item.title).toBeTruthy();
    expect(item.source).toBeTruthy();
    expect(item.category).toBeTruthy();
    expect(item.publishedAt).toMatch(/^2026-07-14T/);
  }
}

export async function installExternalFixtures(page, options = {}) {
  const { community = true } = options;
  assertFixtureContract();
  await page.route('**/api/intelligence/events**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, events: NEWS_FIXTURES, updatedAt: '2026-07-14T12:30:00Z' }),
  }));
  await page.route('**/api/intelligence/items**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, items: NEWS_FIXTURES, updatedAt: '2026-07-14T12:30:00Z' }),
  }));
  await page.route('**/api/intelligence/opportunities**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, opportunities: [] }),
  }));
  await page.route('**/api/intelligence/weekly-sectors**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, sectors: [] }),
  }));
  await page.route('**/api/intelligence/alerts**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, alerts: [] }),
  }));
  await page.route('**/api/news**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, items: NEWS_FIXTURES, total: NEWS_FIXTURES.length }),
  }));
  await page.route('**/api/meta**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { sources: [...new Set(NEWS_FIXTURES.map(item => item.source))] } }),
  }));
  await page.route('**/api/trending**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, items: NEWS_FIXTURES.slice(0, 5) }),
  }));
  await page.route('**/api/github-trending**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, repos: [{ id: 'repo-1', name: 'agent-framework', fullName: 'example/agent-framework', stars: 12000 }] }),
  }));
  await page.route('**/api/stock/dashboard**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      indices: [{ code: '000001', name: '上证指数', price: 3120.12, changePct: 0.8 }],
      stocks: [{ code: '600519', name: '贵州茅台', price: 1688.8, changePct: 1.2 }],
      hotStocks: [{ code: '600519', name: '贵州茅台', price: 1688.8, changePct: 1.2 }],
      coverage: { realtimePollingSeconds: 30 },
    }),
  }));
  await page.route('**/api/stock/sectors**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sectors: [{ name: 'AI Infra', changePct: 2.1, lead: '600519' }] }),
  }));
  await page.route('**/api/stock/realtime**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: '600519',
      secid: '1.600519',
      name: '贵州茅台',
      price: 1688.8,
      change: 20.1,
      changePct: 1.2,
      open: 1660,
      high: 1699,
      low: 1655,
      prevClose: 1668.7,
      volume: 120000,
      amount: 202656000,
      bids: [{ price: 1688.7, volume: 100 }],
      asks: [{ price: 1688.9, volume: 120 }],
      timestamp: '2026-07-14T12:30:00Z',
      dataSource: 'fixture',
    }),
  }));
  await page.route('**/api/stock/timeline**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: '600519', name: '贵州茅台', preClose: 1668.7, points: [{ time: '09:30', price: 1670, volume: 1000 }, { time: '10:00', price: 1688.8, volume: 2000 }] }),
  }));
  await page.route('**/api/stock/kline**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: '600519',
      name: '贵州茅台',
      klines: Array.from({ length: 60 }, (_, index) => ({
        date: `2026-07-${String(1 + (index % 28)).padStart(2, '0')}`,
        open: 1600 + index,
        close: 1601 + index,
        high: 1605 + index,
        low: 1595 + index,
        volume: 100000 + index * 1000,
      })),
    }),
  }));
  if (community) {
    await page.route('**/api/community/posts**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { items: [], nextCursor: null } }),
    }));
  }
}

/**
 * 等开场动画覆盖层退场。
 *
 * 「硅基启动」splash 是全屏 fixed 覆盖层（z-index 10000），起跑后约 3.6s 才卸载；
 * 在它存在期间会拦截指针事件（报错形如 "…intercepts pointer events"），
 * 于是紧跟 page.goto 的点击会随机失败——同一个 spec 里有的用例过、有的挂，就是这个竞态。
 * `prefers-reduced-motion` 下 splash 直接不渲染，此时 waitFor 会立刻超时退出，属正常。
 */
export async function awaitStageReady(page) {
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
}

/**
 * 关闭首访「新用户引导」蒙层（并先等开场动画退场）。
 *
 * 必须在任何交互之前调用：该蒙层同样是全屏遮罩，会拦截指针事件，
 * 于是后续所有 `click()` 都卡到超时（表现为「点击没反应」）。
 * 侧栏导航、卡片、按钮全部受影响——症状是每个用例都 30s 超时。
 */
export async function dismissOnboarding(page) {
  await awaitStageReady(page);
  const onboarding = page.getByRole('dialog', { name: '新用户引导' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: '跳过引导' }).click();
    await onboarding.waitFor({ state: 'hidden' }).catch(() => {});
  }
}

/**
 * 按 nav 标识切换主导航。
 *
 * 侧栏是图标化的、文案随 i18n 变化，`getByText('股市')` / `hasText: '智创'` 这类定位
 * 会永久失效。导航按钮与 `<main>` 共用同一套 `data-nav` 标识，用它定位稳定。
 */
export async function openNav(page, nav) {
  await dismissOnboarding(page);
  await page.locator(`[data-nav="${nav}"]`).click();
  await expect(page.locator(`main[data-nav="${nav}"]`)).toBeVisible();
}
