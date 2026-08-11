import { describe, it, expect, beforeEach } from 'vitest';
import { rememberCompaction, getSessionMemories, retrieveRelevantMemories } from '../sessionMemory.js';

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

beforeEach(() => {
  mockLocalStorage();
});

describe('rememberCompaction', () => {
  it('写入 compaction 记忆', () => {
    rememberCompaction('s1', '关于 AI 芯片的讨论');
    const mems = getSessionMemories();
    expect(mems).toHaveLength(1);
    expect(mems[0].sessionId).toBe('s1');
    expect(mems[0].kind).toBe('compaction');
    expect(mems[0].topic).toContain('AI 芯片');
  });

  it('同 sessionId 不重复写（压缩可能每轮触发）', () => {
    rememberCompaction('s1', '第一次摘要');
    rememberCompaction('s1', '第二次摘要');
    expect(getSessionMemories().length).toBe(1);
  });

  it('不同 sessionId 各自写', () => {
    rememberCompaction('s1', '摘要1');
    rememberCompaction('s2', '摘要2');
    expect(getSessionMemories()).toHaveLength(2);
  });

  it('空 sessionId / 空摘要不写', () => {
    rememberCompaction('', 'x');
    rememberCompaction('s1', '');
    expect(getSessionMemories()).toHaveLength(0);
  });
});

describe('retrieveRelevantMemories / compaction 可检索', () => {
  it('压缩记忆可被新会话检索命中（英文/空格分词场景）', () => {
    rememberCompaction('old-session', 'NVIDIA GPU compute');
    // 排除旧会话本身；tokenize 对英文空格可拆分，命中 nvidia
    const hits = retrieveRelevantMemories('nvidia gpu', 'new-session', 3);
    expect(hits.some(m => m.kind === 'compaction' && m.topic.toLowerCase().includes('nvidia'))).toBe(true);
  });
});