// src/utils/__tests__/personaEvolution.test.js
// Phase 5: personaSummary 进化趋势纯函数单元测试

import { describe, it, expect } from 'vitest';
import { buildPersonaTrendSeries, diffPersonaSnapshots } from '../dashboardBuilders.js';

describe('buildPersonaTrendSeries', () => {
  it('handles empty array', () => {
    const result = buildPersonaTrendSeries([]);
    expect(result.labels).toEqual([]);
    expect(result.series).toHaveLength(3);
    expect(result.series[0].values).toEqual([]);
  });

  it('handles undefined input', () => {
    const result = buildPersonaTrendSeries(undefined);
    expect(result.labels).toEqual([]);
    expect(result.series[0].values).toEqual([]);
  });

  it('returns 3 series named 习惯/性格/需求', () => {
    const result = buildPersonaTrendSeries([{ snapshot: { habits: [], traits: [], needs: [] }, evolved_at: '2026-07-28T10:00:00Z' }]);
    expect(result.series.map(s => s.name)).toEqual(['习惯', '性格', '需求']);
  });

  it('maps snapshot array lengths to values', () => {
    const history = [
      { snapshot: { habits: ['a'], traits: ['b', 'c'], needs: [] }, evolved_at: '2026-07-28T10:00:00Z' },
      { snapshot: { habits: ['a', 'd'], traits: ['b'], needs: ['e'] }, evolved_at: '2026-07-27T10:00:00Z' },
    ];
    const result = buildPersonaTrendSeries(history);
    // 倒序转正序：先 07-27 再 07-28
    expect(result.labels).toEqual(['07-27 10:00', '07-28 10:00']);
    expect(result.series[0].values).toEqual([2, 1]); // 习惯 (07-27: ['a','d']=2, 07-28: ['a']=1)
    expect(result.series[1].values).toEqual([1, 2]); // 性格
    expect(result.series[2].values).toEqual([1, 0]); // 需求
  });

  it('handles missing snapshot as 0 values', () => {
    const result = buildPersonaTrendSeries([{ evolved_at: '2026-07-28T10:00:00Z' }]);
    expect(result.series[0].values).toEqual([0]);
    expect(result.series[1].values).toEqual([0]);
    expect(result.series[2].values).toEqual([0]);
  });

  it('handles null snapshot', () => {
    const result = buildPersonaTrendSeries([{ snapshot: null, evolved_at: '2026-07-28T10:00:00Z' }]);
    expect(result.series[0].values).toEqual([0]);
  });

  it('handles missing evolved_at as empty label', () => {
    const result = buildPersonaTrendSeries([{ snapshot: { habits: ['a'] } }]);
    expect(result.labels).toEqual(['']);
  });

  it('reverses DESC input to ASC output', () => {
    // API 返回 DESC（最新在前），前端需要 ASC（从左到右时间递进）
    const history = [
      { snapshot: { habits: ['c'] }, evolved_at: '2026-07-30T10:00:00Z' },
      { snapshot: { habits: ['a'] }, evolved_at: '2026-07-28T10:00:00Z' },
    ];
    const result = buildPersonaTrendSeries(history);
    expect(result.labels).toEqual(['07-28 10:00', '07-30 10:00']);
  });
});

describe('diffPersonaSnapshots', () => {
  it('returns empty diff for identical snapshots', () => {
    const snap = { habits: ['a'], traits: ['b'], needs: ['c'] };
    const diff = diffPersonaSnapshots(snap, snap);
    expect(diff.habits.added).toEqual([]);
    expect(diff.habits.removed).toEqual([]);
    expect(diff.traits.added).toEqual([]);
    expect(diff.traits.removed).toEqual([]);
    expect(diff.needs.added).toEqual([]);
    expect(diff.needs.removed).toEqual([]);
  });

  it('detects additions', () => {
    const prev = { habits: ['a'], traits: [], needs: [] };
    const current = { habits: ['a', 'b'], traits: ['c'], needs: [] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.added).toEqual(['b']);
    expect(diff.habits.removed).toEqual([]);
    expect(diff.traits.added).toEqual(['c']);
  });

  it('detects removals', () => {
    const prev = { habits: ['a', 'b'], traits: ['c'], needs: ['d'] };
    const current = { habits: ['a'], traits: [], needs: [] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.removed).toEqual(['b']);
    expect(diff.traits.removed).toEqual(['c']);
    expect(diff.needs.removed).toEqual(['d']);
  });

  it('handles empty inputs', () => {
    const diff = diffPersonaSnapshots({}, {});
    expect(diff.habits.added).toEqual([]);
    expect(diff.habits.removed).toEqual([]);
  });

  it('handles undefined inputs', () => {
    const diff = diffPersonaSnapshots(undefined, undefined);
    expect(diff.habits.added).toEqual([]);
  });

  it('handles missing keys gracefully', () => {
    const prev = { habits: ['a'] };
    const current = { traits: ['b'] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.removed).toEqual(['a']);
    expect(diff.traits.added).toEqual(['b']);
    expect(diff.needs.added).toEqual([]);
  });

  it('uses string comparison for dedup (number vs string)', () => {
    const prev = { habits: [1, 2] };
    const current = { habits: ['1', '2', '3'] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.added).toEqual(['3']);
    expect(diff.habits.removed).toEqual([]);
  });
});
