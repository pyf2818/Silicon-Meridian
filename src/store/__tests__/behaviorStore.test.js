import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBehaviorStore, migrateLegacyBehavior, normalizePersistedBehavior } from '../behaviorStore.js';

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

describe('useBehaviorStore 预览历史（v26.8）', () => {
  beforeEach(() => {
    installLocalStorage();
    useBehaviorStore.getState().clearAll?.();
  });

  const previewItem = { id: 'n1', title: '标题', source: '源', category: 'ai-models' };

  it('recordPreview 记入预览轨迹并并入阅读记录（depth=preview）', () => {
    useBehaviorStore.getState().recordPreview(previewItem);
    const { previewHistory, readingHistory } = useBehaviorStore.getState();
    expect(previewHistory).toHaveLength(1);
    expect(previewHistory[0].id).toBe('n1');
    expect(previewHistory[0].previewCount).toBe(1);
    expect(readingHistory).toHaveLength(1);
    expect(readingHistory[0].depth).toBe('preview');
  });

  it('recordPreview 60s 内同条目重复打开被节流', () => {
    useBehaviorStore.getState().recordPreview(previewItem);
    useBehaviorStore.getState().recordPreview(previewItem);
    useBehaviorStore.getState().recordPreview(previewItem);
    const { previewHistory } = useBehaviorStore.getState();
    expect(previewHistory).toHaveLength(1);
    expect(previewHistory[0].previewCount).toBe(1);
  });

  it('recordPreview 不覆盖已有的 full 深度阅读记录', () => {
    useBehaviorStore.getState().upsertReadingEntry(previewItem, 'full');
    useBehaviorStore.getState().recordPreview(previewItem);
    const { readingHistory } = useBehaviorStore.getState();
    expect(readingHistory).toHaveLength(1);
    expect(readingHistory[0].depth).toBe('full');
    // full 深度保留，但这次预览仍被计数
    expect(readingHistory[0].previewCount).toBe(1);
  });

  it('addPreviewHistory 同 id upsert：置顶 + previewCount 累计', () => {
    useBehaviorStore.getState().addPreviewHistory(previewItem);
    // 直接绕过节流的 addPreviewHistory 再记一次
    useBehaviorStore.getState().addPreviewHistory(previewItem);
    const { previewHistory } = useBehaviorStore.getState();
    expect(previewHistory).toHaveLength(1);
    expect(previewHistory[0].previewCount).toBe(2);
    expect(previewHistory[0].firstPreviewAt).toBeTruthy();
  });

  it('clearPreviewHistory 只清预览轨迹，不动阅读记录', () => {
    useBehaviorStore.getState().recordPreview(previewItem);
    useBehaviorStore.getState().clearPreviewHistory();
    const { previewHistory, readingHistory } = useBehaviorStore.getState();
    expect(previewHistory).toHaveLength(0);
    expect(readingHistory).toHaveLength(1);
  });

  it('recordPreview 忽略无 id 的条目', () => {
    useBehaviorStore.getState().recordPreview({ title: 'no id' });
    expect(useBehaviorStore.getState().previewHistory).toHaveLength(0);
    expect(useBehaviorStore.getState().readingHistory).toHaveLength(0);
  });
});

describe('normalizePersistedBehavior（v26.9c 脏数据防崩）', () => {
  const defaults = {
    readingHistory: [],
    previewHistory: [],
    recommendationFeedback: { hiddenIds: [], boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
    recommendationFeedbackEvents: [],
    followKeywords: [],
    trackTargets: [],
  };

  it('数组字段形状不符时回落默认值（对象脏数据不再导致整站崩）', () => {
    // 实测复现的崩溃载荷：readingHistory 被写成对象 map
    const out = normalizePersistedBehavior({ readingHistory: { a: { depth: 'full' } } }, defaults);
    expect(Array.isArray(out.readingHistory)).toBe(true);
    expect(out.readingHistory).toEqual([]);
    // 下游 .filter/.map 不再抛 TypeError
    expect(() => out.readingHistory.filter((h) => h.depth !== 'preview')).not.toThrow();
  });

  it('合法数组数据原样保留（不清空用户真实数据）', () => {
    const hist = [{ id: 'n1', depth: 'full' }, { id: 'n2', depth: 'preview' }];
    const out = normalizePersistedBehavior({ readingHistory: hist, followKeywords: ['AI'] }, defaults);
    expect(out.readingHistory).toHaveLength(2);
    expect(out.followKeywords).toEqual(['AI']);
  });

  it('recommendationFeedback 内部 hiddenIds 非数组时单独归一化', () => {
    const out = normalizePersistedBehavior({ recommendationFeedback: { hiddenIds: 'oops', trackedTerms: { x: 1 } } }, defaults);
    expect(Array.isArray(out.recommendationFeedback.hiddenIds)).toBe(true);
    expect(out.recommendationFeedback.trackedTerms).toEqual({ x: 1 });
  });

  it('空/非法 persisted（null、字符串、数组）不抛异常', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => normalizePersistedBehavior(bad, defaults)).not.toThrow();
      expect(normalizePersistedBehavior(bad, defaults).readingHistory).toEqual([]);
    }
  });

  it('全部字段为脏数据时整体回落，函数仍返回完整结构', () => {
    const out = normalizePersistedBehavior({ readingHistory: 1, previewHistory: 'x', followKeywords: {}, trackTargets: null, recommendationFeedbackEvents: 3, recommendationFeedback: [] }, defaults);
    expect(out.readingHistory).toEqual([]);
    expect(out.previewHistory).toEqual([]);
    expect(out.followKeywords).toEqual([]);
    expect(out.trackTargets).toEqual([]);
    expect(out.recommendationFeedbackEvents).toEqual([]);
    expect(out.recommendationFeedback).toEqual(defaults.recommendationFeedback);
  });
});
