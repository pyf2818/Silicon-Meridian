import { describe, it, expect } from 'vitest';
import { cleanText, decodeEntities, trimSummary, trimIntro } from '../textProcessing.js';

describe('decodeEntities（HTML 实体解码，v26.9e 修复）', () => {
  it('解开最常见的具名实体（旧实现会原样透传到资讯卡片）', () => {
    expect(decodeEntities('OpenAI&nbsp;发布新模型&mdash;重磅')).toBe('OpenAI 发布新模型—重磅');
    expect(decodeEntities('Hello&hellip;world')).toBe('Hello…world');
    expect(decodeEntities('&ldquo;引用&rdquo;')).toBe('“引用”');
    expect(decodeEntities('&rsquo;撇号&times;5&deg;')).toBe('’撇号×5°');
  });

  it('保留既有能力：5 个基本实体 + 十进制/十六进制数字实体', () => {
    expect(decodeEntities('a&amp;b&lt;c&gt;d&quot;e&#39;f')).toBe('a&b<c>d"e\'f');
    expect(decodeEntities('&#8212;')).toBe('—');
    expect(decodeEntities('&#x4e2d;&#x6587;')).toBe('中文');
  });

  it('处理双重转义（&amp;nbsp; → 空格）', () => {
    expect(decodeEntities('A&amp;nbsp;B')).toBe('A B');
  });

  it('大小写不敏感回退（&NBSP; / &Apos;）', () => {
    expect(decodeEntities('&NBSP;x&Apos;')).toBe(' x\'');
  });

  it('未知实体保持原样，不误伤代码片段', () => {
    expect(decodeEntities('&foobar; 与 a && b')).toBe('&foobar; 与 a && b');
  });

  it('越界码点不抛异常（脏 RSS 不能打断整条解析）', () => {
    expect(() => decodeEntities('&#99999999;')).not.toThrow();
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
  });
});

describe('cleanText（去标签 + 折叠空白）', () => {
  it('剥掉 HTML 标签并把 &nbsp; 收敛为单个空格', () => {
    expect(cleanText('<p>OpenAI&nbsp;发布</p>\n\n<p>新&nbsp;&nbsp;模型</p>')).toBe('OpenAI 发布 新 模型');
  });

  it('清掉 CDATA 包裹', () => {
    expect(cleanText('<![CDATA[标题&nbsp;A]]>')).toBe('标题 A');
  });

  it('空值安全', () => {
    expect(cleanText('')).toBe('');
    expect(cleanText(undefined)).toBe('undefined');
  });
});

describe('trimSummary / trimIntro', () => {
  it('空摘要回落提示文案', () => {
    expect(trimSummary('')).toContain('暂无摘要');
    expect(trimSummary(null)).toContain('暂无摘要');
  });

  it('超长截断到 160 并加省略号', () => {
    const long = 'a'.repeat(200);
    const out = trimSummary(long);
    expect(out.length).toBe(163);
    expect(out.endsWith('...')).toBe(true);
  });

  it('trimIntro 折叠空白且超 220 截断', () => {
    expect(trimIntro('  a   b  ')).toBe('a b');
    expect(trimIntro('b'.repeat(300)).length).toBe(223);
  });
});
