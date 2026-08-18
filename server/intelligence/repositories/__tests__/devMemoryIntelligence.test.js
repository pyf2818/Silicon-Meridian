import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createIntelligenceRepository } from '../../repositories/intelligenceRepository.js';
import { intelligenceEvents, intelligenceArticles } from '../../../db/devMemoryStore.js';

describe('intelligenceRepository - dev 内存兜底', () => {
  beforeEach(() => {
    process.env.DEV_MEMORY_AUTH = 'true';
    intelligenceEvents.clear();
    intelligenceArticles.clear();
  });
  afterEach(() => {
    delete process.env.DEV_MEMORY_AUTH;
  });

  it('DEV_MEMORY_AUTH=true 时返回内存实现（不触发 DATABASE_UNAVAILABLE）', () => {
    const repo = createIntelligenceRepository();
    expect(typeof repo.upsertArticlesAndEvents).toBe('function');
    expect(typeof repo.listEvents).toBe('function');
  });

  it('upsert 事件按 id 合并：articleIds/sources 并集、时间窗取极值', async () => {
    const repo = createIntelligenceRepository();
    await repo.upsertArticlesAndEvents({
      articles: [{ id: 'a1', title: 'T1', url: 'https://x.com/1', source: 'S1', publishedAt: '2026-08-18T01:00:00Z' }],
      events: [{
        id: 'ev-1',
        title: 'Event One',
        summary: 'first sighting',
        category: 'ai-models',
        articleIds: ['a1'],
        sources: ['S1'],
        independentSourceCount: 1,
        firstSeenAt: '2026-08-18T01:00:00Z',
        lastSeenAt: '2026-08-18T02:00:00Z',
        intelligenceScore: 60,
        confidence: 30,
      }],
    });
    await repo.upsertArticlesAndEvents({
      events: [{
        id: 'ev-1',
        title: 'Event One (updated)',
        summary: 'more coverage',
        category: 'ai-models',
        articleIds: ['a2'],
        sources: ['S2'],
        independentSourceCount: 2,
        firstSeenAt: '2026-08-18T03:00:00Z',
        lastSeenAt: '2026-08-18T05:00:00Z',
        intelligenceScore: 75,
        confidence: 55,
      }],
    });

    const events = await repo.listEvents({ limit: 10 });
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.title).toBe('Event One (updated)');
    expect(ev.articleIds.sort()).toEqual(['a1', 'a2']);
    expect(ev.sources.sort()).toEqual(['S1', 'S2']);
    expect(ev.firstSeenAt).toBe('2026-08-18T01:00:00Z'); // 取更早
    expect(ev.lastSeenAt).toBe('2026-08-18T05:00:00Z'); // 取更晚
    expect(ev.intelligenceScore).toBe(75); // 新值覆盖
  });

  it('listEvents 支持类别过滤 + date 过滤 + 分数排序', async () => {
    const repo = createIntelligenceRepository();
    await repo.upsertArticlesAndEvents({
      events: [
        { id: 'ev-low', title: 'Low', category: 'industry', articleIds: [], sources: ['A'], intelligenceScore: 30, lastSeenAt: '2026-08-17T10:00:00Z' },
        { id: 'ev-high', title: 'High', category: 'ai-models', articleIds: [], sources: ['B'], intelligenceScore: 90, lastSeenAt: '2026-08-18T10:00:00Z' },
        { id: 'ev-mid', title: 'Mid', category: 'ai-models', articleIds: [], sources: ['C'], intelligenceScore: 50, lastSeenAt: '2026-08-18T12:00:00Z' },
      ],
    });

    const all = await repo.listEvents({ limit: 10 });
    expect(all.map(e => e.id)).toEqual(['ev-high', 'ev-mid', 'ev-low']);

    const filtered = await repo.listEvents({ limit: 10, category: 'ai-models' });
    expect(filtered.map(e => e.id)).toEqual(['ev-high', 'ev-mid']);

    const byDate = await repo.listEvents({ limit: 10, date: '2026-08-18' });
    expect(byDate.map(e => e.id)).toEqual(['ev-high', 'ev-mid']);
  });

  it('articles 按 id 覆盖更新，listArticles 按发布时间倒序', async () => {
    const repo = createIntelligenceRepository();
    await repo.upsertArticlesAndEvents({
      articles: [
        { id: 'a-old', title: 'Old', url: 'https://x.com/old', source: 'S', publishedAt: '2026-08-16T00:00:00Z' },
        { id: 'a-new', title: 'New', url: 'https://x.com/new', source: 'S', publishedAt: '2026-08-18T00:00:00Z' },
      ],
    });
    await repo.upsertArticlesAndEvents({
      articles: [{ id: 'a-old', title: 'Old v2', url: 'https://x.com/old', source: 'S', publishedAt: '2026-08-16T00:00:00Z' }],
    });

    const articles = await repo.listArticles({ limit: 10 });
    expect(articles).toHaveLength(2);
    expect(articles[0].id).toBe('a-new');
    expect(articles.find(a => a.id === 'a-old').title).toBe('Old v2');
  });
});
