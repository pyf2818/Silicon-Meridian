import { expect, it, vi } from 'vitest';
import { runStockAnalysis, buildDiagnosisRecord, buildBriefingSnapshots } from '../useStockAi.js';

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
  expect(systemPrompt).toContain('结论（先看这里）');
  expect(systemPrompt).toContain('买卖参考价和时间');
  expect(systemPrompt).toContain('预计时间窗口');
  expect(systemPrompt).toContain('止损价');
  expect(systemPrompt).toContain('老舵主');
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
  expect(systemPrompt).toContain('结论（先看这里）');
  expect(systemPrompt).toContain('买卖点与时间预测');
  expect(systemPrompt).toContain('预计时间窗口');
  expect(systemPrompt).toContain('买点剧本');
  expect(systemPrompt).toContain('卖点剧本');
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

it('v36.3：诊断历史记录附带图表快照（metrics/多空证据/K线瘦身序列），历史预览可重现图表', () => {
  const klines = Array.from({ length: 80 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    close: 100 + i, high: 101 + i, low: 99 + i, volume: 1000 + i * 10,
  }));
  const record = buildDiagnosisRecord({
    stock: { code: 'sz300502', name: '新易盛' },
    mode: 'ai', status: 'ready', rating: '强势', risk: 'medium',
    metrics: { price: 453.66, ma20: 440, support: 430, resistance: 470, momentum5: 2.1 },
    bullCase: ['站上 MA20'], bearCase: ['RSI 偏高'], invalidation: ['跌破 430'], riskSignals: ['波动率 32%'],
    dataQuality: { bars: 80 },
    usage: { total_tokens: 999 },
    content: '结论',
  }, klines);
  expect(record.status).toBe('ready');
  expect(record.metrics.price).toBeCloseTo(453.66);
  expect(record.bullCase).toEqual(['站上 MA20']);
  expect(record.bearCase).toHaveLength(1);
  expect(record.invalidation).toEqual(['跌破 430']);
  expect(record.riskSignals).toHaveLength(1);
  expect(record.dataQuality.bars).toBe(80);
  // K 线快照：只留最近 60 根、瘦身三字段
  expect(record.klinesSnapshot).toHaveLength(60);
  expect(record.klinesSnapshot[0].close).toBe(120); // 80 根取后 60 → 首根是第 21 根
  expect(Object.keys(record.klinesSnapshot[0]).sort()).toEqual(['close', 'date', 'volume']);
});

it('v36.3：buildBriefingSnapshots——自选股优先覆盖 + 热门股按涨跌幅补位 + 指标来自 analyzeStock', async () => {
  const hotStocks = Array.from({ length: 12 }, (_, i) => ({
    code: `hot${i}`, name: `热门${i}`, price: 10 + i, changePct: i - 6, amount: '1亿',
  }));
  const watchlist = [{ code: 'my1', name: '自选一' }, { code: 'my2', name: '自选二' }];
  const fetchKline = vi.fn(async (code) => Array.from({ length: 30 }, (_, i) => ({
    date: `d${i}`, close: 50 + i, high: 51 + i, low: 49 + i, volume: 800 + i * 7,
  })));
  const snaps = await buildBriefingSnapshots({ stocks: hotStocks, watchlist, fetchKline });
  // 自选 2 只全部入选，其余按 |涨跌幅| 从热门里补，总量 ≤12
  expect(snaps.length).toBeLessThanOrEqual(12);
  const watchSnaps = snaps.filter(s => s.fromWatchlist);
  expect(watchSnaps.map(s => s.code).sort()).toEqual(['my1', 'my2']);
  // 指标来自确定性算法而非 AI
  const first = snaps[0];
  expect(first.ma20).not.toBeNull();
  expect(first.closes).toHaveLength(30);
  expect(first.closes[0]).toBeCloseTo(50);
  expect(first.volumes).toHaveLength(30);
  expect(['expanding', 'contracting', 'stable']).toContain(first.volumeTrend);
  expect(typeof first.rating).toBe('string');
  // fetchKline 每只调一次
  expect(fetchKline.mock.calls.length).toBe(snaps.length);
});

it('v36.3：buildBriefingSnapshots——K 线拉取失败的单只静默跳过，不阻塞整份早报', async () => {
  const fetchKline = vi.fn(async (code) => {
    if (code === 'bad') throw new Error('upstream down');
    return Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, close: 10 + i, volume: 100 }));
  });
  const snaps = await buildBriefingSnapshots({
    stocks: [{ code: 'ok', name: '正常股', price: 10, changePct: 1 }, { code: 'bad', name: '坏数据', price: 5, changePct: 5 }],
    watchlist: [],
    fetchKline,
  });
  expect(snaps.map(s => s.code)).toEqual(['ok']);
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
