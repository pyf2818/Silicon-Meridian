/**
 * agenticBriefing.js - 多智能体「分析性简报」编排（G2 复刻 Meridian 的多阶段 AI 简报）
 *
 * 与项目约定一致：
 * - 纯逻辑、无 React、无 fetch；LLM 调用由调用方通过 `llmCall` 注入（可单测、可离线 mock）。
 * - 直接复用 src/utils/agentOrchestrator.js 的多视角协作状态机
 *   （selectOrchestration / orchestrationStep / commitOrchestrationStep），
 *   不再造轮子；本模块只负责「把语义聚类结果喂进去 + 收集每簇分析 + 合成总览」。
 * - 语义聚类来自 G1 的 buildSemanticClusters（clusterByEmbeddings），二者簇对象同形状，可直接对接。
 *
 * 数据流：
 *   语义簇[]  →  foreach 簇 { analyst→tech-advisor→business-analyst→risk-scout→creation 多视角接力
 *                          → orchestrator 合成该簇分析 }  →  total 跨簇总览  →  Briefing
 *
 * 不修改现有 briefingEngine / recommendationEngine，可并排或后续接入。
 */

import {
  selectOrchestration,
  orchestrationStep,
  commitOrchestrationStep,
  buildSynthesisTask,
} from '../../utils/agentOrchestrator.js';

/** 默认 agent 阵容（id 与 agentOrchestrator.VIEW_LABELS 对齐，systemPrompt 给真实 llmCall 用）。 */
export const DEFAULT_AGENTS = [
  { id: 'analyst', systemPrompt: '你是从业多年的资讯分析师，擅长快速判断事件的背景与驱动因素。' },
  { id: 'tech-advisor', systemPrompt: '你是技术顾问，关注技术可行性与潜在影响面。' },
  { id: 'business-analyst', systemPrompt: '你是商业分析师，关注市场格局与商业模式层面的影响。' },
  { id: 'risk-scout', systemPrompt: '你是风险侦察员，关注潜在风险、不确定性与需警惕的信号。' },
  { id: 'creation-agent', systemPrompt: '你是创作助手，关注可转化为内容/行动的独特视角。' },
  { id: 'orchestrator', systemPrompt: '你是情报总控，负责把各视角产出综合成克制、信息密集的总报告。' },
];

function clusterTaskPrefix(prefix) {
  return prefix || '分析今日情报事件簇';
}

/**
 * 对单个语义簇跑完一轮「多视角接力 + 总控合成」。
 * @param {Object} args
 * @param {Object} args.cluster        语义簇（来自 buildSemanticClusters / clusterEvents）
 * @param {string} args.task           喂给编排器的原始任务描述
 * @param {Function} args.llmCall      async ({ system, user }) => string
 * @param {Array}  args.agents
 * @param {Array}  [args.chain]        显式视角链（缺省走 DEFAULT_CHAIN）
 * @param {string} [args.orchestratorId]
 * @returns {Promise<{views: Array, synthesis: string}>}
 */
export async function runClusterAnalysis({
  cluster,
  task,
  llmCall,
  agents,
  chain,
  orchestratorId,
}) {
  const { chain: resolvedChain, synthesizer } = selectOrchestration(agents, { chain, orchestratorId });
  let state = { task, chain: resolvedChain, synthesizer, views: [], index: 0 };
  let synthesis = '';

  while (true) {
    const step = orchestrationStep(state);
    if (step.step === 'done') break;
    const output = await llmCall({
      system: step.agent?.systemPrompt || '',
      user: step.input,
    });
    if (step.step === 'synthesize') synthesis = output;
    state = commitOrchestrationStep(state, output, step.agent?.id);
  }

  return { views: state.views, synthesis };
}

/**
 * 对全部语义簇生成「分析性简报」。
 *
 * @param {Object} args
 * @param {Array}  args.clusters       语义簇数组（可来自 G1 的 buildSemanticClusters）
 * @param {Function} args.llmCall      async ({ system, user }) => string（必填，纯逻辑故注入）
 * @param {Array}  [args.agents]       缺省用 DEFAULT_AGENTS
 * @param {string} [args.taskPrefix]   簇任务前缀
 * @param {Object} [args.opts]
 * @param {number} [args.opts.maxClusters=8]  最多分析前 N 个簇（按 items 数量降序）
 * @param {Array}  [args.opts.chain]         显式视角链
 * @param {string} [args.opts.orchestratorId]
 * @param {boolean} [args.opts.totalSynthesis=true] 是否再合成一份跨簇总览
 * @returns {Promise<{version:number,mode:string,generatedAt:string,clusters:Array,total:string|null}>}
 */
export async function buildAgenticBriefing({
  clusters = [],
  llmCall,
  agents = DEFAULT_AGENTS,
  taskPrefix,
  opts = {},
}) {
  if (typeof llmCall !== 'function') {
    throw new Error('buildAgenticBriefing: llmCall 为必填（async ({system,user})=>string）');
  }

  const maxClusters = Math.max(1, Number(opts.maxClusters ?? 8));
  const prefix = clusterTaskPrefix(taskPrefix);

  // 簇按报道数（事件热度）降序，优先分析更热的事件
  const ordered = [...clusters].sort(
    (a, b) => (b.items?.length || 0) - (a.items?.length || 0),
  ).slice(0, maxClusters);

  const perCluster = [];
  for (const cluster of ordered) {
    const primaryTitle = cluster.primaryItem?.title || cluster.id || '未命名事件';
    const task = `${prefix}：《${primaryTitle}》（${cluster.items?.length || 0} 篇报道，来自 ${cluster.independentSourceCount || 1} 个独立来源）`;
    const { views, synthesis } = await runClusterAnalysis({
      cluster,
      task,
      llmCall,
      agents,
      chain: opts.chain,
      orchestratorId: opts.orchestratorId,
    });
    perCluster.push({
      clusterId: cluster.id,
      primaryTitle,
      sourceCount: cluster.independentSourceCount || 1,
      itemCount: cluster.items?.length || 0,
      itemIds: cluster.itemIds || (cluster.items || []).map((it) => it.id),
      views,
      synthesis,
    });
  }

  let total = null;
  if (opts.totalSynthesis !== false && perCluster.length) {
    const totalTask = '汇总今日所有事件簇的多视角分析，给出全局态势判断、优先级与下一步动作。';
    const viewsForTotal = perCluster.map((c) => ({ viewLabel: c.primaryTitle, output: c.synthesis }));
    total = await llmCall({
      system: '',
      user: buildSynthesisTask(totalTask, viewsForTotal),
    });
  }

  return {
    version: 1,
    mode: 'agentic',
    generatedAt: new Date().toISOString(),
    clusters: perCluster,
    total,
  };
}
