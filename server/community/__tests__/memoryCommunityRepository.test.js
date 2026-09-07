import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryCommunityRepository, __memoryCommunityStore } from '../memoryCommunityRepository.js';
import { createMemoryAuthRepository, __memoryStore } from '../../auth/memoryAuthRepository.js';

async function seedUsers() {
  const auth = createMemoryAuthRepository();
  const pwd = { hash: 'h', salt: 's', params: {} };
  const alice = await auth.createUser({ username: 'alice', email: '', password: pwd, displayName: '爱丽丝' });
  const bob = await auth.createUser({ username: 'bob', email: '', password: pwd, displayName: '鲍勃' });
  return { alice, bob };
}

describe('memoryCommunityRepository（v22 无 DB 兜底）', () => {
  beforeEach(() => {
    __memoryStore.users.clear();
    __memoryStore.identityIndex.clear();
    __memoryCommunityStore.posts.clear();
    __memoryCommunityStore.comments.clear();
    __memoryCommunityStore.likes.clear();
    __memoryCommunityStore.bookmarks.clear();
    __memoryCommunityStore.follows.clear();
  });

  it('发帖 → 公开可见 → 点赞/收藏/评论计数正确', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice, bob } = await seedUsers();
    const post = await repo.createPost({
      authorId: alice.id, type: 'article', title: '第一篇', body: '正文', visibility: 'public', status: 'published',
    });
    await repo.setLike(bob.id, post.id, true);
    await repo.setBookmark(bob.id, post.id, true);
    await repo.createComment({ postId: post.id, authorId: bob.id, body: '写得不错' });

    const view = await repo.getPost(post.id, bob.id);
    expect(view.likeCount).toBe(1);
    expect(view.bookmarkCount).toBe(1);
    expect(view.commentCount).toBe(1);
    expect(view.liked).toBe(true);
    expect(view.following).toBe(false);
    expect(view.displayName).toBe('爱丽丝');

    const comments = await repo.listComments(post.id);
    expect(comments.length).toBe(1);
    expect(comments[0].displayName).toBe('鲍勃');
  });

  it('private 帖子非作者不可见，草稿仅作者可见', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice, bob } = await seedUsers();
    const priv = await repo.createPost({ authorId: alice.id, type: 'briefing', title: '私密', body: '', visibility: 'private', status: 'published' });
    const draft = await repo.createPost({ authorId: alice.id, type: 'work', title: '草稿', body: '', visibility: 'public', status: 'draft' });

    // getPost 与 PG 版语义一致：单查只过滤 deleted，可见性过滤发生在列表
    expect((await repo.getPost(priv.id, bob.id)).visibility).toBe('private');
    expect((await repo.listPosts({ viewerId: bob.id })).some(p => p.id === priv.id)).toBe(false);
    // 作者自己的列表包含草稿与私密帖
    const own = await repo.listPosts({ viewerId: alice.id, authorId: alice.id });
    expect(own.some(p => p.id === draft.id)).toBe(true);
    expect(own.some(p => p.id === priv.id)).toBe(true);
  });

  it('关注后可见 followers 帖，取关后不可见；软删除后消失', async () => {
    const repo = createMemoryCommunityRepository();
    const { alice, bob } = await seedUsers();
    const post = await repo.createPost({ authorId: alice.id, type: 'workflow', title: '粉丝可见', body: '', visibility: 'followers', status: 'published' });

    expect((await repo.listPosts({ viewerId: bob.id })).some(p => p.id === post.id)).toBe(false);
    await repo.setFollow(bob.id, alice.id, true);
    expect((await repo.listPosts({ viewerId: bob.id })).some(p => p.id === post.id)).toBe(true);
    await repo.setFollow(bob.id, alice.id, false);
    expect((await repo.listPosts({ viewerId: bob.id })).some(p => p.id === post.id)).toBe(false);

    await repo.softDeletePost(post.id);
    expect(await repo.getPost(post.id, alice.id)).toBeNull();
  });
});
