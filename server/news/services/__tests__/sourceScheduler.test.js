import { describe, expect, it, beforeEach } from 'vitest';
import {
  GRADE_INTERVALS_MS,
  createSourceState,
  intervalFor,
  nextDueAt,
  recordOutcome,
  pickDueSources,
  runWithConcurrency,
  bumpSourceAffinity,
  affinityBoost,
  getSourceAffinitySnapshot,
  AFFINITY_HALF_LIFE_MS,
  AFFINITY_MIN_INTERVAL_MS,
  __resetAffinityForTests,
} from '../sourceScheduler.js';

const S_SOURCE = { name: 'OpenAI Blog' };
const A_SOURCE = { name: 'TechCrunch AI' };

beforeEach(() => {
  __resetAffinityForTests();
});

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

describe('sourceScheduler - 源亲和度（画像反哺采集）', () => {
  it('bump 去重累加、封顶 10 分；boost 分档 1x/1.5x/2x', () => {
    expect(affinityBoost('OpenAI Blog')).toBe(1);
    bumpSourceAffinity(['OpenAI Blog', 'OpenAI Blog']); // 同名去重 → +1
    expect(affinityBoost('OpenAI Blog')).toBe(1);
    bumpSourceAffinity(['OpenAI Blog']);
    expect(affinityBoost('OpenAI Blog')).toBe(1.5); // score 2
    bumpSourceAffinity(['OpenAI Blog']);
    bumpSourceAffinity(['OpenAI Blog']);
    expect(affinityBoost('OpenAI Blog')).toBe(2); // score 4
    for (let i = 0; i < 20; i++) bumpSourceAffinity(['OpenAI Blog']);
    const snap = getSourceAffinitySnapshot().find(s => s.name === 'OpenAI Blog');
    expect(snap.score).toBe(10); // 封顶
  });

  it('亲和度 24h 半衰期：隔 2 个半衰期衰减到 1/4，低于阈值清除', () => {
    const now = 1_000_000_000;
    bumpSourceAffinity(['OpenAI Blog'], now);
    bumpSourceAffinity(['OpenAI Blog'], now);
    bumpSourceAffinity(['OpenAI Blog'], now);
    bumpSourceAffinity(['OpenAI Blog'], now); // score 4
    expect(affinityBoost('OpenAI Blog', now + 2 * AFFINITY_HALF_LIFE_MS + 1)).toBe(1); // 4 * 0.25 = 1 → 无加速
    // 衰减到接近 0 → 条目被清除
    bumpSourceAffinity(['SomeSource'], now);
    const far = now + 10 * AFFINITY_HALF_LIFE_MS;
    affinityBoost('SomeSource', far);
    expect(getSourceAffinitySnapshot().find(s => s.name === 'SomeSource')).toBeUndefined();
  });

  it('亲和源轮询间隔最多缩短一半，但下限 5 分钟', () => {
    const now = 1_000_000_000;
    const plain = intervalFor(S_SOURCE, createSourceState(), now);
    expect(plain).toBe(GRADE_INTERVALS_MS.S);
    bumpSourceAffinity(['OpenAI Blog'], now);
    bumpSourceAffinity(['OpenAI Blog'], now);
    bumpSourceAffinity(['OpenAI Blog'], now);
    bumpSourceAffinity(['OpenAI Blog'], now); // boost 2x
    expect(intervalFor(S_SOURCE, createSourceState(), now)).toBe(GRADE_INTERVALS_MS.S / 2);
    // D 级源 6h，2x 加速 = 3h，仍远高于下限；无源能低于 5min
    bumpSourceAffinity(['某未分级源'], now);
    for (let i = 0; i < 10; i++) bumpSourceAffinity(['某未分级源'], now);
    expect(intervalFor({ name: '某未分级源' }, createSourceState(), now)).toBe(Math.max(AFFINITY_MIN_INTERVAL_MS, GRADE_INTERVALS_MS.D / 2));
    expect(intervalFor({ name: '某未分级源' }, createSourceState(), now)).toBeGreaterThanOrEqual(AFFINITY_MIN_INTERVAL_MS);
  });

  it('同级源到期时亲和度高的优先出队', () => {
    const now = 10 * 24 * 60 * 60 * 1000;
    bumpSourceAffinity(['Anthropic News'], now);
    const states = new Map([
      ['OpenAI Blog', { ...createSourceState(), lastFetchedAt: 1 }],
      ['Anthropic News', { ...createSourceState(), lastFetchedAt: 1 }],
    ]);
    const due = pickDueSources([S_SOURCE, { name: 'Anthropic News' }], states, now);
    expect(due.map(s => s.name)).toEqual(['Anthropic News', 'OpenAI Blog']);
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
