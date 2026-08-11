import { describe, it, expect, beforeEach } from 'vitest';
import { forkLinearSession } from '../trailStore.js';

// 测试 forkLinearSession（不依赖 localStorage——它是纯函数）
describe('forkLinearSession', () => {
  const session = {
    id: 's1',
    title: '原会话',
    messages: [
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' },
      { role: 'assistant', content: 'D' },
    ],
  };

  it('无锚点时返回完整会话复制（含 parentId 链）', () => {
    const { messages, anchorIndex, parentId } = forkLinearSession(session);
    expect(messages).toHaveLength(4);
    expect(anchorIndex).toBe(-1);
    expect(parentId).toBe(messages[0].id);
    // 是单链
    expect(messages[0].parentId).toBe(null);
    expect(messages[1].parentId).toBe(messages[0].id);
    expect(messages[2].parentId).toBe(messages[1].id);
    expect(messages[3].parentId).toBe(messages[2].id);
  });

  it('anchorIndex 锚定时保留 [0..anchor]（历史 + 锚点=上下文根）', () => {
    const { messages, anchorIndex } = forkLinearSession(session, { anchorIndex: 2 });
    expect(messages.map(m => m.content)).toEqual(['A', 'B', 'C']);
    expect(anchorIndex).toBe(2);
    // 根置 null
    expect(messages[0].parentId).toBe(null);
    // 后续仍单链
    expect(messages[1].parentId).toBe(messages[0].id);
    expect(messages[2].parentId).toBe(messages[1].id);
  });

  it('keepOnlyFromAnchor=true 时保留 [anchor..]（分支根）', () => {
    const { messages } = forkLinearSession(session, { anchorIndex: 1, keepOnlyFromAnchor: true });
    expect(messages.map(m => m.content)).toEqual(['B', 'C', 'D']);
    expect(messages[0].parentId).toBe(null);
    expect(messages[1].parentId).toBe(messages[0].id);
  });

  it('越界索引回退为全会话（不崩溃）', () => {
    const { messages, anchorIndex } = forkLinearSession(session, { anchorIndex: 99 });
    expect(messages).toHaveLength(4);
    expect(anchorIndex).toBe(-1);
  });

  it('空会话返回空', () => {
    const out = forkLinearSession({ id: 's', messages: [] });
    expect(out.messages).toEqual([]);
    expect(out.parentId).toBe(null);
  });

  it('原始会话不被修改（不可变）', () => {
    const before = JSON.stringify(session.messages.map(m => ({ ...m, parentId: null })));
    forkLinearSession(session, { anchorIndex: 2 });
    forkLinearSession(session);
    // 原消息无 id/parentId，内部 normalize 不污染外部
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0]).not.toHaveProperty('id');
  });
});