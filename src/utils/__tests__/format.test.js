import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, isEnglishText, isChineseText, formatStars, hexToRgba, isFreshNews } from '../format.js';

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
});
