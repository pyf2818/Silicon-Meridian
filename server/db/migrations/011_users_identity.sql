-- C3 任务 4：用户系统升级（展示唯一 ID / 账号绑定 / 认证体系）
-- 向后兼容：ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS；历史行 public_id 由服务端懒分配。

-- 展示用唯一 ID（6 位基36 大写，如 A3F9K2）：uuid 不便交流与统计口径展示
alter table users add column if not exists public_id varchar(12);
-- 历史行兜底填充（36^6 空间碰撞概率可忽略；unique index 兜底极端碰撞）
update users set public_id = upper(substr(md5(random()::text), 1, 6)) where public_id is null;
create unique index if not exists users_public_id_key on users(public_id);

-- 账号绑定：微信号 / 邮箱（每类型一条，重复提交即换绑）
-- 注：真实场景邮箱需验证码、微信需开放平台 OAuth；本阶段为登记制直接 verified，通道接入后切 pending 流程
create table if not exists user_bindings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       varchar(16) not null check (type in ('email','wechat')),
  value      varchar(200) not null,
  status     varchar(16) not null default 'verified' check (status in ('pending','verified')),
  created_at timestamptz not null default now(),
  unique (user_id, type)
);
create unique index if not exists user_bindings_value_key on user_bindings(type, value);

-- 认证：个人 / 企业 / 博主（payload 只存用户主动申报的展示性字段）
create table if not exists user_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  type        varchar(16) not null check (type in ('individual','enterprise','creator')),
  status      varchar(16) not null default 'approved' check (status in ('pending','approved','rejected')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, type)
);
