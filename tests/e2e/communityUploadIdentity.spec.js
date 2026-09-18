import { expect, test } from '@playwright/test';
import { openNav } from './fixtures.js';

/**
 * C3 任务 3/4 探针：
 * - 任务 3 上传：发布器上传分区（图片/视频/附件按钮 + 配额）+ mock 上传后缩略图/附件 chips + 发布 payload 携带 media/attachments
 *   + 详情页媒体画廊（缩略网格 + 缩小视频）与附件下载列表
 * - 任务 4 身份卡：川川 v2 + 唯一 ID + 全站居民数 + 绑定/认证 chips 与表单联动 + 作者认证徽章
 * 社区/身份 API 全部本地 mock，不依赖数据库与真实登录。
 */

const AUTH_USER = { id: 'u-me', username: 'anan', displayName: '安安', avatar: '', interests: ['ai'] };

const UPLOAD_RECORDS = {
  image: { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', kind: 'image', mime: 'image/png', name: '效果图.png', size: 20480, url: '/api/community/uploads/3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
  video: { id: '8f14e45f-ceea-467f-a8d5-4c273fc3c5d7', kind: 'video', mime: 'video/mp4', name: '演示.mp4', size: 102400, url: '/api/community/uploads/8f14e45f-ceea-467f-a8d5-4c273fc3c5d7' },
  file: { id: 'c9f0f895-fb98a-b915-149d27d5d8e0', kind: 'file', mime: 'application/pdf', name: '资料.pdf', size: 40960, url: '/api/community/uploads/c9f0f895-fb98a-b915-149d27d5d8e0' },
};

const DETAIL_POST = {
  id: 'p1', authorId: 'u1', type: 'article', channel: 'share', title: '端侧 Agent 实机演示：从指令到落盘',
  body: '一段视频 + 两张效果图 + 完整脚本附件。',
  summary: '端侧 Agent 全流程实录。',
  tags: ['创作分享'], cover: { kind: 'auto' }, visibility: 'public', status: 'published',
  media: [UPLOAD_RECORDS.image, UPLOAD_RECORDS.video],
  attachments: [UPLOAD_RECORDS.file],
  createdAt: '2026-09-18T10:00:00Z', username: 'chuanchuan', displayName: '川川官方', avatar: '',
  authorBadge: 'creator',
  likeCount: 3, bookmarkCount: 1, commentCount: 0, liked: false, bookmarked: false, following: false,
};

function mockLogin(page) {
  return page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { user: AUTH_USER } }),
  }));
}

function installCommunityMocks(page) {
  const published = [];
  const uploadQueue = [UPLOAD_RECORDS.image, UPLOAD_RECORDS.file]; // 按调用顺序返回（multipart 的 content-type 恒为 form-data，无法按类型判别）
  page.route('**/api/community/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/api\/community\/?/, '');
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
    if (pathname === 'uploads' && request.method() === 'POST') {
      const record = uploadQueue.shift() || UPLOAD_RECORDS.image;
      return json({ uploads: [record] });
    }
    if (pathname === 'posts' && request.method() === 'GET') return json({ items: [], nextCursor: null });
    if (pathname === 'posts' && request.method() === 'POST') {
      published.push(request.postDataJSON());
      return json({
        post: {
          ...request.postDataJSON(), id: 'p-new', authorId: AUTH_USER.id, status: 'published', createdAt: '2026-09-18T11:00:00Z',
          username: AUTH_USER.username, displayName: AUTH_USER.displayName, avatar: '',
          likeCount: 0, bookmarkCount: 0, commentCount: 0, liked: false, bookmarked: false, following: false,
        },
      });
    }
    if (/^posts\/[^/]+$/.test(pathname) && request.method() === 'GET') return json({ post: DETAIL_POST });
    if (/^posts\/[^/]+\/comments$/.test(pathname)) return json({ comments: [] });
    return json({});
  });
  return { published };
}

function installIdentityMocks(page) {
  const state = {
    bindings: [{ type: 'wechat', value: 'anan_wx-01', status: 'verified', createdAt: '2026-09-18T09:00:00Z' }],
    verifications: [{ type: 'creator', status: 'approved', payload: { platform: '即刻' }, createdAt: '2026-09-18T09:10:00Z' }],
  };
  page.route('**/api/user/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/api\/user\/?/, '');
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
    if (pathname === 'identity' && request.method() === 'GET') {
      return json({
        user: { ...AUTH_USER, publicId: 'A7K2M9' },
        bindings: state.bindings,
        verifications: state.verifications,
        totalUsers: 128,
        badge: 'creator',
      });
    }
    if (pathname === 'bindings' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      state.bindings = state.bindings.filter(b => b.type !== payload.type);
      state.bindings.push({ type: payload.type, value: payload.value, status: 'verified', createdAt: '2026-09-18T12:00:00Z' });
      return json({ bindings: state.bindings, binding: state.bindings.at(-1) });
    }
    if (pathname === 'verifications' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      state.verifications.push({ type: payload.type, status: 'approved', payload: payload.payload || {}, createdAt: '2026-09-18T12:01:00Z' });
      return json({ verifications: state.verifications, verification: state.verifications.at(-1), badge: 'creator' });
    }
    return json({});
  });
}

async function boot(page) {
  await page.addInitScript(() => { window.localStorage.setItem('sidebarCollapsed', 'false'); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test.describe('社区上传（C3 任务 3）', () => {
  test('发布器：上传图片/附件 → 缩略图与附件 chips → 发布 payload 携带 media/attachments', async ({ page }) => {
    mockLogin(page);
    const { published } = installCommunityMocks(page);
    await boot(page);
    await openNav(page, 'square');
    await page.getByTestId('community-open-composer').click();
    const composer = page.getByTestId('community-composer');
    await expect(composer).toBeVisible();

    // 上传分区：三个配额按钮 + 拖拽提示
    const uploadZone = page.getByTestId('composer-upload');
    await expect(uploadZone).toContainText('效果图（0/9）');
    await expect(uploadZone).toContainText('效果视频（0/2）');
    await expect(uploadZone).toContainText('附件（0/10）');

    // 封面来源四档：本地上传档在无图时禁用
    await expect(composer.locator('.composer-chip', { hasText: '本地上传' })).toBeDisabled();

    // 选择一张图 → mock 上传 → 缩略图出现 + 配额更新 + 封面「本地上传」点亮
    await page.getByTestId('composer-upload-image').click();
    await page.locator('input[type="file"][data-testid="composer-upload-input"]').setInputFiles({
      name: '效果图.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5, 6, 7]),
    });
    await expect(page.getByTestId('composer-upload-media').locator('img')).toHaveCount(1);
    await expect(uploadZone).toContainText('效果图（1/9）');
    await expect(composer.locator('.composer-chip', { hasText: '本地上传' })).toBeEnabled();

    // 选择附件 → 附件 chip
    await page.locator('.composer-upload-actions .composer-chip', { hasText: '附件' }).click();
    await page.locator('input[type="file"][data-testid="composer-upload-input"]').setInputFiles({
      name: '资料.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 mock'),
    });
    await expect(page.getByTestId('composer-upload-files').locator('.composer-upload-file-chip')).toHaveCount(1);

    // 视觉验收：上传区
    await page.screenshot({ path: 'screenshots/c3-composer-upload.png', fullPage: false });

    // 发布 → payload 携带 media/attachments
    await page.getByTestId('community-title-input').fill('带附件的演示帖');
    await page.getByTestId('community-body-input').fill('正文内容，包含上传物。');
    await page.getByTestId('community-submit-post').click();
    await expect.poll(() => published.length, { timeout: 5000 }).toBe(1);
    expect(published[0].media).toHaveLength(1);
    expect(published[0].media[0].kind).toBe('image');
    expect(published[0].media[0].url).toMatch(/^\/api\/community\/uploads\//);
    expect(published[0].attachments).toHaveLength(1);
    expect(published[0].attachments[0].name).toBe('资料.pdf');
  });

  test('详情页：媒体画廊（图/视频）与附件下载列表渲染', async ({ page }) => {
    mockLogin(page);
    installCommunityMocks(page);
    await boot(page);
    await page.goto('/?post=p1', { waitUntil: 'domcontentloaded' });
    await openNav(page, 'square');

    const detail = page.getByTestId('community-detail');
    await expect(detail).toBeVisible();

    const media = page.getByTestId('detail-media');
    await expect(media).toBeVisible();
    await expect(media.locator('.detail-media-thumb')).toHaveCount(1);
    await expect(media.locator('.detail-media-video')).toHaveCount(1);

    // 点缩略图 → lightbox 放大 → 点遮罩关闭
    await media.locator('.detail-media-thumb').click();
    await expect(page.getByTestId('detail-lightbox')).toBeVisible();
    await page.getByTestId('detail-lightbox').click();
    await expect(page.getByTestId('detail-lightbox')).toHaveCount(0);

    // 附件列表：文件名 + 大小
    const attachments = page.getByTestId('detail-attachments');
    await expect(attachments).toContainText('附件资料（1）');
    await expect(attachments.locator('.detail-attachment', { hasText: '资料.pdf' })).toBeVisible();

    // 作者行带博主认证徽章（compact 徽章只显示图标，用 class 断言）
    await expect(detail.locator('.community-detail-author-name').locator('.verified-badge')).toHaveClass(/verified-badge-creator/);

    await page.screenshot({ path: 'screenshots/c3-detail-media.png', fullPage: false });
  });
});

test.describe('身份卡（C3 任务 4）', () => {
  test('我的社交：川川 v2 立绘 + 唯一 ID + 绑定/认证表单联动', async ({ page }) => {
    mockLogin(page);
    installIdentityMocks(page);
    await boot(page);
    await openNav(page, 'profile-center');

    // 切到「我的社交」分区
    await page.locator('.profile-section-rail-item', { hasText: '我的社交' }).click();
    const card = page.getByTestId('identity-card');
    await expect(card).toBeVisible();

    // 川川 v2 SVG + 唯一 ID + 居民统计
    await expect(card.locator('svg.chuanchuan-v2')).toBeVisible();
    await expect(page.getByTestId('identity-public-id')).toHaveText('A7K2M9');
    await expect(page.getByTestId('identity-total-users')).toContainText('第 128 位居民');
    await expect(card.locator('.verified-badge-creator')).toContainText('博主认证');

    // 绑定状态：微信已绑、邮箱未绑；换绑邮箱 → chips 更新
    await expect(card.locator('.identity-binding-chip', { hasText: '微信' })).toContainText('已绑定');
    await expect(card.locator('.identity-binding-chip', { hasText: '邮箱' })).toContainText('未绑定');
    await page.getByTestId('identity-binding-input').fill('anan@meridian.dev');
    await page.getByTestId('identity-binding-submit').click();
    await expect(card.locator('.identity-binding-chip', { hasText: '邮箱' })).toContainText('已绑定');

    // 认证：企业 chip 初始未认证 → 提交企业认证表单 → chip 点亮
    await expect(card.locator('.identity-binding-chip', { hasText: '企业' })).not.toContainText('已认证');
    await card.locator('select').nth(1).selectOption('enterprise');
    await page.getByTestId('identity-verify-companyName').fill('万般硅川科技');
    await page.getByTestId('identity-verify-creditCode').fill('91310000MA1K35X000');
    await page.getByTestId('identity-verify-submit').click();
    await expect(card.locator('.identity-binding-chip', { hasText: '企业' })).toContainText('已认证');

    await page.screenshot({ path: 'screenshots/c4-identity-card.png', fullPage: false });
  });
});
