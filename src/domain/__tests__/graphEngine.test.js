import { describe, expect, it } from 'vitest';
import { buildGraphData, topHubs } from '../graphEngine.js';

const mat = (id, title, type, tags) => ({ id, title, type, tags });

describe('graphEngine.buildGraphData（v22 关联度增强）', () => {
  it('素材与共享标签建边，tag 节点 val 反映引用次数', () => {
    const { nodes, links } = buildGraphData([
      mat('a', '素材A', 'viewpoint', ['AI', '芯片']),
      mat('b', '素材B', 'case', ['AI']),
      mat('c', '素材C', 'data', ['模型']),
    ]);
    expect(nodes.find(n => n.id === 'tag:AI').val).toBe(2);
    expect(links.filter(l => l.kind === 'tag').length).toBe(4);
  });

  it('共享 ≥2 标签的素材之间生成 strong 边，strength=共享数', () => {
    const { links } = buildGraphData([
      mat('a', '素材A', 'viewpoint', ['AI', '芯片', '算力']),
      mat('b', '素材B', 'case', ['AI', '芯片']),
      mat('c', '素材C', 'data', ['AI']),
    ]);
    const strong = links.filter(l => l.kind === 'strong');
    expect(strong.length).toBe(1);
    expect(strong[0].strength).toBe(2);
    expect([strong[0].source, strong[0].target].sort()).toEqual(['a', 'b']);
  });

  it('节点携带 degree（连接数）且素材 val 随度数增长', () => {
    const { nodes } = buildGraphData([
      mat('a', '素材A', 'viewpoint', ['AI', '芯片', '算力']),
      mat('b', '素材B', 'case', ['AI']),
    ]);
    const a = nodes.find(n => n.id === 'a');
    const b = nodes.find(n => n.id === 'b');
    expect(a.degree).toBe(3);
    expect(b.degree).toBe(1);
    expect(a.val).toBeGreaterThan(b.val);
  });

  it('topHubs 按度数降序返回前 N 个节点', () => {
    const data = buildGraphData([
      mat('a', '素材A', 'viewpoint', ['AI', '芯片', '算力', '云']),
      mat('b', '素材B', 'case', ['AI']),
      mat('c', '素材C', 'data', ['芯片']),
    ]);
    const hubs = topHubs(data, 3);
    expect(hubs[0].id).toBe('a');
    expect(hubs[0].degree).toBeGreaterThanOrEqual(hubs[1].degree);
    expect(hubs.every(h => typeof h.label === 'string' && h.label.length > 0)).toBe(true);
  });
});
