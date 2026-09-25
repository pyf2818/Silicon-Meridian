import { describe, it, expect, beforeEach } from 'vitest';

process.env.DEV_MEMORY_AUTH = 'true';
delete process.env.DATABASE_URL;

const { getArtifactService, ARTIFACTS_PER_USER_CAP, __resetArtifactsForTest } = await import('../artifactService.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

describe('artifactService（内存仓储，DEV_MEMORY_AUTH=true）', () => {
  beforeEach(() => {
    __resetArtifactsForTest();
  });

  it('register → list → get → remove 全链路', async () => {
    const svc = await getArtifactService();
    expect(svc.mode).toBe('memory');

    const artifact = await svc.register(USER_A, {
      kind: 'report', title: '竞品扫描报告', content: '# 报告内容',
      sessionId: 'sess-1', taskId: 'task-9', meta: { source: 'agent-loop' },
    });
    expect(artifact.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(artifact.title).toBe('竞品扫描报告');
    expect(artifact.kind).toBe('report');
    expect(artifact.size).toBeGreaterThan(0);
    expect(artifact.createdAt).toBeTruthy();

    const list1 = await svc.list(USER_A, {});
    expect(list1.artifacts).toHaveLength(1);
    expect(list1.total).toBe(1);
    expect(list1.hasMore).toBe(false);

    const row = await svc.get(USER_A, artifact.id);
    expect(row).toBeTruthy();
    expect(Buffer.isBuffer(row.data)).toBe(true);
    expect(row.data.toString('utf8')).toBe('# 报告内容');

    expect(await svc.remove(USER_A, artifact.id)).toBe(true);
    expect(await svc.get(USER_A, artifact.id)).toBeNull();
    expect((await svc.list(USER_A, {})).total).toBe(0);
  });

  it('归属隔离：USER_B 看不到 USER_A 的产物', async () => {
    const svc = await getArtifactService();
    const a = await svc.register(USER_A, { kind: 'report', content: 'secret' });
    expect(await svc.get(USER_B, a.id)).toBeNull();
    expect((await svc.list(USER_B, {})).total).toBe(0);
    expect(await svc.remove(USER_B, a.id)).toBe(false);
  });

  it('list 支持 session/kind 过滤与 hasMore', async () => {
    const svc = await getArtifactService();
    for (let i = 0; i < 5; i++) {
      await svc.register(USER_A, { kind: 'report', content: `r${i}`, sessionId: 's1' });
    }
    await svc.register(USER_A, { kind: 'code', content: 'const x=1', sessionId: 's2' });

    const bySession = await svc.list(USER_A, { sessionId: 's1' });
    expect(bySession.total).toBe(5);
    const byKind = await svc.list(USER_A, { kind: 'code' });
    expect(byKind.total).toBe(1);
    const paged = await svc.list(USER_A, { sessionId: 's1', limit: 2, offset: 0 });
    expect(paged.artifacts).toHaveLength(2);
    expect(paged.hasMore).toBe(true);
    expect((await svc.list(USER_A, { sessionId: 's1', limit: 2, offset: 4 })).hasMore).toBe(false);
  });

  it('每用户 cap：超额淘汰最旧产物', async () => {
    const svc = await getArtifactService();
    const ids = [];
    for (let i = 0; i < ARTIFACTS_PER_USER_CAP + 5; i++) {
      const a = await svc.register(USER_A, { kind: 'file', content: `f${i}` });
      ids.push(a.id);
    }
    const list = await svc.list(USER_A, { limit: 500 });
    expect(list.total).toBe(ARTIFACTS_PER_USER_CAP);
    // 最旧 5 条被淘汰
    for (const old of ids.slice(0, 5)) {
      expect(await svc.get(USER_A, old)).toBeNull();
    }
    // 最新仍在
    expect(await svc.get(USER_A, ids[ids.length - 1])).toBeTruthy();
  });

  it('normalize 错误冒泡：空内容/超限', async () => {
    const svc = await getArtifactService();
    await expect(svc.register(USER_A, { kind: 'report', content: '' })).rejects.toThrowError(/内容为空/);
    await expect(svc.register(USER_A, { kind: 'report', content: 'x'.repeat(9 * 1024 * 1024) })).rejects.toThrowError(/大小上限/);
  });
});
