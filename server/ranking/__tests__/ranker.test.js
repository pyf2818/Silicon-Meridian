import { describe, expect, it } from 'vitest';
import { LANES, POLICY_VERSION, policyFor, validatePolicy } from '../policy.js';
import { RANKER_VERSION, compareOrders, rankItem, rankItems } from '../ranker.js';

const NOW = Date.parse('2026-09-17T00:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3_600_000).toISOString();

/** 构造一条资讯：所有信号字段显式可调，方便按象限做断言 */
function makeItem(overrides = {}) {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    title: 'OpenAI 发布新一代推理模型',
    summary: '官方博客给出基准数据，覆盖数学推理与代码生成任务。',
    bodyIntro: '官方博客给出基准数据，覆盖数学推理与代码生成任务。',
    source: 'Test Source',
    publishedAt: hoursAgo(1),
    publishedAtEstimated: false,
    fetchedAt: hoursAgo(0.5),
    sourceWeight: 1,
    crossVerifyScore: 1,
    independentSourceCount: 1,
    ...overrides,
  };
}

describe('policy（防信息茧房硬红线）', () => {
  it('两个 lane 都通过事件价值红线', () => {
    for (const lane of ['public', 'personal']) {
      expect(validatePolicy(policyFor(lane))).toBe(true);
    }
  });

  it('public lane 不含画像信号；personal lane 含', () => {
    expect(policyFor('public').affinity).toBe(0);
    expect(policyFor('personal').affinity).toBeGreaterThan(0);
    expect(POLICY_VERSION).toBe(1);
  });
});

describe('ranker 基础契约', () => {
  it('确定性：同输入同输出（排序完全可复现）', () => {
    const items = [makeItem(), makeItem({ publishedAt: hoursAgo(5), independentSourceCount: 3 }), makeItem({ publishedAt: hoursAgo(30) })];
    const first = rankItems(items, { lane: 'public', now: NOW });
    const second = rankItems(items, { lane: 'public', now: NOW });
    expect(first.map(i => i.rankScore)).toEqual(second.map(i => i.rankScore));
    expect(first.map(i => i.id)).toEqual(second.map(i => i.id));
  });

  it('分数永远是有限数，且带可解释 parts', () => {
    const weird = [makeItem(), { publishedAt: null }, {}, makeItem({ title: '突发！！震惊' })];
    for (const item of rankItems(weird, { lane: 'public', now: NOW })) {
      expect(Number.isFinite(item.rankScore)).toBe(true);
      expect(item.rankScore).toBeGreaterThanOrEqual(0);
      expect(item.rankScore).toBeLessThanOrEqual(100);
      expect(item.rankParts.length).toBeGreaterThan(0);
      for (const part of item.rankParts) expect(part.reason).toBeTruthy();
    }
  });

  it('confidence=0 的信号按公式退出：score = 100 × Σ(w·v·c) / Σ(w·c)', () => {
    const bare = { id: 'x', source: 'S' };   // 无时间/无画像/无行为/无摘要
    const ranked = rankItem(bare, { lane: 'public', now: NOW });
    // 用 parts 里的数据复算打分公式，断言内核如实执行（conf=0 的项对分子分母都无贡献）
    let num = 0;
    let den = 0;
    for (const part of ranked.rankParts) {
      num += part.weight * part.value * part.confidence;
      den += part.weight * part.confidence;
    }
    const expected = den > 0 ? Math.round((100 * num) / den) : 0;
    expect(ranked.rankScore).toBe(expected);
    expect(Number.isFinite(ranked.rankScore)).toBe(true);
  });

  it('lane 差异：public 不出画像分，personal 出', () => {
    const item = makeItem({ personalScore: 100 });
    expect(rankItem(item, { lane: 'public', now: NOW }).rankParts.some(p => p.id === 'affinity')).toBe(false);
    expect(rankItem(item, { lane: 'personal', now: NOW, hasProfile: true }).rankParts.some(p => p.id === 'affinity')).toBe(true);
  });

  it('rankItems 不改入参数组', () => {
    const items = [makeItem(), makeItem({ publishedAt: hoursAgo(40) })];
    const snapshot = JSON.stringify(items);
    rankItems(items, { lane: 'public', now: NOW });
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('golden set —— 四象限回归护栏', () => {
  it('【真】同期条目里，多独立来源压过单源', () => {
    const solo = makeItem({ id: 'solo', independentSourceCount: 1, crossVerifyScore: 1 });
    const multi = makeItem({ id: 'multi', independentSourceCount: 4, crossVerifyScore: 3 });
    const ranked = rankItems([solo, multi], { lane: 'public', now: NOW });
    expect(ranked[0].id).toBe('multi');
  });

  it('【新 vs 真】独家新文不该输给 3 天前的多源转载（独家惩罚修复）', () => {
    const scoop = makeItem({ id: 'scoop', publishedAt: hoursAgo(0.5), independentSourceCount: 1, crossVerifyScore: 1, sourceWeight: 1 });
    const repost = makeItem({ id: 'repost', publishedAt: hoursAgo(72), independentSourceCount: 3, crossVerifyScore: 2, sourceWeight: 0.85 });
    const ranked = rankItems([repost, scoop], { lane: 'public', now: NOW });
    expect(ranked[0].id).toBe('scoop');
  });

  it('【热】1 小时扩散到 3 源的事件，压过同样信息但无聚类的条目', () => {
    const hot = makeItem({ id: 'hot' });
    const plain = makeItem({ id: 'plain' });
    const cluster = { independentSourceCount: 3, firstSeenAt: hoursAgo(1) };
    const ranked = rankItems([plain, hot], { lane: 'public', now: NOW, clusterFor: undefined });
    // velocity 只对传入 cluster 的条目生效：逐条打分对比
    const hotScore = rankItem(hot, { lane: 'public', now: NOW, cluster }).rankScore;
    const plainScore = rankItem(plain, { lane: 'public', now: NOW }).rankScore;
    expect(hotScore).toBeGreaterThan(plainScore);
    expect(ranked.length).toBe(2);
  });

  it('【净】估计时间的条目仍然参与排序，但被如实标注（conf 减半）', () => {
    const estimated = makeItem({ id: 'est', publishedAt: null, publishedAtEstimated: true, fetchedAt: hoursAgo(1) });
    const ranked = rankItem(estimated, { lane: 'public', now: NOW });
    const freshness = ranked.rankParts.find(p => p.id === 'freshness');
    expect(freshness.confidence).toBe(0.5);
    expect(ranked.rankScore).toBeGreaterThan(0);   // 不被丢弃
  });

  it('【净】标题党被降分但不消失', () => {
    const clean = makeItem({ id: 'clean' });
    const spam = makeItem({ id: 'spam', title: '突发！！震惊：大模型完了' });
    const scores = Object.fromEntries(rankItems([clean, spam], { lane: 'public', now: NOW }).map(i => [i.id, i.rankScore]));
    expect(scores.spam).toBeLessThan(scores.clean);
    expect(scores.spam).toBeGreaterThan(0);
  });

  it('【行为】收藏的条目获得加权（personal lane）', () => {
    const item = makeItem({ id: 'fav' });
    const without = rankItem(item, { lane: 'personal', now: NOW, hasProfile: true }).rankScore;
    const withFav = rankItem(item, { lane: 'personal', now: NOW, hasProfile: true, feedback: { fav: 'favorited' } }).rankScore;
    expect(withFav).toBeGreaterThan(without);
  });
});

describe('compareOrders（影子模式报表）', () => {
  it('计算 TOP-N 重合度与升降级', () => {
    const legacy = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    const next = [makeItem({ id: 'c' }), makeItem({ id: 'a' }), makeItem({ id: 'b' })].map(i => ({ ...i, rankScore: 80 }));
    const shadow = compareOrders(legacy, next, { topN: 2 });
    expect(shadow.overlapCount).toBe(1);   // 只有 c 同时在两个 TOP-2
    expect(shadow.promoted.length).toBeGreaterThan(0);
  });
});

describe('版本与默认行为', () => {
  it('ranker 版本号显式可追踪', () => {
    expect(RANKER_VERSION).toBe('ranker-v2.1');
    const ranked = rankItem(makeItem(), { now: NOW });
    expect(ranked.rankVersion).toBe(RANKER_VERSION);
    expect(ranked.policyVersion).toBe(POLICY_VERSION);
  });
});
