import { describe, expect, it } from 'vitest';
import {
  FUTURE_TOLERANCE_MS,
  compareByRecency,
  effectivePublishTime,
  isEstimatedPublishTime,
  isFutureDate,
  normalizeDate,
  sortByRecency,
} from '../dateUtils.js';

describe('normalizeDate —— 绝不伪造发布时间', () => {
  it('解析不出来就返回 null（历史 BUG：回退成「抓取时刻」）', () => {
    const before = Date.now();
    for (const bad of ['', '   ', null, undefined, 'not-a-date', 'Mon, 32 Xxx 9999']) {
      expect(normalizeDate(bad)).toBe(null);
    }
    // 反证：旧实现在这里会返回一个「现在」附近的时间戳，把旧文包装成刚发布
    const nowish = before + 60_000;
    expect(normalizeDate('')).toBe(null);
    expect(Date.now()).toBeLessThan(nowish);
  });

  it('正常解析 RFC822 / ISO / 带时区偏移', () => {
    expect(normalizeDate('Mon, 14 Sep 2026 10:00:00 GMT')).toBe('2026-09-14T10:00:00.000Z');
    expect(normalizeDate('2026-09-14T10:00:00Z')).toBe('2026-09-14T10:00:00.000Z');
    expect(normalizeDate('2026-09-14T18:00:00+08:00')).toBe('2026-09-14T10:00:00.000Z');
  });

  it('容忍 CDATA 包裹、标签夹带与不换行空格', () => {
    expect(normalizeDate('<![CDATA[Mon, 14 Sep 2026 10:00:00 GMT]]>')).toBe('2026-09-14T10:00:00.000Z');
    expect(normalizeDate('<span>2026-09-14T10:00:00Z</span>')).toBe('2026-09-14T10:00:00.000Z');
    // 有些源把日期里的空格写成 &nbsp;（U+00A0），不归一化会让 Date 解析失败
    expect(normalizeDate('Mon, 14\u00a0Sep 2026 10:00:00 GMT')).toBe('2026-09-14T10:00:00.000Z');
  });

  it('实体编码的日期也能解出来', () => {
    expect(normalizeDate('2026-09-14T10:00:00Z&amp;')).toBe(null);      // 尾部噪声 → 无法解析
    expect(normalizeDate('Mon, 14 Sep 2026 10:00:00 &#43;0000')).toBe('2026-09-14T10:00:00.000Z');
  });
});

describe('isFutureDate / isEstimatedPublishTime', () => {
  const now = Date.parse('2026-09-14T10:00:00Z');

  it('明显在将来才算未来（带容差）', () => {
    expect(isFutureDate('2026-09-14T20:00:00Z', { now })).toBe(true);          // +10h
    expect(isFutureDate('2026-09-14T11:00:00Z', { now })).toBe(false);         // +1h（容差内，时钟偏差）
    expect(isFutureDate(null, { now })).toBe(false);
  });

  it('没有日期 / 未来时间 都算「估计时间」', () => {
    expect(isEstimatedPublishTime(null, { now })).toBe(true);
    expect(isEstimatedPublishTime(undefined, { now })).toBe(true);
    expect(isEstimatedPublishTime('2026-09-14T20:00:00Z', { now })).toBe(true);   // 未来 → 不可信
    expect(isEstimatedPublishTime('2026-09-14T09:00:00Z', { now })).toBe(false);
  });

  it('容差常量是显式的（2 小时：吸收时钟偏差，但能抓住 +5.7h 那类解析错误）', () => {
    expect(FUTURE_TOLERANCE_MS).toBe(2 * 60 * 60 * 1000);
    // 实测抓到过的真实异常：InfoQ CN 的发布日期被解析成 +5.7 小时
    expect(isEstimatedPublishTime(new Date(now + 5.7 * 3_600_000).toISOString(), { now })).toBe(true);
  });
});

describe('effectivePublishTime', () => {
  it('优先真实发布时间，其次入库时间', () => {
    expect(effectivePublishTime({ publishedAt: '2026-09-14T10:00:00Z', fetchedAt: '2026-09-14T11:00:00Z' }))
      .toBe(Date.parse('2026-09-14T10:00:00Z'));
    expect(effectivePublishTime({ publishedAt: null, fetchedAt: '2026-09-14T11:00:00Z' }))
      .toBe(Date.parse('2026-09-14T11:00:00Z'));
    expect(effectivePublishTime({})).toBe(0);
    expect(effectivePublishTime(null)).toBe(0);
  });
});

describe('compareByRecency —— 不丢内容、不做 NaN 比较', () => {
  // 注意：夹具日期必须用「明确过去」的时间。
  // 第一版夹具写了「今天早上」，结果运行时钟还没走到那里 → 被判成未来 → 断言假失败。
  const real = { publishedAt: '2026-09-07T09:00:00Z', publishedAtEstimated: false };
  const realNewer = { publishedAt: '2026-09-07T09:30:00Z', publishedAtEstimated: false };
  const estimated = { publishedAt: null, publishedAtEstimated: true, fetchedAt: '2026-09-07T09:59:00Z', source: '美团技术团队' };
  const wrongFuture = { publishedAt: '2099-01-01T00:00:00Z', publishedAtEstimated: true, fetchedAt: '2026-09-07T09:59:00Z' };

  it('真实时间按倒序', () => {
    expect(sortByRecency([real, realNewer]).map(i => i.publishedAt))
      .toEqual(['2026-09-07T09:30:00Z', '2026-09-07T09:00:00Z']);
  });

  it('缺日期的条目用「入库时间」参与排序 —— 绝不能被挤出资讯流', () => {
    // 第一版实现是「估计时间一律沉底」，实测导致整个无日期来源从列表消失（列表有条数上限）。
    // 现在按 fetchedAt 排序：这条 09:59 入库，排在最前，前端用「时间未知」如实标注。
    expect(sortByRecency([realNewer, estimated])[0]).toBe(estimated);
    expect(effectivePublishTime(estimated)).toBe(Date.parse(estimated.fetchedAt));
  });

  it('时间明确错误（将来）才降权沉底', () => {
    const sorted = sortByRecency([wrongFuture, real, realNewer]);
    expect(sorted.at(-1)).toBe(wrongFuture);
  });

  it('比较结果永远是有限数（避免 comparator 返回 NaN 导致排序未定义）', () => {
    const inputs = [real, realNewer, estimated, wrongFuture, { publishedAt: null }, {}, null, undefined, { publishedAt: 'garbage' }];
    for (const a of inputs) {
      for (const b of inputs) {
        expect(Number.isFinite(compareByRecency(a, b))).toBe(true);
      }
    }
  });

  it('两个都没有时间时视为等价（返回 0）', () => {
    expect(compareByRecency({}, {})).toBe(0);
    expect(compareByRecency(null, null)).toBe(0);
  });

  it('sortByRecency 不改原数组', () => {
    const list = [estimated, real];
    sortByRecency(list);
    expect(list[0]).toBe(estimated);
  });
});
