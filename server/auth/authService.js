import { createHash, randomBytes } from 'node:crypto';
import { createAuthRepository } from './authRepository.js';
import { createMemoryAuthRepository } from './memoryAuthRepository.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { isDevMemoryMode, isDevMemoryModeResolved } from '../db/devMemoryStore.js';

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function resolveAuthRepository() {
  if (isDevMemoryMode()) return createMemoryAuthRepository();
  return createAuthRepository();
}

// v22：默认服务实例异步解析（含 PG 连通性探测），每进程记忆化一次。
// 内存模式实例带 supportsGuest 标记（体验模式仅在内存仓储上开放，不向真实 DB 写游客行）。
let defaultAuthPromise = null;
export function getAuthService() {
  if (!defaultAuthPromise) {
    defaultAuthPromise = (async () => {
      if (await isDevMemoryModeResolved()) {
        const service = createAuthService(createMemoryAuthRepository());
        service.supportsGuest = true;
        return service;
      }
      return createAuthService();
    })();
  }
  return defaultAuthPromise;
}

function serviceError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    displayName: user.display_name || user.displayName || user.username,
    avatar: user.avatar_url || user.avatar || '',
    signature: user.signature || '',
    interests: Array.isArray(user.interests) ? user.interests : [],
    createdAt: user.created_at || user.createdAt,
  };
}

export function createAuthService(repository = resolveAuthRepository()) {
  async function issueSession(user) {
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_MS);
    await repository.createSession({ userId: user.id, tokenHash: tokenHash(rawToken), expiresAt });
    return { rawToken, expiresAt, user: publicUser(user) };
  }

  return {
    async register({ username, email = '', password }) {
      const existing = await repository.findUserByIdentity(username);
      if (existing || (email && await repository.findUserByIdentity(email))) {
        throw serviceError('IDENTITY_EXISTS', '用户名或邮箱已存在', 409);
      }
      let user;
      try {
        user = await repository.createUser({ username, email, password: await hashPassword(password) });
      } catch (error) {
        if (error?.code === '23505') throw serviceError('IDENTITY_EXISTS', '用户名或邮箱已存在', 409);
        throw error;
      }
      return issueSession(user);
    },
    async login({ username, password }) {
      const user = await repository.findUserByIdentity(username);
      const valid = user && user.status === 'active' && await verifyPassword(password, {
        hash: user.password_hash,
        salt: user.password_salt,
        params: user.password_params,
      });
      if (!valid) throw serviceError('INVALID_CREDENTIALS', '用户名或密码错误', 401);
      return issueSession(user);
    },
    /**
     * v22 体验模式：免注册一键创建一次性体验账号并直接登录。
     * 仅内存仓储实例（getAuthService 在 dev 无 PG 时返回的实例）开放该能力，
     * 不会向真实数据库写入游客行；账号密码随机（不可复登），重启即废弃。
     */
    async guestLogin() {
      if (this.supportsGuest !== true) {
        throw serviceError('GUEST_DISABLED', '体验模式仅在开发环境（数据库不可用时）可用', 403);
      }
      const suffix = randomBytes(4).toString('hex');
      const user = await repository.createUser({
        username: `guest_${suffix}`,
        email: '',
        displayName: `体验用户 ${suffix.slice(0, 4).toUpperCase()}`,
        password: await hashPassword(randomBytes(18).toString('base64url')),
      });
      return issueSession(user);
    },
    async authenticate(rawToken) {
      if (!rawToken) return null;
      const session = await repository.findSession(tokenHash(rawToken));
      if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || session.status !== 'active') return null;
      return publicUser(session);
    },
    async logout(rawToken) {
      if (rawToken) await repository.revokeSession(tokenHash(rawToken));
    },
    async updateProfile(rawToken, updates) {
      const current = await this.authenticate(rawToken);
      if (!current) throw serviceError('UNAUTHORIZED', '请先登录', 401);
      return publicUser(await repository.updateProfile(current.id, updates));
    },
    async getStats(rawToken) {
      const current = await this.authenticate(rawToken);
      if (!current) throw serviceError('UNAUTHORIZED', '请先登录', 401);
      return repository.getUserStats(current.id);
    },
  };
}
