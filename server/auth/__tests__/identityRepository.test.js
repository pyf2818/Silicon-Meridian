import { beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../authService.js';
import { createIdentityService, createMemoryIdentityRepository } from '../identityRepository.js';
import { createMemoryAuthRepository, __memoryStore } from '../memoryAuthRepository.js';
import { clearIdentityForTests } from '../identityMemoryStore.js';

async function bootService() {
  const authRepo = createMemoryAuthRepository();
  const auth = createAuthService(authRepo);
  const identity = createIdentityService(createMemoryIdentityRepository(), auth);
  return { auth, identity };
}

async function registerUser(auth, username) {
  const { user } = await auth.register({ username, email: '', password: { hash: 'h', salt: 's', params: {} } });
  return user;
}

describe('identityRepository（C3 任务 4：唯一 ID / 绑定 / 认证，内存链路）', () => {
  beforeEach(() => {
    __memoryStore.users.clear();
    __memoryStore.identityIndex.clear();
    __memoryStore.sessions.clear();
    clearIdentityForTests();
  });

  it('ensurePublicId：懒分配 6 位展示 ID，幂等且全库唯一', async () => {
    const { auth, identity } = await bootService();
    const alice = await registerUser(auth, 'alice');
    expect(alice.publicId).toBe('');
    const first = await identity.ensurePublicId(alice.id);
    expect(first).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await identity.ensurePublicId(alice.id)).toBe(first); // 幂等
    const bob = await registerUser(auth, 'bob');
    const bobId = await identity.ensurePublicId(bob.id);
    expect(bobId).not.toBe(first);
  });

  it('getIdentity（通过 register 会话）：读卡聚合且未绑定/未认证时为空数组', async () => {
    const { auth, identity } = await bootService();
    const { user, rawToken } = await (async () => {
      const created = await auth.register({ username: 'carol', email: '', password: { hash: 'h', salt: 's', params: {} } });
      // register 返回 rawToken 已写入 sessions，可直接 authenticate
      return created;
    })();
    expect(rawToken).toBeTruthy();
    const card = await identity.getIdentity(rawToken);
    expect(card.user.id).toBe(user.id);
    expect(card.user.publicId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(card.bindings).toEqual([]);
    expect(card.verifications).toEqual([]);
    expect(card.badge).toBe('');
    expect(card.totalUsers).toBe(1);
  });

  it('bindAccount：邮箱/微信格式校验；换绑幂等；跨账号冲突 409', async () => {
    const { auth, identity } = await bootService();
    const aliceReg = await auth.register({ username: 'alice', email: '', password: { hash: 'h', salt: 's', params: {} } });
    const bobReg = await auth.register({ username: 'bob', email: '', password: { hash: 'h', salt: 's', params: {} } });

    const expectFail = async (promise, code, status) => {
      let caught = null;
      try { await promise; } catch (error) { caught = error; }
      expect(caught?.code).toBe(code);
      if (status) expect(caught?.status).toBe(status);
    };

    await expectFail(identity.bindAccount(aliceReg.rawToken, { type: 'qq', value: 'x' }), 'INVALID_BINDING_TYPE', 400);
    await expectFail(identity.bindAccount(aliceReg.rawToken, { type: 'email', value: 'not-an-email' }), 'INVALID_EMAIL', 400);
    await expectFail(identity.bindAccount(aliceReg.rawToken, { type: 'wechat', value: '1abc' }), 'INVALID_WECHAT', 400);

    const bound = await identity.bindAccount(aliceReg.rawToken, { type: 'email', value: 'alice@meridian.dev' });
    expect(bound.binding.status).toBe('verified');
    expect(bound.bindings).toHaveLength(1);

    // 同账号重复绑定（换绑/重绑）幂等成功
    const rebinding = await identity.bindAccount(aliceReg.rawToken, { type: 'email', value: 'alice@meridian.dev' });
    expect(rebinding.bindings).toHaveLength(1);
    // 同账号换绑成新值也成功
    const switched = await identity.bindAccount(aliceReg.rawToken, { type: 'email', value: 'alice2@meridian.dev' });
    expect(switched.binding.value).toBe('alice2@meridian.dev');

    // 其他账号绑定同一邮箱 → 409
    await expectFail(identity.bindAccount(bobReg.rawToken, { type: 'email', value: 'ALICE2@meridian.dev' }), 'BINDING_TAKEN', 409);

    // 微信号绑定
    const wechat = await identity.bindAccount(bobReg.rawToken, { type: 'wechat', value: 'bob_wx-01' });
    expect(wechat.binding.value).toBe('bob_wx-01');
  });

  it('submitVerification：三类认证 payload 校验；提交后 approved 并产出徽章', async () => {
    const { auth, identity } = await bootService();
    const { rawToken } = await auth.register({ username: 'creator1', email: '', password: { hash: 'h', salt: 's', params: {} } });

    const expectFail = async (promise, code) => {
      let caught = null;
      try { await promise; } catch (error) { caught = error; }
      expect(caught?.code).toBe(code);
    };

    await expectFail(identity.submitVerification(rawToken, { type: 'star' }), 'INVALID_VERIFICATION_TYPE');
    await expectFail(identity.submitVerification(rawToken, { type: 'individual', payload: {} }), 'INVALID_VERIFICATION');
    await expectFail(identity.submitVerification(rawToken, { type: 'enterprise', payload: { companyName: '某公司' } }), 'INVALID_VERIFICATION');
    await expectFail(identity.submitVerification(rawToken, { type: 'creator', payload: { platform: '' } }), 'INVALID_VERIFICATION');

    const individual = await identity.submitVerification(rawToken, { type: 'individual', payload: { realName: '安安' } });
    expect(individual.badge).toBe('individual');
    expect(individual.verification.status).toBe('approved');

    // 提交更高级认证 → 徽章升级（creator 优先于 individual）
    const creator = await identity.submitVerification(rawToken, { type: 'creator', payload: { platform: '即刻', homeUrl: 'https://ok.com/@a', junk: '剥离' } });
    expect(creator.badge).toBe('creator');
    expect(creator.verification.payload).toEqual({ platform: '即刻', homeUrl: 'https://ok.com/@a' });
    expect(creator.verifications).toHaveLength(2);
  });

  it('getIdentity 全链路：绑定+认证后卡片带 badge 与 totalUsers 统计', async () => {
    const { auth, identity } = await bootService();
    const alice = await auth.register({ username: 'alice', email: '', password: { hash: 'h', salt: 's', params: {} } });
    const bob = await auth.register({ username: 'bob', email: '', password: { hash: 'h', salt: 's', params: {} } });
    await identity.bindAccount(alice.rawToken, { type: 'wechat', value: 'alice_wx' });
    await identity.submitVerification(alice.rawToken, { type: 'enterprise', payload: { companyName: '万般硅川', creditCode: '91310000MA1K35X000' } });
    const card = await identity.getIdentity(alice.rawToken);
    expect(card.totalUsers).toBe(2);
    expect(card.user.publicId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(card.badge).toBe('enterprise');
    expect(card.bindings[0].type).toBe('wechat');
    expect(bob.user.publicId).toBe(''); // 未读卡前不强制分配
  });
});
