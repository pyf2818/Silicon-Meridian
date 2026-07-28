import { describe, it, expect } from 'vitest';
import { extractLearnedPreferences } from '../memoryEvolver.js';

// ---------------------------------------------------------------------------
// extractLearnedPreferences 纯函数测试
// Phase 3 Task B7-5
// ---------------------------------------------------------------------------

describe('extractLearnedPreferences', () => {
  it('返回空 topics 与默认 shallow/concise 当输入为空数组', () => {
    const result = extractLearnedPreferences([]);
    expect(result.topics).toEqual([]);
    expect(result.preferredDepth).toBe('shallow');
    expect(result.preferredFormat).toBe('concise');
  });

  it('返回空 topics 当输入为 null/undefined（防御性）', () => {
    expect(extractLearnedPreferences(null)).toEqual({
      topics: [],
      preferredDepth: 'shallow',
      preferredFormat: 'concise',
    });
    expect(extractLearnedPreferences(undefined)).toEqual({
      topics: [],
      preferredDepth: 'shallow',
      preferredFormat: 'concise',
    });
  });

  it('仅取 role==="user" 的消息内容做分析（忽略 assistant）', () => {
    const result = extractLearnedPreferences([
      { role: 'assistant', content: '详细解释 React hooks 的使用方法' },
      { role: 'user', content: 'React hooks 怎么用' },
    ]);
    // assistant 的"详细解释"不应影响 preferredFormat
    expect(result.preferredFormat).toBe('concise');
    // user 的 "React hooks" 应进入 topics
    expect(result.topics).toContain('React');
    expect(result.topics).toContain('hooks');
  });

  it('关键词频次排序：高频词排在前面，最多返回 5 个', () => {
    const messages = [
      { role: 'user', content: 'React React React Vue Vue Angular' },
    ];
    const result = extractLearnedPreferences(messages);
    expect(result.topics.length).toBeLessThanOrEqual(5);
    expect(result.topics[0]).toBe('React'); // 出现 3 次，应排第一
    expect(result.topics[1]).toBe('Vue');   // 出现 2 次
    expect(result.topics[2]).toBe('Angular');
  });

  it('过滤掉长度 < 2 的词（单字符噪声）', () => {
    const result = extractLearnedPreferences([
      { role: 'user', content: 'a React 我 们' },
    ]);
    // 'a' / '我' / '们' 都是单字符，应被过滤
    expect(result.topics).not.toContain('a');
    expect(result.topics).not.toContain('我');
    expect(result.topics).not.toContain('们');
    expect(result.topics).toContain('React');
  });

  it('过滤掉长度 > 20 的词（超长 token）', () => {
    const longWord = 'x'.repeat(25);
    const result = extractLearnedPreferences([
      { role: 'user', content: `React ${longWord}` },
    ]);
    expect(result.topics).not.toContain(longWord);
    expect(result.topics).toContain('React');
  });

  it('preferredDepth=deep 当 user 消息平均长度 > 100', () => {
    const longContent = 'x'.repeat(150);
    const result = extractLearnedPreferences([
      { role: 'user', content: longContent },
    ]);
    expect(result.preferredDepth).toBe('deep');
  });

  it('preferredDepth=shallow 当 user 消息平均长度 <= 100', () => {
    const result = extractLearnedPreferences([
      { role: 'user', content: '短消息' },
    ]);
    expect(result.preferredDepth).toBe('shallow');
  });

  it('preferredFormat=detailed 当 user 内容含"详细/深入/具体/展开"', () => {
    const cases = ['请详细说明', '深入分析一下', '能否具体一点', '展开讲讲'];
    for (const c of cases) {
      const result = extractLearnedPreferences([{ role: 'user', content: c }]);
      expect(result.preferredFormat).toBe('detailed');
    }
  });

  it('preferredFormat=concise 当 user 内容不含深度关键词', () => {
    const result = extractLearnedPreferences([
      { role: 'user', content: '简单说一下 React' },
    ]);
    expect(result.preferredFormat).toBe('concise');
  });

  it('多条 user 消息合并计算平均长度', () => {
    const result = extractLearnedPreferences([
      { role: 'user', content: 'short' },                    // 5
      { role: 'user', content: 'a'.repeat(195) },            // 195
    ]);
    // 平均长度 = 100，边界值，应判为 shallow（<= 100）
    expect(result.preferredDepth).toBe('shallow');
  });

  it('对 content 为 undefined/null 的消息做防御性处理', () => {
    const result = extractLearnedPreferences([
      { role: 'user', content: undefined },
      { role: 'user', content: null },
      { role: 'user', content: 'React' },
    ]);
    expect(result.topics).toContain('React');
    expect(result.preferredDepth).toBe('shallow');
  });

  it('按中英文标点切分关键词（支持逗号、句号、空格）', () => {
    const result = extractLearnedPreferences([
      { role: 'user', content: 'React,Vue；Angular。Svelte Solid' },
    ]);
    expect(result.topics).toContain('React');
    expect(result.topics).toContain('Vue');
    expect(result.topics).toContain('Angular');
    expect(result.topics).toContain('Svelte');
    expect(result.topics).toContain('Solid');
  });
});
