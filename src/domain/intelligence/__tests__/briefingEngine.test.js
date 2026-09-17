import { describe, expect, it } from 'vitest';
import { applyItemScoresToLanes, buildAlgorithmBriefing, mergeAiBriefing } from '../briefingEngine.js';

const lanes = {
  public: [{ id: 'p1', title: 'Public', category: 'ai', source: 'A' }],
  personal: [{ id: 'u1', title: 'Personal', category: 'chips', source: 'B', reasons: ['匹配关注领域'] }],
};

it('builds a usable model-free newspaper', () => {
  const result = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  expect(result.mode).toBe('algorithm');
  expect(result.sections.public[0].id).toBe('p1');
  expect(result.citationIds).toEqual(['p1', 'u1']);
});

it('rejects AI citations outside selected evidence', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  const merged = mergeAiBriefing(base, { oneLine: 'claim', citationIds: ['missing'] });
  expect(merged.mode).toBe('algorithm');
  expect(merged.aiValidationError).toContain('missing');
});

it('rejects opportunity and risk itemIds outside selected evidence', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  const merged = mergeAiBriefing(base, {
    oneLine: 'claim', citationIds: ['p1'],
    opportunities: [{ itemId: 'unknown', text: 'bad claim' }],
  });
  expect(merged.mode).toBe('algorithm');
  expect(merged.aiValidationError).toContain('unknown');
});

it('preserves evidence itemIds in a valid AI briefing', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  const merged = mergeAiBriefing(base, {
    oneLine: 'claim', citationIds: ['u1'],
    opportunities: [{ itemId: 'u1', text: 'valid claim' }],
  });
  expect(merged.mode).toBe('ai');
  expect(merged.opportunities).toEqual([{ itemId: 'u1', text: 'valid claim' }]);
  // 反证：旧实现只回字符串，证据 ID 全丢（消费端拿不到「这条判断依据哪条资讯」）
  expect(typeof merged.opportunities[0]).not.toBe('string');
});

it('keeps one evidence id per opinion across both opportunities and risks', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  const merged = mergeAiBriefing(base, {
    oneLine: 'claim', citationIds: ['p1', 'u1'],
    opportunities: [{ itemId: 'u1', text: 'opp-1' }, { itemId: 'p1', text: 'opp-2' }],
    risks: [{ itemId: 'p1', text: 'risk-1' }],
  });
  expect(merged.mode).toBe('ai');
  expect(merged.opportunities).toEqual([
    { itemId: 'u1', text: 'opp-1' },
    { itemId: 'p1', text: 'opp-2' },
  ]);
  expect(merged.risks).toEqual([{ itemId: 'p1', text: 'risk-1' }]);
  // 每条观点都必须能回指证据
  for (const opinion of [...merged.opportunities, ...merged.risks]) {
    expect(base.citationIds).toContain(opinion.itemId);
    expect(opinion.text).toBeTruthy();
  }
});

it('caps opinions at five and drops entries without text', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  const merged = mergeAiBriefing(base, {
    oneLine: 'claim', citationIds: ['p1', 'u1'],
    opportunities: [
      { itemId: 'p1', text: 'o1' }, { itemId: 'p1', text: 'o2' },
      { itemId: 'p1', text: 'o3' }, { itemId: 'p1', text: 'o4' },
      { itemId: 'p1', text: 'o5' }, { itemId: 'p1', text: 'o6' },
      { itemId: 'p1', text: '   ' },
    ],
  });
  expect(merged.opportunities).toHaveLength(5);
  expect(merged.opportunities.every(o => o.text.trim())).toBe(true);
});

it('algorithm-mode opinions share the same evidence-bearing shape', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  for (const opinion of [...base.opportunities, ...base.risks]) {
    expect(typeof opinion).toBe('object');
    expect(typeof opinion.itemId).toBe('string');
    expect(typeof opinion.text).toBe('string');
  }
});

it('rejects plain text AI opinions without an evidence itemId', () => {
  const base = buildAlgorithmBriefing({ date: '2026-07-14', lanes });
  const merged = mergeAiBriefing(base, { oneLine: 'claim', citationIds: ['u1'], opportunities: ['untraceable'] });
  expect(merged.mode).toBe('algorithm');
  expect(merged.aiValidationError).toContain('缺少有效引用');
  // 报错文案里不应出现 String(undefined) 那种噪声
  expect(merged.aiValidationError).not.toContain('undefined');
});

describe('applyItemScoresToLanes —— 预热 AI 评分落卡（零新增 LLM 成本）', () => {
  const laneData = {
    public: [{ id: 'e1', title: 'A' }, { id: 'e2', title: 'B' }],
    personal: [{ id: 'e3', title: 'C' }],
  };
  const itemScores = [
    { id: 'e1', score: 86.4, label: '必读', reason: '官方发布，含具体基准数字' },
    { id: 'e3', score: 62, label: '关注', reason: '行业信号，多家跟进' },
    { id: 'hallucinated', score: 99, label: '必读', reason: '编造的引用' },
    { id: 'e2', score: 999, label: '必读', reason: '越界分数' },
  ];

  it('按 id 合并进 lanes 条目，字段对齐既有前端契约', () => {
    const { lanes: merged, mergedCount } = applyItemScoresToLanes(laneData, itemScores);
    expect(mergedCount).toBe(2);
    expect(merged.public[0].aiScore).toBe(86);
    expect(merged.public[0].aiRelevanceScore).toBe(86);
    expect(merged.public[0].aiLabel).toBe('必读');
    expect(merged.public[0].aiReason).toContain('基准数字');
    expect(merged.personal[0].aiScore).toBe(62);
    // 编造 id / 越界分数不落卡
    expect(merged.public[1].aiScore).toBeUndefined();
  });

  it('纯函数：不修改入参', () => {
    const snapshot = JSON.stringify(laneData);
    applyItemScoresToLanes(laneData, itemScores);
    expect(JSON.stringify(laneData)).toBe(snapshot);
  });

  it('itemScores 为空 / 非法输入安全', () => {
    expect(applyItemScoresToLanes(laneData, []).mergedCount).toBe(0);
    expect(applyItemScoresToLanes({}, null).mergedCount).toBe(0);
    expect(applyItemScoresToLanes(undefined, undefined).mergedCount).toBe(0);
  });
});
