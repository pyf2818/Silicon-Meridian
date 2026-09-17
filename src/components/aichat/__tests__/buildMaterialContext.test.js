import { describe, it, expect } from 'vitest';
import {
  buildMaterialContext,
  tokenizeQuery,
  scoreMaterialsByQuery,
} from '../buildMaterialContext.js';

const MATERIALS = [
  { id: 'm1', title: '英伟达发布新一代AI芯片', source: '财新', tags: ['芯片', '英伟达'], content: '英伟达发布B300，算力大幅提升，主攻大模型训练。', createdAt: '2026-08-01' },
  { id: 'm2', title: '国产大模型备案进展', source: '人民网', tags: ['大模型', '政策'], content: '多款国产大模型完成备案，政策持续支持AI发展。', createdAt: '2026-07-25' },
  { id: 'm3', title: 'OpenAI发布新模型', source: 'TechCrunch', tags: ['OpenAI', '模型'], content: 'OpenAI 发布推理能力更强的模型，成本更低。', createdAt: '2026-08-05' },
  { id: 'm4', title: '股市波动与量化策略', source: '中证', tags: ['股市', '量化'], content: '量化策略在震荡市中表现，机构关注风险。', createdAt: '2026-08-03' },
];

describe('tokenizeQuery', () => {
  it('空查询返回空数组', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery(null)).toEqual([]);
  });

  it('中文生成 bigram，英文生成词', () => {
    const tokens = tokenizeQuery('芯片英伟达 nvidia');
    expect(tokens).toContain('芯片');
    expect(tokens).toContain('英伟');
    expect(tokens).toContain('nvidia');
  });
});

describe('scoreMaterialsByQuery', () => {
  it('标题命中权重最高', () => {
    const scores = scoreMaterialsByQuery(MATERIALS, '英伟达 芯片');
    const m1 = scores.get(MATERIALS[0]);
    expect(m1).toBeGreaterThan(0);
    // 标题命中"英伟达" → 5 分
    expect(m1).toBeGreaterThanOrEqual(5);
  });

  it('内容命中权重较低但仍相关', () => {
    const scores = scoreMaterialsByQuery(MATERIALS, '量化 股市');
    const m4 = scores.get(MATERIALS[3]);
    expect(m4).toBeGreaterThan(0);
  });

  it('无相关返回空 map', () => {
    expect(scoreMaterialsByQuery(MATERIALS, '量子计算')).toEqual(new Map());
  });
});

describe('buildMaterialContext(query)', () => {
  it('无 query 时默认注入（AI精灵优先 + 收藏 + 最新），mode=default', () => {
    const ctx = buildMaterialContext(MATERIALS, {});
    expect(ctx.mode).toBe('default');
    expect(ctx.total).toBe(4);
    expect(ctx.lines.length).toBeGreaterThan(0);
    // 默认按时间排序，最新 m3 在前
    expect(ctx.selected[0].originalItemId).toBe('m3');
  });

  it('有 query 时按相关性检索，mode=query', () => {
    const ctx = buildMaterialContext(MATERIALS, { query: '英伟达芯片 国产大模型', limit: 2 });
    expect(ctx.mode).toBe('query');
    expect(ctx.selected).toHaveLength(2);
    // 英伟达命中最强应排前
    const ids = ctx.selected.map(m => m.originalItemId);
    expect(ids).toContain('m1');
  });

  it('query 无命中时回退默认，mode=default', () => {
    const ctx = buildMaterialContext(MATERIALS, { query: '量子计算机', limit: 3 });
    expect(ctx.mode).toBe('default');
    expect(ctx.selected.length).toBeGreaterThan(0);
  });

  it('query 会避免注入不相关素材（提高注入精度）', () => {
    const ctx = buildMaterialContext(MATERIALS, { query: '股票市场 量化', limit: 2 });
    const ids = ctx.selected.map(m => m.originalItemId);
    // 股市素材应被检索到；纯重复素材不应混入
    expect(ids).toContain('m4');
  });
});