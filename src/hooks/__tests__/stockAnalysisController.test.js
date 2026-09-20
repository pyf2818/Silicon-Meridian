import { expect, it, vi } from 'vitest';
import { runStockAnalysis, buildDiagnosisRecord } from '../useStockAi.js';

const input = {
  stock: { name: '示例', code: 'TEST' },
  realtime: { price: 129 },
  klines: Array.from({ length: 30 }, (_, index) => ({ close: 100 + index, high: 101 + index, low: 98 + index, volume: 1000 + index * 50 })),
};

it('returns algorithm analysis without LLM configuration', async () => {
  const result = await runStockAnalysis({ input, llmConfig: {}, callLlm: vi.fn() });
  expect(result.mode).toBe('algorithm');
  expect(result.rating).toBe('强势');
});

it('keeps algorithm evidence when AI enhancement fails', async () => {
  const result = await runStockAnalysis({
    input,
    llmConfig: { baseUrl: 'x', apiKey: 'x', selectedModel: 'x' },
    callLlm: vi.fn().mockRejectedValue(new Error('timeout')),
  });
  expect(result.mode).toBe('algorithm');
  expect(result.rating).toBe('强势');
  expect(result.aiError).toBe('timeout');
  expect(result.metrics.ma20).not.toBeNull();
});

it('adapts AI guidance for beginner mode and investor policy', async () => {
  const callLlm = vi.fn().mockResolvedValue('解释完成');
  await runStockAnalysis({
    input,
    experienceMode: 'beginner',
    investorPolicy: { horizon: '中线', riskTolerance: '稳健', riskPerTrade: 1 },
    llmConfig: { baseUrl: 'x', apiKey: 'x', selectedModel: 'x' },
    callLlm,
  });
  const [, systemPrompt] = callLlm.mock.calls[0];
  expect(systemPrompt).toContain('输出层级：新手版');
  expect(systemPrompt).toContain('一句话操作判断');
  expect(systemPrompt).toContain('什么时候买');
  expect(systemPrompt).toContain('止损价');
  expect(systemPrompt).toContain('老舵主');
  // v31c：三价表硬性要求——预测的买入/卖出点直接给数字
  expect(systemPrompt).toContain('核心买卖参考价');
  expect(systemPrompt).toContain('目标卖出价');
  // v29：大师决策框架注入（利弗莫尔 / 欧奈尔 / 米勒维尼 公开方法论）
  expect(systemPrompt).toContain('利弗莫尔');
  expect(systemPrompt).toContain('欧奈尔');
  expect(systemPrompt).toContain('米勒维尼');
  expect(systemPrompt).toContain('稳健');
  expect(systemPrompt).toContain('1%');
});

it('adapts AI guidance for professional evidence review', async () => {
  const callLlm = vi.fn().mockResolvedValue('分析完成');
  await runStockAnalysis({
    input,
    experienceMode: 'pro',
    llmConfig: { baseUrl: 'x', apiKey: 'x', selectedModel: 'x' },
    callLlm,
  });
  const [, systemPrompt] = callLlm.mock.calls[0];
  expect(systemPrompt).toContain('输出层级：专业版');
  expect(systemPrompt).toContain('买点剧本');
  expect(systemPrompt).toContain('卖点剧本');
  // v31c：三价表硬性要求
  expect(systemPrompt).toContain('建议买入触发价');
  // 欧奈尔止损铁律数字必须出现在专业版卖点剧本中
  expect(systemPrompt).toContain('7-8%');
  expect(systemPrompt).toContain('失效条件');
});

it('v29：诊断历史记录只留展示字段（code/评级/模式/现价/内容）', () => {
  const record = buildDiagnosisRecord({
    stock: { code: '600519', name: '贵州茅台' },
    mode: 'ai', rating: '强势', risk: 'low',
    metrics: { price: 1257.12 },
    usage: { total_tokens: 1234 },
    content: '## 操作判断\n持有，等待突破。',
  });
  expect(record.code).toBe('600519');
  expect(record.name).toBe('贵州茅台');
  expect(record.mode).toBe('ai');
  expect(record.rating).toBe('强势');
  expect(record.risk).toBe('low');
  expect(record.price).toBeCloseTo(1257.12);
  expect(record.tokens).toBe(1234); // v31：token 用量随记录留存
  expect(record.content).toContain('操作判断');
  expect(typeof record.at).toBe('number');
  expect(record.id).toBeTruthy();
});

it('v31：AI 增强成功时透传上游 token 用量，无 mock usage 时为 null 不报错', async () => {
  const callLlm = vi.fn().mockResolvedValue('AI 结论');
  const result = await runStockAnalysis({
    input,
    experienceMode: 'pro',
    llmConfig: { baseUrl: 'x', apiKey: 'x', selectedModel: 'x' },
    callLlm,
  });
  expect(result.mode).toBe('ai');
  expect(result.content).toContain('AI 结论');
  expect(result.usage ?? null).toBeNull(); // mock 未回调 onUsage → null，UI 自动隐藏
});
