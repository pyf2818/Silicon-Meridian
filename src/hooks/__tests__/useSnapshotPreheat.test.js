import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// localStorage stub for node environment（profileStore 依赖 localStorage）
function installLocalStorage() {
  const store = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((k) => (k in store ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v); }),
    removeItem: vi.fn((k) => { delete store[k]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  });
}

// useSnapshotPreheat 内部用了 useEffect + useState，纯函数测试不易覆盖。
// 这里抽离纯逻辑做校验：状态机 + 触发条件判断。
// 真实的 hook 渲染行为依赖 @testing-library/react，项目无此依赖，故仅测状态机逻辑。

// 复刻 hook 内部"是否需要触发预热"的判定逻辑
function shouldTriggerPreheat({ enabled, llmConfig, dailyProfileSnapshots, today }) {
  if (!enabled || !llmConfig?.baseUrl) return false;
  const hasToday = (dailyProfileSnapshots || []).some(s => s?.date === today);
  return !hasToday;
}

describe('useSnapshotPreheat state machine', () => {
  const today = '2026-07-28';

  it('enabled=false 时不触发', () => {
    expect(shouldTriggerPreheat({
      enabled: false,
      llmConfig: { baseUrl: 'http://x' },
      dailyProfileSnapshots: [],
      today,
    })).toBe(false);
  });

  it('llmConfig.baseUrl 缺失时不触发', () => {
    expect(shouldTriggerPreheat({
      enabled: true,
      llmConfig: {},
      dailyProfileSnapshots: [],
      today,
    })).toBe(false);
  });

  it('今日已有快照时不触发（命中缓存）', () => {
    expect(shouldTriggerPreheat({
      enabled: true,
      llmConfig: { baseUrl: 'http://x' },
      dailyProfileSnapshots: [{ date: today }],
      today,
    })).toBe(false);
  });

  it('今日无快照且配置完整时触发', () => {
    expect(shouldTriggerPreheat({
      enabled: true,
      llmConfig: { baseUrl: 'http://x' },
      dailyProfileSnapshots: [],
      today,
    })).toBe(true);
  });

  it('快照存在但日期不同时仍触发', () => {
    expect(shouldTriggerPreheat({
      enabled: true,
      llmConfig: { baseUrl: 'http://x' },
      dailyProfileSnapshots: [{ date: '2026-07-27' }],
      today,
    })).toBe(true);
  });

  it('dailyProfileSnapshots 为 null 时不抛错（防御性）', () => {
    expect(() => shouldTriggerPreheat({
      enabled: true,
      llmConfig: { baseUrl: 'http://x' },
      dailyProfileSnapshots: null,
      today,
    })).not.toThrow();
  });
});

describe('useSnapshotPreheat module shape', () => {
  beforeEach(() => installLocalStorage());

  it('导出 useSnapshotPreheat 函数', async () => {
    const mod = await import('../useSnapshotPreheat.js');
    expect(typeof mod.useSnapshotPreheat).toBe('function');
  });
});
