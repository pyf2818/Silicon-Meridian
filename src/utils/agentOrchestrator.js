/**
 * agentOrchestrator.js - 多 agent 协作编排（对标 pi 的多步 agent，贴合本项目 agents 生态）
 *
 * AI 工作站补强：把「多个专业 agent 各自产出视角 → 汇总成一份总报告」做成纯逻辑。
 * - 每个 agent 有自己的 system prompt（在 agents 生态里），编排器负责按序接力：
 *   上一个 agent 的输出作为下一个的输入（喂给其 user 消息），最后用「总控」合成。
 * - 不新建运行时：实际 LLM 调用仍走 /api/ai-generate；本模块只编排「谁在什么时候看到什么」。
 * - 纯函数、无 React、无 fetch（fetch 由调用方注入），可单测。
 */

/**
 * 视角标签（用于展示"分析师视角/风险视角"等）
 */
export const VIEW_LABELS = {
  analyst: '资讯视角',
  'tech-advisor': '技术视角',
  'business-analyst': '商业视角',
  'risk-scout': '风险视角',
  'creation-agent': '创作视角',
  'memory-agent': '记忆视角',
  writer: '写作视角',
  orchestrator: '情报总控',
};

/** 默认多视角协作链（不含合成者） */
export const DEFAULT_CHAIN = [
  'analyst',
  'tech-advisor',
  'business-analyst',
  'risk-scout',
  'creation-agent',
];

/**
 * 从 agents 生态里选「多视角协作」的 agent 序列。
 * @param {Array}  agents         agents 生态（含 id/name/systemPrompt）
 * @param {Object} [opts]
 * @param {Array}  [opts.chain]   显式 agentId 顺序（缺省用默认协作链）
 * @param {string} [opts.orchestratorId] 负责合成的总控 agentId（缺省 'orchestrator'）
 * @returns {{chain: Array<{agent, viewLabel}>, synthesizer: {agent, label}}}
 */
export function selectOrchestration(agents = [], opts = {}) {
  const list = Array.isArray(agents) ? agents : [];
  const orchestratorId = opts.orchestratorId || 'orchestrator';
  const chainIds = (Array.isArray(opts.chain) && opts.chain.length) ? opts.chain : DEFAULT_CHAIN;
  const byId = (id) => list.find(a => a.id === id);

  const chain = chainIds
    .map(id => ({ agent: byId(id) }))
    .filter(x => x.agent)
    .map(x => ({ agent: x.agent, viewLabel: VIEW_LABELS[x.agent.id] || x.agent.name || '视角' }));

  let synthesizerAgent = byId(orchestratorId);
  if (!synthesizerAgent) {
    synthesizerAgent = list.find(a => a.id === 'orchestrator') || list[0] || null;
  }

  return {
    chain,
    synthesizer: synthesizerAgent
      ? { agent: synthesizerAgent, label: VIEW_LABELS[synthesizerAgent.id] || synthesizerAgent.name || '总控' }
      : null,
  };
}

/**
 * 构造「第 k 个视角 agent」的 user 消息（前序输出喂进来）。
 * @param {string} task           原始用户任务
 * @param {string} viewLabel      当前视角标签
 * @param {string} prevOutput     上一个 agent 的输出（首节点为空）
 * @param {number} total          视角总数（用于提示第几个）
 * @returns {string}
 */
export function buildViewTask(task, viewLabel, prevOutput, total) {
  const lines = [
    `【协作任务】用户请求：${task}`,
    '',
    `你正在参与一个 ${total} 视角的多 agent 协作，你是第 ${viewLabel}。`,
    '请从你的专业视角，基于给定上下文输出你的分析。不要重复其他视角的内容。',
  ];
  if (prevOutput) {
    lines.push('', `【前序视角产出】以下是前一个视角的分析，请接力（可引用，但突出你的视角增量）：\n${prevOutput}`);
  }
  return lines.join('\n');
}

/**
 * 构造「合成者」的 user 消息：把各视角产出汇总为一份总报告。
 * @param {string} task          原始用户任务
 * @param {Array<{viewLabel, output}>} views 各视角产出
 * @returns {string}
 */
export function buildSynthesisTask(task, views) {
  const viewText = views
    .map((v, i) => `### ${i + 1}. ${v.viewLabel}\n${v.output}`)
    .join('\n\n---\n\n');
  return [
    `【协作汇总】请把下面 ${views.length} 个专业视角的分析，综合成一份面向用户的、克制、信息密集的总报告。`,
    '',
    `原始任务：${task}`,
    '',
    '要求：',
    '- 给出清晰的一句话总判断和优先级。',
    '- 归纳各视角的共识与分歧，明确标注不确定处。',
    '- 输出下一步可执行动作（追踪/阅读/创作/存证）。',
    '- 保留各视角的关键证据引用（如有 [资讯:ID] / [素材:ID]）。',
    '',
    '【各视角产出】',
    viewText,
  ].join('\n');
}

/**
 * 编排一轮「多视角协作」的状态机（纯函数，推进一步返回 next）。
 * 用于前端逐步执行：每步选一个 agent → 注入前序 → 调 LLM → 记 output → 推进。
 *
 * @param {Object} state
 * @param {string} state.task
 * @param {Array}  state.chain     [{agent, viewLabel}]
 * @param {Object|null} state.synthesizer
 * @param {Array}  state.views     [{viewLabel, output, agentId}]
 * @returns {{step: 'view'|'synthesize'|'done', index: number, agent, viewLabel, input, views, done: boolean}}
 *   - step='view'：应执行第 index 个视角 agent
 *   - step='synthesize'：应执行合成者
 *   - step='done'：已完成（views 已含各视角，等待调用方取 result）
 */
export function orchestrationStep(state) {
  const task = state.task;
  const chain = Array.isArray(state.chain) ? state.chain : [];
  const views = Array.isArray(state.views) ? state.views : [];
  const index = state.index || 0;

  if (index < chain.length) {
    const cur = chain[index];
    const prevOutput = views.length ? views[views.length - 1].output : '';
    return {
      step: 'view',
      index,
      agent: cur.agent,
      viewLabel: cur.viewLabel,
      input: buildViewTask(task, cur.viewLabel, prevOutput, chain.length),
      views,
      done: false,
    };
  }
  // index === chain.length：所有视角已产出，且合成尚未执行
  if (index === chain.length && state.synthesizer && views.length > 0) {
    return {
      step: 'synthesize',
      index: chain.length,
      agent: state.synthesizer.agent,
      viewLabel: state.synthesizer.label,
      input: buildSynthesisTask(task, views),
      views,
      done: false,
    };
  }
  // 无合成者，或合成已提交（index 已越过 chain.length）
  return { step: 'done', index: chain.length, views, done: true };
}

/**
 * 记录某个视角/合成的产出，推进到下一步。
 * @param {Object} state   旧状态
 * @param {string} output  刚完成的输出
 * @param {string} agentId 刚执行的 agent id
 * @returns {Object} 新状态（index+1, views 追加）
 */
export function commitOrchestrationStep(state, output, agentId) {
  const chain = Array.isArray(state.chain) ? state.chain : [];
  const views = Array.isArray(state.views) ? state.views : [];
  const index = state.index || 0;
  const cur = index < chain.length ? chain[index] : null;

  const nextViews = cur
    ? [...views, { viewLabel: cur.viewLabel, output, agentId }]
    : views; // 合成阶段不追加到 views

  return {
    ...state,
    index: index + 1,
    views: nextViews,
    lastOutput: output,
  };
}
