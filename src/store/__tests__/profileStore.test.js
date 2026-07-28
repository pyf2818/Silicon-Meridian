import { describe, it, expect, beforeEach, vi } from 'vitest';

// localStorage stub for node environment (vitest defaults to node env)
function installLocalStorage() {
  const store = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((k) => (k in store ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v); }),
    removeItem: vi.fn((k) => { delete store[k]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  });
}

import { useProfileStore } from '../profileStore.js';

describe('pendingSuggestions', () => {
  beforeEach(() => {
    installLocalStorage();
    useProfileStore.getState().clearPendingSuggestions?.();
  });

  it('addPendingSuggestions dedupes by (type, target) when pending', () => {
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r1', source: 'ai' },
    ]);
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r2', source: 'ai' },
    ]);
    const list = useProfileStore.getState().pendingSuggestions;
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('r2');
  });

  it('caps pending at 20 by dropping lowest confidence', () => {
    const items = Array.from({ length: 22 }, (_, i) => ({
      type: 'track', target: `t${i}`, reason: 'r', source: 'ai',
      metadata: { confidence: i / 22 },
    }));
    useProfileStore.getState().addPendingSuggestions(items);
    const list = useProfileStore.getState().pendingSuggestions;
    expect(list).toHaveLength(20);
    // confidence 最低的 t0 应被丢弃
    expect(list.find(s => s.target === 't0')).toBeUndefined();
  });

  it('cools down same (type, target) within 1 hour', () => {
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r1', source: 'ai' },
    ]);
    // 立即再次添加，应被去重
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r2', source: 'ai' },
    ]);
    expect(useProfileStore.getState().pendingSuggestions).toHaveLength(1);
  });

  it('updateSuggestionStatus transitions pending -> accepted', () => {
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r', source: 'ai' },
    ]);
    const id = useProfileStore.getState().pendingSuggestions[0].id;
    useProfileStore.getState().updateSuggestionStatus(id, 'accepted');
    expect(useProfileStore.getState().pendingSuggestions[0].status).toBe('accepted');
  });

  it('pruneExpiredSuggestions removes 30+ day old accepted/rejected', () => {
    useProfileStore.setState({
      pendingSuggestions: [
        { id: 'old', type: 'track', target: 'X', reason: '', source: 'ai', createdAt: Date.now() - 31 * 86400e3, status: 'accepted' },
        { id: 'new', type: 'track', target: 'Y', reason: '', source: 'ai', createdAt: Date.now() - 86400e3, status: 'accepted' },
      ]
    });
    useProfileStore.getState().pruneExpiredSuggestions();
    const list = useProfileStore.getState().pendingSuggestions;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('new');
  });
});

// Phase 3 Task B6: personaSummary 持久化字段
describe('personaSummary', () => {
  beforeEach(() => {
    installLocalStorage();
    // 重置为默认值
    useProfileStore.setState({
      personaSummary: { habits: [], traits: [], needs: [], lastEvolvedAt: null },
    });
  });

  it('replaces habits/traits/needs and stamps lastEvolvedAt', () => {
    useProfileStore.getState().setPersonaSummary({
      habits: ['简洁回复'], traits: ['技术派'], needs: ['GPU 资讯'],
    });
    const ps = useProfileStore.getState().personaSummary;
    expect(ps.habits).toEqual(['简洁回复']);
    expect(ps.traits).toEqual(['技术派']);
    expect(ps.needs).toEqual(['GPU 资讯']);
    expect(typeof ps.lastEvolvedAt).toBe('string');
    expect(new Date(ps.lastEvolvedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('caps habits/traits/needs at 10 each', () => {
    const many = Array.from({ length: 15 }, (_, i) => `h${i}`);
    useProfileStore.getState().setPersonaSummary({ habits: many, traits: many, needs: many });
    const ps = useProfileStore.getState().personaSummary;
    expect(ps.habits).toHaveLength(10);
    expect(ps.traits).toHaveLength(10);
    expect(ps.needs).toHaveLength(10);
    expect(ps.habits[0]).toBe('h0'); // 保留前 10 项
  });

  it('supports updater function form', () => {
    useProfileStore.getState().setPersonaSummary({ habits: ['a'], traits: [], needs: [] });
    useProfileStore.getState().setPersonaSummary(prev => ({
      ...prev,
      habits: [...prev.habits, 'b'],
    }));
    const ps = useProfileStore.getState().personaSummary;
    expect(ps.habits).toEqual(['a', 'b']);
  });

  it('gracefully handles missing fields', () => {
    useProfileStore.getState().setPersonaSummary({});
    const ps = useProfileStore.getState().personaSummary;
    expect(ps.habits).toEqual([]);
    expect(ps.traits).toEqual([]);
    expect(ps.needs).toEqual([]);
    expect(typeof ps.lastEvolvedAt).toBe('string');
  });
});
