import { describe, it, expect } from 'vitest';
import { computeNewsTrends, buildDayKeys } from '../trendAnalytics.js';

// 固定「今天」以保证时间窗断言稳定（避免依赖系统时钟）
const NOW = new Date('2026-09-10T15:00:00');

const item = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  category: 'ai',
  source: 'OpenAI Blog',
  tags: [],
  publishedAt: '2026-09-10T08:00:00Z',
  ...over,
});

describe('buildDayKeys', () => {
  it('生成含今天的升序日期键', () => {
    expect(buildDayKeys(3, NOW)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
  });

  it('跨月边界正确（不出现 2026-09-00）', () => {
    const keys = buildDayKeys(3, new Date('2026-10-02T10:00:00'));
    expect(keys).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('补零到两位', () => {
    expect(buildDayKeys(2, new Date('2026-01-05T10:00:00'))).toEqual(['2026-01-04', '2026-01-05']);
  });
});

describe('computeNewsTrends', () => {
  it('空/非法输入返回空结构而不抛异常', () => {
    for (const input of [[], null, undefined, 'nope']) {
      const r = computeNewsTrends(input, { now: NOW });
      expect(r.categoryStats).toEqual([]);
      expect(r.sourceStats).toEqual([]);
      expect(r.topKeywords).toEqual([]);
      expect(r.emergingKeywords).toEqual([]);
      expect(r.categorySeries).toEqual([]);
      expect(r.sourceSeries).toEqual([]);
      expect(r.dayLabels).toHaveLength(7);
    }
  });

  it('按赛道/来源聚合计数，并按数量降序', () => {
    const items = [
      item({ category: 'ai', source: 'A' }),
      item({ category: 'ai', source: 'B' }),
      item({ category: 'ai', source: 'A' }),
      item({ category: 'dev', source: 'C' }),
    ];
    const r = computeNewsTrends(items, { now: NOW });
    expect(r.categoryStats).toEqual([['ai', { count: 3, sources: new Set(['A', 'B']) }], ['dev', { count: 1, sources: new Set(['C']) }]]);
    expect(r.sourceStats[0]).toEqual(['A', { count: 2, categories: new Set(['ai']) }]);
  });

  it('categorySeries 只取前 3 名赛道，且只统计窗口内的条目', () => {
    // 5 个赛道，各 1 条；窗口内（今天）只有 ai 和 dev 有数据
    const items = [
      item({ category: 'ai', publishedAt: '2026-09-10T01:00:00Z' }),
      item({ category: 'dev', publishedAt: '2026-09-10T02:00:00Z' }),
      item({ category: 'chip', publishedAt: '2026-09-10T03:00:00Z' }),
      item({ category: 'web', publishedAt: '2026-09-10T04:00:00Z' }),
      item({ category: 'ops', publishedAt: '2026-09-10T05:00:00Z' }),
    ];
    const r = computeNewsTrends(items, { now: NOW });
    expect(r.categorySeries).toHaveLength(3); // 上限 3
    const aiSeries = r.categorySeries.find(s => s.id === 'ai');
    expect(aiSeries.values).toHaveLength(7);
    expect(aiSeries.values[6]).toBe(1); // 今天
    expect(aiSeries.values.slice(0, 6).every(v => v === 0)).toBe(true);
  });

  it('窗口外的旧条目不计入折线，但仍计入总量统计', () => {
    const items = [
      item({ category: 'ai', publishedAt: '2026-01-01T00:00:00Z' }), // 远早于窗口
      item({ category: 'ai', publishedAt: '2026-09-10T00:00:00Z' }),
    ];
    const r = computeNewsTrends(items, { now: NOW });
    expect(r.categoryStats[0][1].count).toBe(2); // 总量含旧条目
    const aiSeries = r.categorySeries.find(s => s.id === 'ai');
    expect(aiSeries.values.reduce((a, b) => a + b, 0)).toBe(1); // 折线只含窗口内
  });

  it('publishedAt 缺失时不会崩溃，且不计入折线', () => {
    const items = [item({ publishedAt: undefined }), item({ publishedAt: '2026-09-10T00:00:00Z' })];
    const r = computeNewsTrends(items, { now: NOW });
    expect(r.categoryStats[0][1].count).toBe(2);
    expect(r.categorySeries[0].values.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('关键词频率来自 tags，topKeywords 按频次降序且受上限约束', () => {
    const items = [
      item({ tags: ['gpu', 'llm'] }),
      item({ tags: ['gpu'] }),
      item({ tags: ['gpu', 'agent'] }),
      item({ tags: undefined }), // 无 tags 不应抛
    ];
    const r = computeNewsTrends(items, { now: NOW });
    expect(r.topKeywords[0]).toEqual(['gpu', 3]);
    expect(r.topKeywords.map(([k]) => k)).toEqual(['gpu', 'llm', 'agent']);

    const capped = computeNewsTrends(
      Array.from({ length: 40 }, (_, i) => item({ tags: [`t${i}`] })),
      { now: NOW, keywordLimit: 5 },
    );
    expect(capped.topKeywords).toHaveLength(5);
  });

  it('emergingKeywords 只出现在指定频次区间内', () => {
    // gpu 出现 4 次（3~8 → 命中）；hot 出现 9 次（超出 → 不命中）；rare 出现 1 次（不足 → 不命中）
    const tags = [...Array(4).fill('gpu'), ...Array(9).fill('hot'), 'rare'];
    const r = computeNewsTrends(tags.map(t => item({ tags: [t] })), { now: NOW });
    const emerging = r.emergingKeywords.map(([k]) => k);
    expect(emerging).toContain('gpu');
    expect(emerging).not.toContain('hot');
    expect(emerging).not.toContain('rare');
  });

  it('sourceSeries 只取前 3 名来源', () => {
    const items = ['A', 'B', 'C', 'D'].flatMap(s => [item({ source: s }), item({ source: s })]);
    const r = computeNewsTrends(items, { now: NOW });
    expect(r.sourceSeries).toHaveLength(3);
  });

  it('dayLabels 是 MM-DD 且与折线长度一致', () => {
    const r = computeNewsTrends([item()], { now: NOW });
    expect(r.dayLabels).toHaveLength(7);
    expect(r.dayLabels[6]).toBe('09-10');
    for (const s of r.categorySeries) expect(s.values).toHaveLength(r.dayLabels.length);
    for (const s of r.sourceSeries) expect(s.values).toHaveLength(r.dayLabels.length);
  });

  it('windowDays 可配置（折线与标签同步变长）', () => {
    const r = computeNewsTrends([item()], { now: NOW, windowDays: 30 });
    expect(r.dayLabels).toHaveLength(30);
    expect(r.categorySeries[0].values).toHaveLength(30);
  });
});
