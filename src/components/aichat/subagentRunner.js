/**
 * subagentRunner.js - 子代理执行器（fetch 层编排，依赖 agentLoopCore）
 *
 * 职责：把 spawn 契约的一批任务以**并发池**方式跑起来——每个任务是一次独立的
 * runToolLoop（全新上下文、继承收缩白名单、独立预算、独立审批会话）。
 * 纯编排不做业务判断；契约校验/预算/聚合等纯逻辑在 src/domain/agent/subagentCore.js。
 *
 * 隔离要点（对标 Claude Code subagents）：
 * - 上下文隔离：子代理 systemPrompt 只含角色设定 + 任务简报，不带主对话历史
 * - 工具隔离：toolSchemas = selectToolSchemas(preset.tools)，白名单不含 spawn_subagent，
 *   深度物理限制在 1 层（Codex max_depth=1 的等价实现）
 * - 审批隔离：子代理 sessionId = <父会话>:sub:<taskId>，写操作审批独立记账
 * - 失败隔离：单个子代理失败/中止不影响其余任务，错误进各自报告
 */

import { runToolLoop } from './agentLoopCore.js';
import { selectToolSchemas } from '../../utils/agentTools.js';
import { getRootHandle } from '../../utils/workspaceHandleStore.js';
import { persistLongResult } from '../../session/outputSink.js';
import { createLlmSummarizer } from '../../session/llmSummarizer.js';
import { SUBAGENT_LIMITS, buildSubagentSystemPrompt } from '../../domain/agent/subagentCore.js';

/**
 * 固定并发池：按 lane 消费任务队列，任意一个 worker 抛错不拖垮其余 lane。
 */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        if (err?.name === 'AbortError') throw err; // 用户取消整批
        results[idx] = { __poolError: err };
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

/** 会话消息 → 可读转写文本（落盘用） */
function transcriptText(task, messages) {
  const lines = [
    `# 子代理执行转写`,
    `- 任务 ID：${task.id}`,
    `- 类型：${task.preset.id}（${task.preset.name}）`,
    `- 目标：${task.objective}`,
    `- 时间：${new Date().toISOString()}`,
    '',
    '---',
    '',
  ];
  for (const m of messages || []) {
    const role = m.role === 'user' ? '[任务书]' : m.role === 'tool' ? '[工具]' : '[助手]';
    lines.push(`## ${role}`);
    lines.push(String(m.content ?? '').slice(0, 8_000));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 执行单个子代理任务。
 * @param {Object} opts
 * @param {Array<string>} [opts.extraTools] 追加到白名单的工具（team 协作工具等）
 * @param {() => string} [opts.buildSystemSuffix] 每轮注入 system prompt 的动态后缀
 *        （team 模式下为共享任务列表 + 邮箱快照，实现队友间实时感知；按任务调用）
 * @param {Object} [opts.extraCtx] 追加进 toolCtx 的静态字段
 * @param {(task: Object) => Object} [opts.extraCtxFn] 按任务生成追加 toolCtx 字段
 *        （team 模式下为每个队友绑定 teamId / teamMember 身份）
 * @param {Object} [opts.extraCtx] 追加进 toolCtx 的字段（teamId / teamMember 等）
 * @returns {Promise<{id,agent,agentName,objective,status,report,error,usage,turns,transcriptPath,memberName}>}
 */
async function runOneSubagent(task, { llmConfig, selectedModel, parentCtx, onProgress, signal, extraTools = [], buildSystemSuffix, extraCtx, extraCtxFn }) {
  const preset = task.preset;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onParentAbort, { once: true });

  const emit = (patch) => { try { onProgress?.(task.index, patch); } catch { /* 进度失败不影响执行 */ } };
  emit({ status: 'running', objective: task.objective, agentName: preset.name });

  const whitelist = [...preset.tools, ...extraTools];
  const resolvedExtraCtx = {
    ...(extraCtx || {}),
    ...(typeof extraCtxFn === 'function' ? (extraCtxFn(task) || {}) : {}),
  };
  const toolCtx = {
    rootHandle: getRootHandle(),
    // 审批按子代理独立记账：写操作弹卡仍会在工作站 UI 出现（sessionId 不同不共享 grant）
    sessionId: `${parentCtx?.sessionId || 'ws'}:sub:${task.id}`,
    agentId: preset.id,
    agentName: `${preset.name}（子代理）`,
    agentTools: whitelist,
    approvalMode: parentCtx?.approvalMode || 'autonomous',
    signal: controller.signal,
    llmConfig,
    tavilyKey: parentCtx?.tavilyKey || '',
    doubaoSearchKey: parentCtx?.doubaoSearchKey || '',
    webSearchEnabled: parentCtx?.webSearchEnabled !== false,
    __subagent: true, // 标记子代理上下文（防御性：即使白名单泄露也不允许再 spawn）
    ...resolvedExtraCtx,
  };

  const baseResult = {
    id: task.id,
    agent: preset.id,
    agentName: preset.name,
    memberName: extraCtx?.teamMember || preset.name,
    objective: task.objective,
    usage: null,
    turns: 0,
    transcriptPath: '',
  };

  try {
    // buildSystemSuffix 是"按任务"的工厂：团队模式下每个队友注入自己的邮箱视图
    const suffixFn = typeof buildSystemSuffix === 'function'
      ? () => {
          try { return buildSystemSuffix(task) || ''; } catch { return ''; }
        }
      : undefined;
    const result = await runToolLoop({
      controller,
      toolSchemas: selectToolSchemas(whitelist),
      baseMessages: [{ role: 'user', content: task.objective }],
      systemPrompt: buildSubagentSystemPrompt(task, {}),
      llmConfig,
      selectedModel,
      toolCtx,
      maxIterations: preset.maxTurns,
      buildSystemSuffix: suffixFn,
      generateSummary: createLlmSummarizer({
        llmConfig,
        selectedModel,
        parentSignal: controller.signal,
      }),
    });

    const status = result.aborted ? 'aborted' : 'done';
    // 转写落盘（详细产出进工作空间，报告里只留路径引用——抗传话游戏）
    let transcriptPath = '';
    try {
      const persisted = await persistLongResult({
        result: transcriptText(task, result.conversationMessages),
        rootHandle: toolCtx.rootHandle,
        toolName: `subagent-${preset.id}`,
        pathHint: `outputs/subagents/${new Date().toISOString().slice(0, 10)}/${task.id}.md`,
      });
      transcriptPath = persisted.saved || '';
    } catch { /* 落盘失败不影响报告 */ }

    emit({ status, turns: result.usage.turns, tokens: result.usage.total_tokens });
    return {
      ...baseResult,
      status,
      report: result.finalContent || '',
      error: result.aborted ? '被用户中止' : '',
      usage: result.usage,
      turns: result.usage.turns,
      transcriptPath,
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      emit({ status: 'aborted' });
      return { ...baseResult, status: 'aborted', error: '被用户中止' };
    }
    emit({ status: 'failed', error: err?.message || String(err) });
    return { ...baseResult, status: 'failed', error: err?.message || String(err) };
  } finally {
    signal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * 并发执行一批子代理任务。
 * @param {Object} opts
 * @param {Array} opts.tasks normalizeSpawnTasks 产出的规范化任务
 * @param {Object} opts.llmConfig
 * @param {string} opts.selectedModel
 * @param {Object} [opts.parentCtx] 父循环的 toolCtx（继承审批模式/搜索 Key/工作空间等）
 * @param {(taskIndex:number, patch:Object) => void} [opts.onProgress] 进度回调
 * @param {AbortSignal} [opts.signal] 父级中断信号
 * @param {number} [opts.concurrency] 并发（默认 3，上限 5）
 */
export async function runSubagentTasks({ tasks, llmConfig, selectedModel, parentCtx, onProgress, signal, concurrency, extraTools, buildSystemSuffix, extraCtx } = {}) {
  const limit = Math.max(1, Math.min(
    Number(concurrency) || SUBAGENT_LIMITS.DEFAULT_CONCURRENCY,
    SUBAGENT_LIMITS.MAX_CONCURRENCY,
  ));
  const results = await runPool(tasks, limit, (task) => runOneSubagent(task, {
    llmConfig,
    selectedModel,
    parentCtx,
    onProgress,
    signal,
    extraTools,
    buildSystemSuffix,
    extraCtx,
  }));
  return results.map(r => (r?.__poolError
    ? { id: '', agent: 'unknown', agentName: '未知', objective: '', status: 'failed', error: r.__poolError?.message || String(r.__poolError), usage: null, turns: 0, transcriptPath: '' }
    : r));
}
