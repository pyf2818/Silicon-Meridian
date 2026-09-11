import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractQuery, toVerification, verifyEventsWithGdelt,
  __resetGdeltForTests,
} from '../gdeltService.js';

const event = (over = {}) => ({
  id: 'ev-1',
  title: 'OpenAI releases new reasoning model',
  intelligenceScore: 90,
  ...over,
});

function gdeltPayload(domains) {
  return {
    articles: domains.map((domain, index) => ({
      url: `https://${domain}/story-${index}`,
      title: `OpenAI reasoning model coverage ${index}`,
      domain,
      seendate: '20260909T120000Z',
    })),
  };
}

beforeEach(() => {
  __resetGdeltForTests(0); // 测试零节流
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetGdeltForTests();
});

describe('GDELT 交叉验证层（Batch3）', () => {
  it('extractQuery：去停用词取前 3 词', () => {
    // the/new/update/for 均为停用词 → openai/releases/developers/worldwide 取前 3
    expect(extractQuery(event({ title: 'The new OpenAI releases update for developers worldwide' })))
      .toBe('openai releases developers');
    expect(extractQuery(event({ title: 'Nvidia quarterly earnings beat expectations massively today' })))
      .toBe('nvidia quarterly earnings');
  });

  it('extractQuery：空标题返回空串', () => {
    expect(extractQuery(event({ title: '' }))).toBe('');
    expect(extractQuery(null)).toBe('');
  });

  it('toVerification：域名数映射等级，<2 视为无佐证', () => {
    const checkedAt = '2026-09-09T12:00:00Z';
    const arts = (domains) => gdeltPayload(domains).articles;
    expect(toVerification(arts(['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'bbc.com']), checkedAt))
      .toMatchObject({ distinctDomains: 5, level: 'strong', provider: 'gdelt' });
    expect(toVerification(arts(['reuters.com', 'bloomberg.com']), checkedAt))
      .toMatchObject({ distinctDomains: 2, level: 'partial' });
    expect(toVerification(arts(['reuters.com']), checkedAt)).toBeNull();
    expect(toVerification([], checkedAt)).toBeNull();
    const strong = toVerification(arts(['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com']), checkedAt);
    expect(strong.samples.length).toBe(3);
    expect(strong.samples[0]).toHaveProperty('domain', 'a.com');
  });

  it('端到端：事件按 GDELT 独立域名数挂 verification', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => gdeltPayload(['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'bbc.com']),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const verifications = await verifyEventsWithGdelt([event()], { cap: 1, force: true });
    expect(verifications.size).toBe(1);
    expect(verifications.get('ev-1').level).toBe('strong');
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('api.gdeltproject.org/api/v2/doc/doc');
    expect(calledUrl).toContain(encodeURIComponent('openai releases reasoning'));
    expect(calledUrl).toContain('timespan=3d');
  });

  it('GDELT 佐证不足（<2 域名）不挂 verification 字段', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => gdeltPayload(['reuters.com']),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const verifications = await verifyEventsWithGdelt([event()], { cap: 1, force: true });
    expect(verifications.size).toBe(0);
  });

  it('GDELT 故障（非 JSON/HTTP 错误）静默返回空 Map', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const verifications = await verifyEventsWithGdelt(
      [event({ id: 'ev-a', title: 'Anthropic enterprise push' }), event({ id: 'ev-b', title: 'Nvidia quarterly earnings' })],
      { cap: 2, force: true },
    );
    expect(verifications.size).toBe(0);
  });

  it('单轮上限 cap：只查询头部 N 个候选', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => gdeltPayload(['reuters.com', 'bloomberg.com']),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const events = ['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota', 'kappa lambda mu']
      .map((title, index) => event({ id: `ev-${index}`, title: `Prefix ${title} coverage` }));
    await verifyEventsWithGdelt(events, { cap: 2, force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('缓存命中：相同查询只发一次请求', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => gdeltPayload(['reuters.com', 'bloomberg.com']),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const title = 'Same query twice event title';
    await verifyEventsWithGdelt([event({ id: 'ev-x', title })], { cap: 1, force: true });
    await verifyEventsWithGdelt([event({ id: 'ev-y', title })], { cap: 1, force: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('中文事件（非拉丁主导）直接跳过，不消耗限速配额', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const verifications = await verifyEventsWithGdelt(
      [event({ id: 'ev-cn', title: '华为发布最新人工智能芯片引发全球关注讨论' })],
      { cap: 1, force: true },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(verifications.size).toBe(0);
  });

  it('VITEST 环境默认跳过（无 force 不发网络请求）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const verifications = await verifyEventsWithGdelt([event()], { cap: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(verifications.size).toBe(0);
  });
});
