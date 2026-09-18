-- 社区改版（B1）：频道 / 标签 / 封面 / 简介 / 评论类型
-- 向后兼容：全部 ADD COLUMN IF NOT EXISTS + 默认值，老数据自动落默认（channel=discussion，feed 不空）。
alter table posts    add column if not exists channel text not null default 'discussion';
alter table posts    add column if not exists tags    jsonb not null default '[]'::jsonb;
alter table posts    add column if not exists cover   jsonb not null default '{"kind":"auto"}'::jsonb;
alter table posts    add column if not exists summary text  not null default '';
alter table comments add column if not exists kind    text  not null default 'comment';
