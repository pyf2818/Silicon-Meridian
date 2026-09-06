import { describe, it, expect } from 'vitest';
import { planSimulation, compareValues, summarizeSimulation } from '../workflowSimulator.js';

const node = (over = {}) => ({
  id: `n-${Math.random().toString(36).slice(2, 7)}`,
  type: 'llm',
  title: '节点',
  role: 'r',
  prompt: 'p',
  inputKey: 'a',
  outputKey: 'b',
  enabled: true,
  ...over,
});

describe('compareValues', () => {
  it('支持全部比较算子', () => {
    expect(compareValues(5, '>=', 5)).toBe(true);
    expect(compareValues(5, '>', 5)).toBe(false);
    expect(compareValues(5, '<=', 5)).toBe(true);
    expect(compareValues(5, '<', 4)).toBe(false);
    expect(compareValues(5, '==', 5)).toBe(true);
  });
  it('非法数值退化为 0，不抛错', () => {
    expect(() => compareValues(undefined, '>=', NaN)).not.toThrow();
    expect(compareValues(undefined, '>=', 1)).toBe(false);
  });
});

describe('planSimulation', () => {
  it('按顺序为每个启用节点产出一步，包含耗时与产物', () => {
    const plan = planSimulation([node({ type: 'input' }), node({ type: 'llm' }), node({ type: 'output' })]);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.every(s => s.status === 'done')).toBe(true);
    expect(plan.totalDuration).toBeGreaterThan(0);
    expect(plan.steps[0].output).toContain('上下文包');
    expect(plan.ok).toBe(true);
  });

  it('停用的节点不参与执行', () => {
    const plan = planSimulation([node({ type: 'input' }), node({ type: 'llm', enabled: false })]);
    expect(plan.steps).toHaveLength(1);
  });

  it('条件不满足时短路后续节点', () => {
    const plan = planSimulation([
      node({ type: 'input' }),
      node({ type: 'condition', conditionMetric: 'itemCount', conditionOperator: '>=', conditionValue: 999 }),
      node({ type: 'llm' }),
      node({ type: 'output' }),
    ]);
    expect(plan.shortCircuitAt).toBe(1);
    expect(plan.ok).toBe(false);
    expect(plan.steps[2].status).toBe('skipped');
    expect(plan.steps[3].status).toBe('skipped');
    expect(plan.steps[1].branch).toBe(false);
    expect(summarizeSimulation(plan)).toContain('短路');
  });

  it('条件满足时不短路', () => {
    const plan = planSimulation([
      node({ type: 'input' }),
      node({ type: 'condition', conditionMetric: 'itemCount', conditionOperator: '>=', conditionValue: 1 }),
      node({ type: 'output' }),
    ]);
    expect(plan.shortCircuitAt).toBeNull();
    expect(plan.steps[2].status).toBe('done');
  });

  it('空节点数组返回空计划', () => {
    expect(planSimulation([]).steps).toHaveLength(0);
    expect(planSimulation(undefined).steps).toHaveLength(0);
  });
});
