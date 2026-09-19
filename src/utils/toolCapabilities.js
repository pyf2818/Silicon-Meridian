/**
 * toolCapabilities.js - 工具能力声明（对标 pi 的 promptSnippet / promptGuidelines）
 *
 * pi 每个工具（createBashToolDefinition / createReadTool 等）都会携带：
 *   - promptSnippet    一句话告诉 LLM 这个工具是干嘛的、在什么 prompt 里可用
 *   - promptGuidelines 数组：工具使用的具体规则/触发条件/边界
 * 这些会注入系统提示词，让 LLM 知道「有哪些工具、何时该用、什么时候不该用」。
 *
 * 本项目现状：toolRegistry 的 meta 只有 label/icon（UI 展示），system prompt 里没有任何
 * 工具能力段 → LLM 靠 schema 盲猜工具。本模块集中定义每个内置工具的能力声明，
 * 并提供从「agent.tools 白名单」派生「工具能力段」的纯函数，供 AiChat/AiElf 的 system prompt 复用。
 *
 * 纯逻辑、无 React、无 fetch，可单测。
 */

/**
 * 每个内置工具的能力声明：
 *   label    - 展示名（与 toolRegistry meta.label 对齐）
 *   snippet  - 一句话用途（对标 pi promptSnippet）
 *   guidelines - 使用规则（对标 pi promptGuidelines）：触发条件 + 边界/注意
 *   hidden   - 是否在给 LLM 的能力清单中隐藏（如纯会话状态工具，或需用户显式点名才提）
 */
const CAPABILITIES = {
  read_workspace_file: {
    label: '读取文件',
    snippet: '读取已连接工作空间中的文件内容',
    guidelines: [
      '用户提到了「工作空间/本地文件」且知道路径时使用；agent 需用户已连接工作空间，否则不可用',
    ],
  },
  write_workspace_file: {
    label: '写入文件',
    snippet: '向工作空间写入或覆盖一个文件',
    guidelines: [
      '需要保存产出物（Markdown/报告/代码）到用户本地时使用；会覆盖同名文件',
      '写入前先确认内容完整、正确，避免覆盖用户已有文件',
    ],
  },
  edit_file: {
    label: '编辑文件',
    snippet: '精准修改工作空间中已有文件的局部内容',
    guidelines: [
      '优先用精准替换（old_string→new_string），不要整文件重写，减少 token 消耗',
      'old_string 必须与原文件完全一致（含空白）；多次出现时需提供更长上下文唯一匹配',
    ],
  },
  search_news: {
    label: '检索资讯',
    snippet: '检索站内已沉淀的资讯库与情报事件（支持来源/时间/分类限定召回范围），站内命中优先',
    guidelines: [
      '查资讯/动态/趋势类问题的第一选择：站内已沉淀全站信息源（不是只有对话里提到的素材），先检索这里，再考虑联网',
      '用 sources / since / category / scope 限定召回范围：如只查官方来源（sources="OpenAI"）、只看近 3 天（since="3d"）',
      '站内命中会直接返回；只有站内确实没有相关内容时工具才联网兜底——不要跳过站内检索直接调 web_search',
    ],
  },
  web_search: {
    label: '联网搜索',
    snippet: '联网搜索互联网最新信息（豆包搜索 / Tavily / DuckDuckGo），站内检索无结果时的兜底手段',
    guidelines: [
      '仅在站内检索（search_news / read_intelligence_focus / list_knowledge）确认没有相关内容后才使用',
      '需要训练数据之外的最新信息、或资讯库查不到时使用；结果可作补充依据',
      '用户关闭「联网搜索总开关」时不可用（工具会拒绝）',
    ],
  },
  fetch_page: {
    label: '抓取网页',
    snippet: '抓取一个网页的正文文本（有 SSRF 保护），深读站内资讯正文的主要手段',
    guidelines: [
      'search_news / read_intelligence_focus 的结果里带有「原文」链接——需要深入分析、讲解某条资讯时，用它抓原文全文（RSS 摘要通常只有首段）',
      '需要阅读某 URL 的完整内容时才使用，先确认 URL 可信；受沙箱出口白名单约束',
    ],
  },
  get_stock_quote: {
    label: '股票行情',
    snippet: '获取某只股票（A股/HK）的实时行情，含五档盘口',
    guidelines: [
      '股票代码可写 600519 / sh600519 / 000001，会自动归一化为正确市场前缀',
      '仅提供行情数据，不构成投资建议',
    ],
  },
  get_stock_kline: {
    label: 'K 线数据',
    snippet: '获取股票日/周/月 K 线数据',
    guidelines: [
      '需要历史走势、价格区间、均线分析时使用；period: 101日/102周/103月',
    ],
  },
  execute_command: {
    label: '执行命令',
    snippet: '统一命令入口，可搜索资讯、抓网页、查股票、读写工作空间文件、管理执行计划',
    guidelines: [
      '有明确 shell 风格操作需求时用，支持的子命令见工具的 help；参数可用引号包裹',
    ],
  },
  create_skill: {
    label: '沉淀技能',
    snippet: '把本次工作的方法论、过程、经验沉淀为可复用的 Skill',
    guidelines: [
      '完成一个带工具调用的结构化任务后，若发现了可复用的工作模式，应主动沉淀技能',
      'skill 记录「怎么做」而非「输出结果」：适用场景、工作流程、决策点、工具经验',
    ],
  },
  spawn_subagent: {
    label: '派出子代理',
    snippet: '把可并行的子任务派给专业化子代理（explorer 侦察 / researcher 研究 / writer 撰稿 / critic 审校），收集结构化报告',
    guidelines: [
      '任务是「多个独立可并行的子工作」时派发：如同时侦察多个信源、多课题并行调研、起草后审校',
      'objective 必须自包含（子代理看不到主对话）：把背景材料写进 context，约束写进 constraints',
      '相互独立的任务才放进同一次派发（默认 3 路并发）；有依赖关系的任务分多轮派发',
      '不要为单一小问题派子代理（一次工具调用能解决的事直接做）；派发后基于报告综合，不逐字复述',
    ],
  },
  spawn_agent_team: {
    label: '组建团队',
    snippet: '组建共享任务列表 + 成员邮箱协作的 agent 团队（成员常驻执行、互相可见进度、可互相留言配合）',
    guidelines: [
      '需要成员间配合/交接的复合任务才组队（如调研→撰写→审校流水线、多角色评审）；独立并行用 spawn_subagent',
      '成员 2-6 个，每个成员一张任务卡；goal 说清团队共同目标，成员名用职责化命名（如 主笔/审校）',
      '团队运行中你会实时看到任务板推进；全部完结后收到团队摘要与各成员报告，据此综合作答',
    ],
  },
  set_plan: {
    label: '设置计划',
    snippet: '为当前任务设置一个有序执行计划（任务列表，可声明依赖）',
    guidelines: ['复杂多步任务开始时，用 set_plan 先规划，再逐步执行'],
  },
  add_task: {
    label: '追加任务',
    snippet: '向当前执行计划追加一个任务',
    guidelines: ['规划后若发现遗漏步骤，用 add_task 补充'],
  },
  update_task: {
    label: '更新任务',
    snippet: '更新执行计划中某个任务的状态与结果摘要',
    guidelines: ['每个任务完成时调用，保持计划可见、让后续接力推理有据'],
  },
  set_variable: {
    label: '设置变量',
    snippet: '在当前会话中保存一个键值变量，供后续工具与推理使用',
    guidelines: ['需要把中间产物/里程碑信息跨轮次保留时使用'],
  },
  write_blackboard: {
    label: '写黑板',
    snippet: '向会话黑板写入键值，实现工具间的产出共享',
    guidelines: ['工具需要把产出给后续工具用时，用黑板传递'],
  },
};

/**
 * 从白名单派生「工具能力」清单。
 * - 已声明工具：用 CAPABILITIES 的 snippet + guidelines
 * - 未声明工具（如自定义工具）：兜底为 { snippet: null }，格式化为纯名称行（不丢工具）
 */
export function getToolCapabilities(toolNames) {
  const list = Array.isArray(toolNames) ? toolNames : [];
  const result = [];
  for (const name of list) {
    const cap = CAPABILITIES[name];
    if (!cap || cap.hidden) continue;
    result.push({ name, label: cap.label, snippet: cap.snippet, guidelines: cap.guidelines });
  }
  // 未声明工具兜底（保持完整白名单，但标 unknown 由调用方弱化展示）
  const declared = new Set(result.map(c => c.name));
  for (const name of list) {
    if (!declared.has(name)) result.push({ name, label: name, snippet: null, guidelines: null, unknown: true });
  }
  return result;
}

/**
 * 把可用的工具能力清单格式化成给 LLM 的「工具能力」段。
 * - agent 未配置任何工具 → 返回 ''（不注入，避免让 agent 以为可调工具）
 * - 只输出解析性内容（snippet + guidelines），不输出 schema（schema 走 function calling）
 * - 未声明的自定义工具以纯名称列出（避免"能力段无此工具但 schema 有"的困惑）
 */
export function buildToolCapabilitiesText(toolNames) {
  const caps = getToolCapabilities(toolNames);
  if (caps.length === 0) return '';
  const lines = [
    '【可用工具】你被配置为 Agent Loop 模式，可通过 function calling 主动调用以下工具获取信息或产出文件。',
    '当问题需要外部数据、文件操作或实时信息时，优先调用对应工具后再回答（工具返回的数据是事实依据，直接采纳）。',
  ];
  caps.forEach((c) => {
    if (c.unknown) {
      lines.push(`- ${c.name}（自定义工具）：能力见其 schema 描述，按需调用。`);
    } else {
      lines.push(`- ${c.name}（${c.label}）：${c.snippet}${c.guidelines?.length ? `；注意：${c.guidelines.join('；')}` : ''}`);
    }
  });
  return lines.join('\n');
}