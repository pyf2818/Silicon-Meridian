/**
 * useMultiAgentOrchestrator - AI 工作站多 agent 协作编排（驱动 agentOrchestrator 状态机）
 *
 * 定位：给 AiChat 一个「多视角协作」入口。一次用户任务，让多个专业 agent 按序产出各视角，
 * 最后用总控合成一份总报告。每个视角走一次 /api/ai-generate（非流式），用该 agent 的
 * systemPrompt + 编排器注入的「协作任务」作为 user 消息（前序输出喂进下一视角）。
 *
 * 设计要点：
 * - 复用现有 agents 生态（不新建运行时）；实际 LLM 调用走 /api/ai-generate（与 runAgentLoop 同构）
 * - 纯状态机（agentOrchestrator）+ React 编排循环；暴露 run + result + progress
 * - onView 回调让 UI 逐步渲染每视角产出（可选）；abort 可中断
 * - 失败降级：某视角 LLM 调用失败则该视角跳过，继续后续视角（不整体崩溃）
 */

import { useCallback, useRef, useState, useMemo } from 'react';
import {
  selectOrchestration,
  orchestrationStep,
  commitOrchestrationStep,
} from '../utils/agentOrchestrator.js';
import { streamLlm } from '../utils/llmStream.js';

/** 单视角/合成调用的默认超时与 token 上限 */
const VIEW_MAX_TOKENS = 1800;

/**
 * @param {Object} opts
 * @param {Array}  opts.agents          agents 生态
 * @param {object} opts.llmConfig      { baseUrl, apiKey, selectedModel, webSearchEnabled }
 * @param {boolean} opts.enabled       false 时 hook 空转（如未连工作区）
 * @returns {{
 *   run: (task: string, opts?: {chain?: string[], onView?: Function, onViewDelta?: Function}) => Promise<{ok, views, synthesis, error}>,
 *   runState: 'idle'|'running'|'done'|'error',
 *   progress: Array<{viewLabel, status, output?, error?}>,
 *   abort: () => void,
 * }}
 */
export function useMultiAgentOrchestrator({ agents, llmConfig, enabled = true }) {
  const abortRef = useRef(null);
  const [runState, setRunState] = useState('idle');
  const [progress, setProgress] = useState([]);

  // 实际 LLM 调用：对话（非工具）路径。v30：流式——onDelta 逐字回调，signal 真取消。
  const callLlm = useCallback(async (systemPrompt, userInput, onDelta = null) => {
    if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
      throw new Error('请先在设置中配置大模型');
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const { content } = await streamLlm({
      llmConfig,
      systemPrompt,
      userPrompt: userInput,
      onDelta: onDelta || undefined,
      signal: controller.signal,
      maxTokens: VIEW_MAX_TOKENS,
    });
    return content;
  }, [llmConfig]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 能否用工具的 agent（其 schema 白名单非空）→ 我们用「无工具对话」路径即可，
  // 协作的每个视角都注入 agent.systemPrompt，工具调用对协作不必要（避免复杂化）。
  const run = useCallback(async (task, opts = {}) => {
    if (!task || !enabled) return { ok: false, error: '未就绪' };
    setRunState('running');
    setProgress([]);
    const progressList = [];
    const updateProgress = (entry) => {
      progressList.push(entry);
      setProgress([...progressList]);
      return progressList.length - 1; // 返回条目索引，供流式增量 patch
    };
    const patchProgress = (index, patch) => {
      if (index < 0 || !progressList[index]) return;
      progressList[index] = { ...progressList[index], ...patch };
      setProgress([...progressList]);
    };

    // 选编排（链 + 合成者）
    const { chain, synthesizer } = selectOrchestration(agents, {
      chain: opts.chain,
    });
    if (chain.length === 0) {
      setRunState('error');
      updateProgress({ viewLabel: '编排', status: 'error', error: '没有可用的智能体' });
      return { ok: false, error: '没有可用的智能体' };
    }

    // 状态机推进
    let state = { task, chain, synthesizer, views: [], index: 0 };
    const views = [];
    let synthesis = '';
    let viewSeq = 0;

    try {
      // 逐个视角（v30：onViewDelta 实时流出视角产出）
      while (true) {
        const step = orchestrationStep(state);
        if (step.done) break;

        const { agent, viewLabel, input } = step;
        const progressIndex = updateProgress({ viewLabel, status: 'running' });
        const seq = ++viewSeq;
        opts.onViewDelta?.({ type: 'view-start', seq, label: viewLabel });
        try {
          const out = await callLlm(agent.systemPrompt || '你是专业分析智能体。', input, (delta, full) => {
            patchProgress(progressIndex, { output: full });
            opts.onViewDelta?.({ type: 'view-delta', seq, label: viewLabel, delta, full });
          });
          views.push({ viewLabel, output: out, agentId: agent.id });
          patchProgress(progressIndex, { status: 'done', output: out });
          opts.onViewDelta?.({ type: 'view-done', seq, label: viewLabel, full: out });
          state = commitOrchestrationStep(state, out, agent.id);
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          // 视角失败：标记跳过，继续下一视角
          patchProgress(progressIndex, { status: 'error', error: err?.message || String(err) });
          opts.onViewDelta?.({ type: 'view-error', seq, label: viewLabel, error: err?.message || String(err) });
          state = commitOrchestrationStep(state, `（${viewLabel} 视角执行失败：${err?.message}）`, agent.id);
        }
        // abort 检查
        if (abortRef.current?.signal.aborted) throw new Error('aborted');
      }

      // 合成
      if (synthesizer) {
        const progressIndex = updateProgress({ viewLabel: synthesizer.label, status: 'running' });
        opts.onViewDelta?.({ type: 'synthesis-start', label: synthesizer.label });
        try {
          const step = orchestrationStep(state);
          if (step.step === 'synthesize') {
            synthesis = await callLlm(synthesizer.agent.systemPrompt || '你是信息总控，负责综合多视角。', step.input, (delta, full) => {
              patchProgress(progressIndex, { output: full });
              opts.onViewDelta?.({ type: 'synthesis-delta', label: synthesizer.label, delta, full });
            });
            patchProgress(progressIndex, { status: 'done', output: synthesis });
            opts.onViewDelta?.({ type: 'synthesis-done', label: synthesizer.label, full: synthesis });
          }
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          patchProgress(progressIndex, { status: 'error', error: err?.message || String(err) });
        }
      }

      setRunState('done');
      opts.onView?.(views, synthesis);
      return { ok: true, views, synthesis, error: '' };
    } catch (err) {
      if (err?.name === 'AbortError') {
        setRunState('idle');
        updateProgress({ viewLabel: '中止', status: 'error', error: '已中止' });
        return { ok: false, error: '已中止' };
      }
      setRunState('error');
      updateProgress({ viewLabel: '编排', status: 'error', error: err?.message || String(err) });
      return { ok: false, error: err?.message || '编排失败' };
    }
  }, [agents, llmConfig, enabled, callLlm]);

  const result = useMemo(() => ({ run, runState, progress, abort }), [run, runState, progress, abort]);
  return result;
}