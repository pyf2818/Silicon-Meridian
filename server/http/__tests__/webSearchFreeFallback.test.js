/**
 * server/http/__tests__/webSearchFreeFallback.test.js
 * 免费源兜底（HN Algolia + Bing RSS）单元测试
 */
import { describe, it, expect } from 'vitest';
import { callFreeFallback, callHackerNews, callBingRss } from '../webSearchHandler.js';

describe('callHackerNews', () => {
  it('返回非空结果', async () => {
    const { provider, results } = await callHackerNews('vitest', 3);
    expect(provider).toBe('free-hn');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('title');
    expect(results[0]).toHaveProperty('url');
  });

  it('结果字段完整', async () => {
    const { results } = await callHackerNews('OpenAI', 2);
    for (const r of results) {
      expect(typeof r.title).toBe('string');
      expect(typeof r.url).toBe('string');
      expect(typeof r.snippet).toBe('string');
      expect(r.url.startsWith('http')).toBe(true);
    }
  });
});

describe('callBingRss', () => {
  it('返回非空结果', async () => {
    const { provider, results } = await callBingRss('vitest', 3);
    expect(provider).toBe('free-bing');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('title');
    expect(results[0]).toHaveProperty('url');
  });
});

describe('callFreeFallback', () => {
  it('任一源有结果即返回', async () => {
    const { provider, results } = await callFreeFallback('node.js', 3);
    expect(provider).toMatch(/^free-(hn|bing)$/);
    expect(results.length).toBeGreaterThan(0);
  });

  it('返回结果带结构化字段', async () => {
    const { results } = await callFreeFallback('OpenAI', 2);
    expect(results[0]).toMatchObject({
      title: expect.any(String),
      url: expect.any(String),
      snippet: expect.any(String),
    });
  });
});
