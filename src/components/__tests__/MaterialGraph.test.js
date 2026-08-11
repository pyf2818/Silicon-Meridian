import { describe, it, expect } from 'vitest';
import { buildGraphData, TYPE_COLORS } from '../../domain/graphEngine.js';

const MATERIALS = [
  { id: 'm1', title: '英伟达芯片', type: 'viewpoint', tags: ['芯片', '英伟达'] },
  { id: 'm2', title: '大模型备案', type: 'case', tags: ['政策', '芯片'] },
  { id: 'm3', title: 'OpenAI 新模型', type: 'knowledge', tags: ['OpenAI'] },
];

describe('buildGraphData', () => {
  it('生成素材节点 + tag 节点 + 边', () => {
    const { nodes, links } = buildGraphData(MATERIALS);
    // 3 素材 + 4 唯一 tag
    expect(nodes.length).toBe(3 + 4);
    // 边 = 每条素材的每个 tag
    expect(links.length).toBe(2 + 2 + 1);
  });

  it('tag 节点 id 带前缀，不与素材 id 冲突', () => {
    const { nodes } = buildGraphData(MATERIALS);
    const tagNodes = nodes.filter(n => n.kind === 'tag');
    expect(tagNodes.length).toBe(4);
    for (const n of tagNodes) expect(n.id.startsWith('tag:')).toBe(true);
  });

  it('tag 节点 val 反映被引用数', () => {
    const { nodes } = buildGraphData(MATERIALS);
    const chip = nodes.find(n => n.id === 'tag:芯片');
    // 芯片被 m1、m2 引用
    expect(chip.val).toBe(2);
  });

  it('边连接素材与共享 tag', () => {
    const { links } = buildGraphData(MATERIALS);
    // m1 与 芯片 相连
    expect(links.some(l => l.source === 'm1' && l.target === 'tag:芯片')).toBe(true);
  });

  it('空素材返回空', () => {
    expect(buildGraphData([])).toEqual({ nodes: [], links: [] });
  });

  it('maxNodes 限制素材数', () => {
    const { nodes } = buildGraphData(MATERIALS, { maxNodes: 2 });
    const matNodes = nodes.filter(n => n.kind === 'material');
    expect(matNodes.length).toBe(2);
  });
});

describe('TYPE_COLORS', () => {
  it('覆盖常用素材类型', () => {
    for (const t of ['viewpoint', 'case', 'knowledge', 'material']) {
      expect(TYPE_COLORS[t]).toBeTruthy();
    }
  });
});