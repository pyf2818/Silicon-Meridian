-- 005_profile_extensions.sql
-- Phase 1.4 Task 16: 用户画像扩展字段
-- - briefing_config: 简报配置（length / includeRead 等用户偏好，跨设备同步）
-- - pending_suggestions: AI 建议待确认队列（Phase 1.3 引入的扩展点，
--   存储结构 [{id, type, target, reason, source, metadata, createdAt, status}])

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS briefing_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 注：briefing_snapshots 表通过 snapshot_id 关联 recommendation_snapshots，
-- 后者已有 (user_id, snapshot_date desc) 索引（recommendation_user_date_idx，
-- 见 001_platform.sql L62），此处无需重复创建。
