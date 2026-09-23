import { getPool } from '../db/client.js';

const USER_COLUMN_NAMES = [
  'id', 'username', 'email', 'password_hash', 'password_salt', 'password_params',
  'display_name', 'avatar_url', 'signature', 'interests', 'status', 'public_id', 'created_at', 'updated_at',
];
const USER_COLUMNS = USER_COLUMN_NAMES.join(', ');

export function createAuthRepository(db = getPool()) {
  return {
    async findUserByIdentity(identity) {
      const { rows } = await db.query(
        `select ${USER_COLUMNS} from users where lower(username) = lower($1) or lower(email) = lower($1) limit 1`,
        [identity],
      );
      return rows[0] || null;
    },
    async createUser({ username, email, password }) {
      const { rows } = await db.query(
        `insert into users(username, email, password_hash, password_salt, password_params, display_name)
         values ($1, nullif($2, ''), $3, $4, $5, $1) returning ${USER_COLUMNS}`,
        [username, email || '', password.hash, password.salt, password.params],
      );
      await db.query('insert into user_profiles(user_id) values ($1) on conflict do nothing', [rows[0].id]);
      return rows[0];
    },
    async createSession({ userId, tokenHash, expiresAt }) {
      await db.query('insert into sessions(user_id, token_hash, expires_at) values ($1, $2, $3)', [userId, tokenHash, expiresAt]);
      // 留存治理（2026-09-22）：过期 session 行读取时被过滤但永不物理删除，无限涨。
      // 登录/注册低频触发，顺带清理（失败不影响发 session——读取侧已有过期过滤兜底）。
      try {
        await db.query('delete from sessions where expires_at < now()');
      } catch { /* 清理失败容忍：功能正确性由 findSession 的过期校验保证 */ }
    },
    async findSession(tokenHash) {
      const { rows } = await db.query(
        `select s.expires_at, s.revoked_at, ${USER_COLUMN_NAMES.map(column => `u.${column}`).join(', ')}
         from sessions s join users u on u.id = s.user_id where s.token_hash = $1 limit 1`,
        [tokenHash],
      );
      return rows[0] || null;
    },
    async revokeSession(tokenHash) {
      await db.query('update sessions set revoked_at = coalesce(revoked_at, now()) where token_hash = $1', [tokenHash]);
    },
    async updateProfile(userId, updates) {
      const { rows } = await db.query(
        `update users set display_name = coalesce($2, display_name), avatar_url = coalesce($3, avatar_url),
         signature = coalesce($4, signature), interests = coalesce($5, interests), updated_at = now()
         where id = $1 returning ${USER_COLUMNS}`,
        [userId, updates.displayName ?? null, updates.avatar ?? null, updates.signature ?? null, updates.interests === undefined ? null : JSON.stringify(updates.interests)],
      );
      return rows[0] || null;
    },
    async getUserStats(userId) {
      // 聚合个人主页的社交/行为/时间统计（社区模块对外展示用）
      const { rows } = await db.query(`
        select
          (select count(*) from user_follows where followed_id = $1)::int      as "followers",
          (select count(*) from user_follows where follower_id = $1)::int      as "following",
          (select count(*) from posts where author_id = $1 and status = 'published')::int as "posts",
          (select count(*) from post_likes l join posts p on p.id = l.post_id
             where p.author_id = $1 and p.status = 'published')::int          as "likesReceived",
          (select count(*) from comments c join posts p on p.id = c.post_id
             where p.author_id = $1 and p.status = 'published' and c.status = 'published')::int as "comments",
          (select count(*) from post_bookmarks b join posts p on p.id = b.post_id
             where p.author_id = $1 and p.status = 'published')::int          as "bookmarks",
          (select count(*) from users u where u.id = $1)::int                  as "isUser"
      `, [userId]);
      return rows[0] || null;
    },
  };
}
