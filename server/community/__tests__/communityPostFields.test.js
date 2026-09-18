import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractSummary, normalizeChannel, normalizeCommentKind, normalizeCover, normalizeTags, POST_CONTENT_FIELDS,
} from '../postFields.js';
import { POST_VIEW_SQL } from '../communityRepository.js';
import { createCommunityService } from '../communityService.js';
import { createMemoryCommunityRepository, __memoryCommunityStore } from '../memoryCommunityRepository.js';
import { createMemoryAuthRepository, __memoryStore } from '../../auth/memoryAuthRepository.js';

async function seedUsers() {
  const auth = createMemoryAuthRepository();
  const pwd = { hash: 'h', salt: 's', params: {} };
  const alice = await auth.createUser({ username: 'alice', email: '', password: pwd, displayName: '爱丽丝' });
  const bob = await auth.createUser({ username: 'bob', email: '', password: pwd, displayName: '鲍勃' });
  return { alice, bob };
}

describe('postFields（B1 字段唯一事实源）', () => {
  it('normalizeChannel：非法值一律回落 discussion', () => {
    expect(normalizeChannel('review')).toBe('review');
    expect(normalizeChannel(undefined)).toBe('discussion');
    expect(normalizeChannel('hack')).toBe('discussion');
  });

  it('normalizeTags：截断 5 个 / 单项 24 字 / 剔空白', () => {
    expect(normalizeTags(['a', ' ', 'b'])).toEqual(['a', 'b']);
    expect(normalizeTags(['1', '2', '3', '4', '5', '6']).length).toBe(5);
    expect(normalizeTags(['x'.repeat(30)])[0].length).toBe(24);
    expect(normalizeTags('not-array')).toEqual([]);
  });

  it('normalizeCover：仅 https 外链可用，其余回落自动封面', () => {
    expect(normalizeCover({ kind: 'url', url: 'https://cdn.example.com/a.png' })).toEqual({ kind: 'url', url: 'https://cdn.example.com/a.png' });
    expect(normalizeCover({ kind: 'url', url: 'http://cdn.example.com/a.png' })).toEqual({ kind: 'auto' });
    expect(normalizeCover({ kind: 'url', url: 'javascript:alert(1)' })).toEqual({ kind: 'auto' });
    expect(normalizeCover({ kind: 'url', url: 'data:image/png;base64,x' })).toEqual({ kind: 'auto' });
    expect(normalizeCover(null)).toEqual({ kind: 'auto' });
  });

  it('extractSummary：剥 Markdown 代码块/图片/链接/标题', () => {
    const summary = extractSummary('# 标题\n\n看这张 ![图](https://x/a.png) 和 [链接](https://x)，`代码`ok\n\n```js\nconst a=1\n```');
    expect(summary).toContain('标题');
    expect(summary).toContain('链接');
    expect(summary).not.toContain('https://x/a.png');
    expect(summary).not.toContain('const a=1');
    expect(summary.length).toBeLessThanOrEqual(120);
  });
});

describe('memoryCommunityRepository B1 新字段（与 PG POST_VIEW 对齐）', () => {
  beforeEach(() => {
    __memoryStore.users.clear();
    __memoryStore.identityIndex.clear();
    __memoryCommunityStore.posts.clear();
    __memoryCommunityStore.comments.clear();
    __memoryCommunityStore.likes.clear();
    __memoryCommunityStore.bookmarks.clear();
    __memoryCommunityStore.follows.clear();
  });

  it('P0 对齐断言：PG POST_VIEW 列别名 ⊇ 新内容字段，且内存 postView 输出键与之齐平', async () => {
    // PG 侧：从 SQL 里抠出所有 `as "xxx"` 列别名
    const pgColumns = [...POST_VIEW_SQL.matchAll(/as "([A-Za-z]+)"/g)].map(match => match[1]);
    for (const field of POST_CONTENT_FIELDS) expect(pgColumns).toContain(field);

    // 内存侧：真实走一遍 createPost → getPost，断言输出键覆盖同一集合
    const repo = createMemoryCommunityRepository();
    const { alice } = await seedUsers();
    const post = await repo.createPost({ authorId: alice.id, type: 'article', title: '对齐', body: '正文', visibility: 'public', status: 'published' });
    const view = await repo.getPost(post.id, alice.id);
    for (const field of POST_CONTENT_FIELDS) expect(Object.keys(view)).toContain(field);
  });

  it('发帖携带新字段 → 视图原样返回；省略时落默认值（老数据兜底语义）', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice } = await seedUsers();
    const full = await repo.createPost({
      authorId: alice.id, type: 'article', title: '测评帖', body: '正文', visibility: 'public', status: 'published',
      channel: 'review', tags: ['#Qwen3', '#模型评测'], cover: { kind: 'url', url: 'https://cdn.example.com/c.png' }, summary: '手写简介',
    });
    expect(full.channel).toBe('review');
    expect(full.tags).toEqual(['#Qwen3', '#模型评测']);
    expect(full.cover).toEqual({ kind: 'url', url: 'https://cdn.example.com/c.png' });
    expect(full.summary).toBe('手写简介');

    // 不传新字段 = 老调用方（素材导入/工作站发布）零破坏：存储层兜底为 discussion + 自动封面 + 空 summary
    const legacy = await repo.createPost({ authorId: alice.id, type: 'article', title: '旧调用', body: '这是自动摘要的正文内容', visibility: 'public', status: 'published' });
    expect(legacy.channel).toBe('discussion');
    expect(legacy.tags).toEqual([]);
    expect(legacy.cover).toEqual({ kind: 'auto' });
    expect(legacy.summary).toBe('');
  });

  it('service 层：摘要空则从正文自动提取；非法 channel/tags/cover/summary 被 400 拦截', async () => {
    const service = createCommunityService(createMemoryCommunityRepository());
    const { alice } = await seedUsers();
    const ok = await service.createPost({
      userId: alice.id,
      input: { type: 'article', title: '自动摘要', body: '# 标题行\n\n正文第一段就是摘要来源，包含足够长的内容用来验证提取。', visibility: 'public', status: 'published' },
    });
    expect(ok.summary).not.toBe('');
    expect(ok.summary).not.toContain('#');
    expect(ok.channel).toBe('discussion');

    const expectFail = async (input, code) => {
      let caught = null;
      try { await service.createPost({ userId: alice.id, input }); } catch (error) { caught = error; }
      expect(caught?.code).toBe(code);
    };
    await expectFail({ type: 'article', title: 't', body: 'b', channel: 'hack' }, 'INVALID_CHANNEL');
    await expectFail({ type: 'article', title: 't', body: 'b', tags: ['1', '2', '3', '4', '5', '6'] }, 'INVALID_TAGS');
    await expectFail({ type: 'article', title: 't', body: 'b', cover: { kind: 'url', url: 'http://x.com/a.png' } }, 'INVALID_COVER');
    await expectFail({ type: 'article', title: 't', body: 'b', summary: '长'.repeat(121) }, 'INVALID_SUMMARY');

    // 列表参数校验：非法频道 400；followingOnly 未登录 401
    let badChannel = null;
    try { await service.listPosts({ channel: 'hack' }); } catch (error) { badChannel = error; }
    expect(badChannel?.code).toBe('INVALID_CHANNEL');
    let anonFollowing = null;
    try { await service.listPosts({ followingOnly: true }); } catch (error) { anonFollowing = error; }
    expect(anonFollowing?.code).toBe('UNAUTHORIZED');
  });

  it('模拟老数据行（无新字段键）→ 读侧 normalize 兜底不炸、不空', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice } = await seedUsers();
    await repo.createPost({ authorId: alice.id, type: 'article', title: '迁移前', body: 'b', visibility: 'public', status: 'published' });
    // 直接抹掉新字段键，模拟 DDL 前的历史行
    for (const post of __memoryCommunityStore.posts.values()) {
      delete post.channel; delete post.tags; delete post.cover; delete post.summary;
    }
    const [row] = await repo.listPosts({ viewerId: alice.id });
    expect(row.channel).toBe('discussion');
    expect(row.tags).toEqual([]);
    expect(row.cover).toEqual({ kind: 'auto' });
    expect(row.summary).toBe('');
  });

  it('listPosts：channel 过滤 / q 关键词 / followingOnly 关注流', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice, bob } = await seedUsers();
    const review = await repo.createPost({ authorId: alice.id, type: 'article', title: 'Qwen3 测评', body: '深度实测', visibility: 'public', status: 'published', channel: 'review' });
    const talk = await repo.createPost({ authorId: bob.id, type: 'article', title: '随便聊聊', body: '行业观察', visibility: 'public', status: 'published', channel: 'discussion' });

    const byChannel = await repo.listPosts({ viewerId: alice.id, channel: 'review' });
    expect(byChannel.map(p => p.id)).toEqual([review.id]);

    const byQuery = await repo.listPosts({ viewerId: alice.id, q: '行业' });
    expect(byQuery.map(p => p.id)).toEqual([talk.id]);

    // 关注流：未关注 → 空；关注 bob 后 → 只剩 bob 的内容
    const before = await repo.listPosts({ viewerId: alice.id, followingOnly: true });
    expect(before).toEqual([]);
    await repo.setFollow(alice.id, bob.id, true);
    const after = await repo.listPosts({ viewerId: alice.id, followingOnly: true });
    expect(after.map(p => p.id)).toEqual([talk.id]);
  });

  it('updatePost 支持局部更新新字段（PATCH 语义与旧字段共存）', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice } = await seedUsers();
    const post = await repo.createPost({ authorId: alice.id, type: 'article', title: '待改', body: 'b', visibility: 'public', status: 'published' });
    await repo.updatePost(post.id, { channel: 'share', tags: ['#创作'] });
    const view = await repo.getPost(post.id, alice.id);
    expect(view.channel).toBe('share');
    expect(view.tags).toEqual(['#创作']);
    expect(view.title).toBe('待改');
  });

  it('评论携带 kind 分型；非法 kind 回落 comment', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice, bob } = await seedUsers();
    const post = await repo.createPost({ authorId: alice.id, type: 'article', title: 't', body: 'b', visibility: 'public', status: 'published' });
    const praise = await repo.createComment({ postId: post.id, authorId: bob.id, body: '好评！', kind: 'praise' });
    expect(praise.kind).toBe('praise');
    const weird = await repo.createComment({ postId: post.id, authorId: bob.id, body: '普通', kind: 'hack' });
    expect(weird.kind).toBe('comment');
    const list = await repo.listComments(post.id);
    expect(list.map(c => c.kind)).toEqual(['praise', 'comment']);
  });
});
