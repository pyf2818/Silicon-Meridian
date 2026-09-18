import { getPool } from '../db/client.js';
import { normalizeChannel, normalizeCover, normalizeSummary, normalizeTags, DEFAULT_COMMENT_KIND } from './postFields.js';

// 导出供测试做「双仓储字段对齐」断言（列别名集合 ↔ 内存仓储输出键集合）
export const POST_VIEW_SQL = `
  select p.id, p.author_id as "authorId", p.type, p.title, p.body, p.source_refs as "sourceRefs",
    p.visibility, p.status, p.created_at as "createdAt", p.updated_at as "updatedAt",
    p.channel as "channel", p.tags as "tags", p.cover as "cover", p.summary as "summary",
    u.username, u.display_name as "displayName", u.avatar_url as "avatar",
    (select count(*)::int from post_likes l where l.post_id = p.id) as "likeCount",
    (select count(*)::int from post_bookmarks b where b.post_id = p.id) as "bookmarkCount",
    (select count(*)::int from comments c where c.post_id = p.id and c.status = 'published') as "commentCount",
    case when $1::uuid is null then false else exists(select 1 from post_likes l where l.post_id = p.id and l.user_id = $1) end as liked,
    case when $1::uuid is null then false else exists(select 1 from post_bookmarks b where b.post_id = p.id and b.user_id = $1) end as bookmarked,
    case when $1::uuid is null then false else exists(select 1 from user_follows f where f.follower_id = $1 and f.followed_id = p.author_id) end as following
  from posts p join users u on u.id = p.author_id`;

const POST_VIEW = POST_VIEW_SQL;

export function createCommunityRepository(db = getPool()) {
  return {
    async listPosts({ viewerId = null, cursor = null, limit = 20, authorId = null, channel = null, q = null, tag = null, followingOnly = false } = {}) {
      const parts = [];
      const params = [viewerId];
      // 自己的作品：包含草稿（排除已删除）；否则按可见范围 + 可选作者过滤
      if (authorId && authorId === viewerId) {
        parts.push('p.author_id = $1', "p.status <> 'deleted'");
      } else {
        parts.push("p.status = 'published'");
        if (authorId) {
          params.push(authorId);
          parts.push(`p.author_id = $${params.length}`);
        } else {
          parts.push("(p.visibility = 'public' or p.author_id = $1 or (p.visibility = 'followers' and exists(select 1 from user_follows f where f.follower_id = $1 and f.followed_id = p.author_id)))");
        }
      }
      // 关注流：仅看已关注作者的内容（viewerId 恒为 $1）
      if (followingOnly) parts.push('exists(select 1 from user_follows ff where ff.follower_id = $1 and ff.followed_id = p.author_id)');
      // 频道过滤（值已由 service 层校验枚举）+ 关键词搜索（ILIKE 通配符转义）
      if (channel) {
        params.push(channel);
        parts.push(`p.channel = $${params.length}`);
      }
      if (q) {
        params.push(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`);
        parts.push(`(p.title ilike $${params.length} or p.body ilike $${params.length})`);
      }
      // 场景标签过滤：jsonb 包含查询（tags 数组含该标签即命中）
      if (tag) {
        params.push(String(tag));
        parts.push(`p.tags @> to_jsonb($${params.length}::text)`);
      }
      params.push(cursor);
      parts.push(`($${params.length}::timestamptz is null or p.created_at < $${params.length}::timestamptz)`);
      params.push(limit);
      const { rows } = await db.query(
        `${POST_VIEW} where ${parts.join(' and ')} order by p.created_at desc, p.id desc limit $${params.length}`,
        params,
      );
      return rows;
    },
    async listBookmarkedPosts({ viewerId = null, cursor = null, limit = 20 } = {}) {
      const { rows } = await db.query(
        `${POST_VIEW} join post_bookmarks bm on bm.post_id = p.id and bm.user_id = $1
         where p.status = 'published'
           and ($2::timestamptz is null or p.created_at < $2::timestamptz)
         order by p.created_at desc, p.id desc limit $3`,
        [viewerId, cursor, limit],
      );
      return rows;
    },
    async getPost(postId, viewerId = null) {
      const { rows } = await db.query(`${POST_VIEW} where p.id = $2 and p.status <> 'deleted' limit 1`, [viewerId, postId]);
      return rows[0] || null;
    },
    async createPost(input) {
      const { rows } = await db.query(
        `insert into posts(author_id, type, title, body, source_refs, visibility, status, channel, tags, cover, summary)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) returning id`,
        [
          input.authorId, input.type, input.title, input.body, JSON.stringify(input.sourceRefs || []), input.visibility, input.status,
          normalizeChannel(input.channel), JSON.stringify(normalizeTags(input.tags)), JSON.stringify(normalizeCover(input.cover)), normalizeSummary(input.summary),
        ],
      );
      return this.getPost(rows[0].id, input.authorId);
    },
    async updatePost(postId, input) {
      await db.query(
        `update posts set title = coalesce($2,title), body = coalesce($3,body), type = coalesce($4,type),
         source_refs = coalesce($5,source_refs), visibility = coalesce($6,visibility), status = coalesce($7,status),
         channel = coalesce($8,channel), tags = coalesce($9::jsonb,tags), cover = coalesce($10::jsonb,cover), summary = coalesce($11,summary),
         updated_at = now()
         where id = $1`,
        [
          postId, input.title ?? null, input.body ?? null, input.type ?? null,
          input.sourceRefs === undefined ? null : JSON.stringify(input.sourceRefs), input.visibility ?? null, input.status ?? null,
          input.channel === undefined ? null : normalizeChannel(input.channel),
          input.tags === undefined ? null : JSON.stringify(normalizeTags(input.tags)),
          input.cover === undefined ? null : JSON.stringify(normalizeCover(input.cover)),
          input.summary === undefined ? null : normalizeSummary(input.summary),
        ],
      );
    },
    async softDeletePost(postId) {
      await db.query("update posts set status = 'deleted', updated_at = now() where id = $1", [postId]);
    },
    async listComments(postId) {
      const { rows } = await db.query(
        `select c.id, c.post_id as "postId", c.parent_id as "parentId", c.body, c.kind, c.created_at as "createdAt",
          c.author_id as "authorId", u.username, u.display_name as "displayName", u.avatar_url as avatar
         from comments c join users u on u.id = c.author_id
         where c.post_id = $1 and c.status = 'published' order by c.created_at asc`,
        [postId],
      );
      return rows;
    },
    async createComment(input) {
      const { rows } = await db.query(
        `insert into comments(post_id, author_id, parent_id, body, kind) values ($1,$2,$3,$4,$5)
         returning id, post_id as "postId", author_id as "authorId", parent_id as "parentId", body, kind, created_at as "createdAt"`,
        [input.postId, input.authorId, input.parentId, input.body, input.kind || DEFAULT_COMMENT_KIND],
      );
      return rows[0];
    },
    async setLike(userId, postId, enabled) {
      if (enabled) await db.query('insert into post_likes(user_id,post_id) values ($1,$2) on conflict do nothing', [userId, postId]);
      else await db.query('delete from post_likes where user_id = $1 and post_id = $2', [userId, postId]);
    },
    async setBookmark(userId, postId, enabled) {
      if (enabled) await db.query('insert into post_bookmarks(user_id,post_id) values ($1,$2) on conflict do nothing', [userId, postId]);
      else await db.query('delete from post_bookmarks where user_id = $1 and post_id = $2', [userId, postId]);
    },
    async setFollow(userId, followedId, enabled) {
      if (enabled) await db.query('insert into user_follows(follower_id,followed_id) values ($1,$2) on conflict do nothing', [userId, followedId]);
      else await db.query('delete from user_follows where follower_id = $1 and followed_id = $2', [userId, followedId]);
    },
  };
}
