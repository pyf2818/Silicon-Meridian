import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessages,
  shouldCompact,
  findCutRegion,
  buildContext,
  localSummary,
  buildCompactionPrompt,
} from '../contextManager.js';

// ---------------------------------------------------------------------------
// estimateTokens / estimateMessages
// ---------------------------------------------------------------------------
describe('estimateTokens', () => {
  it('空消息返回 0', () => {
    expect(estimateTokens({ role: 'user', content: '' })).toBe(0);
    expect(estimateTokens({ role: 'user', content: '   ' })).toBe(0);
  });

  it('中文字符按 ~1/1.5 估算，为保守起见非空中文 > 0', () => {
    const t = estimateTokens({ role: 'user', content: '中文内容一段话' });
    expect(t).toBeGreaterThan(0);
    // 7 个汉字 / 1.5 ≈ 5
    expect(t).toBe(5);
  });

  it('英文按 /3.5 估算', () => {
    const t = estimateTokens({ role: 'user', content: 'hello world' });
    expect(t).toBe(3); // 11 字符 / 3.5 ≈ 3.14 -> ceil 4? 实际按 cjk=0, other=11
  });

  it('混合中英文相加', () => {
    const t = estimateTokens({ role: 'user', content: 'abc 中文' });
    // 去空白后 abc中文：cjk=2 -> ceil(2/1.5)=2, other=3 -> ceil(3/3.5)=1, total=3
    expect(t).toBe(3);
  });
});

describe('estimateMessages', () => {
  it('对列表求和', () => {
    const msgs = [
      { role: 'user', content: '中文内容' },
      { role: 'assistant', content: 'abc' },
    ];
    const sum = estimateMessages(msgs);
    expect(sum).toBe(estimateTokens(msgs[0]) + estimateTokens(msgs[1]));
  });
});

describe('shouldCompact', () => {
  it('未超预算返回 false', () => {
    const msgs = [{ role: 'user', content: 'hi' }];
    expect(shouldCompact(msgs, 1000)).toBe(false);
  });

  it('超预算返回 true', () => {
    const msgs = [{ role: 'user', content: '你好'.repeat(500) }];
    expect(shouldCompact(msgs, 100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findCutRegion
// ---------------------------------------------------------------------------
describe('findCutRegion', () => {
  function makeSeq(n) {
    return Array.from({ length: n }, (_, i) => ({
      role: i === 0 ? 'user' : (i % 2 ? 'assistant' : 'user'),
      content: `m${i} ${'文'.repeat(5)}`,
    }));
  }

  it('消息太少时不压缩', () => {
    expect(findCutRegion(makeSeq(4), { keepRecent: 2, cutMin: 2 })).toBeNull();
  });

  it('跳过首条并保留最近 keepRecent', () => {
    const region = findCutRegion(makeSeq(12), { keepRecent: 3, cutMin: 2 });
    expect(region).not.toBeNull();
    expect(region.cutStart).toBe(1);
    expect(region.cutEnd).toBe(12 - 3);
    expect(region.cutRegion.length).toBe(12 - 1 - 3);
  });

  it('cutRegion 不足 cutMin 时返回 null', () => {
    const region = findCutRegion(makeSeq(7), { keepRecent: 4, cutMin: 3 });
    expect(region).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------
describe('buildContext', () => {
  const longMsgs = [
    { role: 'user', content: '根' },
    { role: 'user', content: '旧消息一 ' + '文'.repeat(200) },
    { role: 'assistant', content: '旧回答 ' + '文'.repeat(200) },
    { role: 'user', content: '旧消息二 ' + '文'.repeat(200) },
    { role: 'assistant', content: '最近回答' },
  ];

  it('未超预算原样返回', async () => {
    const out = await buildContext(longMsgs, 1_000_000);
    expect(out.compressed).toBe(false);
    expect(out.messages).toHaveLength(longMsgs.length);
  });

  it('超预算时中段折叠为摘要，保留根与最近', async () => {
    const out = await buildContext(longMsgs, 50, { keepRecent: 1, cutMin: 2 });
    expect(out.compressed).toBe(true);
    // 首条 + 摘要 + 最近 1 条
    expect(out.messages.length).toBeLessThan(longMsgs.length);
    expect(out.messages[0].role).toBe('user');
    expect(out.messages[out.messages.length - 1].content).toBe('最近回答');
    // 压缩节点是 system 摘要
    const summary = out.messages.find(m => m.role === 'system');
    expect(summary).toBeTruthy();
    expect(summary.content).toContain('摘要');
  });

  it('支持外部 generateSummary 覆盖摘要文本', async () => {
    const out = await buildContext(longMsgs, 50, {
      keepRecent: 1,
      cutMin: 2,
      generateSummary: async () => 'LLM摘要',
    });
    expect(out.compressed).toBe(true);
    expect(out.messages.find(m => m.role === 'system').content).toContain('LLM摘要');
  });

  it('generateSummary 抛错时降级本地摘要，不失败', async () => {
    const out = await buildContext(longMsgs, 50, {
      keepRecent: 1,
      cutMin: 2,
      generateSummary: async () => { throw new Error('x'); },
    });
    expect(out.compressed).toBe(true);
    expect(out.messages.find(m => m.role === 'system').content).toContain('摘要');
  });
});

describe('localSummary', () => {
  it('生成分段摘要', () => {
    const region = [
      { role: 'user', content: '第一个用户问题' },
      { role: 'assistant', content: '第一个回答' },
    ];
    const s = localSummary(region);
    expect(s).toContain('用户');
    expect(s).toContain('助手');
    expect(s).toContain('第一个用户问题');
  });

  it('空区域返回空串', () => {
    expect(localSummary([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildCompactionPrompt（LLM 真压缩提示词）
// ---------------------------------------------------------------------------
describe('buildCompactionPrompt', () => {
  it('生成 system + user 两段提示词', () => {
    const region = [
      { role: 'user', content: '帮我调研 klinecharts v10 的 API 变化' },
      { role: 'tool', content: '搜索结果：v10 移除了 applyNewData…' },
      { role: 'assistant', content: '结论：v10 用 setDataLoader 替代' },
    ];
    const { system, user } = buildCompactionPrompt(region);
    expect(system).toContain('压缩');
    expect(system).toContain('[资讯:ID]'); // 要求保留引用锚点
    expect(user).toContain('帮我调研');
    expect(user).toContain('[工具输出]');
  });

  it('超长内容被截断到 1200 字符', () => {
    const region = [{ role: 'user', content: 'x'.repeat(5000) }];
    const { user } = buildCompactionPrompt(region);
    expect(user.length).toBeLessThan(2000);
    expect(user).toContain('(截断)');
  });

  it('空区域安全', () => {
    const { user } = buildCompactionPrompt([]);
    expect(user).toContain('0 条消息');
  });
});