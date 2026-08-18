import { describe, expect, it } from 'vitest';
import {
  GRADE_INTERVALS_MS,
  createSourceState,
  intervalFor,
  nextDueAt,
  recordOutcome,
  pickDueSources,
  runWithConcurrency,
} from '../sourceScheduler.js';

const S_SOURCE = { name: 'OpenAI Blog' };
const A_SOURCE = { name: 'TechCrunch AI' };

describe('sourceScheduler - 等级间隔', () => {
  it('S 级间隔 15 分钟、D 级（未知源）间隔 6 小时', () => {
    expect(GRADE_INTERVALS_MS.S).toBe(15 * 60 * 1000);
    expect(intervalFor(S_SOURCE, createSourceState())).toBe(15 * 60 * 1000);
    // 未收录进 SOURCE_GRADE_MAP 的源默认 D 级
    expect(intervalFor({ name: '某未分级源' }, createSourceState())).toBe(6 * 60 * 60 * 1000);
  });

  it('nextDueAt = lastFetchedAt + interval，未抓取过立即到期（返回 0）', () => {
    const state = { ...createSourceState(), lastFetchedAt: 1_000 };
    expect(nextDueAt(S_SOURCE, state)).toBe(1_000 + 15 * 60 * 1000);
    expect(nextDueAt(S_SOURCE, createSourceState())).toBe(0);
  });
});

describe('sourceScheduler - 失败退避与降档', () => {
  it('失败指数退避：未降档前连续翻倍（2x/4x/8x）', () => {
    let state = createSourceState();
    state = recordOutcome(state, false, 0);
    expect(state.failCount).toBe(1);
    expect(intervalFor(S_SOURCE, state)).toBe(15 * 60 * 1000 * 2);
    state = recordOutcome(state, false, 1);
    state = recordOutcome(state, false, 2);
    expect(state.degradeSteps).toBe(0); // 前 3 次失败未触发降档
    expect(intervalFor(S_SOURCE, state)).toBe(15 * 60 * 1000 * 8);
  });

  it('退避与降档叠加后封顶：不超过 降档基准间隔 x 16', () => {
    let state = createSourceState();
    for (let i = 0; i < 20; i++) state = recordOutcome(state, false, i);
    // 降档封顶 2 档（S→B=60min），退避指数封顶 2^4 → 60min*16
    const capped = GRADE_INTERVALS_MS.B * 16;
    expect(intervalFor(S_SOURCE, state)).toBe(capped);
    const again = recordOutcome(state, false, 21);
    expect(intervalFor(S_SOURCE, again)).toBe(capped);
  });

  it('连续失败 4 次自动降一档（间隔变长），最多降 2 档', () => {
    let state = createSourceState();
    for (let i = 0; i < 4; i++) state = recordOutcome(state, false, i);
    expect(state.degradeSteps).toBe(1);
    // 用 failCount=0 的视角看基准间隔：S 降 1 档 = A 级
    expect(intervalFor(S_SOURCE, { ...state, failCount: 0 })).toBe(GRADE_INTERVALS_MS.A);
    for (let i = 0; i < 8; i++) state = recordOutcome(state, false, i);
    expect(state.degradeSteps).toBe(2);
    expect(intervalFor(S_SOURCE, { ...state, failCount: 0 })).toBe(GRADE_INTERVALS_MS.B);
    // 封顶：不再继续降
    for (let i = 0; i < 4; i++) state = recordOutcome(state, false, i);
    expect(state.degradeSteps).toBe(2);
  });

  it('成功后 failCount 清零、降档逐步恢复', () => {
    let state = createSourceState();
    for (let i = 0; i < 8; i++) state = recordOutcome(state, false, i);
    expect(state.degradeSteps).toBe(2);
    state = recordOutcome(state, true, 100);
    expect(state.failCount).toBe(0);
    expect(state.degradeSteps).toBe(1);
    expect(state.lastOkAt).toBe(100);
    state = recordOutcome(state, true, 200);
    expect(state.degradeSteps).toBe(0);
    expect(intervalFor(S_SOURCE, state)).toBe(GRADE_INTERVALS_MS.S);
  });
});

describe('sourceScheduler - 到期挑选', () => {
  it('冷启动全部到期，按等级优先排序（S 在 A 前）', () => {
    const states = new Map();
    const due = pickDueSources([A_SOURCE, S_SOURCE], states, 0);
    expect(due.map(s => s.name)).toEqual(['OpenAI Blog', 'TechCrunch AI']);
  });

  it('未到期的源不出现；到期时间由各自等级决定', () => {
    const now = 100 * 60 * 1000;
    const states = new Map([
      ['OpenAI Blog', { ...createSourceState(), lastFetchedAt: now - 14 * 60 * 1000 }], // S=15min，差 1 分钟到期
      ['TechCrunch AI', { ...createSourceState(), lastFetchedAt: now - 61 * 60 * 1000 }], // B=60min，已过期
    ]);
    const due = pickDueSources([S_SOURCE, A_SOURCE], states, now);
    expect(due.map(s => s.name)).toEqual(['TechCrunch AI']);
  });

  it('同等级时失败次数少的优先出队', () => {
    // now 取足够大：退避中的源（failCount=3 → 8 倍间隔）也全部到期，纯验证排序
    const now = 10 * 24 * 60 * 60 * 1000;
    const states = new Map([
      ['OpenAI Blog', { ...createSourceState(), failCount: 3, lastFetchedAt: 0 }],
      ['TechCrunch AI', { ...createSourceState(), failCount: 0, lastFetchedAt: 0 }],
    ]);
    const due = pickDueSources([S_SOURCE, A_SOURCE], states, now);
    expect(due.map(s => s.name)).toEqual(['OpenAI Blog', 'TechCrunch AI']);
    // 同为 S 级（OpenAI Blog 失败 3 次 vs Anthropic News 无失败）：失败少的优先
    const states2 = new Map([
      ['OpenAI Blog', { ...createSourceState(), failCount: 3, lastFetchedAt: 0 }],
      ['Anthropic News', { ...createSourceState(), failCount: 0, lastFetchedAt: 0 }],
    ]);
    const due2 = pickDueSources([S_SOURCE, { name: 'Anthropic News' }], states2, now);
    expect(due2.map(s => s.name)).toEqual(['Anthropic News', 'OpenAI Blog']);
    expect(states.get('OpenAI Blog').failCount).toBe(3);
  });
});

describe('sourceScheduler - 并发池', () => {
  it('全部任务执行、失败不中断其他任务', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, async n => {
      if (n === 3) throw new Error('boom');
      return n * 10;
    }, 2);
    expect(results.filter(r => r.status === 'fulfilled').map(r => r.value)).toEqual([10, 20, 40, 50]);
    expect(results.find(r => r.status === 'rejected').reason.message).toBe('boom');
  });

  it('空任务列表直接返回空数组', async () => {
    const results = await runWithConcurrency([], async () => {}, 4);
    expect(results).toEqual([]);
  });

  it('并发不超过上限', async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runWithConcurrency(items, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
    }, 5);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });
});
