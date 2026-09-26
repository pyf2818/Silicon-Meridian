/**
 * agentEvolution.test.js - Agent 进化档案单测（v26 #13）
 * 覆盖：等级计算 / 统计累计与升级里程碑 / 经验沉淀去重封顶 / prompt 注入段 / 崩溃兜底
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEvolution, recordAgentRun, depositExperience, removeExperience,
  evolutionLevelOf, evolutionPromptSnippet, getEvolutionScore, __resetEvolutionCache,
} from '../agentEvolution.js';

const AGENT = 'test-evolution-agent';

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

describe('agentEvolution 进化档案', () => {
  beforeEach(() => {
    mockLocalStorage();
    __resetEvolutionCache(); // 每个用例都从干净 storage 重建
  });

  it('新档案从 Lv0 种子开始', () => {
    const evo = getEvolution('fresh-agent-' + Math.random());
    expect(evo.level.level).toBe(0);
    expect(evo.level.name).toBe('种子');
    expect(evo.experiences).toHaveLength(0);
  });

  it('成长值公式：runs/tokens/toolCalls/skills/experiences 正确加权', () => {
    const score = getEvolutionScore({ runs: 10, tokens: 8000, toolCalls: 20, skills: 2, experienceCount: 4 });
    // 10*2 + 8000/4000 + 20*0.5 + 2*8 + 4*5 = 20+2+10+16+20 = 68
    expect(score).toBe(68);
  });

  it('等级阶梯单调：分数越高等级不降', () => {
    const prev = evolutionLevelOf(39);
    const next = evolutionLevelOf(40);
    expect(next.level).toBeGreaterThanOrEqual(prev.level);
    expect(evolutionLevelOf(100000).level).toBe(5);
  });

  it('recordAgentRun 累计统计；跨过 Lv1 阈值时自动记录里程碑', () => {
    // runs*2 达到 10 需 5 次
    for (let i = 0; i < 5; i += 1) recordAgentRun(AGENT, { tokens: 100, toolCalls: 1 });
    const evo = getEvolution(AGENT);
    expect(evo.stats.runs).toBeGreaterThanOrEqual(5);
    const lv1 = evo.milestones.find(m => m.level === 1);
    expect(lv1).toBeTruthy();
    expect(evo.level.level).toBeGreaterThanOrEqual(1);
  });

  it('里程碑不重复记录（同一等级只记一次）', () => {
    for (let i = 0; i < 8; i += 1) recordAgentRun(AGENT, {});
    const evo = getEvolution(AGENT);
    const lv1Count = evo.milestones.filter(m => m.level === 1).length;
    expect(lv1Count).toBeLessThanOrEqual(1);
  });

  it('depositExperience：正常沉淀 / 短文本拒绝 / 重复结论去重', () => {
    const ok = depositExperience(AGENT, { topic: '检索', lesson: '先搜国内源再搜国外源，命中率更高', source: 'chat' });
    expect(ok).toBe(true);
    const tooShort = depositExperience(AGENT, { lesson: '太短' });
    expect(tooShort).toBe(false);
    const dup = depositExperience(AGENT, { topic: '再次', lesson: '先搜国内源再搜国外源，命中率更高' });
    expect(dup).toBe(false);
    const evo = getEvolution(AGENT);
    expect(evo.experiences.filter(e => e.lesson.includes('国内源'))).toHaveLength(1);
  });

  it('removeExperience 删除指定条目', () => {
    depositExperience(AGENT, { topic: '整理', lesson: '导出前先压缩长文本，避免超出模型上下文预算' });
    const evo = getEvolution(AGENT);
    const target = evo.experiences[0];
    expect(removeExperience(AGENT, target.id)).toBe(true);
    expect(removeExperience(AGENT, target.id)).toBe(false);
  });

  it('evolutionPromptSnippet：无数据返回空，有经验时输出注入段', () => {
    expect(evolutionPromptSnippet('no-data-agent-' + Math.random())).toBe('');
    depositExperience(AGENT, { topic: '汇总', lesson: '简报先给一行结论，再按主题展开证据引用' });
    const snippet = evolutionPromptSnippet(AGENT);
    expect(snippet).toContain('【成长经验】');
    expect(snippet).toContain('简报先给一行结论');
  });

  it('异常输入不崩溃（空 id / 非法对象）', () => {
    // v39：recordAgentRun 返回 { leveledUp, score }（含 history 快照语义）
    expect(recordAgentRun('', {})).toEqual({ leveledUp: false, score: 0 });
    expect(depositExperience('', { lesson: 'x'.repeat(20) })).toBe(false);
    expect(getEvolution('')).toBeTruthy();
  });
});
