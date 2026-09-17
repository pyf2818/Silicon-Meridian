import { describe, expect, it, vi } from 'vitest';

describe('serverless news contract', () => {
  it('keeps pagination and filtering inputs bounded', async () => {
    const mod = await import('../news.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn(), end: vi.fn() };
    await mod.default({ query: { page: '-1', pageSize: '40' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('counts fulfilled source failures in failedSources', async () => {
    const mod = await import('../news.js');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error('upstream down'); });
    try {
      const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
      await mod.default({ query: { page: '0', pageSize: '1', blocked: 'never-match-test' } }, res);
      expect(res.body.failedSources).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes official API sources in the serverless collection path', async () => {
    const mod = await import('../news.js');
    const originalFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = vi.fn(async url => {
      urls.push(String(url));
      throw new Error('offline');
    });
    try {
      const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
      await mod.default({ query: { page: '0', pageSize: '1' } }, res);
      expect(urls.some(url => url.includes('api.github.com') || url.includes('huggingface.co/api') || url.includes('export.arxiv.org'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('limits serverless source concurrency', async () => {
    const mod = await import('../news.js');
    const originalFetch = globalThis.fetch;
    let running = 0;
    let peak = 0;
    globalThis.fetch = vi.fn(async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 2));
      running -= 1;
      throw new Error('offline');
    });
    try {
      await mod.default({ query: { page: '0', pageSize: '1', blocked: 'never-match-concurrency' } }, { setHeader() {}, end() {} });
      expect(peak).toBeLessThanOrEqual(12);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('does not crash when a cached legacy item has non-array tags', async () => {
    const mod = await import('../news.js');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('<rss><item><title>Legacy</title><link>https://example.com/legacy</link></item></rss>'));
    try {
      const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
      await mod.default({ query: { page: '0', pageSize: '1', blocked: 'legacy-no-match' } }, res);
      expect(res.body).toHaveProperty('items');
    } finally { globalThis.fetch = originalFetch; }
  });

  /**
   * 回归：缓存命中分支曾只覆盖 items/total/page/pageSize/blockedCount，
   * 却没重算 hasMore，而写入缓存时 hasMore 被钉死成 false →
   * 只要命中缓存，第 2 页就告诉前端「没有更多」，App.jsx 的后台逐批拉取（while(hasMore)）随即中断。
   */
  describe('缓存命中路径的连续翻页', () => {
    const feed = `<rss><channel>${Array.from({ length: 3 }, (_, i) =>
      `<item><title>Contract title ${i}</title><link>https://example.com/contract-${i}</link><description>desc ${i}</description></item>`,
    ).join('')}</channel></rss>`;

    async function withFeed(run) {
      // api/news.js 的 cache 是模块级状态：不重置会被前面用例（无 blocked 的请求）写进空缓存，
      // 导致这里的第一次请求直接命中缓存、根本没走采集路径。
      vi.resetModules();
      const mod = await import('../news.js');
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response(feed));
      const call = async query => {
        const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
        await mod.default({ query }, res);
        return res.body;
      };
      try { return await run(call, mod); } finally { globalThis.fetch = originalFetch; }
    }

    it('keeps hasMore truthful when the response comes from cache', async () => {
      await withFeed(async call => {
        const first = await call({ page: '0', pageSize: '2' });   // 未命中 → 采集并写缓存
        const second = await call({ page: '1', pageSize: '2' });  // 命中缓存
        const third = await call({ page: '2', pageSize: '2' });   // 命中缓存

        expect(first.total).toBeGreaterThan(4);
        expect(first.hasMore).toBe(true);
        // 命中缓存时 hasMore 必须由 total/page/pageSize 现算，而不是透出缓存里的旧值
        expect(second.hasMore).toBe(1 * 2 + second.items.length < second.total);
        expect(second.hasMore).toBe(true);
        expect(third.hasMore).toBe(true);
        expect(second.items[0]).not.toEqual(first.items[0]); // 确实是下一页，不是重复第 0 页
      });
    });

    it('reports hasMore=false past the last page even on the cached path', async () => {
      await withFeed(async call => {
        const first = await call({ page: '0', pageSize: '2' });
        const beyond = await call({ page: String(Math.ceil(first.total / 2) + 5), pageSize: '2' });
        expect(beyond.items).toHaveLength(0);
        expect(beyond.hasMore).toBe(false);
      });
    });

    it('keeps blockedCount independent from pagination', async () => {
      await withFeed(async call => {
        const blockedQuery = word => ({ pageSize: '2', blocked: word });
        const page0 = await call({ ...blockedQuery('Contract title 0'), page: '0' });
        const page1 = await call({ ...blockedQuery('Contract title 0'), page: '1' });
        // 越界页：旧实现在这里会把 blockedCount 算成「未被分页切掉的条数」
        const pageBeyond = await call({ ...blockedQuery('Contract title 0'), page: '900' });

        expect(page0.blockedCount).toBeGreaterThan(0);
        expect(page0.total).toBeGreaterThan(0);
        // total 与 blockedCount 都不该随 page 变化
        expect(page1.total).toBe(page0.total);
        expect(page1.blockedCount).toBe(page0.blockedCount);
        expect(pageBeyond.items).toHaveLength(0);
        expect(pageBeyond.blockedCount).toBe(page0.blockedCount);
        // 二者之和 = 屏蔽词判定前的总条数，跨页恒定
        expect(page0.total + page0.blockedCount).toBe(pageBeyond.total + pageBeyond.blockedCount);
      });
    });
  });
});
