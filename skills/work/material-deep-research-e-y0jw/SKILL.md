---
name: material-deep-research-e-y0jw
title: material-deep-research-evidence-validation
description: 基于 AI 精灵/历史素材继续深化情报分析的标准流程：先验证证据链，再补证，最后产出四件套
category: research
triggers: 素材深化, 继续研究, 基于素材, AI精灵, 风险验证
tools: list_knowledge, read_intelligence_focus, search_news, save_knowledge
version: 0.1.0
author: 工作沉淀
---

# 素材接力深化研究技能

## 适用场景
用户给出历史素材（AI 精灵保存的分析/交接记录），要求"继续深化"时使用。目标是产出四件套：1）核心判断 2）需验证证据 3）下一步研究清单 4）可沉淀为文章的结构。

## 工作流程
1. **读素材定框架**：提取素材中的核心结论与引用的资讯 ID 列表，形成待验证矩阵（证据 ID × 风险/结论 × 验证方法）。
2. **知识库检索**：list_knowledge 用素材关键词检索沉淀；命中的文件用 read_workspace_file 读取（注意：工作空间未连接时读取失败，改以素材上下文为唯一输入源，并如实告知用户）。
3. **情报库补证**：优先 read_intelligence_focus（按主题聚类，返回条目可直接以 [资讯:ID] 引用）；聚焦未命中时用 search_news 逐条关键词检索，检索不到触发联网兜底。关键决策点：联网兜底结果质量低（官网/百科无关页）时，判定为"证据链断裂"，不强行引用。
4. **素材 ID 校验**：素材引用的 [资讯:ID] 若不在当前证据池，必须明确标注"无法确认"，严禁编造或续引。
5. **融合当日情报**：用当日证据池中可确认条目（尤其命中用户特别关注的）重构主轴判断，素材框架仅作分析透镜。
6. **四件套输出**：核心判断（一句话+表格）/待验证证据（含验证路径）/研究清单（含工具）/文章结构（标题候选+章节大纲）。
7. **沉淀**：save_knowledge 保存分析结论（knowledge 类型），create_skill 保存方法（标题必须 kebab-case，1-64 字符）。

## 决策点与陷阱
- 素材证据 ID 超出证据池 = 信息鸿沟信号，输出时必须显式声明，这是对准确性的承诺。
- 置信度 <50% 的单源情报只能作"侧面信号"，不能升格为事实。
- 用户偏好表格输出：所有清单类内容用 markdown 表格。
- 禁止 emoji；先结论后依据。

## 工具使用经验
- read_intelligence_focus 对"公司名+资本"类主题命中率低，改用更短主题词（如"OpenAI"）或直接 search_news。
- search_news 未命中自动联网兜底，但兜底结果按相关性排序差，需人工判断是否可用。
- update_task 每个阶段完成即更新，保持执行计划状态新鲜。
- create_skill 的 title 必须符合 kebab-case（小写+连字符），中文标题会报错，先用英文/拼音命名或去掉特殊字符。
