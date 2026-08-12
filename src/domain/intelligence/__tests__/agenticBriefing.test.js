import { describe, it, expect } from 'vitest';
import {
  runClusterAnalysis,
  buildAgenticBriefing,
  DEFAULT_AGENTS,
} from '../agenticBriefing.js';

// 确定性 mock LLM：从输入里识别「视角接力」还是「总控合成」，回声不同文本
function makeMockLlm() {
  let calls = 0;
  const llmCall = async ({ user }) => {
    calls += 1;
    if (user.includes('协作汇总')) return `SYNTHESIS#${calls}`;
    const m = user.match(/你是第 (.+?)。/);
    const label = m ? m[1] : '视角';
    return `VIEW(${label})#${calls}`;
  };
  return { llmCall, getCalls: () => calls };
}

const cluster = (id, title, n = 2) => ({
  id,
  primaryItem: { title, id: `${id}-p` },
  items: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, title })),
  itemIds: Array.from({ length: n }, (_, i) => `${id}-${i}`),
  independentSourceCount: n,
});

describe('agenticBriefing', () => {
  it('缺少 llmCall 时抛错', async () => {
    await expect(buildAgenticBriefing({ clusters: [cluster('x', 'A')] })).rejects.toThrow(/llmCall/);
  });

  it('runClusterAnalysis 跑完视角链并产出合成', async () => {
    const { llmCall } = makeMockLlm();
    const { views, synthesis } = await runClusterAnalysis({
      cluster: cluster('c1', '事件C', 3),
      task: '分析事件C',
      llmCall,
      agents: DEFAULT_AGENTS,
    });
    // DEFAULT_CHAIN = 5 个视角；synthesizer 单独产出 synthesis
    expect(views).toHaveLength(5);
    expect(views.map((v) => v.viewLabel)).toEqual([
      '资讯视角', '技术视角', '商业视角', '风险视角', '创作视角',
    ]);
    expect(synthesis).toContain('SYNTHESIS');
    // 每个 view 都拿到了 llm 输出
    views.forEach((v) => expect(v.output).toContain('VIEW'));
  });

  it('buildAgenticBriefing 按热度截断并合成总览', async () => {
    const mock = makeMockLlm();
    const clusters = [
      cluster('hot', '热点事件', 5),
      cluster('mid', '中等事件', 3),
      cluster('cold', '冷门事件', 1),
    ];
    const briefing = await buildAgenticBriefing({
      clusters,
      llmCall: mock.llmCall,
      opts: { maxClusters: 2 },
    });

    expect(briefing.mode).toBe('agentic');
    expect(briefing.clusters).toHaveLength(2); // 仅前 2 个（按 items 降序）
    expect(briefing.clusters[0].primaryTitle).toBe('热点事件');
    expect(briefing.total).toContain('SYNTHESIS');
    // 调用次数 = 2 簇 * (5 视角 + 1 合成) + 1 跨簇总览 = 13
    expect(mock.getCalls()).toBe(13);
  });

  it('每个簇携带 itemIds 与来源数', async () => {
    const { llmCall } = makeMockLlm();
    const briefing = await buildAgenticBriefing({
      clusters: [cluster('c1', '事件一', 4)],
      llmCall,
      opts: { maxClusters: 1 },
    });
    const c = briefing.clusters[0];
    expect(c.itemCount).toBe(4);
    expect(c.sourceCount).toBe(4);
    expect(c.itemIds).toEqual(['c1-0', 'c1-1', 'c1-2', 'c1-3']);
  });
});
