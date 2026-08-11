import { describe, it, expect } from 'vitest';
import {
  selectOrchestration,
  buildViewTask,
  buildSynthesisTask,
  orchestrationStep,
  commitOrchestrationStep,
  VIEW_LABELS,
} from '../agentOrchestrator.js';

const AGENTS = [
  { id: 'orchestrator', name: '情报总控', systemPrompt: '总控' },
  { id: 'analyst', name: '资讯分析师', systemPrompt: '分析' },
  { id: 'tech-advisor', name: '技术顾问', systemPrompt: '技术' },
  { id: 'business-analyst', name: '商业分析师', systemPrompt: '商业' },
  { id: 'risk-scout', name: '风险雷达', systemPrompt: '风险' },
  { id: 'creation-agent', name: '创作转化官', systemPrompt: '创作' },
];

describe('selectOrchestration', () => {
  it('默认链含 5 视角 + 合成者', () => {
    const { chain, synthesizer } = selectOrchestration(AGENTS);
    expect(chain.map(c => c.agent.id)).toEqual(['analyst', 'tech-advisor', 'business-analyst', 'risk-scout', 'creation-agent']);
    expect(chain[0].viewLabel).toBe('资讯视角');
    expect(synthesizer.agent.id).toBe('orchestrator');
    expect(synthesizer.label).toBe('情报总控');
  });

  it('显式 chain 覆盖默认', () => {
    const { chain } = selectOrchestration(AGENTS, { chain: ['analyst', 'risk-scout'] });
    expect(chain.map(c => c.agent.id)).toEqual(['analyst', 'risk-scout']);
  });

  it('跳过不在生态中的 agent（用户删了某 agent 不报错）', () => {
    const { chain } = selectOrchestration(AGENTS, { chain: ['analyst', 'ghost', 'risk-scout'] });
    expect(chain.map(c => c.agent.id)).toEqual(['analyst', 'risk-scout']);
  });

  it('合成者缺失时兜底第一个 agent', () => {
    const { synthesizer } = selectOrchestration([AGENTS[1]], { orchestratorId: 'ghost' });
    expect(synthesizer.agent.id).toBe('analyst');
  });

  it('空 agents 返回空链与空合成者', () => {
    const { chain, synthesizer } = selectOrchestration([], {});
    expect(chain).toEqual([]);
    expect(synthesizer).toBeNull();
  });
});

describe('buildViewTask / buildSynthesisTask', () => {
  it('构建视角任务：无前序时不注入 prev', () => {
    const t = buildViewTask('分析AI芯片', '资讯视角', '', 3);
    expect(t).toContain('分析AI芯片');
    expect(t).toContain('3 视角');
    expect(t).toContain('资讯视角');
    expect(t).not.toContain('前序视角');
  });

  it('构建视角任务：有前序时注入 prev', () => {
    const t = buildViewTask('分析AI芯片', '技术视角', '【前序】市场现状', 3);
    expect(t).toContain('前序视角');
    expect(t).toContain('市场现状');
  });

  it('构建合成任务：汇总各视角', () => {
    const t = buildSynthesisTask('分析AI芯片', [
      { viewLabel: '资讯视角', output: '新闻A' },
      { viewLabel: '风险视角', output: '风险B' },
    ]);
    expect(t).toContain('2 个专业视角');
    expect(t).toContain('资讯视角');
    expect(t).toContain('风险视角');
    expect(t).toContain('新闻A');
    expect(t).toContain('风险B');
    expect(t).toContain('一句话总判断');
  });
});

describe('orchestrationStep / commitOrchestrationStep', () => {
  const base = {
    task: '分析AI芯片',
    chain: [
      { agent: AGENTS[1], viewLabel: '资讯视角' },
      { agent: AGENTS[3], viewLabel: '商业视角' },
    ],
    synthesizer: { agent: AGENTS[0], label: '情报总控' },
    views: [],
    index: 0,
  };

  it('第一步 -> view，index 0，注入 task', () => {
    const s = orchestrationStep(base);
    expect(s.step).toBe('view');
    expect(s.index).toBe(0);
    expect(s.agent.id).toBe('analyst');
    expect(s.input).toContain('分析AI芯片');
  });

  it('推进一视角 -> 第二步 view，携带前序产出', () => {
    const next = commitOrchestrationStep(base, '第一个视角输出', 'analyst');
    const s = orchestrationStep(next);
    expect(s.step).toBe('view');
    expect(s.index).toBe(1);
    expect(s.agent.id).toBe('business-analyst');
    expect(s.input).toContain('第一个视角输出'); // 前序注入
  });

  it('所有视角完成 -> synthesize', () => {
    let st = base;
    st = commitOrchestrationStep(st, 'V1', 'analyst');
    st = commitOrchestrationStep(st, 'V2', 'business-analyst');
    const s = orchestrationStep(st);
    expect(s.step).toBe('synthesize');
    expect(s.agent.id).toBe('orchestrator');
    expect(s.input).toContain('V1');
    expect(s.input).toContain('V2');
  });

  it('合成完成 -> done', () => {
    let st = base;
    st = commitOrchestrationStep(st, 'V1', 'analyst');
    st = commitOrchestrationStep(st, 'V2', 'business-analyst');
    st = commitOrchestrationStep(st, '合成结果', 'orchestrator');
    const s = orchestrationStep(st);
    expect(s.step).toBe('done');
    expect(s.done).toBe(true);
  });

  it('无合成者且视角完成 -> done（不推进到空）', () => {
    const noSynth = { ...base, synthesizer: null };
    let st = noSynth;
    st = commitOrchestrationStep(st, 'V1', 'analyst');
    st = commitOrchestrationStep(st, 'V2', 'business-analyst');
    const s = orchestrationStep(st);
    expect(s.step).toBe('done');
    expect(s.done).toBe(true);
  });
});

describe('VIEW_LABELS 完整性', () => {
  it('覆盖默认链所有视角', () => {
    for (const id of ['analyst', 'tech-advisor', 'business-analyst', 'risk-scout', 'creation-agent', 'orchestrator']) {
      expect(VIEW_LABELS[id]).toBeTruthy();
    }
  });
});