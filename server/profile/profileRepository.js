import { getPool } from '../db/client.js';

async function inTransaction(db, work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createProfileRepository(db = getPool()) {
  return {
    async getState(userId) {
      // Phase 1.4 Task 17: extended SELECT to include briefing_config + pending_suggestions,
      // and added 5th query for dailyProfileSnapshots via JOIN briefing_snapshots ↔ recommendation_snapshots.
      const [profile, domains, sources, follows, snapshots] = await Promise.all([
        db.query('select version, confidence, behavior_signals as "behaviorSignals", briefing_config as "briefingConfig", pending_suggestions as "pendingSuggestions" from user_profiles where user_id = $1', [userId]),
        db.query('select domain_id as id, tier from profile_domains where user_id = $1 order by domain_id', [userId]),
        db.query('select source_id as id, tier from profile_sources where user_id = $1 order by source_id', [userId]),
        db.query('select id, type, target, note, created_at as "createdAt" from special_follows where user_id = $1 order by created_at desc', [userId]),
        db.query(
          `select rs.snapshot_date as date, bs.algorithm_payload as snapshot
           from briefing_snapshots bs
           join recommendation_snapshots rs on bs.snapshot_id = rs.id
           where rs.user_id = $1
           order by rs.snapshot_date desc
           limit 90`,
          [userId]
        ),
      ]);
      return {
        version: profile.rows[0]?.version || 1,
        confidence: Number(profile.rows[0]?.confidence || 0),
        behaviorSignals: profile.rows[0]?.behaviorSignals || {},
        briefingConfig: profile.rows[0]?.briefingConfig || {},
        pendingSuggestions: profile.rows[0]?.pendingSuggestions || [],
        domains: domains.rows,
        sources: sources.rows,
        specialFollows: follows.rows,
        dailyProfileSnapshots: snapshots.rows,
      };
    },
    async saveState(userId, state) {
      return inTransaction(db, async client => {
        await client.query('insert into user_profiles(user_id) values ($1) on conflict do nothing', [userId]);
        // Phase 1.4 Task 17: UPDATE now writes briefing_config + pending_suggestions (migration 005).
        const profile = await client.query(
          `update user_profiles set version = version + 1, confidence = $2, behavior_signals = $3,
              briefing_config = $4, pending_suggestions = $5, updated_at = now()
           where user_id = $1 and ($6::integer is null or version = $6) returning version`,
          [
            userId,
            state.confidence || 0,
            JSON.stringify(state.behaviorSignals || {}),
            JSON.stringify(state.briefingConfig || {}),
            JSON.stringify(state.pendingSuggestions || []),
            state.expectedVersion ?? null,
          ],
        );
        if (!profile.rows[0]) throw Object.assign(new Error('画像已在其他设备更新，请重新加载后再保存'), { code: 'PROFILE_VERSION_CONFLICT', status: 409 });
        await client.query('delete from profile_domains where user_id = $1', [userId]);
        await client.query('delete from profile_sources where user_id = $1', [userId]);
        await client.query('delete from special_follows where user_id = $1', [userId]);
        for (const [id, tier] of Object.entries(state.domainTiers || {})) await client.query('insert into profile_domains(user_id, domain_id, tier) values ($1,$2,$3)', [userId, id, tier]);
        for (const [id, tier] of Object.entries(state.sourceTiers || {})) await client.query('insert into profile_sources(user_id, source_id, tier) values ($1,$2,$3)', [userId, id, tier]);
        for (const follow of state.specialFollows || []) await client.query('insert into special_follows(user_id, type, target, note) values ($1,$2,$3,$4) on conflict do nothing', [userId, follow.type, follow.target, follow.note || '']);
        return profile.rows[0]?.version || 1;
      });
    },
  };
}
