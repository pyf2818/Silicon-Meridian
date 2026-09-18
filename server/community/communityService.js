import { createCommunityRepository } from './communityRepository.js';
import { createMemoryCommunityRepository } from './memoryCommunityRepository.js';
import {
  CHANNELS, DEFAULT_CHANNEL, COMMENT_KINDS, DEFAULT_COMMENT_KIND, extractSummary,
} from './postFields.js';
import { isDevMemoryMode } from '../db/devMemoryStore.js';
import { isDevMemoryModeResolved } from '../db/devMemoryStore.js';

const TYPES = new Set(['article', 'briefing', 'work', 'workflow']);
const VISIBILITIES = new Set(['public', 'followers', 'private']);
const STATUSES = new Set(['draft', 'published']);
const CHANNEL_SET = new Set(CHANNELS);
const COMMENT_KIND_SET = new Set(COMMENT_KINDS);

function fail(code, message, status) { throw Object.assign(new Error(message), { code, status }); }
function requiredUser(userId) { if (!userId) fail('UNAUTHORIZED', '请先登录', 401); }
function text(value) { return String(value ?? '').trim(); }

function validatePost(input, { partial = false } = {}) {
  const output = {};
  if (!partial || input.title !== undefined) {
    output.title = text(input.title);
    if (!output.title || output.title.length > 180) fail('INVALID_TITLE', '标题长度需为 1-180 字', 400);
  }
  if (!partial || input.body !== undefined) {
    output.body = text(input.body);
    if (!output.body || output.body.length > 100000) fail('INVALID_BODY', '正文长度需为 1-100000 字', 400);
  }
  if (!partial || input.type !== undefined) {
    output.type = input.type || 'article';
    if (!TYPES.has(output.type)) fail('INVALID_TYPE', '发布类型不支持', 400);
  }
  if (!partial || input.visibility !== undefined) {
    output.visibility = input.visibility || 'public';
    if (!VISIBILITIES.has(output.visibility)) fail('INVALID_VISIBILITY', '可见范围不支持', 400);
  }
  if (!partial || input.status !== undefined) {
    output.status = input.status || 'published';
    if (!STATUSES.has(output.status)) fail('INVALID_STATUS', '发布状态不支持', 400);
  }
  if (!partial || input.sourceRefs !== undefined) output.sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs.slice(0, 50) : [];
  // B1 社区改版：频道 / 标签 / 封面 / 简介
  if (!partial || input.channel !== undefined) {
    output.channel = input.channel ? String(input.channel).trim() : DEFAULT_CHANNEL;
    if (!CHANNEL_SET.has(output.channel)) fail('INVALID_CHANNEL', '频道不支持', 400);
  }
  if (!partial || input.tags !== undefined) {
    const tags = Array.isArray(input.tags) ? input.tags.map(tag => String(tag ?? '').trim()).filter(Boolean) : [];
    if (tags.length > 5) fail('INVALID_TAGS', '标签最多 5 个', 400);
    if (tags.some(tag => tag.length > 24)) fail('INVALID_TAGS', '单个标签不超过 24 字', 400);
    output.tags = tags;
  }
  if (!partial || input.cover !== undefined) {
    const cover = input.cover ?? { kind: 'auto' };
    if (typeof cover !== 'object') fail('INVALID_COVER', '封面格式不支持', 400);
    const kind = String(cover.kind || 'auto');
    if (!['auto', 'url', 'extracted'].includes(kind)) fail('INVALID_COVER', '封面类型不支持', 400);
    if (kind === 'auto') {
      output.cover = { kind: 'auto' };
    } else {
      const url = String(cover.url || '').trim();
      // P0 安全闸：仅 https 外链（配合仓储 normalizeCover 双保险），阻断 javascript:/data:/内网地址
      if (!/^https:\/\//i.test(url)) fail('INVALID_COVER', '封面图片需为 https 链接', 400);
      output.cover = { kind, url };
    }
  }
  if (!partial || input.summary !== undefined) {
    const summary = text(input.summary);
    if (summary.length > 120) fail('INVALID_SUMMARY', '简介不超过 120 字', 400);
    // 摘要空则从正文自动提取（服务端口径为准，前端只读不再各算各的）
    output.summary = summary || extractSummary(output.body ?? input.body);
  }
  return output;
}

/** v22：dev 未配置数据库时自动落内存仓储，广场/作品集无需启动 PostgreSQL 也能调试 */
export function createCommunityService(repository = (isDevMemoryMode() ? createMemoryCommunityRepository() : createCommunityRepository())) {
  async function visiblePost(postId, viewerId) {
    const post = await repository.getPost(postId, viewerId);
    if (!post || post.status === 'deleted' || (post.status !== 'published' && post.authorId !== viewerId)) fail('POST_NOT_FOUND', '内容不存在', 404);
    if (post.visibility === 'private' && post.authorId !== viewerId) fail('POST_NOT_FOUND', '内容不存在', 404);
    if (post.visibility === 'followers' && post.authorId !== viewerId && !post.following) fail('POST_NOT_FOUND', '内容不存在', 404);
    return post;
  }
  return {
    async listPosts({ viewerId = null, cursor = null, limit = 20, authorId = null, channel = null, q = null, tag = null, followingOnly = false } = {}) {
      // 频道枚举校验（列表参数非法直接 400，不让脏值落查询）；关注流需登录态
      if (channel != null && !CHANNEL_SET.has(String(channel))) fail('INVALID_CHANNEL', '频道不支持', 400);
      if (followingOnly && !viewerId) fail('UNAUTHORIZED', '请先登录', 401);
      const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
      const safeQuery = q ? String(q).trim().slice(0, 80) : null;
      const safeTag = tag ? String(tag).trim().slice(0, 24) : null;
      const posts = await repository.listPosts({
        viewerId, cursor, limit: safeLimit + 1, authorId,
        channel: channel || null, q: safeQuery, tag: safeTag, followingOnly: Boolean(followingOnly),
      });
      const hasMore = posts.length > safeLimit;
      const items = posts.slice(0, safeLimit);
      return { items, nextCursor: hasMore ? items.at(-1)?.createdAt : null };
    },
    async listBookmarks({ viewerId = null, cursor = null, limit = 20 } = {}) {
      requiredUser(viewerId);
      const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
      const posts = await repository.listBookmarkedPosts({ viewerId, cursor, limit: safeLimit + 1 });
      const hasMore = posts.length > safeLimit;
      const items = posts.slice(0, safeLimit);
      return { items, nextCursor: hasMore ? items.at(-1)?.createdAt : null };
    },
    getPost({ postId, viewerId = null }) { return visiblePost(postId, viewerId); },
    async createPost({ userId, input }) {
      requiredUser(userId);
      return repository.createPost({ authorId: userId, ...validatePost(input) });
    },
    async updatePost({ userId, postId, input }) {
      requiredUser(userId);
      const post = await repository.getPost(postId, userId);
      if (!post) fail('POST_NOT_FOUND', '内容不存在', 404);
      if (post.authorId !== userId) fail('FORBIDDEN', '仅作者可编辑', 403);
      await repository.updatePost(postId, validatePost(input, { partial: true }));
      return visiblePost(postId, userId);
    },
    async deletePost({ userId, postId }) {
      requiredUser(userId);
      const post = await repository.getPost(postId, userId);
      if (!post) fail('POST_NOT_FOUND', '内容不存在', 404);
      if (post.authorId !== userId) fail('FORBIDDEN', '仅作者可删除', 403);
      await repository.softDeletePost(postId);
    },
    async listComments({ postId, viewerId = null }) {
      await visiblePost(postId, viewerId);
      return repository.listComments(postId);
    },
    async createComment({ userId, postId, body, parentId = null, kind = DEFAULT_COMMENT_KIND }) {
      requiredUser(userId);
      await visiblePost(postId, userId);
      const value = text(body);
      if (!value || value.length > 2000) fail('INVALID_COMMENT', '评论长度需为 1-2000 字', 400);
      const safeKind = COMMENT_KIND_SET.has(String(kind)) ? String(kind) : DEFAULT_COMMENT_KIND;
      return repository.createComment({ postId, authorId: userId, parentId: parentId || null, body: value, kind: safeKind });
    },
    async setLike({ userId, postId, enabled }) {
      requiredUser(userId); await visiblePost(postId, userId); await repository.setLike(userId, postId, enabled);
      return visiblePost(postId, userId);
    },
    async setBookmark({ userId, postId, enabled }) {
      requiredUser(userId); await visiblePost(postId, userId); await repository.setBookmark(userId, postId, enabled);
      return visiblePost(postId, userId);
    },
    async setFollow({ userId, followedId, enabled }) {
      requiredUser(userId);
      if (userId === followedId) fail('SELF_FOLLOW', '不能关注自己', 400);
      await repository.setFollow(userId, followedId, enabled);
      return { followedId, following: enabled };
    },
  };
}

// v22：默认服务实例异步解析（含 PG 连通性探测），每进程记忆化一次。

let defaultCommunityPromise = null;
export function getCommunityService() {
  if (!defaultCommunityPromise) {
    defaultCommunityPromise = (async () => (
      (await isDevMemoryModeResolved())
        ? createCommunityService(createMemoryCommunityRepository())
        : createCommunityService()
    ))();
  }
  return defaultCommunityPromise;
}
