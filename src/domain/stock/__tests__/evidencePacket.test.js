import { describe, expect, it } from 'vitest';
import { buildStockEvidencePacket, formatEvidencePacketForPrompt } from '../evidencePacket.js';

const bars = Array.from({ length: 30 }, (_, index) => ({ close: 100 + index, timestamp: 1_000 }));

describe('stock evidence packet', () => {
  it('keeps market evidence separate from unavailable research dimensions', () => {
    const packet = buildStockEvidencePacket({
      stock: { code: 'TEST', name: '示例' },
      realtime: { price: 129, changePct: 1.5, amount: 2e8, timestamp: 1_000 },
      klines: bars,
      benchmarkKlines: bars,
      benchmark: { name: '上证指数' },
      sectors: [{ name: '算力', changePct: 2.3, timestamp: 1_000 }],
      diagnosis: { status: 'ready', rating: '强势', risk: 'medium', metrics: { momentum5: 3.2, excessReturn20: 1.1 }, dataQuality: { bars: 30 } },
      now: 2_000,
    });

    expect(packet.coverage).toEqual({ available: 5, total: 5, score: 100, label: '较完整' });
    expect(packet.facts.join(' ')).toContain('技术评级');
    expect(packet.facts.join(' ')).toContain('市场板块样本领先项');
    expect(packet.missing.join(' ')).toContain('财务报表');
    expect(packet.guardrail).toContain('时效');
  });

  it('demotes incomplete and stale quotes instead of overstating coverage', () => {
    const packet = buildStockEvidencePacket({
      realtime: { price: 10, timestamp: 1_000 },
      now: 60 * 60_000,
    });

    expect(packet.dimensions.find(item => item.key === 'quote')?.status).toBe('partial');
    expect(packet.coverage.label).toBe('不足');
    expect(packet.coverage.score).toBeLessThan(20);
    expect(packet.partial.join(' ')).toContain('行情已过期');
    expect(packet.facts.join(' ')).not.toContain('现价');
  });

  it('demotes connected series when their timestamps are missing or stale', () => {
    const packet = buildStockEvidencePacket({
      realtime: { price: 10, changePct: 0, amount: 1e8, timestamp: 1_000 },
      klines: Array.from({ length: 20 }, (_, index) => ({ close: 10 + index })),
      benchmarkKlines: Array.from({ length: 20 }, (_, index) => ({ close: 20 + index, timestamp: 1_000 })),
      diagnosis: { status: 'ready', rating: '强势', risk: 'medium', metrics: { excessReturn20: 1.2 }, dataQuality: { bars: 20 } },
      now: 20 * 24 * 60 * 60_000,
    });

    expect(packet.dimensions.find(item => item.key === 'trend')?.status).toBe('partial');
    expect(packet.dimensions.find(item => item.key === 'benchmark')?.status).toBe('partial');
    expect(packet.facts.join(' ')).not.toContain('技术评级');
    expect(packet.facts.join(' ')).not.toContain('20 期超额');
  });

  it('rejects future quote timestamps as current evidence', () => {
    const packet = buildStockEvidencePacket({
      realtime: { price: 10, changePct: 0, timestamp: 2_000 },
      now: 1_000,
    });

    expect(packet.dimensions.find(item => item.key === 'quote')?.status).toBe('partial');
    expect(packet.dimensions.find(item => item.key === 'quote')?.detail).toContain('更新时间异常');
  });

  it('formats explicit confirmed and missing sections for the AI prompt', () => {
    const packet = buildStockEvidencePacket({ realtime: { price: 10, changePct: 0, timestamp: 1_000 }, now: 1_000 });
    const prompt = formatEvidencePacketForPrompt(packet);
    expect(prompt).toContain('证据覆盖');
    expect(prompt).toContain('已确认');
    expect(prompt).toContain('待补充');
    expect(prompt).toContain('不形成行动结论');
  });
});