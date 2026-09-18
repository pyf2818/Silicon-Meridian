import { describe, expect, it } from 'vitest';
import {
  collectBranchReachable,
  deriveWorkflowExecutionOrder,
  getWorkflowNodePorts,
  normalizeWorkflowEdges,
  workflowEdgeKey,
} from '../workflowConstants.js';

/** 任务 2：无限画布——分支边数据模型 + 拓扑执行顺序 */

const node = (id, type = 'llm', extra = {}) => ({ id, type, title: id, role: 'r', prompt: 'p', enabled: true, ...extra });

describe('normalizeWorkflowEdges 分支边', () => {
  const nodes = [node('a'), node('b'), node('c')];

  it('同一 from→to 允许不同分支并存', () => {
    const edges = normalizeWorkflowEdges([
      { from: 'a', to: 'b', branch: '必读' },
      { from: 'a', to: 'b', branch: '降噪' },
      { from: 'a', to: 'b', branch: '必读' }, // 完全重复 → 去重
    ], nodes);
    expect(edges).toHaveLength(2);
    expect(edges.map(e => e.branch).sort()).toEqual(['必读', '降噪'].sort());
  });

  it('branch 缺省为空串且保留在 key 语义中', () => {
    const edges = normalizeWorkflowEdges([{ from: 'a', to: 'c' }], nodes);
    expect(edges[0].branch).toBe('');
    expect(workflowEdgeKey(edges[0])).toBe('a||c');
    expect(workflowEdgeKey({ from: 'a', branch: 'pass', to: 'c' })).toBe('a|pass|c');
  });

  it('悬空边清理 + bend 限幅', () => {
    const edges = normalizeWorkflowEdges([
      { from: 'a', to: 'ghost' },
      { from: 'a', to: 'b', bend: 999 },
    ], nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0].bend).toBe(160);
  });
});

describe('getWorkflowNodePorts 按类型区分输出口', () => {
  it('分类器：每个分类桶一个口', () => {
    const ports = getWorkflowNodePorts(node('c', 'classifier', { classifierLabels: '必读,追踪,降噪' }));
    expect(ports.map(p => p.id)).toEqual(['必读', '追踪', '降噪']);
  });

  it('条件：通过/不通过两口；路由：规则口 + 默认口', () => {
    expect(getWorkflowNodePorts(node('k', 'condition')).map(p => p.id)).toEqual(['pass', 'fail']);
    const router = getWorkflowNodePorts(node('r', 'router', {
      routes: [{ targetName: 'GitHub 评估', match: { op: 'contains', value: 'github' } }, { match: { value: 'stock' } }],
    }));
    expect(router.map(p => p.id)).toEqual(['route-0', 'route-1', 'default']);
  });

  it('普通节点单口；停用节点无口', () => {
    expect(getWorkflowNodePorts(node('l', 'llm'))).toHaveLength(1);
    expect(getWorkflowNodePorts({ ...node('x'), enabled: false })).toHaveLength(0);
  });
});

describe('deriveWorkflowExecutionOrder 拓扑执行顺序', () => {
  it('无显式边 → 数组顺序（向后兼容）', () => {
    const nodes = [node('a', 'input'), node('b'), node('c', 'output')];
    expect(deriveWorkflowExecutionOrder(nodes, []).map(p => p.node.id)).toEqual(['a', 'b', 'c']);
  });

  it('显式边驱动顺序：按连线走而非数组序', () => {
    const nodes = [node('a', 'input'), node('b'), node('c', 'output')];
    const edges = normalizeWorkflowEdges([{ from: 'b', to: 'c' }, { from: 'a', to: 'b' }], nodes);
    expect(deriveWorkflowExecutionOrder(nodes, edges).map(p => p.node.id)).toEqual(['a', 'b', 'c']);
  });

  it('分类器双分支：两条分支都被执行，环路安全', () => {
    const nodes = [
      node('input', 'input'),
      node('cls', 'classifier', { classifierLabels: '必读,降噪' }),
      node('deep'),
      node('report', 'output'),
    ];
    const edges = normalizeWorkflowEdges([
      { from: 'input', to: 'cls' },
      { from: 'cls', to: 'deep', branch: '必读' },
      { from: 'cls', to: 'report', branch: '降噪' },
      { from: 'deep', to: 'report' },
    ], nodes);
    const order = deriveWorkflowExecutionOrder(nodes, edges).map(p => p.node.id);
    expect(order).toEqual(['input', 'cls', 'deep', 'report']);
    // 分支语义随路径携带（deep 经「必读」，report 先后经「降噪」与默认边——记录首次进入分支）
    const plan = deriveWorkflowExecutionOrder(nodes, edges);
    expect(plan.find(p => p.node.id === 'deep').viaBranch).toBe('必读');
  });

  it('不可达节点追加尾部；禁用节点不参与', () => {
    const nodes = [node('a', 'input'), node('orphan'), node('b'), node('off', 'llm', { enabled: false })];
    const edges = normalizeWorkflowEdges([{ from: 'a', to: 'b' }], nodes);
    const order = deriveWorkflowExecutionOrder(nodes, edges).map(p => p.node.id);
    expect(order).toEqual(['a', 'b', 'orphan']);
  });
});

describe('collectBranchReachable 分支子树圈定', () => {
  const edges = [
    { from: 'cond', branch: 'pass', to: 'a' },
    { from: 'cond', branch: 'fail', to: 'b' },
    { from: 'a', to: 'a2' },
  ];
  it('pass 可达子树 / fail 可达子树各自独立', () => {
    expect(collectBranchReachable('cond', 'pass', edges)).toEqual(new Set(['a', 'a2']));
    expect(collectBranchReachable('cond', 'fail', edges)).toEqual(new Set(['b']));
    expect(collectBranchReachable('cond', 'pass', [{ from: 'cond', branch: 'pass', to: 'x' }])).toEqual(new Set(['x']));
  });
});
