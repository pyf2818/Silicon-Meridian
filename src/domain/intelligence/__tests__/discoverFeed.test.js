import { describe, it, expect } from 'vitest';
import {
  globalKeywordFrequencies,
  computeEngagement,
  freshnessDecay,
  discoverScore,
  buildDiscoverFeed,
} from '../discoverFeed.js';

const NOW = new Date('2026-09-03T20:00:00+08:00').getTime();

describe('globalKeywordFrequencies（全局热词，不依赖画像）', () => {
  it('统计词频并过滤停用词/过短词', () => {
    const freq = globalKeywordFrequencies([
      { title: 'Nvidia 发布新芯片 Nvidia', summary: '' },
      { title: 'Nvidia 财报超预期', summary: '' },
    ]);
    expect(freq['nvidia']).toBeGreaterThanOrEqual(3);
    expect(freq['the']).toBeUndefined();
  });
});

describe('computeEngagement（互动信号：点赞/评论/浏览量）', () => {
  it('评论权重高于点赞，浏览量对数压缩', () => {
    const likes = computeEngagement({ likes: 100 });
    const comments = computeEngagement({ comments: 100 });
    expect(comments.engagement).toBeGreaterThan(likes.engagement);

    const manyViews = computeEngagement({ views: 1_000_000 });
    const fewViews = computeEngagement({ views: 100 });
    expect(manyViews.engagement).toBeGreaterThan(fewViews.engagement);
    expect(manyViews.engagement - fewViews.engagement).toBeLessThan(10); // 对数压缩生效
  });

  it('字段缺失时为 0（RSS 源场景），不产生 NaN', () => {
    expect(computeEngagement({}).engagement).toBe(0);
    expect(computeEngagement({ likes: 'abc' }).engagement).toBe(0);
  });
});

describe('freshnessDecay（新鲜度）', () => {
  it('刚发布≈满分，超过半衰期大幅衰减', () => {
    expect(freshnessDecay(new Date(NOW - 600_000).toISOString(), NOW)).toBeGreaterThan(13);
    // 36h / 半衰期 18h = 2 个半衰期 → 15 × 0.25 = 3.75
    expect(freshnessDecay(new Date(NOW - 36 * 3600_000).toISOString(), NOW)).toBeCloseTo(3.75, 2);
    expect(freshnessDecay('bad-date', NOW)).toBe(0);
  });
});

describe('discoverScore（多信号热度）', () => {
  it('多源发酵条目显著高于孤条', () => {
    const base = { qualityScore: 20, publishedAt: new Date(NOW - 3600_000).toISOString() };
    const solo = discoverScore(base, { clusterSize: 1, keywordScore: 0, maxKeywordScore: 1, now: NOW });
    const hot = discoverScore(base, { clusterSize: 5, keywordScore: 10, maxKeywordScore: 10, now: NOW });
    expect(hot.score).toBeGreaterThan(solo.score + 15);
    expect(hot.parts.corroboration).toBe(24);
  });

  it('互动信号真实参与打分', () => {
    const base = { publishedAt: new Date(NOW - 3600_000).toISOString() };
    const plain = discoverScore(base, { now: NOW });
    const engaged = discoverScore({ ...base, likes: 50, comments: 30, views: 50_000 }, { now: NOW });
    expect(engaged.score).toBeGreaterThan(plain.score);
  });
});

describe('buildDiscoverFeed（大杂烩 + 领域打散 + 稳定序）', () => {
  const mk = (id, category, overrides = {}) => ({
    id,
    title: `头条 ${id}`,
    summary: '',
    source: `源-${id.slice(-1)}`,
    category,
    publishedAt: new Date(NOW - 3600_000).toISOString(),
    qualityScore: 30,
    ...overrides,
  });

  const clusters = [
    { itemIds: ['hot1', 'hot2', 'hot3'], independentSourceCount: 4 },
  ];

  it('多源发酵的热点排最前；产出 meta（条数/领域数/热词）', () => {
    const items = [
      mk('plain1', 'ai-models'),
      mk('hot1', 'ai-models'),
      mk('hot2', 'stock'),
      mk('hot3', 'policy-finance'),
      mk('plain2', 'stock'),
    ];
    const { feed, meta } = buildDiscoverFeed({ items, now: NOW, clusters });
    expect(['hot1', 'hot2', 'hot3']).toContain(feed[0].id);
    expect(meta.total).toBe(5);
    expect(meta.domainCount).toBe(3);
    expect(Array.isArray(meta.hotKeywords)).toBe(true);
  });

  it('领域打散：连续同领域 ≤2', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => mk(`ai${i}`, 'ai-models', { qualityScore: 30 + i })),
      ...Array.from({ length: 2 }, (_, i) => mk(`g${i}`, 'gaming', { qualityScore: 20 - i })),
    ];
    const { feed } = buildDiscoverFeed({ items, now: NOW });
    let run = 0;
    for (const item of feed) {
      if (item.category === 'ai-models') {
        run += 1;
        expect(run).toBeLessThanOrEqual(2);
      } else run = 0;
    }
  });

  it('画像零参与：相同输入下与个人分无关（personalScore 不影响序）', () => {
    const items = [
      mk('a', 'gaming', { personalScore: 100 }),
      mk('b', 'ai-models', { personalScore: 0, qualityScore: 40 }),
    ];
    const { feed } = buildDiscoverFeed({ items, now: NOW });
    // b 质量分更高 → 热度序在前；若画像泄漏，a 会反超
    expect(feed[0].id).toBe('b');
  });

  it('重复 id 去重；两批刷新下同 id 条目保持稳定相对次序（递进不抖动）', () => {
    const batch1 = [mk('a', 'ai-models'), mk('b', 'stock'), mk('c', 'gaming')];
    const batch2 = [...batch1, mk('d', 'policy-finance')];
    const r1 = buildDiscoverFeed({ items: batch1, now: NOW });
    const r2 = buildDiscoverFeed({ items: batch2, now: NOW });
    const order1 = r1.feed.map(i => i.id);
    const order2 = r2.feed.filter(i => order1.includes(i.id)).map(i => i.id);
    expect(order2).toEqual(order1);
    expect(r2.feed.length).toBe(4);
  });
});
