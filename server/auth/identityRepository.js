import { getPool } from '../db/client.js';
import { isDevMemoryMode } from '../db/devMemoryStore.js';
import { __memoryStore } from './memoryAuthRepository.js';
import { publicIdIndex, identityBindings, identityVerifications } from './identityMemoryStore.js';

/**
 * C3 任务 4：用户身份扩展（展示唯一 publicId / 微信·邮箱绑定 / 个人·企业·博主认证）。
 *
 * 与 memoryAuthRepository 共享同一份用户内存数据；PG 侧读写 011 迁移的列与表。
 * publicId 采用「懒分配」：读卡时无则生成 6 位基36 大写（36^6 ≈ 21 亿，查重后写入），
 * 新老用户统一收敛，注册链路无需感知。
 *
 * 绑定/认证的诚实边界（阶段内登记制）：
 * - 邮箱绑定未接验证码、微信绑定未接开放平台 OAuth → 直接 verified；通道接入后切 pending 流程。
 * - 认证提交即 approved；生产环境需接人工审核队列（pending → 审核员裁决）。
 */

const PUBLIC_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去 I/O/0/1 易混字符
const BADGE_PRIORITY = { creator: 0, enterprise: 1, individual: 2 };
export const BINDING_TYPES = new Set(['email', 'wechat']);
export const VERIFICATION_TYPES = new Set(['individual', 'enterprise', 'creator']);
export const BINDING_LABELS = { email: '邮箱', wechat: '微信' };
export const VERIFICATION_LABELS = { individual: '个人认证', enterprise: '企业认证', creator: '博主认证' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WECHAT_RE = /^[A-Za-z][A-Za-z0-9_-]{5,19}$/;

function generatePublicId() {
  let id = '';
  for (let i = 0; i < 6; i += 1) id += PUBLIC_ID_ALPHABET[Math.floor(Math.random() * PUBLIC_ID_ALPHABET.length)];
  return id;
}

// ———— 内存版（dev 无 PG；用户行与 memoryAuthRepository 共享） ————

export function createMemoryIdentityRepository() {
  function userRow(userId) {
    return __memoryStore.users.get(userId) || null;
  }

  return {
    kind: 'memory',
    async assignPublicId(userId) {
      const row = userRow(userId);
      if (!row) return null;
      if (row.public_id) return row.public_id;
      let candidate = generatePublicId();
      while (publicIdIndex.has(candidate)) candidate = generatePublicId(); // 理论上极少循环
      row.public_id = candidate;
      publicIdIndex.set(candidate, userId);
      return candidate;
    },
    async listBindings(userId) {
      return ['email', 'wechat']
        .map(type => identityBindings.get(`${userId}:${type}`))
        .filter(Boolean)
        .map(({ userId: _omit, ...record }) => record);
    },
    async upsertBinding(userId, { type, value }) {
      const existing = identityBindings.get(`${userId}:${type}`);
      const record = { userId, type, value, status: 'verified', createdAt: existing?.createdAt || new Date().toISOString() };
      identityBindings.set(`${userId}:${type}`, record);
      return record;
    },
    async findBindingValue(type, value) {
      const needle = String(value).toLowerCase();
      for (const record of identityBindings.values()) {
        if (record.type === type && record.value.toLowerCase() === needle) return record;
      }
      return null;
    },
    async listVerifications(userId) {
      return ['individual', 'enterprise', 'creator']
        .map(type => identityVerifications.get(`${userId}:${type}`))
        .filter(Boolean)
        .map(({ userId: _omit, ...record }) => record);
    },
    async upsertVerification(userId, { type, payload }) {
      const existing = identityVerifications.get(`${userId}:${type}`);
      const record = {
        userId, type, payload, status: 'approved',
        createdAt: existing?.createdAt || new Date().toISOString(),
        reviewedAt: new Date().toISOString(),
      };
      identityVerifications.set(`${userId}:${type}`, record);
      return record;
    },
    async bestBadge(userId) {
      const approved = (await this.listVerifications(userId)).filter(item => item.status === 'approved');
      if (!approved.length) return '';
      return approved.sort((a, b) => BADGE_PRIORITY[a.type] - BADGE_PRIORITY[b.type])[0].type;
    },
    async countUsers() {
      return __memoryStore.users.size;
    },
  };
}

// ———— PG 版 ————

function createPgIdentityRepository(db = getPool()) {
  return {
    kind: 'pg',
    async findPublicId(userId) {
      const { rows } = await db.query('select public_id from users where id = $1 limit 1', [userId]);
      return rows[0]?.public_id || null;
    },
    async assignPublicId(userId) {
      const current = await this.findPublicId(userId);
      if (current) return current;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generatePublicId();
        try {
          const { rows } = await db.query('update users set public_id = $2 where id = $1 and public_id is null returning public_id', [userId, candidate]);
          if (rows[0]?.public_id) return rows[0].public_id;
          return await this.findPublicId(userId); // 并发下已被分配 → 读现有值
        } catch (error) {
          if (error?.code === '23505') continue; // unique 冲突 → 换号重试
          throw error;
        }
      }
      throw Object.assign(new Error('唯一 ID 分配失败，请稍后重试'), { code: 'PUBLIC_ID_EXHAUSTED', status: 500 });
    },
    async listBindings(userId) {
      const { rows } = await db.query(
        'select type, value, status, created_at as "createdAt" from user_bindings where user_id = $1 order by created_at asc',
        [userId],
      );
      return rows;
    },
    async upsertBinding(userId, { type, value }) {
      const { rows } = await db.query(
        `insert into user_bindings(user_id, type, value, status) values ($1,$2,$3,'verified')
         on conflict (user_id, type) do update set value = excluded.value, status = 'verified', created_at = now()
         returning type, value, status, created_at as "createdAt"`,
        [userId, type, value],
      );
      return rows[0];
    },
    async findBindingValue(type, value) {
      const { rows } = await db.query('select user_id as "userId" from user_bindings where type = $1 and lower(value) = lower($2) limit 1', [type, value]);
      return rows[0] || null;
    },
    async listVerifications(userId) {
      const { rows } = await db.query(
        `select type, status, payload, created_at as "createdAt", reviewed_at as "reviewedAt"
         from user_verifications where user_id = $1 order by created_at asc`,
        [userId],
      );
      return rows;
    },
    async upsertVerification(userId, { type, payload }) {
      const { rows } = await db.query(
        `insert into user_verifications(user_id, type, payload, status, reviewed_at) values ($1,$2,$3::jsonb,'approved',now())
         on conflict (user_id, type) do update set payload = excluded.payload, status = 'approved', reviewed_at = now()
         returning type, status, payload, created_at as "createdAt", reviewed_at as "reviewedAt"`,
        [userId, type, JSON.stringify(payload)],
      );
      return rows[0];
    },
    async bestBadge(userId) {
      const { rows } = await db.query(
        `select type from user_verifications where user_id = $1 and status = 'approved'
         order by case type when 'creator' then 0 when 'enterprise' then 1 else 2 end limit 1`,
        [userId],
      );
      return rows[0]?.type || '';
    },
    async countUsers() {
      const { rows } = await db.query('select count(*)::int as total from users');
      return rows[0]?.total || 0;
    },
  };
}

// ———— 服务层 ————

export function createIdentityService(repository, authService) {
  async function requireViewer(rawToken) {
    const user = await authService.authenticate(rawToken);
    if (!user) throw Object.assign(new Error('请先登录'), { code: 'UNAUTHORIZED', status: 401 });
    return user;
  }

  return {
    repository,
    /** 展示唯一 ID 懒分配（注册/登录/读卡路径均可触发，幂等） */
    ensurePublicId(userId) {
      return repository.assignPublicId(userId);
    },
    /** 用户卡片全量数据：publicId + 绑定 + 认证 + 全站用户数（统计口径） */
    async getIdentity(rawToken) {
      const user = await requireViewer(rawToken);
      const publicId = await repository.assignPublicId(user.id);
      const [bindings, verifications, totalUsers] = await Promise.all([
        repository.listBindings(user.id),
        repository.listVerifications(user.id),
        repository.countUsers(),
      ]);
      const badge = verifications.filter(item => item.status === 'approved')
        .sort((a, b) => BADGE_PRIORITY[a.type] - BADGE_PRIORITY[b.type])[0]?.type || '';
      return { user: { ...user, publicId }, bindings, verifications, totalUsers, badge };
    },
    async bindAccount(rawToken, { type, value }) {
      const user = await requireViewer(rawToken);
      const kind = String(type || '').trim();
      if (!BINDING_TYPES.has(kind)) throw Object.assign(new Error('绑定类型不支持'), { code: 'INVALID_BINDING_TYPE', status: 400 });
      const text = String(value || '').trim();
      if (kind === 'email' && !EMAIL_RE.test(text)) throw Object.assign(new Error('邮箱格式不正确'), { code: 'INVALID_EMAIL', status: 400 });
      if (kind === 'wechat' && !WECHAT_RE.test(text)) throw Object.assign(new Error('微信号需为字母开头 6-20 位（字母/数字/下划线/减号）'), { code: 'INVALID_WECHAT', status: 400 });
      const taken = await repository.findBindingValue(kind, text);
      if (taken && String(taken.userId) !== String(user.id)) {
        throw Object.assign(new Error(`该${BINDING_LABELS[kind]}已被其他账号绑定`), { code: 'BINDING_TAKEN', status: 409 });
      }
      const binding = await repository.upsertBinding(user.id, { type: kind, value: text });
      return { bindings: await repository.listBindings(user.id), binding };
    },
    async submitVerification(rawToken, { type, payload }) {
      const user = await requireViewer(rawToken);
      const kind = String(type || '').trim();
      if (!VERIFICATION_TYPES.has(kind)) throw Object.assign(new Error('认证类型不支持'), { code: 'INVALID_VERIFICATION_TYPE', status: 400 });
      const data = payload && typeof payload === 'object' ? payload : {};
      const clean = {};
      if (kind === 'individual') {
        clean.realName = String(data.realName || '').trim().slice(0, 40);
        if (!clean.realName) throw Object.assign(new Error('请填写真实姓名'), { code: 'INVALID_VERIFICATION', status: 400 });
      } else if (kind === 'enterprise') {
        clean.companyName = String(data.companyName || '').trim().slice(0, 80);
        clean.creditCode = String(data.creditCode || '').trim().slice(0, 40);
        if (!clean.companyName || !clean.creditCode) throw Object.assign(new Error('请填写企业名称与统一社会信用代码'), { code: 'INVALID_VERIFICATION', status: 400 });
      } else {
        clean.platform = String(data.platform || '').trim().slice(0, 24);
        clean.homeUrl = /^https:\/\//i.test(String(data.homeUrl || '').trim()) ? String(data.homeUrl).trim().slice(0, 300) : '';
        if (!clean.platform) throw Object.assign(new Error('请填写主创作平台'), { code: 'INVALID_VERIFICATION', status: 400 });
      }
      const verification = await repository.upsertVerification(user.id, { type: kind, payload: clean });
      return { verifications: await repository.listVerifications(user.id), verification, badge: await repository.bestBadge(user.id) };
    },
  };
}

export function createIdentityRepository(repository = (isDevMemoryMode() ? createMemoryIdentityRepository() : createPgIdentityRepository())) {
  return repository;
}

let defaultIdentityPromise = null;
export function getIdentityService() {
  if (!defaultIdentityPromise) {
    defaultIdentityPromise = (async () => {
      const { getAuthService } = await import('./authService.js');
      const auth = await getAuthService();
      return createIdentityService(createIdentityRepository(), auth);
    })();
  }
  return defaultIdentityPromise;
}
