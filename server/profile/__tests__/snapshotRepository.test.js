import { describe, it, expect } from 'vitest';
import { buildInsertItemsParams } from '../snapshotRepository.js';

describe('buildInsertItemsParams', () => {
  it('builds params for both lanes', () => {
    const lanes = {
      public: [{ id: 'a', mustReadScore: 80, scoreParts: { x: 40 }, reasons: ['fresh'] }],
      personal: [{ id: 'b', mustReadScore: 70, scoreParts: { x: 35 }, reasons: ['domain'] }],
    };
    const { values, params } = buildInsertItemsParams('snap-1', lanes);
    expect(values.split('),(')).toHaveLength(2);
    expect(params[0]).toBe('snap-1'); // snapshotId
    expect(params[1]).toBe('a'); // item_id
  });

  it('handles empty lanes', () => {
    const { values, params } = buildInsertItemsParams('snap-1', { public: [], personal: [] });
    expect(values).toBe('');
    expect(params).toEqual([]);
  });

  it('handles missing lanes gracefully', () => {
    const { values, params } = buildInsertItemsParams('snap-1', {});
    expect(values).toBe('');
    expect(params).toEqual([]);
  });

  it('assigns correct lane label and position to each item', () => {
    const lanes = {
      public: [
        { id: 'a1', mustReadScore: 80, scoreParts: {}, reasons: [] },
        { id: 'a2', mustReadScore: 70, scoreParts: {}, reasons: [] },
      ],
      personal: [
        { id: 'b1', mustReadScore: 60, scoreParts: {}, reasons: [] },
      ],
    };
    const { params } = buildInsertItemsParams('snap-1', lanes);
    // params layout: snapshotId, itemId, lane, position, score, scoreParts, reasons, payload (8 per item)
    expect(params).toHaveLength(8 * 3);
    // First item: public, position 0
    expect(params[1]).toBe('a1');
    expect(params[2]).toBe('public');
    expect(params[3]).toBe(0);
    // Third item: personal, position 0
    expect(params[8 + 8 + 1]).toBe('b1');
    expect(params[8 + 8 + 2]).toBe('personal');
    expect(params[8 + 8 + 3]).toBe(0);
  });
});
