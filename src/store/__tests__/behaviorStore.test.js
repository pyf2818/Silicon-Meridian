import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBehaviorStore, migrateLegacyBehavior } from '../behaviorStore.js';

// 项目惯例：vitest 默认 environment 为 'node'，需用 vi.stubGlobal 注入 localStorage
// （参考 src/domain/creative/__tests__/versionStore.test.js 同款写法）
function installLocalStorage() {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(key => store.get(key) || null),
    setItem: vi.fn((key, value) => store.set(key, String(value))),
    removeItem: vi.fn(key => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  });
}

describe('migrateLegacyBehavior', () => {
  beforeEach(() => { installLocalStorage(); });

  it('merges legacy localStorage keys into persisted state', () => {
    localStorage.setItem('readingHistory', JSON.stringify([{ id: 'a', readAt: '2026-07-01' }]));
    localStorage.setItem('followKeywords', JSON.stringify(['AI']));
    localStorage.setItem('trackTargets', JSON.stringify([{ term: 'GPU' }]));
    localStorage.setItem('recommendationFeedback', JSON.stringify({
      boostedCategories: { ai: 1 }, mutedSources: {}, trackedTerms: {}, hiddenIds: []
    }));
    localStorage.setItem('recommendationFeedback:v2', JSON.stringify([{ type: 'boost', target: 'ai' }]));

    const result = migrateLegacyBehavior({});
    expect(result.readingHistory).toHaveLength(1);
    expect(result.followKeywords).toEqual(['AI']);
    expect(result.trackTargets).toHaveLength(1);
    expect(result.recommendationFeedback.boostedCategories.ai).toBe(1);
    expect(result.recommendationFeedbackEvents).toHaveLength(1);
  });

  it('does not override persisted state if legacy key absent', () => {
    const result = migrateLegacyBehavior({ followKeywords: ['existing'] });
    expect(result.followKeywords).toEqual(['existing']);
  });
});

describe('useBehaviorStore actions', () => {
  beforeEach(() => {
    installLocalStorage();
    useBehaviorStore.getState().clearAll?.();
  });

  it('addReadingHistory appends with cap 200', () => {
    for (let i = 0; i < 210; i++) useBehaviorStore.getState().addReadingHistory({ id: `i${i}` });
    expect(useBehaviorStore.getState().readingHistory).toHaveLength(200);
    expect(useBehaviorStore.getState().readingHistory[0].id).toBe('i209');
  });

  it('addFollowKeyword dedupes', () => {
    useBehaviorStore.getState().addFollowKeyword('AI');
    useBehaviorStore.getState().addFollowKeyword('AI');
    expect(useBehaviorStore.getState().followKeywords).toEqual(['AI']);
  });

  it('addTrackTarget dedupes by term', () => {
    useBehaviorStore.getState().addTrackTarget({ term: 'GPU' });
    useBehaviorStore.getState().addTrackTarget({ term: 'GPU', note: 'updated' });
    expect(useBehaviorStore.getState().trackTargets).toHaveLength(1);
    expect(useBehaviorStore.getState().trackTargets[0].note).toBe('updated');
  });
});
