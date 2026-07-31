---
name: skill-template
title: 技能模板
description: 复制此目录创建新技能，修改 frontmatter 与正文即可
category: general
triggers: 模板, template
tools: ""
version: 0.1.0
author: Silicon Meridian
---

# 技能模板

这是一个技能模板，用于快速创建新技能。

## 使用方法

1. 复制 `_template/` 目录到 `skills/<你的技能名>/`
2. 编辑 `SKILL.md` 的 frontmatter：
   - `name`: 技能唯一标识（kebab-case）
   - `title`: 展示名称
   - `description`: 一句话描述
   - `category`: 分类（research / writing / analysis / automation / general）
   - `triggers`: 触发关键词（逗号分隔，用于 agent 自动匹配用户输入）
   - `tools`: 依赖的工具（逗号分隔，对应 agentTools 中的 tool name）
   - `version`: 语义化版本号
   - `author`: 作者
3. 编写正文：技能说明 / prompt 模板 / 使用示例 / 注意事项

## frontmatter 字段说明

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| name | 否 | string | 缺省时取目录名 |
| title | 否 | string | 缺省时取 name |
| description | 否 | string | 一句话描述 |
| category | 否 | string | 默认 general |
| triggers | 否 | array | 逗号分隔，用于 agent 自动匹配 |
| tools | 否 | array | 逗号分隔，依赖的工具 |
| tags | 否 | array | 逗号分隔，自由标签 |
| version | 否 | string | 默认 0.1.0 |
| author | 否 | string | 作者 |

## 注意事项

- 以 `_` 或 `.` 开头的目录会被跳过（如本模板）
- frontmatter 只支持扁平的 `key: value`，不支持嵌套
- 正文支持完整 markdown 语法
- 加载时机：服务端启动时扫描一次，缓存在内存；可通过 `listSkills(true)` 强制刷新
