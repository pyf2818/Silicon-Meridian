import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProfileRepository } from '../profileRepository.js';

// Mock DB: a plain object with `query` vi.fn.
// createProfileRepository accepts db as parameter, no need to mock '../db/client.js'.
function createMockDb(handlerMap) {
  return {
    query: vi.fn((sql) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      for (const { match, rows } of handlerMap) {
        if (match(normalized)) return { rows };
      }
      return { rows: [] };
    }),
    connect: vi.fn(() => ({
      query: vi.fn((sql) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        for (const { match, rows } of handlerMap) {
          if (match(normalized)) return { rows };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
  };
}

describe('profileRepository extended fields (Phase 1.4 Task 17)', () => {
  it('getState returns briefingConfig, pendingSuggestions, and dailyProfileSnapshots', async () => {
    // Mock returns rows with camelCase keys as PG would after applying column aliases
    // (e.g., `briefing_config as "briefingConfig"` → row.briefingConfig).
    const mockDb = createMockDb([
      { match: sql => sql.includes('from user_profiles'),
        rows: [{ version: 1, confidence: 0, behaviorSignals: {}, briefingConfig: { length: 'detailed' }, pendingSuggestions: [{ id: 'sg1', type: 'track', target: 'AI' }] }] },
      { match: sql => sql.includes('from profile_domains'), rows: [] },
      { match: sql => sql.includes('from profile_sources'), rows: [] },
      { match: sql => sql.includes('from special_follows'), rows: [] },
      { match: sql => sql.includes('from briefing_snapshots'),
        rows: [{ date: '2026-07-28', snapshot: { confidence: 50 } }] },
    ]);
    const repo = createProfileRepository(mockDb);
    const r = await repo.getState('user1');
    expect(r.briefingConfig).toEqual({ length: 'detailed' });
    expect(r.pendingSuggestions).toEqual([{ id: 'sg1', type: 'track', target: 'AI' }]);
    expect(r.dailyProfileSnapshots).toHaveLength(1);
    expect(r.dailyProfileSnapshots[0].date).toBe('2026-07-28');
    expect(r.dailyProfileSnapshots[0].snapshot).toEqual({ confidence: 50 });
  });

  it('saveState writes briefingConfig and pendingSuggestions columns', async () => {
    const mockDb = createMockDb([
      { match: sql => sql.includes('insert into user_profiles'),
        rows: [{ version: 2 }] },
      { match: sql => sql.includes('update user_profiles set'),
        rows: [{ version: 2 }] },
    ]);
    const repo = createProfileRepository(mockDb);
    const result = await repo.saveState('user1', {
      confidence: 50,
      behaviorSignals: { x: 1 },
      domainTiers: {},
      sourceTiers: {},
      specialFollows: [],
      briefingConfig: { length: 'standard', includeRead: true },
      pendingSuggestions: [{ id: 'sg1', type: 'track', target: 'AI', reason: 'r', source: 'ai', createdAt: Date.now(), status: 'pending' }],
    });
    expect(result).toBe(2);
    // Find the UPDATE call
    const updateCall = mockDb.connect.mock.results[0].value.query.mock.calls.find(c =>
      c[0].includes('update user_profiles set')
    );
    expect(updateCall).toBeDefined();
    // Should mention briefing_config and pending_suggestions in the SQL
    expect(updateCall[0]).toContain('briefing_config');
    expect(updateCall[0]).toContain('pending_suggestions');
  });

  it('getState returns safe defaults when columns are empty', async () => {
    const mockDb = createMockDb([
      { match: sql => sql.includes('from user_profiles'),
        rows: [{ version: 1, confidence: 0, behaviorSignals: {}, briefingConfig: null, pendingSuggestions: null }] },
      { match: sql => sql.includes('from profile_domains'), rows: [] },
      { match: sql => sql.includes('from profile_sources'), rows: [] },
      { match: sql => sql.includes('from special_follows'), rows: [] },
      { match: sql => sql.includes('from briefing_snapshots'), rows: [] },
    ]);
    const repo = createProfileRepository(mockDb);
    const r = await repo.getState('user1');
    expect(r.briefingConfig).toEqual({});
    expect(r.pendingSuggestions).toEqual([]);
    expect(r.dailyProfileSnapshots).toEqual([]);
  });
});
