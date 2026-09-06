/**
 * AI 工作流搭建：提示词构造 / 结果解析 / 无模型时的本地兜底
 *
 * 拆成纯函数的目的：LLM 输出不可信，解析与规范化必须可单测、可复现。
 * 约定：AI 只输出一个 JSON 对象，前端负责把任意"脏"输出收敛成合法节点。
 */
import { createWorkflowNode } from '../constants/workflowConstants.js';

/** 节点类型清单（写进提示词，约束模型只能选用这些类型） */
export function buildTypeCatalog(nodeTypeMeta) {
  return Object.entries(nodeTypeMeta)
    .map(([type, m]) => `- ${type}（${m.label}）`)
    .join('\n');
}

/** 系统提示词：目标 + 类型清单 + JSON 契约 + 规则 + 当前画布上下文 */
export function buildWorkflowSystemPrompt(nodeTypeMeta, currentDraft) {
  const current = (currentDraft?.nodes || []).length
    ? `\n当前画布已有工作流「${currentDraft.name || '未命名'}」，共 ${currentDraft.nodes.length} 个节点：\n${
      currentDraft.nodes.map((n, i) => `${i + 1}. ${n.type}｜${n.title}`).join('\n')
    }\n用户可能是在此基础上修改，请理解增量意图。`
    : '';
  return [
    '你是工作流画布搭建助手，把用户的自然语言需求转换成可执行的画布工作流 JSON。',
    '',
    '可用节点类型（只能从下列类型中选择）：',
    buildTypeCatalog(nodeTypeMeta),
    '',
    '输出契约（严格只输出一个 JSON 对象，不要多余文字，不要代码块标记）：',
    '{"name":"工作流名(≤16字)","description":"一句话说明","nodes":[{"type":"类型","title":"节点标题(≤12字)","role":"职责一句话","prompt":"该节点的执行指令","enabled":true}]}',
    '',
    '规则：',
    '1. 节点数量 2-8 个，第一个节点用 input，最后一个用 output 或 reply；',
    '2. 相邻节点要有清晰的上下游关系，llm 节点的 prompt 必须写清具体指令；',
    '3. condition 节点只写 prompt 说明判断意图即可，分类用 classifier 并给出分类桶；',
    '4. 节点标题要贴合用户场景，不要出现"节点1"这种占位名；',
    '5. 只输出 JSON。',
    current,
  ].filter(Boolean).join('\n');
}

/** 从任意文本中抠出 JSON 对象（容忍 ```json 包裹与前后废话） */
export function parseWorkflowJson(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 把 AI 产出的（可能不完整的）节点规范化成画布可直接落地的节点
 * @returns {Array} 节点数组，非法类型降级为 llm，最多 12 个
 */
export function normalizeAiNodes(parsed, nodeTypeMeta, offset = 0) {
  const raw = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const types = Object.keys(nodeTypeMeta);
  return raw.slice(0, 12).map((n, i) => {
    const type = types.includes(n?.type) ? n.type : 'llm';
    const base = createWorkflowNode(type, offset + i, offset + i, type, {
      x: 120 + (i % 3) * 300,
      y: 90 + Math.floor(i / 3) * 200,
    });
    return {
      ...base,
      title: String(n?.title || base.title).trim().slice(0, 24) || base.title,
      role: String(n?.role || base.role).trim().slice(0, 120),
      prompt: String(n?.prompt || base.prompt).trim().slice(0, 800),
      enabled: n?.enabled !== false,
    };
  });
}

/* ---------------- 无大模型时的本地兜底：关键词 → 预置链路 ---------------- */

const LOCAL_RULES = [
  {
    match: /(资讯|新闻|日报|简报|摘要|早报|晚报|情报)/,
    name: '每日资讯简报流',
    description: '抓取今日资讯 → 分层 → 解读 → 输出简报',
    nodes: [
      { type: 'input', title: '今日资讯输入', role: '汇总当日推荐与关注领域命中的资讯。', prompt: '收集今日推荐、关注领域命中和收藏素材，输出统一的上下文包。' },
      { type: 'classifier', title: '信号分层', role: '按价值把资讯分成必读/追踪/素材/降噪。', prompt: '将每条资讯归类到分类桶，并给出一句归类理由。', classifierLabels: '必读,追踪,素材,创作,降噪' },
      { type: 'llm', title: '要点解读', role: '对必读与追踪内容给出判断与影响分析。', prompt: '请输出今日最值得关注的 3 条判断，每条给出事实、影响与建议动作。' },
      { type: 'output', title: '简报输出', role: '生成可直接阅读的今日简报。', prompt: '按「一句话判断 / 优先阅读 / 风险 / 行动建议」四段输出简报。' },
    ],
  },
  {
    match: /(github|仓库|开源|项目评估|repo)/i,
    name: 'GitHub 仓库评估流',
    description: '读取仓库 → 质量门槛 → 价值评估 → 结论',
    nodes: [
      { type: 'input', title: '仓库信息输入', role: '接收仓库 README、指标与近期动态。', prompt: '整理仓库的基础信息、活跃度与社区反馈。' },
      { type: 'condition', title: '质量门槛', role: '低于门槛的仓库直接短路，不做深度评估。', prompt: '资讯数量或项目数达到阈值才继续评估。', conditionMetric: 'itemCount', conditionOperator: '>=', conditionValue: 1 },
      { type: 'llm', title: '价值与风险评估', role: '判断接入价值、维护风险与替代方案。', prompt: '请输出接入价值、主要风险、维护活跃度判断与替代方案对比。' },
      { type: 'output', title: '评估结论', role: '给出明确的接入/观察/放弃建议。', prompt: '输出结论：建议接入 / 继续观察 / 放弃，并附三条依据。' },
    ],
  },
  {
    match: /(素材|文章|创作|写作|成稿|选题|大纲)/,
    name: '素材成稿工作流',
    description: '素材输入 → 观点提炼 → 大纲 → 成稿',
    nodes: [
      { type: 'input', title: '素材输入', role: '接收素材库内容与用户补充观点。', prompt: '读取素材库条目、标签与用户备注。' },
      { type: 'llm', title: '观点提炼', role: '从素材中提炼可写成文章的观点。', prompt: '请提炼 3-5 个有信息增量的观点，并标注可引用的素材。' },
      { type: 'skill', title: '大纲生成', role: '调用内置 Skill 生成结构化大纲。', prompt: '基于观点生成文章大纲，标注每段的论据来源。', skillId: 'article-outline' },
      { type: 'output', title: '成稿输出', role: '输出可直接编辑的文章初稿。', prompt: '按大纲输出文章初稿，保留引用标记。' },
    ],
  },
  {
    match: /(监控|告警|预警|阈值|巡检)/,
    name: '监控告警工作流',
    description: '采集 → 阈值判断 → 告警回复 → 报告',
    nodes: [
      { type: 'input', title: '信号采集', role: '汇总需要监控的指标与来源。', prompt: '读取监控目标的最新数据。' },
      { type: 'condition', title: '阈值判断', role: '超过阈值才触发后续告警。', prompt: '指标超过设定阈值时继续，否则短路。', conditionMetric: 'itemCount', conditionOperator: '>=', conditionValue: 3 },
      { type: 'reply', title: '告警回复', role: '按模板输出告警内容。', prompt: '输出告警：触发指标、当前值、影响范围与建议动作。' },
      { type: 'output', title: '巡检报告', role: '归档本次巡检结果。', prompt: '输出巡检记录，包含是否触发与处理建议。' },
    ],
  },
];

/** 本地兜底：没有配置大模型时也能用一句话搭出可用链路 */
export function buildLocalWorkflow(text, nodeTypeMeta) {
  const query = String(text || '');
  const rule = LOCAL_RULES.find(r => r.match.test(query));
  const plan = rule || {
    name: '自定义工作流',
    description: '按你的描述生成的通用链路',
    nodes: [
      { type: 'input', title: '输入', role: '接收待处理的原始内容。', prompt: '读取用户提供的输入内容。' },
      { type: 'llm', title: '分析处理', role: '对输入做理解、提炼或推理。', prompt: '请基于输入内容输出关键结论与依据。' },
      { type: 'classifier', title: '结果分类', role: '把处理结果分流到不同用途。', prompt: '按分类桶对结果归类。', classifierLabels: '必读,追踪,素材,创作,降噪' },
      { type: 'output', title: '结果输出', role: '汇总并输出最终交付物。', prompt: '输出结构化的最终产物。' },
    ],
  };
  const nodes = normalizeAiNodes({ nodes: plan.nodes }, nodeTypeMeta);
  return { name: plan.name, description: plan.description, nodes, local: true };
}
