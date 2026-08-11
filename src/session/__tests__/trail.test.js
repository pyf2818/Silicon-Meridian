import { describe, it, expect } from 'vitest';
import {
  genTrailId,
  normalizeMessage,
  appendMessage,
  linearToTrail,
  getActivePath,
  makeBranch,
  getLeafIds,
  activeTrail,
} from '../trail.js';

describe('genTrailId', () => {
  it('带前缀且唯一性差异明显', () => {
    const a = genTrailId('m');
    const b = genTrailId('m');
    expect(a.startsWith('m_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('normalizeMessage', () => {
  it('补全 id/parentId/createdAt，保留角色', () => {
    const raw = { role: 'user', content: 'hi' };
    const n = normalizeMessage(raw, { parentId: 'p1', overrideParent: true });
    expect(n.id).toBeTruthy();
    expect(n.parentId).toBe('p1');
    expect(n.role).toBe('user');
    expect(n.content).toBe('hi');
    expect(Number.isFinite(n.createdAt)).toBe(true);
  });

  it('非 tool/assistant 一律归一为 user', () => {
    expect(normalizeMessage({ role: 'weird', content: 'x' }).role).toBe('user');
    expect(normalizeMessage({ role: 'tool', content: 't' }).role).toBe('tool');
  });

  it('保留 toolCalls/thinking/meta', () => {
    const n = normalizeMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'c1' }], thinking: 'think', meta: { a: 1 } });
    expect(n.toolCalls).toHaveLength(1);
    expect(n.thinking).toBe('think');
    expect(n.meta.a).toBe(1);
  });

  it('overrideParent=false 时沿用已有 parentId', () => {
    const n = normalizeMessage({ role: 'user', content: 'x', parentId: 'mine' }, { parentId: 'other' });
    expect(n.parentId).toBe('mine');
  });
});

describe('appendMessage', () => {
  it('默认接在上一条之后', () => {
    const m0 = { id: 'a', role: 'user', content: '根' };
    const msgs = appendMessage([m0], { role: 'assistant', content: '答' });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].parentId).toBe('a');
  });

  it('previousId 显式指定时优先', () => {
    const msgs = appendMessage([{ id: 'a', role: 'user', content: '根' }], { id: 'b', role: 'assistant', content: '答' }, { previousId: 'a' });
    expect(msgs[1].parentId).toBe('a');
  });

  it('空列表时 parent 为 null', () => {
    const msgs = appendMessage([], { id: 'a', role: 'user', content: 'x' });
    expect(msgs[0].parentId).toBe(null);
  });
});

describe('linearToTrail', () => {
  it('把线性数组转成单链', () => {
    const trail = linearToTrail([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
    expect(trail).toHaveLength(3);
    expect(trail[0].parentId).toBe(null);
    expect(trail[1].parentId).toBe(trail[0].id);
    expect(trail[2].parentId).toBe(trail[1].id);
  });
});

describe('getActivePath', () => {
  it('从根到叶子回溯路径', () => {
    const messages = [
      { id: 'a', parentId: null, role: 'user', content: '根' },
      { id: 'b', parentId: 'a', role: 'assistant', content: 'B' },
      { id: 'c', parentId: 'b', role: 'user', content: 'C' },
    ];
    const path = getActivePath(messages, 'c');
    expect(path.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('未知叶子返回空', () => {
    expect(getActivePath([{ id: 'a', parentId: null, role: 'user', content: 'x' }], 'zz')).toEqual([]);
  });

  it('防环：有环时不无限循环', () => {
    const messages = [
      { id: 'a', parentId: 'b', role: 'user', content: 'x' },
      { id: 'b', parentId: 'a', role: 'user', content: 'y' },
    ];
    const path = getActivePath(messages, 'a');
    expect(path.length).toBeLessThanOrEqual(2);
  });
});

describe('makeBranch', () => {
  const base = [
    { id: 'a', parentId: null, role: 'user', content: '根' },
    { id: 'b', parentId: 'a', role: 'assistant', content: 'B' },
    { id: 'c', parentId: 'b', role: 'user', content: 'C' },
  ];

  it('从叶子继续=路径延伸', () => {
    const { branch } = makeBranch(base, 'c', [{ role: 'assistant', content: '新答' }]);
    expect(branch.map(m => m.id)).toEqual(['a', 'b', 'c', branch[3].id]);
    expect(branch[3].parentId).toBe('c');
  });

  it('从历史节点分叉', () => {
    const { branch } = makeBranch(base, 'b', [{ role: 'user', content: '分叉' }]);
    // 路径到 b，新消息挂 b 下
    expect(branch.map(m => m.id)).toEqual(['a', 'b', branch[2].id]);
    expect(branch[2].parentId).toBe('b');
    // 原树未被修改
    expect(base).toHaveLength(3);
  });

  it('锚点不存在返回空分支', () => {
    const { branch } = makeBranch(base, 'nope', [{ role: 'user', content: 'x' }]);
    expect(branch).toEqual([]);
  });
});

describe('getLeafIds / activeTrail', () => {
  it('叶子 = 无子节点', () => {
    const messages = [
      { id: 'a', parentId: null, role: 'user', content: '根' },
      { id: 'b', parentId: 'a', role: 'assistant', content: 'B' },
      { id: 'c', parentId: 'b', role: 'user', content: 'C' },
      { id: 'd', parentId: 'a', role: 'assistant', content: 'second branch' },
    ];
    expect(getLeafIds(messages).sort()).toEqual(['c', 'd']);
  });

  it('activeTrail 等价于 getActivePath', () => {
    const messages = [
      { id: 'a', parentId: null, role: 'user', content: '根' },
      { id: 'b', parentId: 'a', role: 'assistant', content: 'B' },
    ];
    expect(activeTrail(messages, 'b').map(m => m.id)).toEqual(getActivePath(messages, 'b').map(m => m.id));
  });
});