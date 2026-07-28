import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/toast.js', () => ({
  showToast: vi.fn(),
}));

const storage = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn(k => storage[k] ?? null),
  setItem: vi.fn((k, v) => { storage[k] = String(v); }),
  removeItem: vi.fn(k => { delete storage[k]; }),
});

const { applySuggestionByType } = await import('../PendingSuggestionCard.jsx');

describe('applySuggestionByType', () => {
  beforeEach(() => vi.clearAllMocks());

  it('track type adds keyword to specialFollows via updater function', () => {
    const setSpecialFollows = vi.fn();
    const stores = { setSpecialFollows, specialFollows: [] };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU', reason: 'r' },
      { target: 'GPU', note: 'reason' },
      stores
    );
    expect(ok).toBe(true);
    expect(setSpecialFollows).toHaveBeenCalledTimes(1);
    const updater = setSpecialFollows.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    const result = updater([{ id: 'a', type: 'keyword', target: 'CPU', note: '' }]);
    expect(result).toHaveLength(2);
    expect(result[1].target).toBe('GPU');
    expect(result[1].type).toBe('keyword');
    expect(result[1].note).toBe('reason');
    expect(result[1].id).toBeTruthy();
  });

  it('track type rejects duplicate keyword (case-insensitive)', () => {
    const setSpecialFollows = vi.fn();
    const stores = {
      setSpecialFollows,
      specialFollows: [{ id: 'a', type: 'keyword', target: 'GPU' }],
    };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU', reason: 'r' },
      { target: 'gpu', note: '' },
      stores
    );
    expect(ok).toBe(false);
    expect(setSpecialFollows).not.toHaveBeenCalled();
  });

  it('track type rejects empty target', () => {
    const stores = { setSpecialFollows: vi.fn(), specialFollows: [] };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU', reason: 'r' },
      { target: '  ', note: '' },
      stores
    );
    expect(ok).toBe(false);
    expect(stores.setSpecialFollows).not.toHaveBeenCalled();
  });

  it('boost type sets domainTiers[target] to focus via updater', () => {
    const setDomainTiers = vi.fn();
    const stores = { setDomainTiers };
    const ok = applySuggestionByType(
      { type: 'boost', target: 'ai' },
      { tier: 'focus' },
      stores
    );
    expect(ok).toBe(true);
    const updater = setDomainTiers.mock.calls[0][0];
    const result = updater({ web: 'normal' });
    expect(result).toEqual({ web: 'normal', ai: 'focus' });
  });

  it('boost type defaults tier to focus when missing', () => {
    const setDomainTiers = vi.fn();
    const stores = { setDomainTiers };
    applySuggestionByType({ type: 'boost', target: 'ai' }, {}, stores);
    const updater = setDomainTiers.mock.calls[0][0];
    const result = updater({});
    expect(result.ai).toBe('focus');
  });

  it('mute type sets sourceTiers[target] to explore via updater', () => {
    const setSourceTiers = vi.fn();
    const stores = { setSourceTiers };
    const ok = applySuggestionByType(
      { type: 'mute', target: 'src-1' },
      { tier: 'explore' },
      stores
    );
    expect(ok).toBe(true);
    const updater = setSourceTiers.mock.calls[0][0];
    const result = updater({ 'src-2': 'normal' });
    expect(result).toEqual({ 'src-2': 'normal', 'src-1': 'explore' });
  });

  it('unknown type returns false', () => {
    const ok = applySuggestionByType({ type: 'unknown', target: 'x' }, {}, {});
    expect(ok).toBe(false);
  });
});
