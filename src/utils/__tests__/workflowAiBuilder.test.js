import { describe, it, expect } from 'vitest';
import {
  parseWorkflowJson,
  normalizeAiNodes,
  buildLocalWorkflow,
  buildWorkflowSystemPrompt,
} from '../workflowAiBuilder.js';
import { WORKFLOW_NODE_TYPES } from '../../constants/workflowConstants.js';

const NODE_META = {
  input: { label: '输入' }, llm: { label: '大模型' }, output: { label: '输出' },
  classifier: { label: '分类' }, condition: { label: '条件' }, skill: { label: '技能' },
};

describe('parseWorkflowJson', () => {
  it('解析裸 JSON', () => {
    expect(parseWorkflowJson('{"name":"a","nodes":[]}')).toEqual({ name: 'a', nodes: [] });
  });
  it('解析带代码块标记与前后废话的输出', () => {
    const text = '好的，这是方案：\n```json\n{"name":"x","nodes":[{"type":"llm"}]}\n```\n希望有帮助';
    expect(parseWorkflowJson(text).nodes).toHaveLength(1);
  });
  it('无 JSON 或非法 JSON 返回 null', () => {
    expect(parseWorkflowJson('抱歉，我无法完成')).toBeNull();
    expect(parseWorkflowJson('{bad json}')).toBeNull();
  });
});

describe('normalizeAiNodes', () => {
  it('未知类型降级为 llm，且每个节点都带完整可用配置', () => {
    const nodes = normalizeAiNodes({ nodes: [{ type: 'unknown-type', title: 'T' }] }, NODE_META);
    expect(nodes[0].type).toBe('llm');
    expect(nodes[0].title).toBe('T');
    expect(nodes[0].role).toBeTruthy();
    expect(nodes[0].prompt).toBeTruthy();
    expect(nodes[0].position).toHaveProperty('x');
  });

  it('生成的节点 id 互不重复', () => {
    const nodes = normalizeAiNodes({ nodes: [{ type: 'llm' }, { type: 'llm' }, { type: 'llm' }] }, NODE_META);
    expect(new Set(nodes.map(n => n.id)).size).toBe(3);
  });

  it('最多截断到 12 个节点', () => {
    const many = Array.from({ length: 30 }, () => ({ type: 'llm' }));
    expect(normalizeAiNodes({ nodes: many }, NODE_META)).toHaveLength(12);
  });

  it('只使用受支持的节点类型', () => {
    const nodes = normalizeAiNodes({ nodes: [{ type: 'classifier' }, { type: 'condition' }] }, NODE_META);
    nodes.forEach(n => expect(WORKFLOW_NODE_TYPES).toContain(n.type));
  });
});

describe('buildLocalWorkflow', () => {
  it('无大模型时按关键词产出可用链路', () => {
    const plan = buildLocalWorkflow('做一个每日资讯摘要工作流', NODE_META);
    expect(plan.nodes.length).toBeGreaterThanOrEqual(3);
    expect(plan.nodes[0].type).toBe('input');
    expect(plan.nodes[plan.nodes.length - 1].type).toBe('output');
    expect(plan.local).toBe(true);
  });
  it('未知描述回退到通用链路，仍然首尾完整', () => {
    const plan = buildLocalWorkflow('随便搭一个', NODE_META);
    expect(plan.nodes[0].type).toBe('input');
    expect(plan.nodes.at(-1).type).toBe('output');
  });
});

describe('buildWorkflowSystemPrompt', () => {
  it('包含类型清单与 JSON 契约', () => {
    const prompt = buildWorkflowSystemPrompt(NODE_META, { name: 'w', nodes: [{ type: 'llm', title: 'A' }] });
    expect(prompt).toContain('- llm（大模型）');
    expect(prompt).toContain('"nodes"');
    expect(prompt).toContain('A');
  });
});
