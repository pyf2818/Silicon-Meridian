import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKline, parseListItem, parseMarketPoolItem, resolveSecid, searchStock } from '../stockService.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stockService quote normalization', () => {
  it('keeps fltt=2 batch quote values at their real scale', () => {
    const item = parseListItem({
      f1: 1,
      f2: 1287.51,
      f3: -1.57,
      f4: -20.49,
      f12: '600519',
      f14: '贵州茅台',
      f15: 1308,
      f16: 1283.24,
      f17: 1300,
      f18: 1308,
    }, ['1.600519']);

    expect(item).toMatchObject({
      secid: '1.600519',
      price: 1287.51,
      change: -20.49,
      changePct: -1.57,
      open: 1300,
      high: 1308,
      low: 1283.24,
      prevClose: 1308,
    });
  });

  it('resolves common A-share, Hong Kong, and US symbols', () => {
    expect(resolveSecid('sh600519')).toBe('1.600519');
    expect(resolveSecid('00700')).toBe('116.00700');
    expect(resolveSecid('AAPL')).toBe('105.AAPL');
  });

  it('normalizes dynamic A-share market-pool rows', () => {
    expect(parseMarketPoolItem({
      f2: 38.91, f3: 0.52, f4: 0.2, f5: 1234, f6: 567890,
      f12: '600036', f13: 1, f14: '招商银行', f15: 38.99,
      f16: 38.45, f17: 38.68, f18: 38.71,
    })).toMatchObject({
      secid: '1.600036', code: 'sh600036', name: '招商银行',
      price: 38.91, changePct: 0.52, amount: 567890,
    });
    expect(parseMarketPoolItem({ f12: 'invalid' })).toBeNull();
  });

  it('keeps different adjustment modes in separate K-line cache entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          code: '999999',
          name: '测试标的',
          klines: ['2026-07-22,10,11,12,9,1000,11000,3'],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getKline('1.999999', { period: '101', count: 20, adjust: '0' });
    await getKline('1.999999', { period: '101', count: 20, adjust: '1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('fqt=0');
    expect(fetchMock.mock.calls[1][0]).toContain('fqt=1');
  });
});

describe('stockService.searchStock', () => {
  // 回归：腾讯 smartbox 把中文名以 \uXXXX 字面转义形式塞进 v_hint，
  // searchStock 必须解码成真中文，否则前端显示"\u8d35\u5dde\u8305\u53f0"。
  it('decodes \\uXXXX-escaped Chinese names from Tencent smartbox', async () => {
    const fetchMock = vi.fn().mockImplementation((url) => {
      // 腾讯 smartbox：返回带转义中文名的 v_hint
      if (String(url).includes('smartbox.gtimg.cn')) {
        return Promise.resolve({ text: async () => 'v_hint="sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A"' });
      }
      // 东方财富：返回空结果集，避免干扰
      return Promise.resolve({ text: async () => 'callback({"QuotationCodeTable":{"Data":[]}})' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchStock('600519');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ secid: '1.600519', code: '600519', market: 'sh' });
    expect(results[0].name).toBe('贵州茅台');
    // 关键：不能是字面转义字符串
    expect(results[0].name).not.toContain('\\u');
  });

  it('passes through real Chinese names unchanged (EastMoney path)', async () => {
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (String(url).includes('smartbox.gtimg.cn')) {
        // 腾讯返回空（无匹配），让 EastMoney 兜底
        return Promise.resolve({ text: async () => 'v_hint=""' });
      }
      return Promise.resolve({
        text: async () => 'callback({"QuotationCodeTable":{"Data":[{"Code":"600519","Name":"贵州茅台","MktNum":"1"}]}})',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchStock('600519');
    expect(results[0].name).toBe('贵州茅台');
  });
});
