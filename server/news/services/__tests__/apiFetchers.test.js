import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchApiSource } from '../apiFetchers.js';

const ghSource = {
  name: 'GitHub Releases · PyTorch',
  type: 'api',
  url: 'https://api.github.com/repos/pytorch/pytorch/releases',
  api: { kind: 'github-releases', repo: 'pytorch/pytorch' },
  region: 'global',
  defaultCategory: 'open-source',
};

const hfSource = {
  name: 'HF 新模型速递',
  type: 'api',
  url: 'https://huggingface.co/api/models',
  api: { kind: 'hf-models', filter: 'text-generation', limit: 20 },
  region: 'global',
  defaultCategory: 'ai-models',
};

const arxivSource = {
  name: 'arXiv Agent 研究',
  type: 'api',
  url: 'https://export.arxiv.org/api/query',
  api: { kind: 'arxiv', search: 'cat:cs.AI AND abs:"agent"', maxResults: 15 },
  region: 'global',
  defaultCategory: 'research',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFetchOnce(payload, { ok = true, status = 200, raw = false } = {}) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => (raw ? payload : JSON.stringify(payload)),
  }));
}

describe('apiFetchers（Batch2 生产端 API 源）', () => {
  it('github-releases：归一化 item，过滤 draft，空 name 回退 tag_name', async () => {
    const releases = [
      { name: 'PyTorch 2.6', tag_name: 'v2.6.0', html_url: 'https://github.com/pytorch/pytorch/releases/tag/v2.6.0', body: 'Release notes **here**', published_at: '2026-09-01T00:00:00Z', draft: false },
      { name: null, tag_name: 'v2.5.1', html_url: 'https://github.com/pytorch/pytorch/releases/tag/v2.5.1', body: '', published_at: '2026-08-20T00:00:00Z', draft: false },
      { name: 'draft 内部版', tag_name: 'v2.7.0-rc', html_url: 'https://github.com/pytorch/pytorch/releases/tag/v2.7.0-rc', draft: true },
    ];
    const fetchMock = mockFetchOnce(releases);
    vi.stubGlobal('fetch', fetchMock);
    const { items } = await fetchApiSource(ghSource);
    expect(items.length).toBe(2);
    expect(items[0].title).toBe('PyTorch 2.6');
    expect(items[0].url).toContain('/tag/v2.6.0');
    expect(items[0].source).toBe(ghSource.name);
    expect(items[0].publishedAt).toBeTruthy();
    expect(items[0].summary).toContain('Release notes');
    expect(items[1].title).toBe('v2.5.1');
  });

  it('github-releases：请求带 UA，GITHUB_TOKEN 存在时注入 Authorization', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'gh_test_token');
    const fetchMock = mockFetchOnce([]);
    vi.stubGlobal('fetch', fetchMock);
    await fetchApiSource(ghSource);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['User-Agent']).toBeTruthy();
    expect(opts.headers.Authorization).toBe('Bearer gh_test_token');
  });

  it('github-releases：非法 repo 参数直接抛错且不发起请求', async () => {
    const bad = { ...ghSource, api: { kind: 'github-releases', repo: 'a/b?inject=1' } };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchApiSource(bad)).rejects.toThrow(/invalid github repo/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hf-models：modelId → 官方页 URL，摘要拼接/downloads/likes', async () => {
    const models = [
      { modelId: 'org/model-a', pipeline_tag: 'text-generation', downloads: 1234, likes: 56, createdAt: '2026-09-08T10:00:00.000Z' },
      { modelId: 'org/model-b', pipeline_tag: null, downloads: null, likes: null, createdAt: null },
    ];
    const fetchMock = mockFetchOnce(models);
    vi.stubGlobal('fetch', fetchMock);
    const { items } = await fetchApiSource(hfSource);
    expect(items.length).toBe(2);
    expect(items[0].url).toBe('https://huggingface.co/org/model-a');
    expect(items[0].summary).toContain('1234 downloads');
    expect(items[0].summary).toContain('56 likes');
    expect(items[0].publishedAt).toBeTruthy();
    expect(items[1].summary).toContain('暂无摘要'); // trimSummary 对空摘要填占位文案（与 RSS 行为一致）
    // normalizeDate 对空值回退为当前时间（全局既有契约：缺日期按「刚发布」处理）
    expect(new Date(items[1].publishedAt).toString()).not.toBe('Invalid Date');
  });

  it('arxiv：search 参数编码进请求 URL，Atom 复用 parseFeed 归一化', async () => {
    const atom = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      '<entry><title>Agent Paper A</title><link href="https://arxiv.org/abs/2609.00001" rel="alternate" type="text/html"/><published>2026-09-08T00:00:00Z</published><summary>We study agents.</summary></entry>',
      '<entry><title>Agent Paper B</title><link href="https://arxiv.org/abs/2609.00002"/><published>2026-09-07T00:00:00Z</published><summary>More agents.</summary></entry>',
      '</feed>',
    ].join('');
    const fetchMock = mockFetchOnce(atom, { raw: true });
    vi.stubGlobal('fetch', fetchMock);
    const { items } = await fetchApiSource(arxivSource);
    expect(items.length).toBe(2);
    expect(items[0].url).toBe('https://arxiv.org/abs/2609.00001');
    expect(items[0].title).toBe('Agent Paper A');
    expect(items[0].source).toBe(arxivSource.name);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain(`search_query=${encodeURIComponent('cat:cs.AI AND abs:"agent"')}`);
    expect(calledUrl).toContain('sortBy=submittedDate');
  });

  it('未知 kind 抛错', async () => {
    await expect(fetchApiSource({ name: 'x', api: { kind: 'nope' } })).rejects.toThrow(/unsupported api kind/);
  });

  it('HTTP 非 2xx 抛错且带状态码（走调度退避）', async () => {
    const fetchMock = mockFetchOnce({}, { ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchApiSource(ghSource)).rejects.toThrow(/403/);
  });

  it('空 releases 返回空 items（算成功，不触发退避）', async () => {
    const fetchMock = mockFetchOnce([]);
    vi.stubGlobal('fetch', fetchMock);
    const { items } = await fetchApiSource(ghSource);
    expect(items).toEqual([]);
  });
});
