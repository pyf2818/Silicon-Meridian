-- 产物中心（Artifact Hub）：agent 任务产出的报告/代码/图表/文件统一注册与验收
-- 对齐 WorkBuddy「任务 → 交付物 → 结果区」契约。内容 bytea 直存（≤8MB，文本类产物为主），
-- 元数据与引用同表；dev 内存仓储字段形状与此严格对齐。
-- id 全程 opaque：前端只持 uuid，不透服务器路径（越权读取面收口到 userId 归属校验）。
create table if not exists artifacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  session_id varchar(120) not null default '',
  task_id    varchar(120) not null default '',
  kind       varchar(16)  not null check (kind in ('report','code','chart','table','file','image')),
  title      varchar(200) not null default '',
  mime       varchar(120) not null default 'text/markdown',
  size       integer not null default 0,
  data       bytea not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists artifacts_user_idx on artifacts(user_id, created_at desc);
create index if not exists artifacts_session_idx on artifacts(user_id, session_id, created_at desc);
