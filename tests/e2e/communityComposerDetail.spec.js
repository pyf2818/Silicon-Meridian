import { expect, test } from '@playwright/test';
import { openNav } from './fixtures.js';

/**
 * B3/B4/B5 探针：
 * - B3 发布器：四分区 + 实时预览联动 + 草稿自动恢复 + 发布请求字段审计（channel/tags/cover/summary）
 * - B4 详情页：hero 封面 + 作者链 + 标签 + 评价区四分型（讨论/好评/吐槽/问答）+ 过滤 + 发表问答落 kind
 * - B5 聊天：未登录川川空态；登录后帖子分享卡一键跳广场详情（?post= 深链）
 * 社区 / 聊天 / 认证 API 全部本地 mock，不依赖数据库与真实登录。
 */

const AUTH_USER = { id: 'u-me', username: 'anan', displayName: '安安', avatar: '', interests: ['ai'] };

const DETAIL_POST = {
  id: 'p1', authorId: 'u1', type: 'article', channel: 'review', title: 'Qwen3-Max 深度测评：中文写作到底进步了多少',
  body: '## 实测结论\n\n覆盖 12 类中文任务，**写作与指令跟随**提升明显。',
  summary: '覆盖 12 类中文任务实测，对比上一代与竞品。',
  tags: ['模型评测', '中文能力'], cover: { kind: 'auto' }, visibility: 'public', status: 'published',
  createdAt: '2026-09-17T10:00:00Z', username: 'chuanchuan', displayName: '川川官方', avatar: '',
  likeCount: 14, bookmarkCount: 4, commentCount: 2, liked: false, bookmarked: false, following: false,
};

const MOCK_COMMENTS = [
  { id: 'c1', postId: 'p1', authorId: 'u2', kind: 'praise', body: '测试集非常扎实，直接能用。', createdAt: '2026-09-17T11:00:00Z', username: 'anan', displayName: '安安', avatar: '' },
  { id: 'c2', postId: 'p1', authorId: 'u3', kind: 'question', body: '有没有对比 Claude 的中文长文？', createdAt: '2026-09-17T12:00:00Z', username: 'gstar', displayName: 'Gstar', avatar: '' },
];

function installCommunityMocks(page) {
  const comments = [...MOCK_COMMENTS];
  const published = [];
  page.route('**/api/community/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/api\/community\/?/, '');
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
    if (pathname === 'posts' && request.method() === 'GET') return json({ items: [], nextCursor: null });
    if (pathname === 'posts' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      published.push(payload);
      return json({
        post: {
          ...payload, id: 'p-new', authorId: AUTH_USER.id, status: 'published', createdAt: '2026-09-18T03:00:00Z',
          username: AUTH_USER.username, displayName: AUTH_USER.displayName, avatar: '',
          likeCount: 0, bookmarkCount: 0, commentCount: 0, liked: false, bookmarked: false, following: false,
        },
      });
    }
    const postMatch = pathname.match(/^posts\/([^/]+)$/);
    if (postMatch && request.method() === 'GET') return json({ post: DETAIL_POST });
    const commentMatch = pathname.match(/^posts\/([^/]+)\/comments$/);
    if (commentMatch) {
      if (request.method() === 'GET') return json({ comments });
      const payload = request.postDataJSON();
      const comment = {
        id: `c-new-${comments.length + 1}`, postId: commentMatch[1], authorId: AUTH_USER.id,
        createdAt: '2026-09-18T04:00:00Z', username: AUTH_USER.username, displayName: AUTH_USER.displayName, avatar: '',
        ...payload,
      };
      comments.push(comment);
      return json({ comment });
    }
    return json({});
  });
  return { comments, published };
}

function installChatMocks(page) {
  const conversation = { id: 'conv-1', kind: 'direct', title: '川川官方', memberCount: 2, inviteCode: 'CHUAN-01' };
  const messages = [
    {
      id: 'm1', conversationId: 'conv-1', senderId: 'u1', senderName: '川川官方', kind: 'share', body: '推荐阅读',
      sharePayload: { type: 'community-post', id: 'p1', title: 'Qwen3-Max 深度测评：中文写作到底进步了多少', author: '川川官方' },
      createdAt: '2026-09-18T03:00:00Z',
    },
    { id: 'm2', conversationId: 'conv-1', senderId: AUTH_USER.id, kind: 'text', body: '收到，回头细看！', createdAt: '2026-09-18T03:01:00Z' },
  ];
  page.route('**/api/chat/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/api\/chat\/?/, '');
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
    if (pathname === 'conversations' && request.method() === 'GET') return json({ conversations: [conversation] });
    if (pathname === 'contacts' && request.method() === 'GET') return json({ contacts: [{ id: 'u1', username: 'chuanchuan', displayName: '川川官方', avatar: '' }] });
    if (/^conversations\/[^/]+\/messages$/.test(pathname) && request.method() === 'GET') return json({ items: messages });
    return json({});
  });
}

function mockLogin(page) {
  return page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { user: AUTH_USER } }),
  }));
}

function denyLogin(page) {
  return page.route('**/api/auth/me', route => route.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } }),
  }));
}

async function boot(page) {
  await page.addInitScript(() => { window.localStorage.setItem('sidebarCollapsed', 'false'); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test.describe('社区发布器与详情（B3/B4）', () => {
  test('B3 发布器：四分区 + 预览联动 + 草稿恢复 + 发布请求字段审计', async ({ page }) => {
    mockLogin(page);
    const { published } = installCommunityMocks(page);
    await boot(page);
    await openNav(page, 'square');

    // 登录态下打开发布器
    await page.getByTestId('community-open-composer').click();
    const composer = page.getByTestId('community-composer');
    await expect(composer).toBeVisible();

    // 四分区表单 + 川川发布小助手
    await expect(composer.locator('.composer-section-title')).toHaveCount(4);
    await expect(composer.getByTestId('composer-mascot-tip')).toBeVisible();
    await expect(composer.getByTestId('composer-mascot-tip').locator('svg')).toBeVisible();

    // 填标题/正文 → 右列预览联动；点「重新提取」→ 摘要自动生成
    await page.getByTestId('community-title-input').fill('智能体编排的三种范式');
    await page.getByTestId('community-body-input').fill('编排不是堆工具。**范式一**：规划器主导；**范式二**：黑板协作；**范式三**：分层委派。');
    const preview = composer.locator('.composer-preview-card');
    await expect(preview).toContainText('智能体编排的三种范式');
    await expect(preview).toContainText('编排不是堆工具');
    await composer.locator('.composer-link-btn').click();
    await expect(page.getByTestId('composer-summary-input')).not.toHaveValue('');

    // 加一个场景标签
    await composer.locator('.composer-tags .composer-chip', { hasText: '开源项目' }).click();
    await expect(composer.locator('.composer-tags .composer-chip.active', { hasText: '开源项目' })).toBeVisible();

    // 视觉验收：发布器全貌
    await page.screenshot({ path: 'screenshots/b3-community-composer.png', fullPage: false });

    // 关闭再打开 → 草稿自动恢复横幅
    await composer.locator('.community-composer-head button').click();
    await expect(page.getByTestId('community-composer')).toHaveCount(0);
    await page.getByTestId('community-open-composer').click();
    await expect(page.getByTestId('composer-draft-banner')).toContainText('已恢复');

    // 发布 → 请求审计：四分区字段全部落进 payload，且发布器关闭
    await page.getByTestId('community-submit-post').click();
    await expect.poll(() => published.length, { timeout: 5000 }).toBe(1);
    const payload = published[0];
    expect(payload.type).toBe('article');
    expect(payload.channel).toBe('discussion');
    expect(payload.title).toBe('智能体编排的三种范式');
    expect(payload.summary.length).toBeGreaterThan(0);
    expect(payload.tags).toContain('开源项目');
    expect(payload.cover).toEqual({ kind: 'auto' });
    expect(payload.visibility).toBe('public');
    await expect(page.getByTestId('community-composer')).toHaveCount(0);
  });

  test('B4 详情页：hero/作者链/标签 + 评价区四分型 + 过滤 + 发表问答落 kind', async ({ page }) => {
    mockLogin(page);
    const { comments } = installCommunityMocks(page);
    await boot(page);
    await page.goto('/?post=p1', { waitUntil: 'domcontentloaded' });
    await openNav(page, 'square');

    // 抽屉结构：hero 封面 + 标题 + 作者链 + 标签
    const detail = page.getByTestId('community-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Qwen3-Max');
    await expect(detail.locator('.community-detail-hero')).toBeVisible();
    await expect(detail.locator('.community-detail-author-name')).toContainText('川川官方');
    await expect(detail.locator('.community-detail-tags .community-detail-tag')).toHaveCount(2);

    // 评价 Tab：四分型 chips + 两条既有评价
    await page.getByTestId('community-detail-feedback-tab').click();
    await expect(page.getByTestId('community-feedback')).toBeVisible();
    for (const kind of ['comment', 'praise', 'critique', 'question']) {
      await expect(page.getByTestId(`community-kind-${kind}`)).toBeVisible();
    }
    await expect(page.getByTestId('community-comment-item')).toHaveCount(2);

    // 分型过滤：好评 → 1 条；回全部 → 2 条
    await page.locator('.community-feedback-filter', { hasText: '好评' }).click();
    await expect(page.getByTestId('community-comment-item')).toHaveCount(1);
    await page.locator('.community-feedback-filter', { hasText: '全部' }).click();
    await expect(page.getByTestId('community-comment-item')).toHaveCount(2);

    // 发表「问答」型评价 → POST 带 kind=question，列表即时追加
    await page.getByTestId('community-kind-question').click();
    await page.getByTestId('community-comment-input').fill('能否开源测试集脚本？');
    await page.getByTestId('community-submit-comment').click();
    await expect.poll(() => comments.length, { timeout: 5000 }).toBe(3);
    expect(comments[2].kind).toBe('question');
    expect(comments[2].body).toBe('能否开源测试集脚本？');
    await expect(page.getByTestId('community-comment-item')).toHaveCount(3);

    // 视觉验收：详情评价区
    await page.screenshot({ path: 'screenshots/b4-community-detail.png', fullPage: false });
  });
});

test.describe('聊天与广场联动（B5）', () => {
  test('B5 未登录：聊天页展示川川空态引导', async ({ page }) => {
    denyLogin(page);
    await boot(page);
    await openNav(page, 'chat');
    const emptyState = page.getByTestId('chat-login-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('川川帮你传话');
    await expect(emptyState.locator('svg')).toBeVisible();
  });

  test('B5 已登录：会话帖子分享卡 → 一键跳广场直达详情', async ({ page }) => {
    mockLogin(page);
    installCommunityMocks(page);
    installChatMocks(page);
    await boot(page);
    await openNav(page, 'chat');

    // 消息流里的帖子分享卡：PostCover 缩略 + 标题 + 来源
    const card = page.getByTestId('chat-post-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Qwen3-Max');
    await expect(card).toContainText('来自用户广场');

    // 点击「在广场查看」→ 切到广场频道并直达详情
    // （不做 URL 断言：深链被 CommunityPage 挂载时消费并从地址栏剥离，时序竞态）
    await card.getByRole('button', { name: '在广场查看 →' }).click();
    await expect(page.locator('main[data-nav="square"]')).toBeVisible();
    await expect(page.getByTestId('community-detail')).toContainText('Qwen3-Max');
  });
});
