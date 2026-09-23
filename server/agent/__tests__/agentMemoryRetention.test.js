/**
 * memoryRetention 单测（2026-09-22 治理落地）：
 * - 纯函数：resolveExpiresAt / isExpiredMemory / selectEvictions
 * - 内存版（memoryAgentMemoryService）：TTL 默认、读取过滤、cap 淘汰
 * - PG 版（agentMemoryService）：写入参数带默认 TTL、维护 SQL 被触发、读取 SQL 过滤过期
 * 口径一处定义（memoryRetention.js），双版行为必须一致——这是本文件的核心断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_MEMORY_CAP, AGENT_INSIGHT_TTL_DAYS,
  resolveExpiresAt, isExpiredMemory, selectEvictions, mergePersonaSummaryFields,
} from '../memoryRetention.js';

describe('memoryRetention 纯函数', () => {
  it('resolveExpiresAt：agent_insight 未传时默认 90 天，其余类型不过期', () => {
    const now = new Date('2026-09-22T00:00:00Z');
    const insight = resolveExpiresAt('agent_insight', undefined, now);
    expect(insight.toISOString()).toBe('2026-12-21T00:00:00.000Z');
    expect(insight.getTime() - now.getTime()).toBe(AGENT_INSIGHT_TTL_DAYS * 24 * 3600 * 1000);
    expect(resolveExpiresAt('user_habit', undefined, now)).toBeNull();
    expect(resolveExpiresAt('user_trait', null, now)).toBeNull();
  });

  it('resolveExpiresAt：显式传入优先（含字符串日期），非法值回落 null', () => {
    const explicit = resolveExpiresAt('agent_insight', new Date('2027-01-01T00:00:00Z'));
    expect(explicit.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(resolveExpiresAt('user_habit', '2027-06-01T00:00:00Z').toISOString()).toBe('2027-06-01T00:00:00.000Z');
    expect(resolveExpiresAt('user_habit', 'not-a-date')).toBeNull();
  });

  it('isExpiredMemory：兼容 Date 与 ISO 字符串两种形态（PG/内存版字段差异）', () => {
    const now = new Date('2026-09-22T00:00:00Z');
    expect(isExpiredMemory({ expiresAt: '2026-09-21T00:00:00Z' }, now)).toBe(true);
    expect(isExpiredMemory({ expiresAt: new Date('2026-09-22T00:00:00Z') }, now)).toBe(true); // 恰好到点即过期
    expect(isExpiredMemory({ expiresAt: '2026-09-22T00:00:01Z' }, now)).toBe(false);
    expect(isExpiredMemory({ expiresAt: null }, now)).toBe(false);
    expect(isExpiredMemory({ expires_at: '2026-09-01T00:00:00Z' }, now)).toBe(true); // PG snake_case 形态
  });

  it('selectEvictions：超 cap 淘汰 weight 最低者，同权重再淘汰最旧；未超不淘汰', () => {
    const rec = (id, weight, createdAt) => ({ id, weight, createdAt });
    const records = [
      rec('new-low', 1, '2026-09-20'),   // 低权重但新 → 淘汰（权重优先）
      rec('old-mid', 5, '2026-01-01'),   // 高权重但最旧 → 保留（权重优先于时间）
      rec('mid-a', 5, '2026-03-01'),
      rec('mid-b', 5, '2026-03-01'),     // 与 mid-a 同权重同时间 → id 稳定序
      rec('new-hi', 9, '2026-09-21'),
    ];
    // 5 条 cap 3 → 淘汰 2 条；weight 1 最先，同权重里 2026-01-01 最旧第二
    const evicted = selectEvictions(records, 3);
    expect(evicted.map(r => r.id)).toEqual(['new-low', 'old-mid']);
    expect(selectEvictions(records.slice(0, 3), 3)).toEqual([]);
    expect(selectEvictions([], 3)).toEqual([]);
  });

  it('selectEvictions：真实 cap 500 下精确淘汰超出部分', () => {
    const records = Array.from({ length: AGENT_MEMORY_CAP + 7 }, (_, i) => ({
      id: `m${i}`, weight: 1 + (i % 10), createdAt: new Date(2026, 0, 1 + i).toISOString(),
    }));
    expect(selectEvictions(records)).toHaveLength(7);
  });

  it('mergePersonaSummaryFields：数组字段新在前合并去重（修复浅覆盖抹掉旧画像）', () => {
    const current = { habits: ['夜猫子', '爱喝咖啡'], traits: ['直接'] };
    const merged = mergePersonaSummaryFields(current, { habits: ['爱喝咖啡', '晨跑'] });
    expect(merged.habits).toEqual(['爱喝咖啡', '晨跑', '夜猫子']); // 新在前、去重、旧画像保留
    expect(merged.traits).toEqual(['直接']);                      // 未被 patch 碰的字段原样
  });

  it('mergePersonaSummaryFields：数组 cap 20 + 单条截断 200 字 + 脏值过滤', () => {
    const current = { needs: Array.from({ length: 25 }, (_, i) => `旧需求${i}`) };
    const merged = mergePersonaSummaryFields(current, { needs: ['新需求'] });
    expect(merged.needs).toHaveLength(20);
    expect(merged.needs[0]).toBe('新需求');
    const long = 'x'.repeat(500);
    const dirty = mergePersonaSummaryFields({}, { habits: [long, '  ', null, '正常'] });
    expect(dirty.habits).toEqual(['x'.repeat(200), '正常']); // 截断 + 空值剔除
  });

  it('mergePersonaSummaryFields：非数组字段浅合并、patch 非数组值尊重原样', () => {
    const merged = mergePersonaSummaryFields({ personality: '温和', habits: ['a'] }, {
      personality: '安静',            // 非治理字段 → 覆盖
      habits: '不是数组',             // 治理字段但值非数组 → 尊重写入方意图
    });
    expect(merged.personality).toBe('安静');
    expect(merged.habits).toBe('不是数组');
  });
});

/* ============ 内存版（直接打真实 devMemoryStore Map） ============ */
import { agentMemories } from '../../db/devMemoryStore.js';
import * as memoryStore from '../memoryAgentMemoryService.js';

describe('内存版治理（memoryAgentMemoryService）', () => {
  const USER = 'u-retention';
  beforeEach(() => { agentMemories.clear(); });

  it('agent_insight 未传 expiresAt 时自动获得 90 天 TTL；画像类永不过期', async () => {
    const insightId = await memoryStore.addAgentMemory({ userId: USER, agentId: 'a', memoryType: 'agent_insight', content: '任务产物' });
    await memoryStore.addAgentMemory({ userId: USER, agentId: 'a', memoryType: 'user_habit', content: '习惯观察' });
    const list = agentMemories.get(USER);
    const insight = list.find(m => m.id === insightId);
    expect(insight.expiresAt).toBeTruthy();
    expect(new Date(insight.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const habit = list.find(m => m.memoryType === 'user_habit');
    expect(habit.expiresAt).toBeNull();
  });

  it('过期条目读取时被过滤（89 天可见 / 91 天不可见）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const id = await memoryStore.addAgentMemory({ userId: USER, agentId: 'a', memoryType: 'agent_insight', content: '会过期的任务产物' });
      const searchKey = '会过期';

      vi.setSystemTime(new Date('2026-03-30T00:00:00Z')); // +88 天
      expect((await memoryStore.getAgentMemories(USER)).some(m => m.id === id)).toBe(true);
      expect((await memoryStore.searchAgentMemories(USER, searchKey)).some(m => m.id === id)).toBe(true);

      vi.setSystemTime(new Date('2026-04-02T00:00:00Z')); // +91 天
      expect((await memoryStore.getAgentMemories(USER)).some(m => m.id === id)).toBe(false);
      expect((await memoryStore.searchAgentMemories(USER, searchKey))).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('超 cap 时按 weight asc → createdAt asc 淘汰（高权重旧条目存活）', async () => {
    // 直接往 Map 塞 cap 条低权重旧记忆，再写入 1 条高权重 → 旧低权重被淘汰
    const seed = Array.from({ length: AGENT_MEMORY_CAP }, (_, i) => ({
      id: `seed-${i}`, userId: USER, agentId: 'a', sessionId: null, memoryType: 'user_habit',
      content: `seed ${i}`, evidence: [], weight: 1, createdAt: new Date(2026, 0, 1).toISOString(), expiresAt: null,
    }));
    agentMemories.set(USER, seed);
    await memoryStore.addAgentMemory({ userId: USER, agentId: 'a', memoryType: 'agent_insight', content: '新记忆', weight: 5 });
    const after = agentMemories.get(USER);
    expect(after).toHaveLength(AGENT_MEMORY_CAP);
    expect(after.some(m => m.content === '新记忆')).toBe(true);
    expect(after.some(m => m.id === 'seed-0')).toBe(false); // 最旧的 seed 被挤出
  });

  it('mergePersonaSummary：habits 新在前合并（旧画像不被抹掉，与 PG 版同口径）', async () => {
    await memoryStore.mergePersonaSummary(USER, { habits: ['夜猫子', '爱喝咖啡'] });
    const { personaSummary } = await memoryStore.mergePersonaSummary(USER, { habits: ['晨跑'] });
    expect(personaSummary.habits).toEqual(['晨跑', '夜猫子', '爱喝咖啡']);
  });
});

/* ============ PG 版（mock pool，断言 SQL 口径） ============ */
// 注意：不 mock devMemoryStore（内存版用例要打真实 Map）；PG 分支靠 stubEnv
// DATABASE_URL 让 isDevMemoryMode() 返回 false（无 DATABASE_URL 时默认内存模式）。
import { getPool } from '../../db/client.js';

vi.mock('../../db/client.js', () => ({ getPool: vi.fn() }));

describe('PG 版治理（agentMemoryService）', () => {
  const query = vi.fn();
  beforeEach(() => {
    query.mockReset();
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    getPool.mockReturnValue({ query });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('addAgentMemory：insert 携带默认 TTL，写入后触发维护（过期清理 + cap 淘汰）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-22T00:00:00Z'));
      query.mockResolvedValue({ rows: [{ id: 'm1' }] });
      const { addAgentMemory } = await import('../agentMemoryService.js');
      await addAgentMemory({ userId: 'u1', agentId: 'a', memoryType: 'agent_insight', content: 'x' });

      const insert = query.mock.calls.find(([sql]) => sql.includes('insert into agent_memories'));
      expect(insert[1][7]).toBeInstanceOf(Date);
      expect(insert[1][7].toISOString()).toBe('2026-12-21T00:00:00.000Z');
      const deletes = query.mock.calls.filter(([sql]) => sql.startsWith('delete from agent_memories'));
      expect(deletes.some(([sql]) => sql.includes('expires_at <= now()'))).toBe(true);
      expect(deletes.some(([sql]) => sql.includes('rn > $2'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('读取 SQL 过滤过期条目（get/search 两路一致）', async () => {
    query.mockResolvedValue({ rows: [] });
    const { getAgentMemories, searchAgentMemories } = await import('../agentMemoryService.js');
    await getAgentMemories('u1');
    await searchAgentMemories('u1', 'kw');
    for (const [sql] of query.mock.calls.filter(([s]) => s.includes('from agent_memories'))) {
      expect(sql).toContain('expires_at is null or expires_at > now()');
    }
  });

  it('维护失败不拖垮写入（治理是最终一致，写入照常返回）', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'm1' }] })                     // insert 成功
      .mockRejectedValueOnce(new Error('db gone'))                         // 过期清理失败
      .mockRejectedValueOnce(new Error('db gone'));                        // cap 淘汰失败
    const { addAgentMemory } = await import('../agentMemoryService.js');
    const id = await addAgentMemory({ userId: 'u1', agentId: 'a', memoryType: 'user_habit', content: 'x' });
    expect(id).toBe('m1');
  });
});
