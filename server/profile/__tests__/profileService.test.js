import { describe, it, expect } from 'vitest';
import { normalizeBriefingConfig, normalizeSnapshot } from '../profileService.js';

describe('normalizeBriefingConfig (Phase 1.4 Task 18)', () => {
  it('returns default when input is null/undefined', () => {
    expect(normalizeBriefingConfig(null)).toEqual({ length: 'standard', includeRead: false });
    expect(normalizeBriefingConfig(undefined)).toEqual({ length: 'standard', includeRead: false });
  });

  it('returns default when length is invalid', () => {
    expect(normalizeBriefingConfig({ length: 'invalid' })).toEqual({ length: 'standard', includeRead: false });
    expect(normalizeBriefingConfig({ length: 123 })).toEqual({ length: 'standard', includeRead: false });
    expect(normalizeBriefingConfig({ length: '' })).toEqual({ length: 'standard', includeRead: false });
  });

  it('preserves valid length values (compact/standard/detailed)', () => {
    expect(normalizeBriefingConfig({ length: 'compact' }).length).toBe('compact');
    expect(normalizeBriefingConfig({ length: 'standard' }).length).toBe('standard');
    expect(normalizeBriefingConfig({ length: 'detailed' }).length).toBe('detailed');
  });

  it('preserves includeRead boolean', () => {
    expect(normalizeBriefingConfig({ length: 'detailed', includeRead: true })).toEqual({ length: 'detailed', includeRead: true });
    expect(normalizeBriefingConfig({ length: 'standard', includeRead: false })).toEqual({ length: 'standard', includeRead: false });
  });

  it('coerces non-boolean includeRead to false', () => {
    expect(normalizeBriefingConfig({ length: 'standard', includeRead: 'yes' }).includeRead).toBe(false);
    expect(normalizeBriefingConfig({ length: 'standard', includeRead: 1 }).includeRead).toBe(false);
    expect(normalizeBriefingConfig({ length: 'standard', includeRead: null }).includeRead).toBe(false);
  });
});

describe('normalizeSnapshot (Phase 1.4 Task 18)', () => {
  it('returns null when date missing or invalid', () => {
    expect(normalizeSnapshot({ confidence: 50 })).toBeNull();
    expect(normalizeSnapshot({ date: null, confidence: 50 })).toBeNull();
    expect(normalizeSnapshot({ date: 'not-a-date', confidence: 50 })).toBeNull();
  });

  it('truncates ISO date to YYYY-MM-DD', () => {
    const r = normalizeSnapshot({ date: '2026-07-28T12:00:00Z', confidence: 60 });
    expect(r.date).toBe('2026-07-28');
  });

  it('preserves YYYY-MM-DD date as-is', () => {
    const r = normalizeSnapshot({ date: '2026-07-28', confidence: 60 });
    expect(r.date).toBe('2026-07-28');
  });

  it('coerces numeric confidence string to number', () => {
    const r = normalizeSnapshot({ date: '2026-07-28', confidence: '60' });
    expect(r.confidence).toBe(60);
  });

  it('clamps confidence to 0-100 range', () => {
    expect(normalizeSnapshot({ date: '2026-07-28', confidence: 150 }).confidence).toBe(100);
    expect(normalizeSnapshot({ date: '2026-07-28', confidence: -10 }).confidence).toBe(0);
  });

  it('truncates summary to 500 chars', () => {
    const r = normalizeSnapshot({ date: '2026-07-28', confidence: 60, summary: 'x'.repeat(600) });
    expect(r.summary.length).toBe(500);
  });

  it('returns null when confidence is missing', () => {
    expect(normalizeSnapshot({ date: '2026-07-28' })).toBeNull();
  });
});
