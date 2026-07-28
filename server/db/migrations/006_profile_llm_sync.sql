-- server/db/migrations/006_profile_llm_sync.sql
-- Phase 3 基础设施：用户活跃度跟踪 + LLM 配置跨设备同步

-- 用户最后活跃时间（cron 活跃用户筛选用）
alter table users add column if not exists last_seen_at timestamptz;
create index if not exists users_last_seen_idx on users(last_seen_at desc) where last_seen_at is not null;

-- 用户 LLM 配置（cron 后台任务读取用，前端 localStorage 仍是主源）
alter table user_profiles add column if not exists llm_config jsonb not null default '{}'::jsonb;
