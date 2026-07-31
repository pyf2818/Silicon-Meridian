---
name: paper-quickread
title: 论文快读
description: 抓取学术论文/技术报告，5 分钟内提取核心贡献、方法、实验、局限
category: research
triggers: 论文, paper, arxiv, 快读, 论文阅读, 论文总结, 看论文
tools: fetch_page, web_search
version: 0.1.0
author: Silicon Meridian
---

# 论文快读

把一篇学术论文或技术报告压缩到 5 分钟可读完的结构化摘要，突出核心贡献与可复用洞察。

## Prompt 模板

```
请快速阅读以下论文并输出结构化摘要：

【论文来源】
{paperUrl}

【输出结构】
1. 一句话总结（核心贡献，不超过 30 字）
2. 解决的问题（之前的方案为什么不够好）
3. 核心方法（关键 idea + 1-2 个最关键的技术细节）
4. 实验结果（在什么 benchmark 上达到什么水平，对比 baseline 提升多少）
5. 局限性（作者承认的 + 你识别的）
6. 可复用洞察（对其他工作有启发的 2-3 点）
7. 关键引用（3-5 篇值得顺藤摸瓜的参考文献）

【风格要求】
- 避免堆砌术语，关键概念用一句话解释
- 实验数据保留具体数字（不要"显著提升"这种模糊表达）
- 区分作者声明与你自己的判断
```

## 使用示例

用户输入："帮我读一下 https://arxiv.org/abs/2412.16789" / "这篇论文讲了什么"

Agent 匹配 triggers 后：
1. 调用 `fetch_page` 抓取论文 abstract / HTML 全文
2. 若抓取失败或仅 PDF，调用 `web_search` 搜索论文标题 + "abstract" 补充
3. 按结构化模板输出
4. 末尾给出"是否值得精读全文"的判断

## 注意事项

- arxiv 页面抓取通常顺利；闭源期刊可能需要订阅，遇 403 直接说明
- 数学推导细节可省略，但需说明"详见原文 Section X"
- 若论文为 survey/review 类，输出结构改为"覆盖范围 / 分类框架 / 主要发现 / 缺失视角"
- 涉及代码实现时，主动指出 GitHub 链接（若 abstract 中提及）
- 引用建议给出 arxiv ID 或 DOI，便于用户后续查阅
