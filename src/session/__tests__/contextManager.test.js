import { describe, it, expect, vi } from 'vitest';
import {
  estimateTokens,
  estimateMessages,
  shouldCompact,
  findCutRegion,
  buildContext,
  localSummary,
  buildCompactionPrompt,
  packConversation,
  PACK_DEFAULTS,
  resolveContextBudget,
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
// ---------------------------------------------------------------------------
// packConversation —— 三个调用点（agent 工具循环 / 工作站流式 / 精灵流式）共用的唯一实现
// ---------------------------------------------------------------------------
describe('packConversation', () => {
  const mk = (role, content) => ({ role, content });
  const cjk = (n) => '中'.repeat(n); // 1 个中文字 ≈ 1 token（ceil(n/1.5)）

  it('空输入安全返回，不抛异常', async () => {
    for (const input of [[], null, undefined]) {
      const r = await packConversation(input);
      expect(r.messages).toEqual([]);
      expect(r.compressed).toBe(false);
      expect(r.tokens).toBe(0);
    }
  });

  it('未超预算：原样返回、不压缩、不调用摘要器', async () => {
    const generateSummary = vi.fn();
    const msgs = [mk('user', '你好'), mk('assistant', '在的')];
    const r = await packConversation(msgs, { budget: 10_000, generateSummary });
    expect(r.messages).toHaveLength(2);
    expect(r.compressed).toBe(false);
    expect(r.summaryText).toBe('');
    expect(generateSummary).not.toHaveBeenCalled();
  });

  it('未超预算但超过 fallbackLimit：按条数收拢尾部并标记 truncated', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) => mk('user', `m${i}`));
    const r = await packConversation(msgs, { budget: 10_000, fallbackLimit: 4 });
    expect(r.messages).toHaveLength(4);
    expect(r.messages[3].content).toBe('m9'); // 保留的是最新的
    expect(r.truncated).toBe(true);
  });

  it("summaryStrategy:'local' 不调用 LLM 摘要器（省一次调用）", async () => {
    const generateSummary = vi.fn();
    const msgs = [mk('user', cjk(20)), mk('assistant', cjk(400)), mk('user', cjk(400)), mk('assistant', '收尾')];
    const r = await packConversation(msgs, {
      budget: 200, keepRecent: 1, cutMin: 1, summaryStrategy: 'local', generateSummary,
    });
    expect(r.compressed).toBe(true);
    expect(generateSummary).not.toHaveBeenCalled();
    expect(r.summaryText).not.toBe('');
  });

  it("summaryStrategy:'llm' 调用摘要器并采用其返回值", async () => {
    const generateSummary = vi.fn(async () => 'LLM 生成的结构化摘要');
    const msgs = [mk('user', cjk(20)), mk('assistant', cjk(400)), mk('user', cjk(400)), mk('assistant', '收尾')];
    const r = await packConversation(msgs, {
      budget: 200, keepRecent: 1, cutMin: 1, summaryStrategy: 'llm', generateSummary,
    });
    expect(generateSummary).toHaveBeenCalledTimes(1);
    expect(r.summaryText).toBe('LLM 生成的结构化摘要');
    expect(r.messages.some((m) => m.content.includes('LLM 生成的结构化摘要'))).toBe(true);
  });

  it('LLM 摘要器抛错时降级为本地摘要，不向外抛', async () => {
    const generateSummary = vi.fn(async () => { throw new Error('上游挂了'); });
    const msgs = [mk('user', cjk(20)), mk('assistant', cjk(400)), mk('user', cjk(400)), mk('assistant', '收尾')];
    const r = await packConversation(msgs, {
      budget: 200, keepRecent: 1, cutMin: 1, summaryStrategy: 'llm', generateSummary,
    });
    expect(r.compressed).toBe(true);
    expect(r.summaryText).not.toBe(''); // 本地降级摘要兜住了
  });

  it('【核心回归】摘要窗口 === 压缩窗口：开头是 tool 的消息不会被算进摘要', async () => {
    // 旧实现用 messages.slice(1, len - keepRecent) 手算摘要窗口，
    // 会包含 index 1 的 tool 消息；而 findCutRegion 会跳过它（cutStart 推进到 2）。
    // 两者错位 → 摘要描述的内容与实际被压掉的内容不一致。
    const msgs = [
      mk('user', cjk(30)),        // 0 锚点，永不压缩
      mk('tool', cjk(30)),        // 1 开头的 tool：findCutRegion 会跳过
      mk('assistant', cjk(300)),  // 2 ┐
      mk('user', cjk(300)),       // 3 ├ 预期压缩窗口
      mk('assistant', cjk(300)),  // 4 ┘
      mk('user', 'TASK'),         // 5 keepRecent
      mk('assistant', 'OK'),      // 6 keepRecent
    ];
    const seen = [];
    const generateSummary = vi.fn(async (region) => { seen.push(region); return '摘要'; });

    const r = await packConversation(msgs, {
      budget: 200, keepRecent: 2, cutMin: 1, summaryStrategy: 'llm', generateSummary,
    });

    expect(r.compressed).toBe(true);
    expect(seen).toHaveLength(1);
    const region = seen[0];
    expect(region.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(region[0].content).toBe(msgs[2].content);
    // 关键断言：那条 tool 消息不在摘要窗口内
    expect(region.some((m) => m.role === 'tool')).toBe(false);
  });

  it("'local' 策略的摘要内容取自同一个 findCutRegion 窗口", async () => {
    const msgs = [
      mk('user', cjk(30)),
      mk('tool', cjk(30)),
      mk('assistant', cjk(300)),
      mk('user', cjk(300)),
      mk('assistant', cjk(300)),
      mk('user', 'TASK'),
      mk('assistant', 'OK'),
    ];
    const r = await packConversation(msgs, {
      budget: 200, keepRecent: 2, cutMin: 1, summaryStrategy: 'local',
    });
    // localSummary 对 3 条 assistant/user/assistant 生成 3 行，首行角色标签为「助手」
    const lines = r.summaryText.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('[助手]');
    expect(lines[1]).toContain('[用户]');
  });

  it('压缩窗口压不动时退回尾部条数兜底，绝不越界', async () => {
    // 全部是超长消息且 keepRecent 很大 → findCutRegion 返回 null
    const msgs = Array.from({ length: 6 }, (_, i) => mk('user', cjk(4000) + i));
    const r = await packConversation(msgs, {
      budget: 100, keepRecent: 6, cutMin: 1, fallbackLimit: 2,
    });
    expect(r.messages.length).toBeLessThanOrEqual(2);
  });

  it('返回值字段齐全，tokens 与 messages 自洽', async () => {
    const msgs = [mk('user', '你好'), mk('assistant', '在的')];
    const r = await packConversation(msgs, { budget: 10_000 });
    expect(Object.keys(r).sort()).toEqual(
      ['compressed', 'messages', 'originalTokens', 'summaryText', 'tokens', 'truncated'].sort(),
    );
    expect(r.tokens).toBe(estimateMessages(r.messages));
    expect(r.originalTokens).toBe(estimateMessages(msgs));
  });

  it('PACK_DEFAULTS 导出且缺省参数与其一致', async () => {
    const msgs = [mk('user', 'a'), mk('assistant', 'b')];
    const withDefaults = await packConversation(msgs);
    const withExplicit = await packConversation(msgs, {
      budget: PACK_DEFAULTS.budget,
      keepRecent: PACK_DEFAULTS.keepRecent,
      cutMin: PACK_DEFAULTS.cutMin,
      fallbackLimit: PACK_DEFAULTS.fallbackLimit,
    });
    expect(withExplicit.messages).toEqual(withDefaults.messages);
    expect(PACK_DEFAULTS.budget).toBe(48_000);
  });
});

// ---------------------------------------------------------------------------
// buildContext 回归：摘要器必须收到「真正的压缩窗口」，本地降级摘要不得为空
// 历史 BUG：把 region.cutRegion 误写成 region.region，导致摘要器恒收 undefined
//（「LLM 真压缩」形同虚设），且本地降级摘要恒为空串，压缩段被替换成一句「摘要（）」。
// ---------------------------------------------------------------------------
describe('buildContext 摘要窗口回归', () => {
  const mk = (role, content) => ({ role, content });
  const cjk = (n) => '中'.repeat(n);

  it('generateSummary 收到的是压缩窗口的消息数组，而非 undefined', async () => {
    const msgs = [mk('user', cjk(30)), mk('assistant', cjk(300)), mk('user', cjk(300)), mk('assistant', '尾')];
    const received = [];
    await buildContext(msgs, 200, {
      keepRecent: 1, cutMin: 1,
      generateSummary: async (region) => { received.push(region); return 'S'; },
    });
    expect(received).toHaveLength(1);
    expect(Array.isArray(received[0])).toBe(true);
    expect(received[0].length).toBeGreaterThan(0);
    expect(received[0].every((m) => typeof m.content === 'string')).toBe(true);
  });

  it('无摘要器时本地降级摘要非空（不再产出「摘要（）」）', async () => {
    const msgs = [mk('user', cjk(30)), mk('assistant', cjk(300)), mk('user', cjk(300)), mk('assistant', '尾')];
    const r = await buildContext(msgs, 200, { keepRecent: 1, cutMin: 1 });
    expect(r.compressed).toBe(true);
    expect(r.summaryText).not.toBe('');
    expect(r.summaryText).toContain('[助手]'); // localSummary 的角色标签
    const sysLine = r.messages.find((m) => m.role === 'system');
    expect(sysLine.content).not.toContain('摘要（）。');
  });

  it('摘要器返回空串时同样降级到非空本地摘要', async () => {
    const msgs = [mk('user', cjk(30)), mk('assistant', cjk(300)), mk('user', cjk(300)), mk('assistant', '尾')];
    const r = await buildContext(msgs, 200, {
      keepRecent: 1, cutMin: 1, generateSummary: async () => '',
    });
    expect(r.summaryText).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveContextBudget：预算随模型窗口自适应（2026-09-22）
// 规则：budget = clamp(floor(window × 0.85) − 12000, 2000, fallback)
// 大窗口模型 === fallback（行为与旧版一致）；小窗口收紧；未知模型原样返回 fallback。
// ---------------------------------------------------------------------------
describe('resolveContextBudget 模型窗口自适应', () => {
  it('大窗口 / 未知模型 === fallback，行为不变', () => {
    expect(resolveContextBudget('claude-sonnet-4', 48_000)).toBe(48_000);
    expect(resolveContextBudget('gpt-4o-mini', 40_000)).toBe(40_000);
    expect(resolveContextBudget('gemini-2.5-pro', 48_000)).toBe(48_000);
    expect(resolveContextBudget('some-unknown-model-v9', 48_000)).toBe(48_000);
    expect(resolveContextBudget(undefined, 40_000)).toBe(40_000);
  });

  it('小窗口模型收紧预算（qwen 32k → 15200；deepseek 64k 大于 fallback 时不放大）', () => {
    // 32000 × 0.85 − 12000 = 15200
    expect(resolveContextBudget('qwen-max', 48_000)).toBe(15_200);
    // 64000 × 0.85 − 12000 = 42400 → 与 48k 取 min = 42400（收紧但不放大到 48k）
    expect(resolveContextBudget('deepseek-chat', 48_000)).toBe(42_400);
    // deepseek 对 40k 的精灵路径：min(42400, 40000) = 40000（不变）
    expect(resolveContextBudget('deepseek-chat', 40_000)).toBe(40_000);
  });

  it('名字自带窗口的模型直接解析（moonshot-v1-8k → 6400 触底 2000 下限）', () => {
    // 8000 × 0.85 − 12000 < 0 → 下限 2000
    expect(resolveContextBudget('moonshot-v1-8k', 48_000)).toBe(2_000);
    // 32000 × 0.85 − 12000 = 15200
    expect(resolveContextBudget('moonshot-v1-32k', 48_000)).toBe(15_200);
    expect(resolveContextBudget('moonshot-v1-128k', 48_000)).toBe(48_000);
  });

  it('gpt-3.5 16k 收紧到 1600 触下限 2000（小窗口模型体验受限但不炸请求）', () => {
    expect(resolveContextBudget('gpt-3.5-turbo', 48_000)).toBe(2_000);
  });

  it('非法输入防御：fallback 非正数 / 窗口解析异常时安全回落', () => {
    expect(resolveContextBudget('claude-sonnet-4', NaN)).toBeNaN();
    expect(resolveContextBudget('claude-sonnet-4', -1)).toBe(-1);
    expect(resolveContextBudget('claude-sonnet-4', 0)).toBe(0);
  });
});
