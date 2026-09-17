import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, isEnglishText, isChineseText, formatStars, hexToRgba, formatRelative, isFreshNews } from '../format.js';

describe('decodeHtmlEntities（展示层兜底，v26.9e）', () => {
  it('解开资讯里最常见的具名实体', () => {
    expect(decodeHtmlEntities('OpenAI&nbsp;发布&mdash;新模型&hellip;')).toBe('OpenAI 发布—新模型…');
    expect(decodeHtmlEntities('&ldquo;引用&rdquo;与&rsquo;撇号')).toBe('“引用”与’撇号');
    expect(decodeHtmlEntities('5&times;3&deg;&plusmn;1')).toBe('5×3°±1');
  });

  it('保留原有能力：基本实体 + 数字实体', () => {
    expect(decodeHtmlEntities('a&amp;b&lt;c&gt;d&quot;e&#39;f')).toBe('a&b<c>d"e\'f');
    expect(decodeHtmlEntities('&#8212;&#x4e2d;')).toBe('—中');
  });

  it('无 & 时走快路径原样返回', () => {
    expect(decodeHtmlEntities('普通中文标题')).toBe('普通中文标题');
    expect(decodeHtmlEntities('plain ascii title')).toBe('plain ascii title');
  });

  it('空值安全', () => {
    expect(decodeHtmlEntities(null)).toBe('');
    expect(decodeHtmlEntities(undefined)).toBe('');
    expect(decodeHtmlEntities(0)).toBe('0');
  });

  it('未知实体与孤立 & 保持原样', () => {
    expect(decodeHtmlEntities('&foobar; 与 a && b')).toBe('&foobar; 与 a && b');
  });

  it('越界码点不抛异常', () => {
    expect(() => decodeHtmlEntities('&#99999999;')).not.toThrow();
    expect(decodeHtmlEntities('&#99999999;')).toBe('&#99999999;');
  });

  it('幂等：解过一次再解不会继续变化', () => {
    const once = decodeHtmlEntities('A&nbsp;B&amp;C');
    expect(decodeHtmlEntities(once)).toBe(once);
  });
});

describe('format.js 其他导出（回归护栏）', () => {
  it('语言判定', () => {
    expect(isEnglishText('Hello world')).toBe(true);
    expect(isEnglishText('你好世界')).toBe(false);
    expect(isChineseText('你好')).toBe(true);
    expect(isChineseText('hello')).toBe(false);
  });

  it('formatStars / hexToRgba', () => {
    expect(formatStars(999)).toBe('999');
    expect(formatStars(1500)).toBe('1.5k');
    expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(hexToRgba('bad', 1)).toBe('rgba(100, 116, 139, 1)');
  });

  it('isFreshNews 以 5 分钟为默认阈值', () => {
    expect(isFreshNews(new Date().toISOString())).toBe(true);
    expect(isFreshNews(new Date(Date.now() - 10 * 60 * 1000).toISOString())).toBe(false);
    expect(isFreshNews(null)).toBe(false);
  });

  it('isFreshNews 兼容旧的「直接传毫秒阈值」写法', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isFreshNews(tenMinAgo, 20 * 60 * 1000)).toBe(true);
    expect(isFreshNews(tenMinAgo, 5 * 60 * 1000)).toBe(false);
  });
});

describe('发布时间不可信时的展示（第1点修复）', () => {
  const iso = ms => new Date(Date.now() - ms).toISOString();

  it('estimated 标记的条目显示「时间未知」，绝不显示「刚刚」', () => {
    // 这正是历史 BUG 的用户可见表现：无日期字段的条目（服务端曾伪造为抓取时刻）显示成「刚刚」
    expect(formatRelative(new Date().toISOString(), { estimated: true })).toBe('时间未知');
    expect(formatRelative(iso(3 * 60 * 60 * 1000), { estimated: true })).toBe('时间未知');
  });

  it('未来时间不参与「刚刚 / N分钟前」话术', () => {
    const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(future)).toBe('时间未知');
    expect(formatRelative(future, { estimated: true })).toBe('时间未知');
  });

  it('空值 / 非法值一律「时间未知」', () => {
    expect(formatRelative(null)).toBe('时间未知');
    expect(formatRelative(undefined)).toBe('时间未知');
    expect(formatRelative('garbage')).toBe('时间未知');
  });

  it('正常时间仍按原来的分档显示', () => {
    expect(formatRelative(new Date().toISOString())).toBe('刚刚');
    expect(formatRelative(iso(20 * 60 * 1000))).toBe('20分钟前');
    expect(formatRelative(iso(5 * 60 * 60 * 1000))).toBe('5小时前');
  });

  it('estimated 的条目永不打 NEW 角标（即便时间看起来很近）', () => {
    expect(isFreshNews(new Date().toISOString(), { estimated: true })).toBe(false);
    expect(isFreshNews(new Date(Date.now() + 60_000).toISOString())).toBe(false); // 未来
    expect(isFreshNews('garbage')).toBe(false);
  });
});
