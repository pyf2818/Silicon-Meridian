// Workflow constants extracted from App.jsx (lines 106-508)

export const DEFAULT_AGENT_WORKFLOW = {
  name: '个人情报协作流',
  description: '把每日汇报、用户画像和素材库交给多个智能体协作，输出可阅读、可追踪、可创作的结果。',
  nodes: [
    {
      id: 'wf-input',
      type: 'input',
      title: '输入',
      role: '接收今日推荐、用户画像、追踪关键词和已收藏素材。',
      prompt: '读取今日情报工作台、用户画像、素材库和用户补充指令。',
      inputKey: 'user_context',
      outputKey: 'briefing_context',
      enabled: true
    },
    {
      id: 'wf-analyst',
      type: 'llm',
      title: '大模型分析',
      role: '识别重要事实、机会、风险和不确定性。',
      prompt: '请基于输入资料输出事实、推断、不确定性和优先级。',
      inputKey: 'briefing_context',
      outputKey: 'analysis',
      enabled: true
    },
    {
      id: 'wf-classifier',
      type: 'classifier',
      title: '分类判断',
      role: '按领域、质量等级、应用场景和风险等级给内容分流。',
      prompt: '将内容分类为：必读、追踪、素材、创作、忽略，并说明原因。',
      classifierLabels: '必读,追踪,素材,创作,降噪',
      inputKey: 'analysis',
      outputKey: 'classified_signals',
      enabled: true
    },
    {
      id: 'wf-skill',
      type: 'skill',
      title: '工具 Skills',
      role: '调用搜索、摘要、正文抽取、导出和格式化等工具能力。',
      prompt: '需要时调用工具补充证据、提取正文图片、整理参考链接。',
      skillId: 'evidence-pack',
      inputKey: 'classified_signals',
      outputKey: 'evidence_pack',
      enabled: true
    },
    {
      id: 'wf-output',
      type: 'output',
      title: '输出',
      role: '生成今日简报、素材卡片、追踪记忆和创作选题。',
      prompt: '输出结构：一句话判断、优先阅读、风险、行动、可沉淀素材。',
      inputKey: 'evidence_pack',
      outputKey: 'final_briefing',
      enabled: true
    }
  ]
};

export const WORKFLOW_NODE_TYPES = ['input', 'llm', 'skill', 'condition', 'classifier', 'reply', 'output', 'subworkflow', 'parallel', 'router'];

/* ============ 多 agent 编排节点元信息（方案 C Phase 5） ============ */

export const WORKFLOW_NODE_META = {
  input:       { label: '输入', iconKey: 'incoming', color: '#3b82f6', category: 'flow' },
  llm:         { label: 'LLM', iconKey: 'robot', color: '#8b5cf6', category: 'agent' },
  skill:       { label: '技能', iconKey: 'bolt', color: '#f59e0b', category: 'agent' },
  condition:   { label: '条件', iconKey: 'shuffle', color: '#ef4444', category: 'flow' },
  classifier:  { label: '分类器', iconKey: 'tag', color: '#10b981', category: 'flow' },
  reply:       { label: '回复', iconKey: 'chat', color: '#06b6d4', category: 'output' },
  output:      { label: '输出', iconKey: 'outgoing', color: '#06b6d4', category: 'output' },
  subworkflow: { label: '子工作流', iconKey: 'puzzle', color: '#ec4899', category: 'orchestration' },
  parallel:    { label: '并行', iconKey: 'layers', color: '#f97316', category: 'orchestration' },
  router:      { label: '路由', iconKey: 'compass', color: '#a855f7', category: 'orchestration' },
};

/* 新建节点的默认蓝图：保证每个节点一落地就是「真实有效」的可执行配置 */
export const WORKFLOW_NODE_BLUEPRINT = {
  input:       { title: '输入',       role: '接收上游数据、用户画像与补充指令。', prompt: '读取当前上下文、关注领域与用户补充指令，输出统一的上下文包。' },
  llm:         { title: '大模型分析', role: '基于上游内容完成理解、推理或生成。', prompt: '请基于输入内容输出关键结论、依据与不确定性，避免空泛表述。' },
  skill:       { title: '工具调用',   role: '调用内置 Skill 补充证据或做结构化整理。', prompt: '调用所选 Skill 处理输入，输出可直接引用的结构化结果。' },
  condition:   { title: '条件判断',   role: '按指标阈值决定链路是否继续。', prompt: '不满足阈值时短路后续节点，避免无效执行。' },
  classifier:  { title: '分类分流',   role: '把内容归入若干分类桶。', prompt: '按分类桶对输入逐条归类，并给出一句归类理由。' },
  reply:       { title: '指定回复',   role: '按固定模板直接回复，不经过大模型改写。', prompt: '使用预设模板输出回复内容。' },
  output:      { title: '输出',       role: '汇总结果，产出最终交付物。', prompt: '输出结构化的最终产物，并附关键依据与下一步建议。' },
  subworkflow: { title: '子工作流',   role: '调用另一个已保存的工作流。', prompt: '把输入交给子工作流执行，并接收其输出继续流转。' },
  parallel:    { title: '并行扇出',   role: '把输入分发给多条分支同时处理。', prompt: '并行执行各分支，按合并策略汇总结果。' },
  router:      { title: '路由分发',   role: '按规则把输入路由到不同分支。', prompt: '根据路由规则选择目标分支并传递输入。' },
};

/** 各节点类型在模拟运行中的基准耗时（毫秒），用于体现真实的执行节奏差异 */
export const WORKFLOW_SIM_DURATION = {
  input: 320, llm: 900, skill: 620, condition: 260,
  classifier: 520, reply: 260, output: 420,
  subworkflow: 760, parallel: 700, router: 300,
};

/* 路由规则支持的比较操作 */
export const WORKFLOW_ROUTER_OPERATORS = [
  { id: 'contains',   label: '包含' },
  { id: 'not_contains', label: '不包含' },
  { id: 'equals',     label: '等于' },
  { id: 'starts_with', label: '前缀匹配' },
  { id: 'regex',      label: '正则匹配' },
];

/* 并行节点的合并策略 */
export const WORKFLOW_PARALLEL_MERGE_STRATEGIES = [
  { id: 'concat',    label: '拼接（保留各分支输出）' },
  { id: 'first',     label: '取首个完成的分支' },
  { id: 'last',      label: '取最后完成的分支' },
  { id: 'summarize', label: '让 LLM 汇总（生成综述）' },
];

/* v24 #4：并行节点的视角目录——画布只配分支数时，真实执行按此合成各分支的独立视角 */
export const WORKFLOW_PARALLEL_PERSPECTIVES = [
  { name: '事实核查', prompt: '核对输入中的事实性陈述：哪些有依据、哪些存疑、哪些缺失关键证据。' },
  { name: '价值与机会', prompt: '评估输入中最值得利用的机会与价值点，并说明为什么值得。' },
  { name: '风险与反驳', prompt: '站在对立面：找出输入结论的风险、漏洞与最有力的反驳理由。' },
  { name: '用户影响', prompt: '分析对目标用户的实际影响，给出具体的行动建议。' },
  { name: '数据与证据', prompt: '关注可量化的数据、指标与证据缺口，指出哪些结论需要数据支撑。' },
  { name: '趋势外推', prompt: '基于输入推测后续 1-3 个月的可能走向，标注确定性高低。' },
  { name: '执行方案', prompt: '给出可落地的下一步执行清单，按优先级排序。' },
  { name: '反方钢人', prompt: '把输入观点最强的反对版本钢化到极致，再给出裁决：它最强时还站得住吗。' },
];

export const WORKFLOW_SKILL_CATALOG = [
  {
    id: 'evidence-pack',
    label: '证据包整理',
    description: '整理可引用链接、来源、摘要和推荐理由，形成后续 LLM 可直接使用的证据包。'
  },
  {
    id: 'media-audit',
    label: '多媒体审计',
    description: '检查资讯卡片图片/视频覆盖、重复图片、缺图风险和可补图线索。'
  },
  {
    id: 'material-extractor',
    label: '素材候选提取',
    description: '把高价值资讯转成素材库候选，补齐类型、标签、来源和使用场景。'
  },
  {
    id: 'profile-memory',
    label: '画像记忆更新',
    description: '从本次输入中提取追踪词、兴趣强化项和降噪建议，让系统越用越懂用户。'
  },
  {
    id: 'article-outline',
    label: '文章草稿架构',
    description: '把素材与情报结论转成可进入内容创作中心的大纲、论点和引用安排。'
  },
  {
    id: 'github-evaluator',
    label: 'GitHub 项目评估',
    description: '评估开源项目用途、成熟度、可落地场景、媒体线索和试用建议。'
  }
];

export const WORKFLOW_CONDITION_METRICS = [
  { id: 'itemCount', label: '资讯数量' },
  { id: 'mediaCount', label: '多媒体线索' },
  { id: 'materialCount', label: '素材数量' },
  { id: 'savedCount', label: '收藏/素材命中' },
  { id: 'focusCount', label: '关注领域命中' },
  { id: 'githubCount', label: 'GitHub 项目数' }
];

export const WORKFLOW_CONDITION_OPERATORS = [
  { id: '>=', label: '>=' },
  { id: '>', label: '>' },
  { id: '<=', label: '<=' },
  { id: '<', label: '<' },
  { id: '==', label: '=' }
];

export const WORKFLOW_TEMPLATE_LIBRARY = [
  {
    id: 'daily-briefing-copilot',
    name: '每日情报简报工作流',
    description: '从用户画像、今日资讯、收藏素材中提取高价值信号，生成可追踪的每日汇报。',
    source: '参考 Dify / Langflow 的模板化工作流设计',
    tags: ['每日汇报', '用户画像', '可执行'],
    nodes: [
      {
        id: 'tpl-daily-input', type: 'input', title: '汇总输入',
        role: '收集今日推荐、关注领域、阅读历史、收藏素材和用户补充任务。',
        prompt: '读取当前日期、用户画像、今日推荐列表、追踪关键词、收藏和素材库，形成完整任务上下文。',
        inputKey: 'user_context', outputKey: 'briefing_context', enabled: true
      },
      {
        id: 'tpl-daily-rank', type: 'classifier', title: '信号分层',
        role: '把信息分为必读、追踪、素材、创作、降噪五类，并说明分层依据。',
        prompt: '按照质量等级、用户兴趣、来源可信度、可行动性和新鲜度给资讯分层，避免平均用力。',
        classifierLabels: '必读,追踪,素材,创作,降噪',
        inputKey: 'briefing_context', outputKey: 'ranked_signals', enabled: true
      },
      {
        id: 'tpl-daily-llm', type: 'llm', title: '大模型解读',
        role: '把高价值信号解释成对用户有意义的判断、机会、风险和下一步行动。',
        prompt: '输出一段清晰的每日汇报：一句话结论、三条必读、风险提醒、行动建议、可沉淀素材。',
        inputKey: 'ranked_signals', outputKey: 'briefing_analysis', enabled: true
      },
      {
        id: 'tpl-daily-actions', type: 'skill', title: '行动沉淀',
        role: '生成可执行动作：收藏素材、追踪关键词、生成创作草稿、记录画像快照。',
        prompt: '根据分析结果生成后续动作队列，并标明每个动作的触发原因和预期价值。',
        skillId: 'profile-memory',
        inputKey: 'briefing_analysis', outputKey: 'action_queue', enabled: true
      },
      {
        id: 'tpl-daily-output', type: 'output', title: '结构化输出',
        role: '生成可阅读、可追踪、可导出的最终汇报。',
        prompt: '输出 Markdown 结构，包含结论、依据、引用来源、行动清单和素材沉淀建议。',
        inputKey: 'action_queue', outputKey: 'final_briefing', enabled: true
      }
    ]
  },
  {
    id: 'github-project-evaluator',
    name: 'GitHub 项目评估工作流',
    description: '评估热门开源项目的真实用途、成熟度、适用人群和可落地场景。',
    source: '参考 Flowise / Langflow 的节点化评估链路',
    tags: ['GitHub', '开源评估', '项目场景'],
    nodes: [
      {
        id: 'tpl-github-input', type: 'input', title: '项目输入',
        role: '读取 GitHub 榜单、README 摘要、Stars、更新时间、语言和媒体线索。',
        prompt: '聚合项目元数据、README 介绍、图片线索、仓库活跃度和当前用户关注领域。',
        inputKey: 'github_items', outputKey: 'repo_context', enabled: true
      },
      {
        id: 'tpl-github-condition', type: 'condition', title: '质量门槛',
        role: '过滤过期、描述空泛、缺少应用场景或证据不足的项目。',
        prompt: '至少需要 3 个项目；优先保留有 README、近期更新、明确应用场景和可解释价值的项目。',
        conditionMetric: 'githubCount', conditionOperator: '>=', conditionValue: 3,
        inputKey: 'repo_context', outputKey: 'quality_pass', enabled: true
      },
      {
        id: 'tpl-github-skill', type: 'skill', title: '证据增强',
        role: '整理 README 图片、官网截图、演示视频、引用链接和重复媒体风险。',
        prompt: '生成媒体质量审计：正文图片优先，过滤 logo/小图标，记录缺图、重复图和可引用链接。',
        skillId: 'github-evaluator',
        inputKey: 'quality_pass', outputKey: 'evidence_pack', enabled: true
      },
      {
        id: 'tpl-github-llm', type: 'llm', title: '应用场景判断',
        role: '用大模型解释项目解决什么问题、适合谁、能落地到什么业务场景。',
        prompt: '为每个项目输出：核心价值、适用人群、典型应用场景、集成难度、风险和下一步试用建议。',
        inputKey: 'evidence_pack', outputKey: 'repo_judgement', enabled: true
      },
      {
        id: 'tpl-github-output', type: 'output', title: '项目卡片输出',
        role: '形成可以进入资讯卡片、素材库和内容创作的项目洞察。',
        prompt: '输出项目对比表和推荐排序，保留来源链接、图片线索和可沉淀素材字段。',
        inputKey: 'repo_judgement', outputKey: 'final_repo_cards', enabled: true
      }
    ]
  },
  {
    id: 'material-to-article',
    name: '素材转文章工作流',
    description: '把资讯卡片、每日汇报和本地素材转成可继续编辑的文章草稿。',
    source: '参考 n8n 的可执行自动化与 Langflow 的多 Agent 协作',
    tags: ['素材库', '内容创作', '知识资产'],
    nodes: [
      {
        id: 'tpl-article-input', type: 'input', title: '素材读取',
        role: '读取素材库、收藏资讯、今日汇报、用户选题和目标读者。',
        prompt: '把可用素材按主题、来源、观点、证据、媒体资源分类，形成写作输入包。',
        inputKey: 'material_pool', outputKey: 'writing_context', enabled: true
      },
      {
        id: 'tpl-article-classifier', type: 'classifier', title: '选题聚类',
        role: '把素材聚类为可写选题，并区分观点型、教程型、趋势型和复盘型文章。',
        prompt: '输出 3 个候选选题，每个选题给出核心论点、关键证据、目标读者和缺口。',
        classifierLabels: '观点型,教程型,趋势型,复盘型,资料型',
        inputKey: 'writing_context', outputKey: 'topic_candidates', enabled: true
      },
      {
        id: 'tpl-article-llm', type: 'llm', title: '文章架构',
        role: '生成完整大纲、段落目的、引用安排和需要补充的证据。',
        prompt: '选择最有价值的选题，生成类似 Word 文档的文章结构：标题、摘要、正文大纲、引用、结尾行动。',
        inputKey: 'topic_candidates', outputKey: 'article_outline', enabled: true
      },
      {
        id: 'tpl-article-reply', type: 'reply', title: '写作风格约束',
        role: '确保文章不是资讯堆砌，而是清晰、有判断、有证据的成稿。',
        prompt: '保持简洁、可信、可读；每个观点必须对应素材或来源；避免空泛口号。',
        inputKey: 'article_outline', outputKey: 'style_guardrails', enabled: true
      },
      {
        id: 'tpl-article-output', type: 'output', title: '导出草稿',
        role: '输出可进入内容创作中心继续编辑、导出和沉淀为私有知识库的草稿。',
        prompt: '输出 Markdown 草稿，包含素材引用清单、图片建议、标签和知识库归档建议。',
        inputKey: 'style_guardrails', outputKey: 'final_article_draft', enabled: true
      }
    ]
  },
  /* ====== 方案 C Phase 5：多 agent 编排模板 ====== */
  {
    id: 'parallel-perspective-analysis',
    name: '多视角并行分析工作流',
    description: '输入一条资讯，并行调度三个不同视角（技术、商业、风险）的智能体同时分析，最后由 LLM 汇总成综述。',
    source: '方案 C Phase 5：并行扇出 + LLM 汇总',
    tags: ['多视角', '并行', '综述'],
    nodes: [
      {
        id: 'tpl-par-input', type: 'input', title: '输入资讯',
        role: '聚合待分析的资讯上下文。',
        prompt: '读取今日推荐资讯与用户画像，准备给三个并行分支使用。',
        inputKey: 'context', outputKey: 'raw_input', enabled: true
      },
      {
        id: 'tpl-par-parallel', type: 'parallel', title: '三视角并行',
        role: '技术、商业、风险三个智能体同时分析同一份输入。',
        prompt: '基于输入给出该视角的判断。',
        inputKey: 'raw_input', outputKey: 'parallel_digest', enabled: true,
        branches: [
          { name: '技术视角', prompt: '从技术原理、技术价值、落地可行性角度分析。', agentId: 'tech-advisor' },
          { name: '商业视角', prompt: '从商业模式、市场机会、竞争格局角度分析。', agentId: 'business-analyst' },
          { name: '风险视角', prompt: '从政策、安全、市场风险角度识别潜在问题。', agentId: 'risk-scout' }
        ],
        mergeStrategy: 'summarize'
      },
      {
        id: 'tpl-par-output', type: 'output', title: '综述输出',
        role: '把汇总结果作为最终结论输出。',
        prompt: '输出包含三视角判断的综述。',
        inputKey: 'parallel_digest', outputKey: 'final_summary', enabled: true
      }
    ]
  },
  {
    id: 'router-dispatcher',
    name: '路由分发工作流',
    description: '根据输入内容（含 GitHub 关键词 / 含股价代码 / 其他）路由到对应子工作流。',
    source: '方案 C Phase 5：路由 + 子工作流',
    tags: ['路由', '子工作流', '条件分发'],
    nodes: [
      {
        id: 'tpl-rout-input', type: 'input', title: '输入待分发内容',
        role: '聚合原始内容，准备路由判断。',
        prompt: '读取用户输入或资讯摘要。',
        inputKey: 'context', outputKey: 'dispatch_input', enabled: true
      },
      {
        id: 'tpl-rout-router', type: 'router', title: '内容路由',
        role: '按内容特征路由到对应子工作流。',
        prompt: '检测输入是否包含 GitHub 关键词、股票代码或普通资讯。',
        inputKey: 'dispatch_input', outputKey: 'routed_branch', enabled: true,
        routes: [
          { match: { op: 'contains', value: 'github' }, target: 'github-project-evaluator', targetName: 'GitHub 评估' },
          { match: { op: 'regex', value: '\\d{6}' }, target: 'github-project-evaluator', targetName: '含股票代码（占位：股票评估子工作流）' }
        ],
        default: { target: 'daily-briefing-copilot', targetName: '每日简报（默认）' }
      },
      {
        id: 'tpl-rout-output', type: 'output', title: '路由结果输出',
        role: '输出路由命中后的子工作流结果。',
        prompt: '输出最终结果。',
        inputKey: 'routed_branch', outputKey: 'final_dispatched', enabled: true
      }
    ]
  }
];

export function getWorkflowSkillMeta(skillId) {
  return WORKFLOW_SKILL_CATALOG.find(skill => skill.id === skillId) || WORKFLOW_SKILL_CATALOG[0];
}

export function isWorkflowSkillId(skillId) {
  return WORKFLOW_SKILL_CATALOG.some(skill => skill.id === skillId);
}

export function formatWorkflowNodeConfig(node) {
  if (!node) return '';
  if (node.type === 'skill') return getWorkflowSkillMeta(node.skillId)?.label || '证据包整理';
  if (node.type === 'condition') {
    const metric = WORKFLOW_CONDITION_METRICS.find(item => item.id === node.conditionMetric)?.label || node.conditionMetric || '资讯数量';
    return `${metric} ${node.conditionOperator || '>='} ${node.conditionValue || 1}`;
  }
  if (node.type === 'classifier') return `分类桶：${node.classifierLabels || '必读,追踪,素材,创作,降噪'}`;
  return '';
}

export function createWorkflowTemplateInstance(template, options = {}) {
  const suffix = options.suffix || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rawNodes = Array.isArray(template?.nodes) ? template.nodes : [];
  if (!rawNodes.length) throw new Error('工作流至少需要一个节点');

  const seenNodeIds = new Set();
  const nodes = rawNodes.map((node, index) => {
    const type = WORKFLOW_NODE_TYPES.includes(node?.type) ? node.type : 'llm';
    const baseId = String(node?.id || `${type}-${index + 1}`).replace(/[^\w-]/g, '') || `${type}-${index + 1}`;
    const id = options.preserveNodeIds && !seenNodeIds.has(baseId) ? baseId : `${baseId}-${suffix}`;
    seenNodeIds.add(id);
    return {
      id,
      type,
      title: String(node?.title || `节点 ${index + 1}`).trim(),
      role: String(node?.role || '').trim(),
      prompt: String(node?.prompt || '').trim(),
      skillId: type === 'skill' ? (node?.skillId || 'evidence-pack') : node?.skillId,
      conditionMetric: type === 'condition' ? (node?.conditionMetric || 'itemCount') : node?.conditionMetric,
      conditionOperator: type === 'condition' ? (node?.conditionOperator || '>=') : node?.conditionOperator,
      conditionValue: type === 'condition' ? Number(node?.conditionValue ?? 1) : node?.conditionValue,
      classifierLabels: type === 'classifier' ? (node?.classifierLabels || '必读,追踪,素材,创作,降噪') : node?.classifierLabels,
      inputKey: String(node?.inputKey || (index === 0 ? 'context' : `step_${index}`)).trim(),
      outputKey: String(node?.outputKey || (type === 'output' ? 'final' : `step_${index + 1}`)).trim(),
      enabled: node?.enabled !== false
    };
  });

  return {
    id: options.id || `${options.idPrefix || template?.id || 'workflow'}-${suffix}`,
    name: String(template?.name || '未命名工作流').trim(),
    description: String(template?.description || '').trim(),
    source: String(options.source || template?.source || 'custom').trim(),
    tags: Array.isArray(template?.tags) ? template.tags.filter(Boolean) : [],
    updatedAt: new Date().toISOString(),
    nodes
  };
}

export function validateWorkflowImportPayload(payload) {
  const workflow = payload?.workflow && typeof payload.workflow === 'object' ? payload.workflow : payload;
  if (!workflow || typeof workflow !== 'object') throw new Error('JSON 不是有效的工作流对象');
  if (!String(workflow.name || '').trim()) throw new Error('导入失败：缺少工作流名称 name');
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) throw new Error('导入失败：nodes 必须是非空数组');

  workflow.nodes.forEach((node, index) => {
    const label = `第 ${index + 1} 个节点`;
    if (!WORKFLOW_NODE_TYPES.includes(node?.type)) throw new Error(`${label} 的 type 不受支持`);
    if (!String(node?.title || '').trim()) throw new Error(`${label} 缺少 title`);
    if (!String(node?.role || '').trim()) throw new Error(`${label} 缺少 role`);
    if (!String(node?.prompt || '').trim()) throw new Error(`${label} 缺少 prompt`);
  });

  return createWorkflowTemplateInstance(workflow, { idPrefix: 'imported-workflow', source: 'imported-json' });
}

export function normalizeWorkflowTemplate(workflow, fallback = DEFAULT_AGENT_WORKFLOW) {
  const base = { ...fallback, ...(workflow || {}) };
  const rawNodes = Array.isArray(base.nodes) && base.nodes.length ? base.nodes : fallback.nodes;
  const nodes = rawNodes.map((node, index) => {
    const type = WORKFLOW_NODE_TYPES.includes(node?.type) ? node.type : 'llm';
    const previousOutputKey = index > 0 ? (rawNodes[index - 1]?.outputKey || `step_${index}`) : 'context';
    return {
      id: node?.id || `wf-${type}-${index + 1}`,
      type,
      title: node?.title || `节点 ${index + 1}`,
      role: node?.role || '描述这个节点负责的判断、工具或输出职责。',
      prompt: node?.prompt || '在这里填写该节点的执行指令。',
      skillId: type === 'skill' ? (node?.skillId || 'evidence-pack') : node?.skillId,
      conditionMetric: type === 'condition' ? (node?.conditionMetric || 'itemCount') : node?.conditionMetric,
      conditionOperator: type === 'condition' ? (node?.conditionOperator || '>=') : node?.conditionOperator,
      conditionValue: type === 'condition' ? Number(node?.conditionValue ?? 1) : node?.conditionValue,
      classifierLabels: type === 'classifier' ? (node?.classifierLabels || '必读,追踪,素材,创作,降噪') : node?.classifierLabels,
      inputKey: String(node?.inputKey || previousOutputKey).trim(),
      outputKey: String(node?.outputKey || (type === 'output' ? 'final_output' : `step_${index + 1}`)).trim(),
      enabled: node?.enabled !== false,
      // ── 分支/编排类参数必须透传 ─────────────────────────────────────
      // 这里是「字段白名单重建」：不在白名单里的参数会在 store 初始化 / 切模板 /
      // 导入 / 重置（都会过 normalize）时被静默丢弃——表现为「配置完刷新就没了」。
      routerRules: Array.isArray(node?.routerRules) ? node.routerRules : [],
      parallelBranches: Array.isArray(node?.parallelBranches) ? node.parallelBranches : [],
      parallelMerge: node?.parallelMerge || 'concat',
      workflowId: node?.workflowId || '',
      skillMode: node?.skillMode || '',
      // 模板/引擎侧的等价字段（旧数据兼容）：仅在原值存在时透传，不凭空造空字段
      ...(Array.isArray(node?.routes) ? { routes: node.routes } : {}),
      ...(Array.isArray(node?.branches) ? { branches: node.branches } : {}),
      ...(node?.mergeStrategy ? { mergeStrategy: node.mergeStrategy } : {}),
      // 画布坐标（无限画布）：旧数据无 position 时按序自动排布一列
      position: normalizeNodePosition(node?.position, index),
    };
  });

  return {
    ...base,
    name: base.name || fallback.name,
    description: base.description || fallback.description,
    nodes,
    // v23 #3：显式连线（用户拖拽建立的边，作为顺序派生边的覆盖层持久化）
    edges: normalizeWorkflowEdges(base.edges, nodes),
  };
}

/**
 * v23 #3 规范化显式边：{ from, to, branch?, bend? }。
 * v25 #2：branch 标识分支输出口（分类器=分类桶名、条件=pass/fail、路由=规则 id、其余空串）。
 * 只保留两端节点都存在的边（节点删除后悬空边自动清理）；自环与完全重复边去重；
 * 同一 from→to 允许多条边并存（不同分支各自连到同一节点是合法拓扑）；
 * bend 为弧度偏移（像素），限制在 ±160。
 */
export function normalizeWorkflowEdges(rawEdges, nodes) {
  if (!Array.isArray(rawEdges) || rawEdges.length === 0) return [];
  const nodeIds = new Set((nodes || []).map(n => n.id));
  const seen = new Set();
  const out = [];
  for (const edge of rawEdges) {
    const from = String(edge?.from || '');
    const to = String(edge?.to || '');
    if (!from || !to || from === to) continue;
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue; // 悬空边清理
    const branch = String(edge?.branch || '').trim().slice(0, 32);
    const key = `${from}|${branch}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bend = Number(edge?.bend);
    out.push({ from, to, branch, bend: Number.isFinite(bend) ? Math.max(-160, Math.min(160, bend)) : 0 });
  }
  return out;
}

/** 显式边的唯一键（去重 / DOM data-edge-key / 断开重连定位共用） */
export function workflowEdgeKey(edge) {
  return `${edge?.from || ''}|${String(edge?.branch || '').trim().slice(0, 32)}|${edge?.to || ''}`;
}

/**
 * v25 #2：节点的分支输出口清单（真实区分节点类型，不再千篇一律单口）。
 * - classifier：每个分类桶一个口（桶名即 branch）
 * - condition：通过(pass) / 不通过(fail) 两个口
 * - router：每条路由规则一个口 + 默认(default) 口
 * - parallel：汇总(merge) 口
 * - 其余类型：单一 out 口
 */
export function getWorkflowNodePorts(node) {
  if (!node || node.enabled === false) return [];
  switch (node.type) {
    case 'classifier':
      return String(node.classifierLabels || '必读,追踪,素材,创作,降噪')
        .split(',')
        .map(label => label.trim())
        .filter(Boolean)
        .slice(0, 8)
        .map(label => ({ id: label, label }));
    case 'condition':
      return [{ id: 'pass', label: '通过' }, { id: 'fail', label: '不通过' }];
    case 'router': {
      // UI 写的是 routerRules（{ matchKey/matchValue/… }），模板/引擎侧用 routes —— 两者都认，
      // 否则配置面板里加的路由规则不会长出输出口（节点看起来永远只有一个「默认」口）。
      const rulesRaw = Array.isArray(node.routerRules) && node.routerRules.length
        ? node.routerRules
        : (Array.isArray(node.routes) ? node.routes : []);
      return [
        ...rulesRaw.map((rule, index) => ({
          id: `route-${index}`,
          label: rule?.targetName
            || rule?.label
            || rule?.match?.value
            || rule?.matchValue
            || rule?.when
            || `规则${index + 1}`,
        })),
        { id: 'default', label: '默认' },
      ];
    }
    case 'parallel':
      return [{ id: 'merge', label: '汇总' }];
    default:
      return [{ id: 'out', label: '' }];
  }
}

/** 分支口在节点右缘的纵向偏移（像素）：多口时均匀分布，单口居中 */
export function workflowPortOffsetY(node, branch, nodeHeight = 118) {
  const ports = getWorkflowNodePorts(node);
  if (ports.length <= 1) return nodeHeight / 2;
  const index = ports.findIndex(port => port.id === (branch || ports[0].id));
  const safeIndex = index < 0 ? 0 : index;
  return (nodeHeight * (safeIndex + 1)) / (ports.length + 1);
}

/**
 * v25 #2：按显式连线推导执行顺序（拓扑化）。
 * - 无显式边 → 完全向后兼容：启用节点按数组顺序执行。
 * - 起点 = 数组序首个没有入边的启用节点（找不到则第一个启用节点）；
 *   从起点沿出边 DFS，出边按「输出口顺序」排列（分支语义：分类器各桶、条件通过/不通过）；
 *   环路由 visiting 集合拦截；节点只执行一次。
 * - 不可达的启用节点按数组顺序追加在尾部（仍会被执行，等价旧顺序兜底）。
 * @returns {Array<{node:object, viaBranch:string}>}
 */
export function deriveWorkflowExecutionOrder(nodes, edges) {
  const enabled = (Array.isArray(nodes) ? nodes : []).filter(node => node && node.enabled !== false);
  if (!enabled.length) return [];
  const nodeById = new Map(enabled.map(node => [node.id, node]));
  const normEdges = (Array.isArray(edges) ? edges : [])
    .filter(edge => nodeById.has(edge?.from) && nodeById.has(edge?.to) && edge.from !== edge.to);
  if (!normEdges.length) return enabled.map(node => ({ node, viaBranch: '' }));

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of normEdges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }

  const start = enabled.find(node => !incoming.has(node.id)) || enabled[0];
  const order = [];
  const visited = new Set();
  const visiting = new Set();

  const portOrderIndex = (node, branch) => {
    const ports = getWorkflowNodePorts(node);
    if (ports.length <= 1) return 0;
    const idx = ports.findIndex(port => port.id === (branch || 'out'));
    return idx < 0 ? ports.length : idx;
  };

  const visit = (nodeId, viaBranch) => {
    if (visited.has(nodeId) || visiting.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodeById.get(nodeId);
    if (node) {
      visited.add(nodeId);
      order.push({ node, viaBranch: viaBranch || '' });
      const outs = (outgoing.get(nodeId) || [])
        .slice()
        .sort((a, b) => portOrderIndex(node, a.branch) - portOrderIndex(node, b.branch));
      for (const edge of outs) visit(edge.to, edge.branch || '');
    }
    visiting.delete(nodeId);
  };

  visit(start.id, '');
  for (const node of enabled) {
    if (!visited.has(node.id)) visit(node.id, '');
  }
  return order;
}

/**
 * v25 #2：从某节点沿指定分支口出发可达的节点集合（含下游整棵子树）。
 * 条件节点短路 / 分支跳过时用它圈定需要标记 skipped 的节点。
 */
export function collectBranchReachable(startNodeId, branch, edges) {
  const reachable = new Set();
  const stack = [];
  for (const edge of (Array.isArray(edges) ? edges : [])) {
    if (edge?.from === startNodeId && (edge.branch || '') === (branch || '')) stack.push(edge.to);
  }
  while (stack.length) {
    const nodeId = stack.pop();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const edge of (Array.isArray(edges) ? edges : [])) {
      if (edge?.from === nodeId) stack.push(edge.to);
    }
  }
  return reachable;
}

/** 画布坐标规范化：非法/缺失时按索引排成一列（x=90, y=60+idx*190） */
export function normalizeNodePosition(position, index = 0) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return { x: 90, y: 60 + index * 190 };
}

let wfNodeSeq = 0;
const nextNodeId = (type) => `wf-${type}-${Date.now().toString(36)}-${(wfNodeSeq += 1).toString(36)}`;

/**
 * 创建节点：按类型注入真实可用的默认配置（标题/职责/指令/变量/类型专属参数）
 * @param {string} type 节点类型
 * @param {number} index 新节点在链路中的下标（用于变量命名）
 * @param {number} existingNodesLength 当前节点数
 * @param {string} workflowNodeType 兜底类型
 * @param {{x:number,y:number}|null} position 画布坐标
 */
export function createWorkflowNode(type, index, existingNodesLength, workflowNodeType = 'llm', position = null) {
  const meta = WORKFLOW_NODE_TYPES.includes(type) ? type : (WORKFLOW_NODE_TYPES.includes(workflowNodeType) ? workflowNodeType : 'llm');
  const bp = WORKFLOW_NODE_BLUEPRINT[meta] || WORKFLOW_NODE_BLUEPRINT.llm;
  const seq = Math.max(Number(index) || 0, Number(existingNodesLength) || 0);
  return {
    id: nextNodeId(meta),
    type: meta,
    title: bp.title,
    role: bp.role,
    prompt: bp.prompt,
    skillId: meta === 'skill' ? 'evidence-pack' : undefined,
    conditionMetric: meta === 'condition' ? 'itemCount' : undefined,
    conditionOperator: meta === 'condition' ? '>=' : undefined,
    conditionValue: meta === 'condition' ? 1 : undefined,
    classifierLabels: meta === 'classifier' ? '必读,追踪,素材,创作,降噪' : undefined,
    routerRules: meta === 'router' ? [{ label: '默认分支', operator: 'contains', value: '' }] : undefined,
    parallelBranches: meta === 'parallel' ? 3 : undefined,
    parallelMerge: meta === 'parallel' ? 'concat' : undefined,
    inputKey: seq === 0 ? 'context' : `step_${seq}`,
    outputKey: `step_${seq + 1}`,
    enabled: true,
    position: position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
      ? { x: Number(position.x), y: Number(position.y) }
      : { x: 90, y: 60 + seq * 190 },
  };
}

/** 创建一个空白工作流（三名可编辑起点） */
export function createBlankWorkflow(name = '未命名工作流') {
  return {
    id: `workflow-${Date.now().toString(36)}`,
    name,
    description: '',
    nodes: [createWorkflowNode('input', 0, 0, 'input', { x: 80, y: 120 }), createWorkflowNode('output', 1, 1, 'output', { x: 560, y: 120 })],
    updatedAt: new Date().toISOString(),
  };
}
