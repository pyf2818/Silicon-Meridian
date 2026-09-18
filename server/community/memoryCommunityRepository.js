import { randomUUID } from 'node:crypto';
import { __memoryStore } from '../auth/memoryAuthRepository.js';
import { normalizeChannel, normalizeCommentKind, normalizeCover, normalizeSummary, normalizeTags } from './postFields.js';

/**
 * 开发态内存版广场（社区）仓储（v22 简化登录配套）。
 *
 * 仅在 isDevMemoryMode()（非 production 且未配置 DATABASE_URL）时由 communityService 启用，
 * 与 memoryAuthRepository 共享同一份用户内存数据。重启即清空，商业化阶段由
 * communityRepository.js（PostgreSQL）接管。
 *
 * 行形状与 communityRepository.js 的 POST_VIEW / comments 查询对齐。
 */
const posts = new Map();      // postId -> { id, authorId, type, title, body, sourceRefs, visibility, status, createdAt, updatedAt }
const comments = new Map();   // postId -> [ { id, postId, parentId, authorId, body, createdAt, status } ]
const likes = new Map();      // `${userId}:${postId}` -> true
const bookmarks = new Map();  // `${userId}:${postId}` -> true
const follows = new Map();    // `${followerId}:${followedId}` -> true

function userRow(userId) {
  return __memoryStore.users.get(userId) || null;
}

function counts(postId) {
  let likeCount = 0;
  let bookmarkCount = 0;
  for (const key of likes.keys()) if (key.endsWith(`:${postId}`)) likeCount += 1;
  for (const key of bookmarks.keys()) if (key.endsWith(`:${postId}`)) bookmarkCount += 1;
  const commentCount = (comments.get(postId) || []).filter(c => c.status === 'published').length;
  return { likeCount, bookmarkCount, commentCount };
}

function postView(post, viewerId) {
  const author = userRow(post.authorId);
  return {
    id: post.id,
    authorId: post.authorId,
    type: post.type,
    title: post.title,
    body: post.body,
    sourceRefs: post.sourceRefs || [],
    visibility: post.visibility,
    status: post.status,
    // B1 新字段：与 PG POST_VIEW 输出键严格对齐（测试有对齐断言），读侧一律 normalize 兜底
    channel: normalizeChannel(post.channel),
    tags: normalizeTags(post.tags),
    cover: normalizeCover(post.cover),
    summary: normalizeSummary(post.summary),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    username: author?.username || '未知用户',
    displayName: author?.display_name || author?.username || '未知用户',
    avatar: author?.avatar_url || '',
    ...counts(post.id),
    liked: viewerId ? likes.has(`${viewerId}:${post.id}`) : false,
    bookmarked: viewerId ? bookmarks.has(`${viewerId}:${post.id}`) : false,
    following: viewerId ? follows.has(`${viewerId}:${post.authorId}`) : false,
  };
}

function visibleTo(post, viewerId) {
  if (post.status === 'deleted') return false;
  if (viewerId && post.authorId === viewerId) return post.status !== 'deleted';
  if (post.status !== 'published') return false;
  if (post.visibility === 'public') return true;
  if (post.visibility === 'private') return false;
  if (post.visibility === 'followers') return viewerId ? follows.has(`${viewerId}:${post.authorId}`) : false;
  return false;
}

export function createMemoryCommunityRepository() {
  return {
    async listPosts({ viewerId = null, cursor = null, limit = 20, authorId = null, channel = null, q = null, followingOnly = false } = {}) {
      let rows = [...posts.values()];
      if (authorId && authorId === viewerId) {
        rows = rows.filter(p => p.authorId === authorId && p.status !== 'deleted');
      } else {
        rows = rows.filter(p => visibleTo(p, viewerId));
        if (authorId) rows = rows.filter(p => p.authorId === authorId);
      }
      // 关注流（与 PG 版语义一致：$1 = viewerId 的 exists 过滤）
      if (followingOnly && viewerId) rows = rows.filter(p => follows.has(`${viewerId}:${p.authorId}`));
      // 频道 + 关键词（title/body 子串、忽略大小写，与 ILIKE 语义对齐）
      if (channel) rows = rows.filter(p => normalizeChannel(p.channel) === channel);
      if (q) {
        const needle = String(q).toLowerCase();
        rows = rows.filter(p => String(p.title).toLowerCase().includes(needle) || String(p.body).toLowerCase().includes(needle));
      }
      if (cursor) rows = rows.filter(p => new Date(p.createdAt) < new Date(cursor));
      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b.id).localeCompare(String(a.id)));
      return rows.slice(0, limit).map(p => postView(p, viewerId));
    },

    async listBookmarkedPosts({ viewerId = null, cursor = null, limit = 20 } = {}) {
      const rows = [...posts.values()]
        .filter(p => p.status === 'published' && viewerId && bookmarks.has(`${viewerId}:${p.id}`))
        .filter(p => !cursor || new Date(p.createdAt) < new Date(cursor))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
      return rows.map(p => postView(p, viewerId));
    },

    async getPost(postId, viewerId = null) {
      const post = posts.get(postId);
      if (!post || post.status === 'deleted') return null;
      return postView(post, viewerId);
    },

    async createPost(input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      posts.set(id, {
        id,
        authorId: input.authorId,
        type: input.type,
        title: input.title,
        body: input.body,
        sourceRefs: input.sourceRefs || [],
        visibility: input.visibility,
        status: input.status,
        channel: normalizeChannel(input.channel),
        tags: normalizeTags(input.tags),
        cover: normalizeCover(input.cover),
        summary: normalizeSummary(input.summary),
        createdAt: now,
        updatedAt: now,
      });
      return this.getPost(id, input.authorId);
    },

    async updatePost(postId, input) {
      const post = posts.get(postId);
      if (!post) return;
      if (input.title != null) post.title = input.title;
      if (input.body != null) post.body = input.body;
      if (input.type != null) post.type = input.type;
      if (input.sourceRefs !== undefined) post.sourceRefs = input.sourceRefs;
      if (input.visibility != null) post.visibility = input.visibility;
      if (input.status != null) post.status = input.status;
      if (input.channel !== undefined) post.channel = normalizeChannel(input.channel);
      if (input.tags !== undefined) post.tags = normalizeTags(input.tags);
      if (input.cover !== undefined) post.cover = normalizeCover(input.cover);
      if (input.summary !== undefined) post.summary = normalizeSummary(input.summary);
      post.updatedAt = new Date().toISOString();
    },

    async softDeletePost(postId) {
      const post = posts.get(postId);
      if (post) { post.status = 'deleted'; post.updatedAt = new Date().toISOString(); }
    },

    async listComments(postId) {
      return (comments.get(postId) || [])
        .filter(c => c.status === 'published')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(c => {
          const author = userRow(c.authorId);
          return {
            id: c.id,
            postId: c.postId,
            parentId: c.parentId,
            body: c.body,
            kind: normalizeCommentKind(c.kind),
            createdAt: c.createdAt,
            authorId: c.authorId,
            username: author?.username || '未知用户',
            displayName: author?.display_name || author?.username || '未知用户',
            avatar: author?.avatar_url || '',
          };
        });
    },

    async createComment(input) {
      const row = {
        id: randomUUID(),
        postId: input.postId,
        parentId: input.parentId || null,
        authorId: input.authorId,
        body: input.body,
        kind: normalizeCommentKind(input.kind),
        createdAt: new Date().toISOString(),
        status: 'published',
      };
      const list = comments.get(input.postId) || [];
      list.push(row);
      comments.set(input.postId, list);
      return {
        id: row.id, postId: row.postId, authorId: row.authorId,
        parentId: row.parentId, body: row.body, kind: row.kind, createdAt: row.createdAt,
      };
    },

    async setLike(userId, postId, enabled) {
      const key = `${userId}:${postId}`;
      if (enabled) likes.set(key, true); else likes.delete(key);
    },

    async setBookmark(userId, postId, enabled) {
      const key = `${userId}:${postId}`;
      if (enabled) bookmarks.set(key, true); else bookmarks.delete(key);
    },

    async setFollow(userId, followedId, enabled) {
      const key = `${userId}:${followedId}`;
      if (enabled) follows.set(key, true); else follows.delete(key);
    },
  };
}

export const __memoryCommunityStore = { posts, comments, likes, bookmarks, follows };
