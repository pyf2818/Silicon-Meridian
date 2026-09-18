import { expect, test } from '@playwright/test';
import { dismissOnboarding, openNav } from './fixtures.js';

/**
 * B2 社区广场壳探针：频道条 / 场景 chips / 搜索 / 自动封面卡片 / hero / 川川空态 / 详情抽屉。
 * 社区 API 走本地 mock（按 query 组装），不依赖登录与数据库。
 */

const MOCK_POSTS = [
  {
    id: 'p1', authorId: 'u1', type: 'review', channel: 'review', title: 'Qwen3-Max 深度测评：中文写作到底进步了多少',
    body: '覆盖 12 类中文任务实测，对比上一代与竞品，附完整测试集与复现脚本。',
    summary: '覆盖 12 类中文任务实测，对比上一代与竞品，附完整测试集与复现脚本。',
    tags: ['模型评测'], cover: { kind: 'auto' }, visibility: 'public', status: 'published',
    createdAt: '2026-09-17T10:00:00Z', username: 'chuanchuan', displayName: '川川官方', avatar: '',
    likeCount: 14, bookmarkCount: 4, commentCount: 11, liked: false, bookmarked: false, following: false,
  },
  {
    id: 'p2', authorId: 'u2', type: 'article', channel: 'discussion', title: '开源模型本地部署的显存账到底怎么算',
    body: '量化、上下文、批大小三件事，一张表讲清楚。',
    summary: '量化、上下文、批大小三件事，一张表讲清楚。',
    tags: ['开源项目'], cover: { kind: 'auto' }, visibility: 'public', status: 'published',
    createdAt: '2026-09-17T08:00:00Z', username: 'anan', displayName: '安安', avatar: '',
    likeCount: 27, bookmarkCount: 9, commentCount: 3, liked: false, bookmarked: false, following: false,
  },
  {
    id: 'p3', authorId: 'u3', type: 'work', channel: 'discussion', title: '用工作站跑通「论文追踪」智能体流水线',
    body: '从 arxiv 抓取到聚类摘要，全流程配置与踩坑记录。',
    summary: '从 arxiv 抓取到聚类摘要，全流程配置与踩坑记录。',
    tags: ['AI厂商'], cover: { kind: 'auto' }, visibility: 'public', status: 'published',
    createdAt: '2026-09-16T09:00:00Z', username: 'gstar', displayName: 'Gstar', avatar: '',
    likeCount: 8, bookmarkCount: 2, commentCount: 0, liked: false, bookmarked: false, following: false,
  },
];

function installCommunityMocks(page) {
  const requests = [];
  page.route('**/api/community/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/api\/community\/?/, '');
    requests.push(`${request.method()} ${pathname}?${url.searchParams.toString()}`);
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
    if (pathname === 'posts') {
      const channel = url.searchParams.get('channel');
      const tag = url.searchParams.get('tag');
      const q = url.searchParams.get('q');
      let items = MOCK_POSTS;
      if (channel) items = items.filter(post => post.channel === channel);
      if (tag) items = items.filter(post => post.tags.includes(tag));
      if (q) items = items.filter(post => `${post.title}${post.body}`.toLowerCase().includes(q.toLowerCase()));
      return json({ items, nextCursor: null });
    }
    const postMatch = pathname.match(/^posts\/([^/]+)$/);
    if (postMatch && request.method() === 'GET') {
      const post = MOCK_POSTS.find(item => item.id === postMatch[1]);
      return post ? json({ post }) : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'POST_NOT_FOUND', message: '内容不存在' } }) });
    }
    const commentMatch = pathname.match(/^posts\/([^/]+)\/comments$/);
    if (commentMatch) {
      if (request.method() === 'GET') return json({ comments: [] });
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {} }) });
  });
  return requests;
}

test.describe('社区广场壳（B2）', () => {
  test('频道条 + 精选 hero + 封面卡片栅格 + chips/搜索/频道联动 + 川川空态 + 详情抽屉', async ({ page }) => {
    const requests = installCommunityMocks(page);
    await page.addInitScript(() => { window.localStorage.setItem('sidebarCollapsed', 'false'); });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openNav(page, 'square');

    // 1. 频道条渲染且精选默认激活
    const channels = page.locator('.community-channels');
    await expect(channels).toBeVisible();
    await expect(page.locator('.community-channel-tab.active')).toHaveText('精选');

    // 2. 精选视图：hero + 封面卡片栅格
    await expect(page.getByTestId('community-hero')).toBeVisible();
    const cards = page.getByTestId('community-post');
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator('.community-card-cover-word')).toBeVisible();

    // 3. 切讨论频道：请求带 channel=discussion，hero 消失
    await page.getByTestId('community-channel-discussion').click();
    await expect(cards).toHaveCount(2);
    await expect(page.getByTestId('community-hero')).toHaveCount(0);

    // 4. 场景 chips：点「模型评测」→ 空（讨论频道无该标签帖）→ 川川空态出现
    await page.getByRole('button', { name: '模型评测' }).click();
    await expect(page.getByTestId('community-empty-state')).toBeVisible();
    await expect(page.getByTestId('community-empty-state').locator('svg')).toBeVisible();

    // 5. 清掉 chip 回讨论，搜索「显存」→ 只剩 p2
    await page.locator('.community-chip', { hasText: '全部' }).click();
    await page.getByTestId('community-search').fill('显存');
    await page.getByTestId('community-search').press('Enter');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('显存');

    // 6. 点卡片 → 详情抽屉打开（mock GET posts/p2）
    await cards.first().click();
    await expect(page.getByTestId('community-detail')).toBeVisible();
    await expect(page.getByTestId('community-detail')).toContainText('显存');
    await page.locator('.community-detail-toolbar button').click();

    // 7. 深链 ?post=p1 直达详情
    await page.goto('/?post=p1', { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(page);
    await expect(page.getByTestId('community-detail')).toBeVisible();
    await expect(page.getByTestId('community-detail')).toContainText('Qwen3-Max');

    // 8. 请求参数审计：频道/chips/搜索参数确实落到了 API
    const listRequests = requests.filter(line => line.startsWith('GET posts?'));
    expect(listRequests.some(line => line.includes('channel=discussion'))).toBe(true);
    expect(listRequests.some(line => line.includes('tag=%E6%A8%A1%E5%9E%8B%E8%AF%84%E6%B5%8B'))).toBe(true);
    expect(listRequests.some(line => line.includes('q=%E6%98%BE%E5%AD%98'))).toBe(true);

    // 9. 视觉验收截图（浅色主题）
    await page.getByTestId('community-detail').locator('.community-detail-toolbar button').click();
    await page.getByTestId('community-channel-featured').click();
    await expect(page.getByTestId('community-hero')).toBeVisible();
    await page.screenshot({ path: 'screenshots/b2-community-square.png', fullPage: false });
  });
});
