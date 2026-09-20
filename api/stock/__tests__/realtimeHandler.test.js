import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../[action].js';

// 东方财富 stock/get 真实字段量级（raw 模式：price 是分需 ÷100，amount f48 已是元）
const EASTMONEY_QUOTE = {
  f43: 125712, f44: 128000, f45: 124000, f46: 125000, f47: 24891,
  f48: 3135849108, f57: '600519', f58: '贵州茅台', f60: 126698,
};

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function makeReq(query) {
  return { method: 'GET', query };
}

// behave: 'ok' 主源返回行情；'fail' 主源抛错（触发降级→缓存兜底）
function installFetch(behave) {
  const fn = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('push2.eastmoney.com/api/qt/stock/get')) {
      if (behave === 'fail') throw new Error('upstream down');
      return { json: async () => ({ data: EASTMONEY_QUOTE }) };
    }
    if (u.includes('gtimg.cn')) {
      // 腾讯降级源返回无法解析的行，parseTencentLine 返回 null（主报价仍可用）
      return { arrayBuffer: async () => new TextEncoder().encode('v_x="1~bad"').buffer };
    }
    return { json: async () => ({ data: null }) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stock realtime handler', () => {
  it('returns the quote for a normal realtime request', async () => {
    installFetch('ok');
    const res = makeRes();
    await handler(makeReq({ action: 'realtime', code: '600519' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBeUndefined();
    expect(res.body.price).toBeCloseTo(1257.12);
    expect(res.body.amount).toBe(3135849108);
  });

  it('recognizes prefetch=1 and returns a lightweight envelope', async () => {
    installFetch('ok');
    const res = makeRes();
    await handler(makeReq({ action: 'realtime', code: '600036', prefetch: '1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, prefetched: true });
  });

  it('falls back to cached stale quote when upstream fails (never 503 with cache)', async () => {
    installFetch('ok');
    const res1 = makeRes();
    await handler(makeReq({ action: 'realtime', code: '600519' }), res1);
    expect(res1.statusCode).toBe(200);

    // 让单标的缓存（REALTIME_TTL=2s）过期，确保下一次会真正触达上游而非命中缓存
    await new Promise((r) => setTimeout(r, 2200));
    installFetch('fail');
    const res2 = makeRes();
    await handler(makeReq({ action: 'realtime', code: '600519' }), res2);

    expect(res2.statusCode).toBe(200);
    expect(res2.body.stale).toBe(true);
    expect(res2.body.source).toBe('cache');
    expect(res2.body.price).toBeCloseTo(1257.12);
  }, 15000);

  it('still returns 503 when upstream fails and nothing is cached', async () => {
    installFetch('fail');
    const res = makeRes();
    await handler(makeReq({ action: 'realtime', code: '600999' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('MARKET_DATA_UNAVAILABLE');
  });
});
