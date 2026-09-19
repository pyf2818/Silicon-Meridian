import { describe, it, expect } from 'vitest';
import {
  buildIndex,
  semanticSearch,
  augmentWithSemantics,
  indexText,
  itemKey,
  MIN_SEMANTIC_SCORE,
} from '../newsSemanticIndex.js';

// 语义检索的定位：给「子串 OR 匹配」补召回——自然语句问法（标题里没那些字）也能捞到相关条目。
// 实现是本地哈希向量（零 API 成本），所以这里重点锁死：补召回有效、噪声被挡、不重复入列。

const item = (over = {}) => ({
  id: 'n1',
  title: 'OpenAI 发布新一代推理模型',
  summary: '该模型在长上下文与工具调用上有明显提升',
  source: 'OpenAI Blog',
  publishedAt: '2026-09-19T10:00:00.000Z',
  ...over,
});

describe('indexText / buildIndex', () => {
  it('标题参与且权重更高（拼两次），摘要截断到 300 字', () => {
    const text = indexText(item({ summary: 'x'.repeat(1000) }));
    expect(text.match(/OpenAI 发布新一代推理模型/g).length).toBe(2);
    expect(text.length).toBeLessThan(400);
  });

  it('空条目不炸，索引条目数与输入一致', () => {
    expect(buildIndex([item(), item({ id: 'n2' })]).length).toBe(2);
    expect(buildIndex(null)).toEqual([]);
  });
});

describe('semanticSearch（语义召回）', () => {
  const pool = [
    item({ id: 'a', title: 'OpenAI 发布 GPT 新版本', summary: '推理能力提升' }),
    item({ id: 'b', title: '英伟达数据中心营收创新高', summary: '财报显示增长' }),
    item({ id: 'c', title: '某前端框架发布小版本更新', summary: '修复若干问题' }),
  ];
  const index = buildIndex(pool);

  it('同主题查询能召回语义相关条目（即使标题不含查询原词）', () => {
    const hits = semanticSearch(index, 'OpenAI 推理模型 进展');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].item.id).toBe('a');
  });

  it('完全不相关的查询被 minScore 挡住', () => {
    const hits = semanticSearch(index, 'zzzz 完全无关的词 qqqq', { minScore: MIN_SEMANTIC_SCORE });
    expect(hits.length).toBe(0);
  });

  it('按分数降序返回', () => {
    const hits = semanticSearch(index, 'OpenAI GPT 推理');
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it('空查询 / 空索引安全返回', () => {
    expect(semanticSearch(index, '')).toEqual([]);
    expect(semanticSearch([], 'OpenAI')).toEqual([]);
  });

  it('limit 生效', () => {
    expect(semanticSearch(index, 'OpenAI', { limit: 1 }).length).toBeLessThanOrEqual(1);
  });
});

describe('augmentWithSemantics（补充召回 + 去重）', () => {
  const pool = [
    item({ id: 'a', title: 'OpenAI 发布新模型' }),
    item({ id: 'b', title: 'OpenAI 模型定价调整' }),
  ];

  it('把语义命中追加到已有结果之后', () => {
    const existing = [item({ id: 'z', title: '无关条目' })];
    const { items, added } = augmentWithSemantics(existing, pool, 'OpenAI 新模型');
    expect(added).toBeGreaterThan(0);
    expect(items[0].id).toBe('z');           // 已有结果保持在前
    expect(items.length).toBeGreaterThan(1);
  });

  it('已在结果中的条目不会被重复追加（按 id 去重）', () => {
    const existing = [pool[0]];
    const { items, added } = augmentWithSemantics(existing, pool, 'OpenAI 新模型');
    expect(added).toBeLessThanOrEqual(1);
    expect(items.filter(i => i.id === 'a').length).toBe(1);
  });

  it('无 id 的条目按 标题|来源 去重，也不会重复', () => {
    const noId = [{ title: 'OpenAI 发布新模型', source: 'OpenAI Blog', summary: 'x' }];
    const existing = [...noId];
    const { items } = augmentWithSemantics(existing, noId, 'OpenAI 新模型');
    expect(items.length).toBe(1);
  });

  it('itemKey 回退顺序：id > url > 标题|来源', () => {
    expect(itemKey({ id: 'i', url: 'u' })).toBe('i');
    expect(itemKey({ url: 'u', title: 't' })).toBe('u');
    expect(itemKey({ title: 't', source: 's' })).toBe('t|s');
  });
});
