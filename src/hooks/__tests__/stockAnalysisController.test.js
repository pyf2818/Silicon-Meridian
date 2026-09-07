import { expect, it, vi } from 'vitest';
import { runStockAnalysis } from '../useStockAi.js';

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
  expect(systemPrompt).toContain('面向新手用户');
  expect(systemPrompt).toContain('一句话结论');
  expect(systemPrompt).toContain('新手学习点');
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
  expect(systemPrompt).toContain('面向专业用户');
  expect(systemPrompt).toContain('证据权重');
  expect(systemPrompt).toContain('失效条件');
});
