import { describe, it, expect } from 'vitest';
import { buildSavePayload, mergeSnapshots } from '../useProfileSync.js';

describe('buildSavePayload', () => {
  it('includes original 3 blocks (domains/sources/specialFollows) + expectedVersion', () => {
    const payload = buildSavePayload({
      domainTiers: { ai: 'focus', web: 'normal' },
      sourceTiers: { 'src-1': 'focus' },
      specialFollows: [{ type: 'keyword', target: 'GPU', note: '' }],
      expectedVersion: 3,
    });
    expect(payload.expectedVersion).toBe(3);
    expect(payload.domainTiers).toEqual({ ai: 'focus', web: 'normal' });
    expect(payload.sourceTiers).toEqual({ 'src-1': 'focus' });
    expect(payload.specialFollows).toEqual([{ type: 'keyword', target: 'GPU', note: '' }]);
  });

  it('includes briefingConfig when provided', () => {
    const payload = buildSavePayload({
      domainTiers: {},
      sourceTiers: {},
      specialFollows: [],
      briefingConfig: { length: 'detailed', includeRead: true },
      expectedVersion: null,
    });
    expect(payload.briefingConfig).toEqual({ length: 'detailed', includeRead: true });
  });

  it('includes only today snapshot from dailyProfileSnapshots (not full history)', () => {
    const today = { date: '2026-07-28', confidence: 80, summary: '今日' };
    const yesterday = { date: '2026-07-27', confidence: 60, summary: '昨日' };
    const payload = buildSavePayload({
      domainTiers: {},
      sourceTiers: {},
      specialFollows: [],
      dailyProfileSnapshots: [today, yesterday],
      expectedVersion: null,
    });
    expect(payload.dailyProfileSnapshots).toHaveLength(1);
    expect(payload.dailyProfileSnapshots[0].date).toBe('2026-07-28');
  });

  it('excludes dailyProfileSnapshots when empty or absent', () => {
    const payload1 = buildSavePayload({
      domainTiers: {}, sourceTiers: {}, specialFollows: [],
      dailyProfileSnapshots: [],
      expectedVersion: null,
    });
    expect(payload1.dailyProfileSnapshots).toEqual([]);

    const payload2 = buildSavePayload({
      domainTiers: {}, sourceTiers: {}, specialFollows: [],
      expectedVersion: null,
    });
    expect(payload2.dailyProfileSnapshots).toEqual([]);
  });

  it('omits briefingConfig when not provided (defaults to null and stripped)', () => {
    const payload = buildSavePayload({
      domainTiers: {}, sourceTiers: {}, specialFollows: [],
      expectedVersion: null,
    });
    // briefingConfig 未提供时为 null，buildSavePayload 会跳过该字段
    expect(payload).not.toHaveProperty('briefingConfig');
  });
});

describe('mergeSnapshots', () => {
  it('adds remote snapshots missing locally', () => {
    const local = [{ date: '2026-07-28', confidence: 80, summary: '今日本地' }];
    const remote = [
      { date: '2026-07-28', confidence: 80, summary: '今日远端' },
      { date: '2026-07-27', confidence: 60, summary: '昨日远端' },
    ];
    const merged = mergeSnapshots(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.find(s => s.date === '2026-07-27')).toBeDefined();
  });

  it('does not overwrite local with remote for same date', () => {
    const local = [{ date: '2026-07-28', confidence: 90, summary: '本地更新' }];
    const remote = [{ date: '2026-07-28', confidence: 50, summary: '远端旧版本' }];
    const merged = mergeSnapshots(local, remote);
    expect(merged).toHaveLength(1);
    // 本地优先：远端同日不覆盖
    expect(merged[0].confidence).toBe(90);
    expect(merged[0].summary).toBe('本地更新');
  });

  it('caps merged snapshots to 30 entries sorted by date desc', () => {
    const local = [];
    const remote = [];
    for (let i = 1; i <= 40; i++) {
      remote.push({
        date: `2026-07-${String(i).padStart(2, '0')}`,
        confidence: 50,
        summary: `day-${i}`,
      });
    }
    const merged = mergeSnapshots(local, remote);
    expect(merged).toHaveLength(30);
    // 最新日期在前
    expect(merged[0].date).toBe('2026-07-40');
  });

  it('handles empty remote array', () => {
    const local = [{ date: '2026-07-28', confidence: 80, summary: '' }];
    const merged = mergeSnapshots(local, []);
    expect(merged).toEqual(local);
  });
});
