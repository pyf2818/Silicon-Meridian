import { describe, expect, it } from 'vitest';
import { canonicalItemId, canonicalSpaceId, hasItemId, matchesItemId, matchesSpaceId } from '../itemIdentity.js';

describe('item identity', () => {
  it('normalizes numeric and string ids', () => {
    expect(canonicalItemId(42)).toBe('42');
    expect(matchesItemId(42, '42')).toBe(true);
    expect(matchesItemId('', '42')).toBe(false);
  });

  it('finds an item regardless of id representation', () => {
    expect(hasItemId([{ originalItemId: 42 }], 'originalItemId', '42')).toBe(true);
    expect(hasItemId([{ itemId: 'x' }], 'itemId', 42)).toBe(false);
  });
});

describe('space identity', () => {
  it('keeps opaque string ids intact and trims padding', () => {
    expect(canonicalSpaceId('space-abc')).toBe('space-abc');
    expect(canonicalSpaceId('  space-abc  ')).toBe('space-abc');
    expect(canonicalSpaceId(1712345678901)).toBe('1712345678901');
  });

  it('never yields NaN for non-numeric space ids (the historical bug)', () => {
    // Number('space-abc') === NaN 曾让「空间筛选恒空 / 指派静默丢失」
    expect(canonicalSpaceId('space-abc')).not.toBe('NaN');
    expect(Number.isNaN(Number(canonicalSpaceId('space-abc')))).toBe(true);
  });

  it('collapses unusable values to empty string', () => {
    expect(canonicalSpaceId(null)).toBe('');
    expect(canonicalSpaceId(undefined)).toBe('');
    expect(canonicalSpaceId(NaN)).toBe('');
    expect(canonicalSpaceId(Infinity)).toBe('');
    expect(canonicalSpaceId(true)).toBe('');
    expect(canonicalSpaceId({})).toBe('');
    expect(canonicalSpaceId([])).toBe('');
  });

  it('matches across number/string representation but never against "no space"', () => {
    expect(matchesSpaceId(42, '42')).toBe(true);
    expect(matchesSpaceId('space-a', 'space-a')).toBe(true);
    expect(matchesSpaceId('space-a', 'space-b')).toBe(false);
    expect(matchesSpaceId(0, '0')).toBe(true);
    expect(matchesSpaceId('', '42')).toBe(false);
    expect(matchesSpaceId(null, '42')).toBe(false);
    expect(matchesSpaceId(NaN, NaN)).toBe(false);
    expect(matchesSpaceId(null, null)).toBe(false);
  });
});
