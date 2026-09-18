-- C3 任务 3：社区帖子本地上传（效果图 / 效果视频 / 附件资料）
-- 向后兼容：全部 ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS，老数据自动落默认空数组。
alter table posts add column if not exists media       jsonb not null default '[]'::jsonb;
alter table posts add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 上传物本体：小文件（图 ≤5MB / 视频 ≤25MB / 附件 ≤10MB）直接 bytea 入库，
-- 与内存仓储（dev 无 PG）字段对齐；url 统一 /api/community/uploads/:id。
create table if not exists community_uploads (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  kind       varchar(8)  not null check (kind in ('image','video','file')),
  mime       varchar(80) not null,
  name       varchar(200) not null default '',
  size       integer not null default 0,
  data       bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists community_uploads_owner_idx on community_uploads(owner_id, created_at desc);
