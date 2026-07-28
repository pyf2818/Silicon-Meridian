import { describe, it, expect } from 'vitest';
import { buildListQuery, parseListResponse } from '../useAgentMemories.js';

describe('buildListQuery', () => {
  it('builds query with page offset and memoryType', () => {
    const q = buildListQuery({ page: 1, pageSize: 10, memoryType: 'user_habit' });
    expect(q).toEqual({ memoryType: 'user_habit', limit: 10, offset: 10 });
  });

  it('omits memoryType when empty string', () => {
    const q = buildListQuery({ page: 0, pageSize: 10, memoryType: '' });
    expect(q.memoryType).toBeUndefined();
  });

  it('omits memoryType when undefined', () => {
    const q = buildListQuery({ page: 0, pageSize: 20, memoryType: undefined });
    expect(q.memoryType).toBeUndefined();
  });

  it('clamps limit to reasonable range', () => {
    const q1 = buildListQuery({ page: 0, pageSize: 0, memoryType: '' });
    expect(q1.limit).toBeGreaterThanOrEqual(1);
    const q2 = buildListQuery({ page: 0, pageSize: 200, memoryType: '' });
    expect(q2.limit).toBeLessThanOrEqual(100);
  });
});

describe('parseListResponse', () => {
  it('extracts memories array and computes hasMore=true when full page', () => {
    const memories = Array(10).fill({ id: 'x', content: 'c' });
    const parsed = parseListResponse({ ok: true, memories }, 10);
    expect(parsed.items).toHaveLength(10);
    expect(parsed.hasMore).toBe(true);
  });

  it('hasMore=false when memories < pageSize', () => {
    const parsed = parseListResponse({ ok: true, memories: [{ id: 'x' }] }, 10);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.hasMore).toBe(false);
  });

  it('returns empty items and hasMore=false on falsy payload', () => {
    const parsed = parseListResponse(null, 10);
    expect(parsed.items).toEqual([]);
    expect(parsed.hasMore).toBe(false);
  });

  it('returns empty items when memories field missing', () => {
    const parsed = parseListResponse({ ok: true }, 10);
    expect(parsed.items).toEqual([]);
    expect(parsed.hasMore).toBe(false);
  });
});
