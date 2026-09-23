-- v36.1：附件上传支持匿名（工作站附件不强依赖社区账号）
-- owner_id 放开 NOT NULL：匿名上传（按 IP 限流 20 次/小时）记 NULL 归属。
-- GET 公开读口径不变（id 为 uuid 不可枚举，无新增暴露面）。
alter table community_uploads alter column owner_id drop not null;
