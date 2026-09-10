import { describe, it, expect } from 'vitest';
import {
  startOfLocalDay,
  decayWeight,
  computeBehaviorSignals,
  scorePrecisionItem,
  diversifyOrder,
  injectExploration,
  todayKeywordFrequencies,
  buildPrecisionFeed,
} from '../precisionFeed.js';

const NOW = new Date('2026-09-03T20:00:00+08:00').getTime();
const DAY_START = new Date('2026-09-03T00:00:00+08:00').getTime();

const scoredItem = (id, overrides = {}) => ({
  id,
  title: `资讯 ${id}`,
  summary: '',
  source: `源-${id.slice(-1)}`,
  category: 'ai-models',
  publishedAt: new Date(NOW - 3600_000).toISOString(),
  personalScore: 60,
  publicScore: 60,
  mustReadScore: 60,
  recommendationReasons: [],
  ...overrides,
});

describe('startOfLocalDay / decayWeight', () => {
  it('本地时区当天零点', () => {
    expect(startOfLocalDay(NOW)).toBe(DAY_START);
  });

  it('时间衰减：半衰期处权重≈0.5，超过后继续衰减，未来时间为 0', () => {
    const t = NOW - 48 * 3600_000;
    expect(decayWeight(t, NOW, 48)).toBeCloseTo(0.5, 5);
    // 48h / 半衰期 12h = 4 个半衰期 → 0.5^4 = 0.0625
    expect(decayWeight(t, NOW, 12)).toBeCloseTo(0.0625, 5);
    expect(decayWeight(NOW + 1000, NOW, 48)).toBe(0);
    expect(decayWeight('invalid', NOW)).toBe(0);
  });
});

describe('computeBehaviorSignals（时间衰减行为 + 负反馈）', () => {
  it('近期点击权重高于久远点击', () => {
    const s = computeBehaviorSignals({
      readingHistory: [
        { id: 'a', category: 'ai-models', readAt: new Date(NOW - 3600_000).toISOString() },
        { id: 'b', category: 'ai-models', readAt: new Date(NOW - 96 * 3600_000).toISOString() },
      ],
      now: NOW,
    });
    expect(s.categoryWeights['ai-models']).toBeGreaterThan(1);
    // 两条相加：近期(≈1) + 久远(≈0.06) → 大于 1 且远小于 2
    expect(s.categoryWeights['ai-models']).toBeLessThan(1.5);
  });

  it('hiddenIds / mutedSources / 负反馈事件进入惩罚', () => {
    const s = computeBehaviorSignals({
      readingHistory: [],
      feedback: { hiddenIds: ['x1'], mutedSources: { '坏源': 3 } },
      feedbackEvents: [{ type: 'less', category: 'showbiz', ts: NOW - 600_000 }],
      now: NOW,
    });
    expect(s.hiddenIds.has('x1')).toBe(true);
    expect(s.penaltySources['坏源']).toBeGreaterThanOrEqual(3);
    expect(s.penaltyCategories['showbiz']).toBeGreaterThan(0);
  });
});

describe('scorePrecisionItem', () => {
  const baseCtx = () => ({
    behaviorSignals: computeBehaviorSignals({ readingHistory: [], now: NOW }),
    focusCategories: new Set(['ai-models']),
    bookmarkIds: new Set(),
    clusterSize: 1,
    keywordFreq: 0,
    maxKeywordFreq: 1,
  });

  it('高分画像条目得分高于低分条目', () => {
    const ctx = baseCtx();
    const high = scorePrecisionItem(scoredItem('a', { personalScore: 90, publicScore: 90 }), ctx);
    const low = scorePrecisionItem(scoredItem('b', { personalScore: 20, publicScore: 20 }), ctx);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('关注领域内不是探索，领域外且无行为历史是探索', () => {
    const ctx = baseCtx();
    const focus = scorePrecisionItem(scoredItem('a'), ctx);
    expect(focus.isExploration).toBe(false);
    const outside = scorePrecisionItem(scoredItem('b', { category: 'showbiz' }), ctx);
    expect(outside.isExploration).toBe(true);
    expect(outside.reasons).toContain('探索：拓宽视野');
  });

  it('负反馈惩罚显著降分', () => {
    const signals = computeBehaviorSignals({
      readingHistory: [],
      feedbackEvents: [{ type: 'not-interested', category: 'ai-models', ts: NOW - 60_000 }],
      now: NOW,
    });
    const clean = scorePrecisionItem(scoredItem('a'), baseCtx());
    const penalized = scorePrecisionItem(scoredItem('b'), { ...baseCtx(), behaviorSignals: signals });
    expect(penalized.score).toBeLessThan(clean.score);
    expect(penalized.reasons).toContain('已按你的负反馈降权');
  });
});

describe('diversifyOrder（多样性打散）', () => {
  const mk = (id, category, source) => ({ id, category, source });

  it('连续同领域不超过 2（可打散时）', () => {
    const sorted = [
      mk('a', 'ai', 's1'), mk('b', 'ai', 's2'), mk('c', 'ai', 's3'),
      mk('d', 'stock', 's4'),
    ];
    const out = diversifyOrder(sorted, { maxConsecutiveCategory: 2, maxConsecutiveSource: 3 });
    // 前 3 条中不能有 3 条连续 ai
    const first3 = out.slice(0, 3);
    expect(first3.filter(i => i.category === 'ai').length).toBeLessThanOrEqual(2);
    expect(out.length).toBe(sorted.length); // 不丢条目
  });

  it('连续同信源不超过 3', () => {
    const sorted = [
      mk('a', 'ai', 's1'), mk('b', 'stock', 's1'), mk('c', 'hot', 's1'), mk('d', 'ai', 's1'),
      mk('e', 'stock', 's2'),
    ];
    const out = diversifyOrder(sorted, { maxConsecutiveCategory: 5, maxConsecutiveSource: 3 });
    let run = 0;
    let maxRun = 0;
    out.forEach(i => {
      if (i.source === 's1') { run += 1; maxRun = Math.max(maxRun, run); } else run = 0;
    });
    expect(maxRun).toBeLessThanOrEqual(3);
  });
});

describe('injectExploration（探索流量池）', () => {
  const focus = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}` }));
  const explore = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}` }));

  it('按节奏插入且占比封顶', () => {
    const out = injectExploration(focus, explore, { every: 6, capRatio: 0.2 });
    const exploreCount = out.filter(i => String(i.id).startsWith('e')).length;
    expect(exploreCount).toBe(Math.floor(12 * 0.2)); // 封顶 2 条
    // 第 7 个位置（索引 6）应是第一条探索
    expect(String(out[6].id).startsWith('e')).toBe(true);
  });

  it('探索池为空时返回原序列', () => {
    expect(injectExploration(focus, [])).toEqual(focus);
  });
});

describe('todayKeywordFrequencies', () => {
  it('统计词频并过滤过短英文词', () => {
    const freq = todayKeywordFrequencies([
      { title: 'OpenAI 发布新模型 OpenAI', summary: '' },
      { title: 'OpenAI 融资', summary: '' },
    ]);
    expect(freq['openai']).toBeGreaterThanOrEqual(3);
    expect(freq['of']).toBeUndefined();
  });
});

describe('buildPrecisionFeed（当日硬过滤 + 不限条数 + 探索注入 + 打散）', () => {
  const profile = {
    domainTiers: { 'ai-models': 'focus' },
    sourceTiers: {},
    selectedInterests: ['ai-models'],
    followKeywords: ['OpenAI'],
    specialFollows: [],
  };
  const behavior = { readingHistory: [], bookmarks: [], feedback: {}, feedbackEvents: [] };
  const clusters = [{ itemIds: ['a1', 'a2'], independentSourceCount: 2 }];

  const mk = (id, publishedAt, category = 'ai-models') => scoredItem(id, { publishedAt, category });

  it('只保留今天发布的内容，昨天/明天/无日期一律排除', () => {
    const items = [
      mk('today-1', new Date(NOW - 3600_000).toISOString()),
      mk('today-2', new Date(DAY_START + 60_000).toISOString()),
      mk('yesterday', new Date(DAY_START - 60_000).toISOString()),
      mk('tomorrow', new Date(NOW + 3600_000).toISOString()),
      mk('nodate', 'not-a-date'),
    ];
    const { feed, meta } = buildPrecisionFeed({ items, now: NOW, profile, behavior });
    expect(feed.map(i => i.id).sort()).toEqual(['today-1', 'today-2']);
    expect(meta.candidateCount).toBe(2);
    expect(meta.dayStart).toBe(DAY_START);
  });

  it('不限条数：当天 60 条全部产出', () => {
    const items = Array.from({ length: 60 }, (_, i) => mk(`t${i}`, new Date(NOW - (i + 1) * 60_000).toISOString()));
    const { feed, meta } = buildPrecisionFeed({ items, now: NOW, profile, behavior });
    expect(feed.length).toBe(60);
    expect(meta.total).toBe(60);
  });

  it('已读与 hiddenIds 被排除', () => {
    const items = [mk('a', new Date(NOW - 600_000).toISOString()), mk('b', new Date(NOW - 700_000).toISOString())];
    const { feed } = buildPrecisionFeed({
      items, now: NOW, profile,
      behavior: { readingHistory: [{ id: 'a', readAt: new Date().toISOString() }], bookmarks: [], feedback: { hiddenIds: ['b'] }, feedbackEvents: [] },
    });
    expect(feed.length).toBe(0);
  });

  it('探索条目被注入并带「探索：拓宽视野」标记', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => mk(`ai-${i}`, new Date(NOW - (i + 1) * 60_000).toISOString())),
      ...Array.from({ length: 5 }, (_, i) => mk(`biz-${i}`, new Date(NOW - (i + 1) * 120_000).toISOString(), 'policy-finance')),
    ];
    const { feed } = buildPrecisionFeed({ items, now: NOW, profile, behavior });
    const explorations = feed.filter(i => i.isExploration);
    expect(explorations.length).toBeGreaterThan(0);
    expect(explorations.length).toBeLessThanOrEqual(Math.floor(8 * 0.2));
    expect(feed.some(i => i.feedReasons.includes('探索：拓宽视野'))).toBe(true);
  });

  it('多源发酵信号提升簇内条目得分', () => {
    const solo = mk('solo', new Date(NOW - 600_000).toISOString());
    const inCluster = mk('a1', new Date(NOW - 600_000).toISOString());
    const { feed } = buildPrecisionFeed({
      items: [solo, inCluster], now: NOW, profile, behavior, clusters,
    });
    const a1 = feed.find(i => i.id === 'a1');
    const s = feed.find(i => i.id === 'solo');
    expect(a1.feedScore).toBeGreaterThan(s.feedScore);
  });
});

describe('buildPrecisionFeed 回填机制（v26.8：今日不足时补充近两天精华）', () => {
  const profile = {
    domainTiers: { 'ai-models': 'focus' },
    sourceTiers: {},
    selectedInterests: ['ai-models'],
    followKeywords: [],
    specialFollows: [],
  };
  const behavior = { readingHistory: [], bookmarks: [], feedback: {}, feedbackEvents: [] };
  const opts = { minFeedSize: 24, backfillWindowHours: 48, backfillCap: 60 };
  const mk = (id, publishedAt, category = 'ai-models') => scoredItem(id, { publishedAt, category });

  it('默认关闭：不传 minFeedSize 时昨日条目绝不出现（旧行为不变）', () => {
    const items = [
      mk('today', new Date(NOW - 3600_000).toISOString()),
      mk('yesterday', new Date(DAY_START - 3600_000).toISOString()),
    ];
    const { feed, meta } = buildPrecisionFeed({ items, now: NOW, profile, behavior });
    expect(feed.map(i => i.id)).toEqual(['today']);
    expect(meta.backfillCount).toBe(0);
  });

  it('今日不足 24 条时回填 48h 内昨日高分条目，带 isBackfill 标记与说明', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => mk(`t${i}`, new Date(NOW - (i + 1) * 600_000).toISOString())),
      ...Array.from({ length: 30 }, (_, i) => mk(`old-${i}`, new Date(DAY_START - (i + 1) * 900_000).toISOString())),
    ];
    const { feed, meta } = buildPrecisionFeed({ items, now: NOW, profile, behavior, options: opts });
    const backfills = feed.filter(i => i.isBackfill);
    expect(backfills.length).toBeGreaterThan(0);
    expect(meta.backfillCount).toBe(backfills.length);
    // 今日条目排在前、回填条目排在后
    expect(feed.slice(0, 5).every(i => !i.isBackfill)).toBe(true);
    expect(backfills[0].feedReasons[0]).toBe('今日更新不足，为你补充近两天精华');
    // 今日 5 条 + 回填补到 24
    expect(feed.length).toBe(24);
  });

  it('回填排除已读 / hiddenIds / 窗口外（72h 前）条目', () => {
    const items = [
      mk('today', new Date(NOW - 600_000).toISOString()),
      mk('yesterday-ok', new Date(DAY_START - 3600_000).toISOString()),
      mk('yesterday-read', new Date(DAY_START - 7200_000).toISOString()),
      mk('yesterday-hidden', new Date(DAY_START - 10800_000).toISOString()),
      mk('too-old', new Date(NOW - 72 * 3600_000).toISOString()),
    ];
    const { feed } = buildPrecisionFeed({
      items, now: NOW, profile,
      behavior: { readingHistory: [{ id: 'yesterday-read', readAt: new Date().toISOString() }], bookmarks: [], feedback: { hiddenIds: ['yesterday-hidden'] }, feedbackEvents: [] },
      options: { ...opts, minFeedSize: 5 },
    });
    const ids = feed.map(i => i.id);
    expect(ids).toContain('yesterday-ok');
    expect(ids).not.toContain('yesterday-read');
    expect(ids).not.toContain('yesterday-hidden');
    expect(ids).not.toContain('too-old');
    expect(ids).toContain('today');
  });

  it('backfillCap 封顶回填数量', () => {
    const items = [
      mk('today', new Date(NOW - 600_000).toISOString()),
      ...Array.from({ length: 100 }, (_, i) => mk(`old-${i}`, new Date(DAY_START - (i + 1) * 60_000).toISOString())),
    ];
    const { feed, meta } = buildPrecisionFeed({
      items, now: NOW, profile, behavior,
      options: { minFeedSize: 24, backfillWindowHours: 48, backfillCap: 10 },
    });
    expect(meta.backfillCount).toBe(10);
    expect(feed.length).toBe(11);
  });
});
