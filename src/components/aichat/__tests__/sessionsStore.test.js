/**
 * sessionsStore 存储边界治理单测（2026-09-22）：
 * - buildPersistProjection：会话 cap 50 / active 强制保留 / 消息投影 400 / 纯函数不污染入参
 * - saveSessions 配额降级：投影爆配额 → 淘汰最旧非活跃重试 → 活跃截 100 → 放弃不抛
 * - setState 集成：节流落盘时带 activeSessionId
 * store 是模块级单例 + localStorage 依赖 → vi.resetModules + 动态 import + stubGlobal。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'aiCopilotSessions';

function installLocalStorage({ quotaFail = false } = {}) {
  const backing = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(key => backing.get(key) ?? null),
    setItem: vi.fn((key, value) => {
      if (quotaFail) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      backing.set(key, String(value));
    }),
    removeItem: vi.fn(key => backing.delete(key)),
    clear: vi.fn(() => backing.clear()),
  });
  return backing;
}

let backing;

async function freshStore() {
  vi.resetModules();
  return import('../sessionsStore.js');
}

function makeSession(id, { updatedAt = 0, messageCount = 1 } = {}) {
  return {
    id,
    title: `会话${id}`,
    updatedAt,
    messages: Array.from({ length: messageCount }, (_, i) => ({ role: 'user', content: `m${i}` })),
  };
}

beforeEach(() => {
  backing = installLocalStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('buildPersistProjection（纯函数投影）', () => {
  it('超过 50 个会话只保最新 50 个', async () => {
    const { buildPersistProjection } = await freshStore();
    const sessions = Array.from({ length: 60 }, (_, i) => makeSession(`s${i}`, { updatedAt: i }));
    const out = buildPersistProjection(sessions);
    expect(out).toHaveLength(50);
    expect(out.some(s => s.id === 's59')).toBe(true);  // 最新保留
    expect(out.some(s => s.id === 's0')).toBe(false);  // 最旧淘汰
  });

  it('active 会话即使最旧也强制保留（挤掉名单内最旧者，cap 恒定 50）', async () => {
    const { buildPersistProjection } = await freshStore();
    const sessions = Array.from({ length: 60 }, (_, i) => makeSession(`s${i}`, { updatedAt: i }));
    const out = buildPersistProjection(sessions, 's0');
    expect(out.some(s => s.id === 's0')).toBe(true);
    expect(out.some(s => s.id === 's59')).toBe(true);   // 最新会话不受挤占
    expect(out).toHaveLength(50);                        // cap 恒定，active 替换名单尾部
  });

  it('单会话消息超 400 条时投影只保最近 400 条，且不污染入参（纯函数）', async () => {
    const { buildPersistProjection } = await freshStore();
    const sessions = [makeSession('s1', { updatedAt: 1, messageCount: 450 })];
    const out = buildPersistProjection(sessions);
    expect(out[0].messages).toHaveLength(400);
    expect(out[0].messages[0].content).toBe('m50');      // 前 50 条被投影裁掉
    expect(out[0].messages.at(-1).content).toBe('m449');
    expect(sessions[0].messages).toHaveLength(450);      // state 本体不动
  });

  it('非数组入参返回空数组', async () => {
    const { buildPersistProjection } = await freshStore();
    expect(buildPersistProjection(null)).toEqual([]);
    expect(buildPersistProjection('x')).toEqual([]);
  });
});

describe('saveSessions 配额降级', () => {
  it('投影写入失败 → 逐轮淘汰最旧非活跃会话，直到成功；active 与较新会话存活', async () => {
    backing = installLocalStorage({ quotaFail: true });
    // 让 setItem 从第 2 次调用起成功（第 1 次=投影爆；第 2 次=淘汰 1 个后成功）
    const store = await freshStore();
    const setItem = vi.spyOn(localStorage, 'setItem');
    let calls = 0;
    setItem.mockImplementation((key, value) => {
      calls += 1;
      if (calls < 2) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      backing.set(key, String(value));
    });

    const sessions = [
      makeSession('old', { updatedAt: 1 }),
      makeSession('mid', { updatedAt: 2 }),
      makeSession('new', { updatedAt: 3 }),
    ];
    const ok = store.saveSessions(sessions, 'new');
    expect(ok).toBe(true);
    const persisted = JSON.parse(backing.get(STORAGE_KEY));
    const ids = persisted.map(s => s.id);
    expect(ids).toEqual(['new', 'mid']);               // 最旧的 old 被淘汰两层
    expect(ids).toContain('new');                       // active 存活
  });

  it('非活跃全部淘汰仍爆 → 活跃消息截到 100 条后成功', async () => {
    backing = installLocalStorage({ quotaFail: true });
    const store = await freshStore();
    const setItem = vi.spyOn(localStorage, 'setItem');
    let calls = 0;
    setItem.mockImplementation((key, value) => {
      calls += 1;
      if (calls < 4) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      backing.set(key, String(value));
    });

    const sessions = [
      makeSession('a1', { updatedAt: 1 }),
      makeSession('a2', { updatedAt: 2 }),
      makeSession('active', { updatedAt: 3, messageCount: 300 }),
    ];
    expect(store.saveSessions(sessions, 'active')).toBe(true);
    const persisted = JSON.parse(backing.get(STORAGE_KEY));
    expect(persisted.map(s => s.id)).toEqual(['active']);
    expect(persisted[0].messages).toHaveLength(100);    // 终极兜底截断
  });

  it('彻底无空间时放弃并返回 false，不向外抛错', async () => {
    backing = installLocalStorage({ quotaFail: true });
    const store = await freshStore();
    expect(store.saveSessions([makeSession('s1', { updatedAt: 1 })], 's1')).toBe(false);
  });
});

describe('sessionsStore.setState 集成', () => {
  it('sessions 变化节流 800ms 后落盘，投影带 activeSessionId', async () => {
    vi.useFakeTimers();
    const store = await freshStore();
    const sessions = Array.from({ length: 60 }, (_, i) => makeSession(`s${i}`, { updatedAt: i }));
    store.sessionsStore.setState({ sessions, activeSessionId: 's0' });
    expect(backing.has(STORAGE_KEY)).toBe(false);       // 节流期内未落盘
    vi.advanceTimersByTime(800);
    const persisted = JSON.parse(backing.get(STORAGE_KEY));
    expect(persisted.length).toBe(50);                  // cap 恒定：active 替换名单尾部
    expect(persisted.some(s => s.id === 's0')).toBe(true);
  });
});

describe('多标签页吸收（absorbExternalSessions）', () => {
  it('正常吸收：state 更新 + 订阅者收到通知 + 不写回磁盘（防回声）', async () => {
    const store = await freshStore();
    const notified = [];
    store.sessionsStore.subscribe(s => notified.push(s.sessions.length));
    const external = JSON.stringify([makeSession('from-other-tab', { updatedAt: 9 })]);
    store.absorbExternalSessions(external);
    expect(store.sessionsStore.state.sessions).toHaveLength(1);
    expect(store.sessionsStore.state.sessions[0].id).toBe('from-other-tab');
    expect(notified).toContain(1);
    expect(backing.has(STORAGE_KEY)).toBe(false);       // 吸收路径绝不落盘
  });

  it('流式中 / 本地有 pending 写入时忽略外部快照（本地权威）', async () => {
    vi.useFakeTimers();
    const store = await freshStore();
    const local = [makeSession('local', { updatedAt: 2 })];
    store.sessionsStore.setState({ sessions: local, activeSessionId: 'local' });
    const external = JSON.stringify([makeSession('external', { updatedAt: 9 })]);

    store.sessionsStore.state.isStreaming = true;
    store.absorbExternalSessions(external);
    expect(store.sessionsStore.state.sessions[0].id).toBe('local'); // 流式中不吸收
    store.sessionsStore.state.isStreaming = false;

    store.absorbExternalSessions(external);             // 800ms 节流 pending 仍在 → 不吸收
    expect(store.sessionsStore.state.sessions[0].id).toBe('local');

    vi.advanceTimersByTime(800);                        // pending 落盘清空
    store.absorbExternalSessions(external);             // 无 pending → 正常吸收
    expect(store.sessionsStore.state.sessions[0].id).toBe('external');

    store.sessionsStore.setState({ sessions: local });  // 新 pending（节流期内）
    store.absorbExternalSessions(external);
    expect(store.sessionsStore.state.sessions[0].id).toBe('local'); // pending 期间不吸收
    vi.advanceTimersByTime(800);                        // 放掉节流定时器
  });

  it('坏 JSON / 非数组静默忽略，不影响现有 state', async () => {
    const store = await freshStore();
    const before = store.sessionsStore.state.sessions;
    store.absorbExternalSessions('{broken json');
    store.absorbExternalSessions(JSON.stringify({ not: 'an array' }));
    store.absorbExternalSessions(null);
    expect(store.sessionsStore.state.sessions).toBe(before);
  });
});
