-- server/db/migrations/007_persona_summary_history.sql
-- Phase 5: personaSummary 进化历史记录表
-- 每次 mergePersonaSummary 调用时同事务写入一条完整快照，cap 90/用户

CREATE TABLE IF NOT EXISTS persona_summary_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,
  evolved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psh_user_time ON persona_summary_history (user_id, evolved_at DESC);
