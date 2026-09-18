import { randomUUID } from 'node:crypto';

/**
 * 开发态内存版认证仓储（仅 DEV_MEMORY_AUTH=true 且非 production 时启用）。
 *
 * 用模块级单例存储，保证一次进程内多次 createAuthService() 调用共享同一份账户/会话数据，
 * 从而让「注册 → 登录 → 取当前用户」在跨请求的端到端链路中保持一致。
 *
 * 字段形状刻意与 authRepository.js / 001_platform.sql 对齐：
 *   users:  id, username, email, password_hash, password_salt, password_params,
 *           display_name, avatar_url, signature, interests, status, created_at, updated_at
 *   sessions: token_hash -> { userId, expiresAt, revokedAt }
 * 注意：sessions 表本身没有 status 列，authenticate 里读取的 session.status 来自被 join 的 users 行。
 */

const users = new Map(); // id -> raw user row
const identityIndex = new Map(); // lower(username) | lower(email) -> id
const sessions = new Map(); // tokenHash -> { userId, expiresAt, revokedAt }

const USER_COLUMN_NAMES = [
  'id', 'username', 'email', 'password_hash', 'password_salt', 'password_params',
  'display_name', 'avatar_url', 'signature', 'interests', 'status', 'public_id', 'created_at', 'updated_at',
];

function indexIdentity(value, id) {
  if (value) identityIndex.set(String(value).toLowerCase(), id);
}

function unindexIdentity(value) {
  if (value) identityIndex.delete(String(value).toLowerCase());
}

function normalizeUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    password_hash: row.password_hash,
    password_salt: row.password_salt,
    password_params: row.password_params,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    signature: row.signature,
    interests: row.interests,
    status: row.status,
    public_id: row.public_id || null, // C3 任务 4：展示唯一 ID（identityRepository 懒分配）
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createMemoryAuthRepository() {
  return {
    async findUserByIdentity(identity) {
      const id = identityIndex.get(String(identity || '').toLowerCase());
      if (!id) return null;
      const user = users.get(id);
      return user ? normalizeUser(user) : null;
    },

    async createUser({ username, email, password, displayName }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const user = {
        id,
        username,
        email: email || null,
        password_hash: password.hash,
        password_salt: password.salt,
        password_params: password.params,
        display_name: displayName || username,
        avatar_url: '',
        signature: '',
        interests: [],
        status: 'active',
        created_at: now,
        updated_at: now,
      };
      users.set(id, user);
      indexIdentity(username, id);
      indexIdentity(email, id);
      return normalizeUser(user);
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      sessions.set(tokenHash, { userId, expiresAt: expiresAt.toISOString(), revokedAt: null });
    },

    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      const user = users.get(session.userId);
      if (!user) return null;
      return {
        ...normalizeUser(user),
        expires_at: session.expiresAt,
        revoked_at: session.revokedAt,
      };
    },

    async revokeSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (session) session.revokedAt = new Date().toISOString();
    },

    async updateProfile(userId, updates) {
      const user = users.get(userId);
      if (!user) return null;
      if (updates.displayName != null) user.display_name = updates.displayName;
      if (updates.avatar != null) user.avatar_url = updates.avatar;
      if (updates.signature != null) user.signature = updates.signature;
      if (updates.interests !== undefined) user.interests = updates.interests;
      user.updated_at = new Date().toISOString();
      return normalizeUser(user);
    },

    // 内存版无社区数据，返回全 0 聚合（与 authRepository.getUserStats 字段对齐）
    async getUserStats(userId) {
      return {
        followers: 0,
        following: 0,
        posts: 0,
        likesReceived: 0,
        comments: 0,
        bookmarks: 0,
      };
    },
  };
}

export const __memoryStore = { users, identityIndex, sessions, USER_COLUMN_NAMES };
