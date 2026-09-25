-- 安全基线：审计日志 + LLM 凭证加密迁移
-- audit_log：登录/登出、敏感工具执行（含 deny）、上传、导出、mcp_call 的服务端审计。
-- llm_config 加密：user_profiles.llm_config 中 apiKey 字段将存 v1:... 密文（读时升级，无需 DDL 变更）。
create table if not exists audit_log (
  id         bigserial primary key,
  user_id    uuid null references users(id) on delete set null,
  action     varchar(64) not null,
  target     varchar(200) not null default '',
  outcome    varchar(16) not null default 'ok' check (outcome in ('ok','denied','error')),
  detail     jsonb not null default '{}'::jsonb,
  ip         varchar(64) not null default '',
  user_agent varchar(200) not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_log_user_idx on audit_log(user_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log(action, created_at desc);
