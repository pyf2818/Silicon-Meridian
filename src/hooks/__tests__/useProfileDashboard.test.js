// src/hooks/__tests__/useProfileDashboard.test.js
// Phase 4 D2: buildTrendSeries / buildAiStatusCounts 纯函数单元测试
// 测试纯函数文件（不 import hook，避免 store 初始化时 localStorage 依赖）

import { describe, it, expect } from 'vitest';
import { buildTrendSeries, buildAiStatusCounts } from '../../utils/dashboardBuilders.js';

describe('buildTrendSeries', () => {
  it('handles empty array', () => {
    const result = buildTrendSeries([]);
    expect(result.labels).toEqual([]);
    expect(result.series).toHaveLength(1);
    expect(result.series[0].values).toEqual([]);
  });

  it('handles undefined input', () => {
    const result = buildTrendSeries(undefined);
    expect(result.labels).toEqual([]);
    expect(result.series[0].values).toEqual([]);
  });

  it('slices snapshot_date to MM-DD format', () => {
    const snapshots = [
      { snapshot_date: '2026-07-28', item_count: 10 },
      { snapshot_date: '2026-07-27', item_count: 8 },
    ];
    const result = buildTrendSeries(snapshots);
    expect(result.labels).toEqual(['07-28', '07-27']);
    expect(result.series[0].values).toEqual([10, 8]);
  });

  it('handles missing item_count as 0', () => {
    const snapshots = [{ snapshot_date: '2026-07-28' }];
    const result = buildTrendSeries(snapshots);
    expect(result.series[0].values).toEqual([0]);
  });

  it('handles missing snapshot_date as empty string', () => {
    const snapshots = [{ item_count: 5 }];
    const result = buildTrendSeries(snapshots);
    expect(result.labels).toEqual(['']);
    expect(result.series[0].values).toEqual([5]);
  });

  it('returns single series named "每日推荐数"', () => {
    const result = buildTrendSeries([{ snapshot_date: '2026-07-28', item_count: 1 }]);
    expect(result.series).toHaveLength(1);
    expect(result.series[0].name).toBe('每日推荐数');
  });
});

describe('buildAiStatusCounts', () => {
  it('handles empty array', () => {
    expect(buildAiStatusCounts([])).toEqual({});
  });

  it('handles undefined input', () => {
    expect(buildAiStatusCounts(undefined)).toEqual({});
  });

  it('counts single status', () => {
    const snapshots = [
      { ai_status: 'generated' },
      { ai_status: 'generated' },
      { ai_status: 'generated' },
    ];
    expect(buildAiStatusCounts(snapshots)).toEqual({ generated: 3 });
  });

  it('counts mixed statuses', () => {
    const snapshots = [
      { ai_status: 'generated' },
      { ai_status: 'merged' },
      { ai_status: 'generated' },
      { ai_status: 'ai_failed' },
      { ai_status: 'merged' },
    ];
    expect(buildAiStatusCounts(snapshots)).toEqual({
      generated: 2,
      merged: 2,
      ai_failed: 1,
    });
  });

  it('treats missing ai_status as unknown', () => {
    const snapshots = [
      { ai_status: 'generated' },
      {}, // missing ai_status
      { ai_status: null },
    ];
    const counts = buildAiStatusCounts(snapshots);
    expect(counts.generated).toBe(1);
    expect(counts.unknown).toBe(2);
  });

  it('handles all unknown', () => {
    const snapshots = [{}, {}, {}];
    expect(buildAiStatusCounts(snapshots)).toEqual({ unknown: 3 });
  });
});
