import { describe, expect, it } from 'vitest';
import { parseFeed } from '../feedParser.js';

const SOURCE = { name: 'Test Source', url: 'https://example.test/feed', region: 'domestic', defaultCategory: 'ai' };
const FETCHED_AT = '2026-09-07T10:00:00.000Z';

const rss = (items) => `<rss><channel>${items.join('')}</channel></rss>`;
const item = (title, extra = '') =>
  `<item><title>${title}</title><link>https://example.test/${encodeURIComponent(title)}</link><description>desc ${title}</description>${extra}</item>`;

describe('feedParser 发布时间标记（第1点修复）', () => {
  it('有 pubDate → 采用真实发布时间，标记为非估计', () => {
    const [parsed] = parseFeed(rss([item('A', '<pubDate>Mon, 07 Sep 2026 08:30:00 GMT</pubDate>')]), SOURCE, { fetchedAt: FETCHED_AT });
    expect(parsed.publishedAt).toBe('2026-09-07T08:30:00.000Z');
    expect(parsed.publishedAtEstimated).toBe(false);
    expect(parsed.fetchedAt).toBe(FETCHED_AT);
  });

  it('完全没有日期字段 → publishedAt 为 null 且标记为估计（不再伪装成抓取时刻）', () => {
    const [parsed] = parseFeed(rss([item('B')]), SOURCE, { fetchedAt: FETCHED_AT });
    expect(parsed.publishedAt).toBe(null);
    expect(parsed.publishedAtEstimated).toBe(true);
    // 反证：历史实现会把 publishedAt 写成「抓取时刻」，于是这条旧文显示为「刚刚」
    expect(parsed.publishedAt).not.toBe(FETCHED_AT);
    // 但入库时间仍然保留，供排序兜底
    expect(parsed.fetchedAt).toBe(FETCHED_AT);
  });

  it('日期不可解析 → 同样视为估计', () => {
    const [parsed] = parseFeed(rss([item('C', '<pubDate>not-a-real-date</pubDate>')]), SOURCE, { fetchedAt: FETCHED_AT });
    expect(parsed.publishedAt).toBe(null);
    expect(parsed.publishedAtEstimated).toBe(true);
  });

  it('CDATA 包裹的日期能解出来', () => {
    const [parsed] = parseFeed(rss([item('D', '<pubDate><![CDATA[Mon, 07 Sep 2026 07:00:00 GMT]]></pubDate>')]), SOURCE, { fetchedAt: FETCHED_AT });
    expect(parsed.publishedAt).toBe('2026-09-07T07:00:00.000Z');
    expect(parsed.publishedAtEstimated).toBe(false);
  });

  it('Atom 的 <updated> 也算真实时间', () => {
    const atom = `<feed><entry><title>E</title><link href="https://example.test/e"/><updated>2026-09-07T06:00:00Z</updated></entry></feed>`;
    const [parsed] = parseFeed(atom, SOURCE, { fetchedAt: FETCHED_AT });
    expect(parsed.publishedAt).toBe('2026-09-07T06:00:00.000Z');
    expect(parsed.publishedAtEstimated).toBe(false);
  });

  it('明显在将来的日期 → 标记为估计（时区解析错误 / 排期发布）', () => {
    const [parsed] = parseFeed(rss([item('F', '<pubDate>Mon, 14 Sep 2099 10:00:00 GMT</pubDate>')]), SOURCE, { fetchedAt: FETCHED_AT });
    expect(parsed.publishedAt).toBe('2099-09-14T10:00:00.000Z');  // 原值保留，不篡改
    expect(parsed.publishedAtEstimated).toBe(true);               // 但打上不可信标记
  });

  it('同一批里有无日期的条目各自独立标记', () => {
    const parsed = parseFeed(
      rss([item('G1', '<pubDate>Mon, 07 Sep 2026 05:00:00 GMT</pubDate>'), item('G2')]),
      SOURCE,
      { fetchedAt: FETCHED_AT },
    );
    expect(parsed.map(p => p.publishedAtEstimated)).toEqual([false, true]);
  });

  it('不传 fetchedAt 时仍可用（默认取当前时间）', () => {
    const [parsed] = parseFeed(rss([item('H')]), SOURCE);
    expect(parsed.publishedAtEstimated).toBe(true);
    expect(Number.isFinite(Date.parse(parsed.fetchedAt))).toBe(true);
  });
});
