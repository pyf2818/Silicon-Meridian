import { describe, it, expect, beforeEach } from 'vitest';

process.env.DEV_MEMORY_AUTH = 'true';
delete process.env.DATABASE_URL;

const audit = await import('../auditService.js');
const { getAuditService, AUDIT_ACTIONS, recordAudit, auditContextFrom, __resetAuditForTest } = audit;

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const flush = () => new Promise(r => setTimeout(r, 10));

describe('auditService（内存仓储，DEV_MEMORY_AUTH=true）', () => {
  beforeEach(() => {
    __resetAuditForTest();
  });

  it('AUDIT_ACTIONS 白名单齐全且格式合法', () => {
    expect(AUDIT_ACTIONS).toContain('auth.login');
    expect(AUDIT_ACTIONS).toContain('tool.execute');
    expect(AUDIT_ACTIONS).toContain('tool.denied');
    expect(AUDIT_ACTIONS).toContain('llm-config.update');
    for (const a of AUDIT_ACTIONS) expect(a).toMatch(/^[a-z][a-z0-9.-]{1,63}$/);
  });

  it('write → list 全链路（最新在前），归属隔离', async () => {
    const svc = await getAuditService();
    expect(svc.mode).toBe('memory');

    const row = await svc.write({
      userId: USER_A, action: 'tool.execute', target: 'web_search',
      outcome: 'ok', detail: { tool: 'web_search' }, ip: '127.0.0.1', userAgent: 'vitest',
    });
    expect(row.id).toBe('a1');
    expect(row.createdAt).toBeTruthy();

    await svc.write({ userId: USER_B, action: 'auth.login' });

    const listA = await svc.list(USER_A, {});
    expect(listA.entries).toHaveLength(1);
    expect(listA.entries[0].action).toBe('tool.execute');

    const listB = await svc.list(USER_B, {});
    expect(listB.entries).toHaveLength(1);
    expect(listB.entries[0].action).toBe('auth.login');
    expect((await svc.list('no-such-user', {})).entries).toHaveLength(0);
  });

  it('list 支持 action 过滤与 limit 上限 200', async () => {
    const svc = await getAuditService();
    for (let i = 0; i < 5; i++) {
      await svc.write({ userId: USER_A, action: 'tool.execute' });
      await svc.write({ userId: USER_A, action: 'auth.login' });
    }
    const filtered = await svc.list(USER_A, { action: 'tool.execute' });
    expect(filtered.entries).toHaveLength(5);
    expect(filtered.entries.every(e => e.action === 'tool.execute')).toBe(true);

    // 写入 300 条 → list 上限 200（同时间接证明 cap > 200：最旧未洞删）
    for (let i = 0; i < 300; i++) {
      await svc.write({ userId: USER_A, action: 'mcp.call' });
    }
    const capped = await svc.list(USER_A, { limit: 500 });
    expect(capped.entries).toHaveLength(200);
    expect(capped.entries[0].id).toBe(`a${310}`);
    expect(capped.entries[199].id).toBe(`a${111}`);
  });

  it('outcome 非白名单时由 recordAudit 归一为 ok，target/ip/ua 截断', async () => {
    const svc = await getAuditService();
    recordAudit({
      userId: USER_A, action: 'export.run',
      outcome: 'hacked', // 非法 → ok
      target: 't'.repeat(500),
      ip: '9'.repeat(100),
      userAgent: 'u'.repeat(500),
    });
    await flush();
    const { entries } = await svc.list(USER_A, {});
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('ok');
    expect(entries[0].target).toHaveLength(200);
    expect(entries[0].ip).toHaveLength(64);
    expect(entries[0].userAgent).toHaveLength(200);
  });

  it('detail 非对象时归一为空对象', async () => {
    const svc = await getAuditService();
    recordAudit({ userId: USER_A, action: 'auth.login', detail: 'not-an-object' });
    await flush();
    const { entries } = await svc.list(USER_A, {});
    expect(entries[0].detail).toEqual({});
  });

  it('recordAudit fire-and-forget：成功写入不抛、不计数', async () => {
    const svc = await getAuditService();
    const before = audit.auditWriteFailures;
    expect(() => recordAudit({ userId: USER_A, action: 'artifact.register', target: 'art-1' })).not.toThrow();
    await flush();
    expect((await svc.list(USER_A, {})).entries).toHaveLength(1);
    expect(audit.auditWriteFailures).toBe(before);
  });

  it('recordAudit 无效 action：不抛进程错误，auditWriteFailures 递增', async () => {
    const before = audit.auditWriteFailures;
    expect(() => recordAudit({ userId: USER_A, action: 'INVALID ACTION!' })).not.toThrow();
    expect(() => recordAudit({ userId: USER_A, action: '' })).not.toThrow();
    expect(() => recordAudit({ userId: USER_A })).not.toThrow();
    await flush();
    expect(audit.auditWriteFailures).toBe(before + 3);
    const svc = await getAuditService();
    expect((await svc.list(USER_A, {})).entries).toHaveLength(0);
  });

  it('auditContextFrom：x-forwarded-for 优先取首段，回退 remoteAddress，ua 截断', () => {
    const mkReq = (headers, remote) => ({ headers, socket: { remoteAddress: remote } });
    expect(auditContextFrom(mkReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, '9.9.9.9')).ip).toBe('1.2.3.4');
    expect(auditContextFrom(mkReq({}, '10.0.0.1')).ip).toBe('10.0.0.1');
    expect(auditContextFrom(mkReq({}, '')).ip).toBe('');
    const ua = 'u'.repeat(300);
    expect(auditContextFrom(mkReq({ 'user-agent': ua }, '')).userAgent).toHaveLength(200);
  });
});
