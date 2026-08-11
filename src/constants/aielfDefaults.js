/**
 * aielfDefaults.js - AI 精灵单例助手配置（方案 A：去 agent 化）
 *
 * 定位：AI 精灵是「全站快速问答 + 拖拽即分析」的轻量助理，不需要多 agent 生态。
 * 它固定为一个通用全能 agent，靠「用户画像 + 内容自识别 + 工具能力」实现智能，
 * 而不是靠切换专业化角色。
 *
 * 与 AI 工作站（AiChat）的分工：
 *   - AiElf：低摩擦。拖一张卡片/问一个问题 → 立刻得到判断。分析产出可「存入工作站」深做。
 *   - AiChat：深度工作台。多专业 agent + 工具编排 + 计划执行。
 *
 * 本文件只定义精灵的「单例配置」与「prompt 构造」两个纯逻辑导出，无 React / 无 fetch。
 */

import { buildToolCapabilitiesText } from '../utils/toolCapabilities.js';

/** 精灵单例 agent 配置：固定 id，不再来自 agents 生态。 */
export const ELF_DEFAULT_AGENT = {
  id: 'ai-elf',
  name: 'AI精灵',
  description: '全站 AI 助理：快速问答、拖拽分析资讯/股票/代码/GitHub、联网搜索',
  // 精灵侧重"分析/查证"类工具，不含 set_plan 等多步编排（那是工作站的活）
  tools: [
    'search_news',
    'web_search',
    'fetch_page',
    'read_workspace_file',
    'get_stock_quote',
    'get_stock_kline',
    'create_skill',
  ],
  systemPrompt: '', // 实际由 buildElfSystemPrompt 动态构造（注入画像/工具能力）
};

/**
 * 构造精灵的 system prompt。
 * 核心是「内容自识别」：精灵收到的输入可能是资讯段落、股票代码、代码片段、GitHub 仓库、
 * 图片描述、或任意知识点。不靠外部分类器，而是告诉模型"先识别类型，再按对应策略分析"。
 *
 * @param {object}  profile       用户画像 { focusLabels, tracked, depth, outputGoal, ... }
 * @param {object}  context       可选，今日情报摘要等（欠佳时留空）
 * @returns {string}
 */
export function buildElfSystemPrompt(profile = {}, context = '') {
  const focus = Array.isArray(profile?.focusLabels) && profile.focusLabels.length
    ? profile.focusLabels.join('、')
    : '未设置';
  const tracked = Array.isArray(profile?.tracked) && profile.tracked.length
    ? profile.tracked.join('、')
    : '';
  const toolsText = buildToolCapabilitiesText(ELF_DEFAULT_AGENT.tools);

  const recognition = [
    '【内容自识别】你收到的输入可能是以下任意类型，请先判断属于哪一类，再按对应策略分析：',
    '- 资讯/文章：先概括核心事实，再说明与用户关注领域的关系、是否存在机会或风险。',
    '- 股票/行情：结合实时行情（可调 get_stock_quote/get_stock_kline）给出当前概况，注意你只提供信息分析，不构成投资建议。',
    '- 代码/K线/技术主题：从原理、成熟度、可落地性三个角度解读。',
    '- GitHub 项目：判断它解决什么问题、适用人群、落地难度与价值。',
    '- 图片/视觉内容：基于你看到的内容描述并分析。',
    '- 一般知识点/概念：用可理解的层次讲清核心、关键与误区，并结合用户画像谈相关性。',
  ].join('\n');

  return [
    '你是全站 AI 精灵助手，一个实时在线的个人情报助理。你结合用户的关注画像、今日情报上下文，提供快速、克制的判断。',
    '',
    '【原则】',
    '- 先给一句话结论和优先级，再展开。',
    '- 明确区分事实、推断与不确定性。',
    '- 给出下一步可执行动作（追踪、阅读、创作、存证）。',
    '- 如果你需要实时信息，主动调用工具（检索资讯、联网搜索、抓网页、查行情）而不是空答。',
    '',
    '【用户画像】',
    `- 核心关注：${focus}`,
    tracked ? `- 追踪记忆：${tracked}` : '',
    `- 推荐深度：${profile?.depth || 'standard'}`,
    `- 输出目标：${profile?.outputGoal || '阅读判断'}`,
    '',
    recognition,
    context ? `\n【今日情报上下文】\n${context}` : '',
    toolsText ? `\n${toolsText}` : '',
    '',
    '【输出风格·硬性约束】',
    '- 禁止使用任何 emoji、颜文字或装饰性符号。',
    '- 使用纯文字 markdown 结构（标题/列表/表格/加粗），不依赖符号传达层次。',
    '- 保持专业、克制、信息密集的表达。',
  ].filter(Boolean).join('\n');
}

/**
 * 构造「拖拽分析」的用户消息：把拖入的卡片/链接 + 网页全文包装成待分析内容。
 * 与旧版 buildAnalysisPrompt 的区别：不再按 agentId 选 8 种模板，而是注入
 * 「类型线索 + 原始内容」，由精灵系统提示里的内容自识别策略接管。
 *
 * @param {object}  itemData   拖入的资讯卡片 { title, summary, url, source, category, ... }
 * @param {string}  pageContent 已抓取的网页正文（可选）
 * @returns {string}
 */
export function buildElfDropPrompt(itemData, pageContent) {
  if (!itemData) return '';
  const base = [
    '【拖入内容】',
    `- 标题：${itemData.title || '(无标题)'}`,
    itemData.source ? `- 来源：${itemData.source}` : '',
    itemData.category ? `- 分类线索：${itemData.category}` : '',
    itemData.url ? `- 链接：${itemData.url}` : '',
    itemData.summary ? `- 摘要：${itemData.summary}` : '',
  ].filter(Boolean).join('\n');
  const full = pageContent && pageContent.length > 50
    ? `\n\n【网页全文】\n${pageContent.slice(0, 6000)}`
    : '';
  return `${base}${full}\n\n请分析这条内容：概括核心、判断对我的相关性、指出机会或风险，并给出下一步动作。`;
}

/** 精灵的其他维度动态快速问答：接收纯文本即可（由精灵自识别），无需额外包装。 */
export const buildElfQuickPrompt = (text) => text;