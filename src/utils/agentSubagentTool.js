/**
 * agentSubagentTool.js - spawn_subagent 工具注册（import 即注册，与 agentTools 的
 * ensureRegistered 同模式）
 *
 * 这是 AI 工作站的多 agent 编排入口（orchestrator-worker 模式，对标 Claude Code 的
 * Task/Agent tool + Anthropic 多 agent 研究系统）：主 agent 通过本工具把可并行的
 * 子任务派给预置子代理（explorer/researcher/writer/critic），收集结构化报告。
 *
 * 安全边界：
 * - 深度硬限制 1 层：子代理工具白名单不含 spawn_subagent（物理隔离）+ ctx.__subagent 二次校验
 * - 子代理工具白名单是继承收缩（只读为主），写操作仍走审批闸门
 * - 全批并发上限 5、单次任务数上限 5、每任务独立 maxTurns 预算
 * - 子代理报告回灌前会被 agentLoopCore 统一包 <untrusted_data> 定界
 */

import { registerTool } from './toolRegistry.js';
import {
  normalizeSpawnTasks,
  aggregateSpawnReports,
  listSubagentIds,
  SUBAGENT_LIMITS,
} from '../domain/agent/subagentCore.js';
import { runSubagentTasks } from '../components/aichat/subagentRunner.js';

/** 单次 spawn 的最长执行窗口（5 任务 × 10 轮 LLM 调用，串行最坏情况很慢） */
const SPAWN_TIMEOUT_MS = 900_000;

async function toolSpawnSubagent(args, ctx) {
  // 深度防御：子代理上下文不允许再 spawn（正常情况下白名单已隔离，这里双保险）
  if (ctx?.__subagent) {
    return '错误：子代理不允许派生其他子代理（编排深度限制 1 层）。请直接完成任务并输出报告。';
  }
  const { tasks, errors } = normalizeSpawnTasks(args?.tasks);
  if (errors.length && tasks.length === 0) {
    return `错误：spawn_subagent 契约校验失败：\n- ${errors.join('\n- ')}\n请修正后重新调用。`;
  }

  try {
    // 进度桥接：runner 按 (taskIndex, patch) 推单任务补丁，这里维护全量任务快照，
    // 每次都推完整数组给卡片（ToolCards 的 SubagentProgress 按快照渲染）
    const progressTasks = tasks.map(t => ({
      id: t.id,
      agent: t.preset.id,
      agentName: t.preset.name,
      objective: t.objective,
      status: 'pending',
      tokens: 0,
    }));
    const results = await runSubagentTasks({
      tasks,
      llmConfig: ctx?.llmConfig,
      selectedModel: ctx?.llmConfig?.selectedModel,
      parentCtx: ctx,
      signal: ctx?.signal,
      onProgress: (taskIndex, patch) => {
        if (progressTasks[taskIndex]) Object.assign(progressTasks[taskIndex], patch);
        try {
          ctx?.emitProgress?.({ type: 'subagent', tasks: progressTasks.map(t => ({ ...t })) });
        } catch { /* 进度失败不影响执行 */ }
      },
    });
    let out = aggregateSpawnReports(results);
    if (errors.length) {
      out += `\n\n> 契约警告：${errors.join('；')}`;
    }
    return out;
  } catch (err) {
    if (err?.name === 'AbortError') throw err; // 用户取消：穿透让整轮停止
    return `工具执行失败：${err?.message || String(err)}`;
  }
}

const taskItemSchema = {
  type: 'object',
  properties: {
    agent: {
      type: 'string',
      enum: listSubagentIds(),
      description: '子代理类型：explorer（只读侦察，快）/ researcher（深度研究，多轮交叉验证）/ writer（基于材料起草文稿，可写工作空间）/ critic（对照材料挑漏洞给修改清单）',
    },
    objective: { type: 'string', description: '任务目标（一句话说清这个子代理要做什么，必须自包含——子代理看不到主对话）' },
    context: { type: 'string', description: '背景上下文：上级掌握的相关材料/数据/中间结论，作为子代理的分析输入' },
    constraints: { type: 'string', description: '硬性约束：范围、篇幅、禁止事项等' },
    output_format: { type: 'string', description: '期望的报告输出格式' },
  },
  required: ['agent', 'objective'],
};

registerTool('spawn_subagent', {
  source: 'builtin',
  enabled: true,
  schema: {
    type: 'function',
    function: {
      name: 'spawn_subagent',
      description: `【多代理编排】把可并行的子任务派给专业化子代理并收集报告。适用场景：多源信息需要并行侦察（如同时查资讯库+联网+行情）、独立可分的调研课题、需要"起草→审校"分工的产出流程。每个子代理在全新隔离上下文中运行（看不到主对话），只回传最终报告。单次最多 ${SUBAGENT_LIMITS.MAX_TASKS_PER_SPAWN} 个任务，默认 ${SUBAGENT_LIMITS.DEFAULT_CONCURRENCY} 路并发。注意：objective 必须自包含，把子代理需要的背景写进 context，不要让它猜主对话内容。`,
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: taskItemSchema,
            description: `子任务列表（1-${SUBAGENT_LIMITS.MAX_TASKS_PER_SPAWN} 个），相互独立的任务才并行派发；有依赖关系的任务请分多轮派发`,
          },
        },
        required: ['tasks'],
      },
    },
  },
  meta: {
    label: '派出子代理',
    iconKey: 'bot',
    description: '派发并行子代理任务并收集报告（多 agent 编排）',
    category: 'agents',
    timeoutMs: SPAWN_TIMEOUT_MS,
  },
  executor: toolSpawnSubagent,
});
