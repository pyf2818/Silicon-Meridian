import { describe, it, expect } from 'vitest';
import { selectItemsForAiInsights } from '../snapshotService.js';

describe('selectItemsForAiInsights', () => {
  it('selects top 15 from each lane', () => {
    const lanes = {
      public: Array(20).fill(0).map((_, i) => ({ id: `p${i}` })),
      personal: Array(20).fill(0).map((_, i) => ({ id: `u${i}` })),
    };
    const result = selectItemsForAiInsights(lanes);
    expect(result).toHaveLength(30);
    expect(result[0].id).toBe('p0');
    expect(result[15].id).toBe('u0');
  });

  it('handles missing lanes gracefully', () => {
    const result = selectItemsForAiInsights({});
    expect(result).toEqual([]);
  });

  it('handles partial lanes', () => {
    const result = selectItemsForAiInsights({ public: [{ id: 'a' }] });
    expect(result).toEqual([{ id: 'a' }]);
  });

  it('caps at 15 per lane even if more provided', () => {
    const lanes = {
      public: Array(20).fill(0).map((_, i) => ({ id: `p${i}` })),
    };
    const result = selectItemsForAiInsights(lanes);
    expect(result).toHaveLength(15);
    expect(result[14].id).toBe('p14');
  });
});
