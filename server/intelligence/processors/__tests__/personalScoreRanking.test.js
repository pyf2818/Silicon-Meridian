import { describe, expect, it, afterEach } from 'vitest';
import { applyPersonalScores } from '../personalScore.js';

const EVENTS = [
  {
    id: 'hot', title: 'Agent 评测基准发布', summary: '多个独立来源报道同一基准发布',
    category: 'industry', publishedAt: '2026-09-16T20:00:00Z',
    independentSourceCount: 4, firstSeenAt: '2026-09-16T20:00:00Z',
    sources: ['TechCrunch', 'The Verge'], confidence: 80,
  },
  {
    id: 'cold', title: '某实验室常规周报', summary: '例行内容更新，无独立扩散',
    category: 'research', publishedAt: '2026-09-16T18:00:00Z',
    independentSourceCount: 0, confidence: 30,
  },
];

const CONTEXT = { interests: ['industry'], follows: ['agent'], now: Date.parse('2026-09-16T21:00:00Z') };

afterEach(() => { delete process.env.MERIDIAN_RANKER_V2; });

describe('applyPersonalScores × 统一排序内核（P3）', () => {
  it('默认（无开关）：行为与历史完全一致，不新增 rankScore', () => {
    const events = applyPersonalScores(EVENTS, CONTEXT);
    expect(events[0].rankScore).toBeUndefined();
    expect(events[0].personalScore).toBeGreaterThan(0);   // 画像照常生效
    expect(events[0].intelligenceScore).toBeGreaterThan(events[1].intelligenceScore);
  });

  it('影子模式开启：事件带 rankScore/rankParts，且 velocity 用的是聚类真数据', () => {
    process.env.MERIDIAN_RANKER_V2 = '1';
    const events = applyPersonalScores(EVENTS, CONTEXT);
    const hot = events.find(e => e.id === 'hot');
    expect(hot.rankVersion).toBe('ranker-v2.1');
    expect(hot.rankLane).toBe('personal');
    const velocity = hot.rankParts.find(p => p.id === 'velocity');
    expect(velocity.confidence).toBe(1);                       // 聚类数据 → 高置信
    expect(velocity.reason).toContain('独立源');
    // 热事件（多源扩散 + 画像命中）应排在没有扩散的常规内容前面
    expect(events[0].id).toBe('hot');
  });

  it('开关开启但用户无画像：affinity 退出打分（conf=0），事件仍获得分数', () => {
    process.env.MERIDIAN_RANKER_V2 = '1';
    const events = applyPersonalScores(EVENTS, {});
    const first = events[0];
    expect(first.rankScore).toBeGreaterThan(0);
    const affinity = first.rankParts.find(p => p.id === 'affinity');
    expect(affinity.confidence).toBe(0);
  });

  it('无画像上下文时同样产出 rankScore（公共视角兜底）', () => {
    process.env.MERIDIAN_RANKER_V2 = '1';
    const events = applyPersonalScores(EVENTS, {});
    expect(events.every(e => e.rankScore != null)).toBe(true);
  });
});
