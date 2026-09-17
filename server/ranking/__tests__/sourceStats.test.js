import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES_FOR_DYNAMIC,
  flushSourceStats,
  getDynamicSourceScore,
  recordBlockedHits,
  recordCorroborations,
  recordTopHits,
  resetSourceStatsForTests,
  setSourceStatsStorePath,
} from '../sourceStats.js';
import { sourceTrustSignal } from '../signals.js';

let dir;

function useTempStore() {
  dir = mkdtempSync(path.join(tmpdir(), 'source-stats-'));
  setSourceStatsStorePath(path.join(dir, 'source-stats.json'));
}

afterEach(() => {
  resetSourceStatsForTests();
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; }
});

describe('sourceStats（P4 源动态分）', () => {
  it('样本不足 → 返回 null（宁可保守，不给源定性）', () => {
    useTempStore();
    recordTopHits(['好源', '好源', '好源']);
    expect(getDynamicSourceScore('好源')).toBe(null);
    expect(MIN_SAMPLES_FOR_DYNAMIC).toBeGreaterThanOrEqual(10);
  });

  it('样本达标 → 命中率归一为动态分', () => {
    useTempStore();
    recordTopHits(Array(12).fill('独家用户新闻源'));
    expect(getDynamicSourceScore('独家用户新闻源')).toBe(1);
    for (let i = 0; i < 4; i += 1) recordBlockedHits(['独家用户新闻源']);
    // 12 命中 / 4 屏蔽 = 0.75
    expect(getDynamicSourceScore('独家用户 新闻源'.replace(/\s/g, ''))).toBeCloseTo(0.75);
  });

  it('被屏蔽越多动态分越低（用户用脚投票的反向信号）', () => {
    useTempStore();
    recordTopHits(['差源', '差源']);
    recordBlockedHits(Array(10).fill('差源'));
    expect(getDynamicSourceScore('差源')).toBeCloseTo(2 / 12, 2);
  });

  it('corroborations 单独记录（报表用，不参与 v1 动态分）', () => {
    useTempStore();
    recordCorroborations([{ source: '验源', count: 3 }]);
    flushSourceStats();
    const store = JSON.parse(readFileSync(path.join(dir, 'source-stats.json'), 'utf8'));
    expect(store.sources['验源'].corroborations).toBe(1);
  });

  it('持久化：flush 后换实例仍能读回（进程重启不丢）', () => {
    useTempStore();
    recordTopHits(Array(15).fill('持久源'));
    flushSourceStats();
    resetSourceStatsForTests();
    expect(getDynamicSourceScore('持久源')).toBe(1);
  });

  it('sourceTrustSignal：有动态分时 30% 参与混合；无样本时纯静态', () => {
    useTempStore();
    const item = { source: '混合源', sourceWeight: 1 };
    expect(sourceTrustSignal(item).value).toBe(1);            // 静态满分
    recordTopHits(Array(6).fill('混合源'));
    recordBlockedHits(Array(6).fill('混合源'));               // 动态分 0.5
    const blended = sourceTrustSignal(item);
    expect(blended.value).toBeCloseTo(1 * 0.7 + 0.5 * 0.3, 5);
    expect(blended.reason).toContain('动态表现');
  });

  it('空来源名不炸', () => {
    useTempStore();
    expect(() => recordTopHits(['', null, undefined])).not.toThrow();
    expect(getDynamicSourceScore('')).toBe(null);
  });
});
