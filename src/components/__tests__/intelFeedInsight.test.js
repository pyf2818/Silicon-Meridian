import { describe, it, expect } from 'vitest';
import { buildIntelInsight } from '../IntelligenceFeedPanel.jsx';

const baseEvent = {
  id: 'ev-1',
  title: 'OpenAI 发布新模型',
  impactScore: 80,
  heatScore: 60,
  intelligenceScore: 88,
  confidence: 70,
  independentSourceCount: 3,
  sources: ['A', 'B', 'C'],
  reasons: [],
  entities: [],
};

describe('buildIntelInsight：GDELT 佐证解读', () => {
  it('有 verification 时输出佐证行（strong/partial 措辞区分）', () => {
    const strong = buildIntelInsight({
      ...baseEvent,
      verification: { provider: 'gdelt', distinctDomains: 6, level: 'strong', checkedAt: '2026-09-11T00:00:00Z', samples: [] },
    });
    expect(strong.lines.some(l => l.includes('GDELT 交叉佐证：6 家独立域名报道（强佐证）'))).toBe(true);

    const partial = buildIntelInsight({
      ...baseEvent,
      verification: { provider: 'gdelt', distinctDomains: 2, level: 'partial', checkedAt: '2026-09-11T00:00:00Z', samples: [] },
    });
    expect(partial.lines.some(l => l.includes('2 家独立域名报道（部分佐证）'))).toBe(true);
  });

  it('无 verification 时不输出佐证行（其余解读不受影响）', () => {
    const insight = buildIntelInsight(baseEvent);
    expect(insight.lines.some(l => l.includes('GDELT'))).toBe(false);
    expect(insight.lines.some(l => l.includes('3 家独立信源报道'))).toBe(true);
    expect(insight.headline).toContain('综合评分 88');
  });

  it('空事件返回 null', () => {
    expect(buildIntelInsight(null)).toBeNull();
  });
});
