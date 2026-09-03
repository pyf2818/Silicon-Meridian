// AiElf Agent Loop：工具调用循环执行
// 从 src/AiElf.jsx 抽离；内核循环（流式/重试/校验/审批/压缩/中断）复用 agentLoopCore.js，
// 与 AI 工作站共享同一实现，消除此前复制版的语义漂移（无重试/无取消/绕审批）。
// 精灵侧差异化：
//   - maxIterations=6（轻量快问快答）
//   - sessionId = elf:<agentId>：审批闸门从此对精灵生效（此前精灵 ctx 无 sessionId，
//     敏感写操作完全绕过审批——安全修复）
//   - approvalPolicy='deny'：精灵是浮动助理，UI 上没有审批卡片入口；敏感写操作
//     （写文件/执行命令/自定义 HTTP 等）直接拒绝并引导去工作站，避免审批 Promise
//     悬挂无人应答。只读敏感操作（如 fetch_page，已标注 riskLevel=read）不受影响。
//   - 产出消息对象原地替换（setAgentMessages），支持流式逐字渲染

import { getRootHandle } from '../../utils/workspaceHandleStore.js';
import { rememberCompaction } from '../../utils/sessionMemory.js';
import { runToolLoop } from '../aichat/agentLoopCore.js';
import { createLlmSummarizer } from '../../session/llmSummarizer.js';

/**
 * @param {Object} params
 * @param {string} params.activeAgentId
 * @param {Array} params.baseMessages - 初始消息列表
 * @param {Array} params.toolSchemas - 工具 schema 列表
 * @param {string} params.systemPrompt
 * @param {Object} params.llmConfig - { baseUrl, apiKey, selectedModel, tavilyKey... }
 * @param {Function} params.setAgentMessages - React setState，用于原地更新消息
 * @param {AbortController} [params.controller] - 可选中断控制器（精灵 UI 提供"停止"按钮时传入）
 * @returns {Promise<{role:string,content:string,toolCalls:Array,toolCallCount:number,loading:boolean,timestamp:number,usage:Object}>}
 */
export async function runElfAgentLoop({ activeAgentId, baseMessages, toolSchemas, systemPrompt, llmConfig, setAgentMessages, controller }) {
  const MAX_ITERATIONS = 6;
  // 未提供 controller 时内部兜底创建一个（保持"永不 abort"的旧外部行为，同时让内核签名完整）
  const abortController = controller || new AbortController();
  const toolCtx = {
    rootHandle: getRootHandle(),
    // 审批闸门生效的关键：注册表只在 ctx.sessionId 非空时启用闸门
    sessionId: `elf:${activeAgentId}`,
    agentId: activeAgentId,
    agentName: 'AI精灵',
    // 注入 llmConfig 让联网搜索开关和 API Key 兜底逻辑生效（与工作站对齐）
    llmConfig,
    tavilyKey: llmConfig?.tavilyKey || '',
    doubaoSearchKey: llmConfig?.doubaoSearchKey || '',
    webSearchEnabled: llmConfig?.webSearchEnabled !== false,
    approvalMode: 'semi',
    // 精灵无审批卡片 UI：敏感写操作直接拒绝（错误信息会引导用户去工作站）
    approvalPolicy: 'deny',
    signal: abortController.signal,
    // 压缩摘要沉淀为跨会话记忆（同主动 agent 去重），与工作站行为对齐
    onCompacted: (summaryText) => {
      if (summaryText) {
        try { rememberCompaction(activeAgentId, summaryText); } catch { /* silent */ }
      }
    },
  };

  const patchLast = (patch) => {
    setAgentMessages(prev => {
      const list = prev[activeAgentId] || [];
      if (list.length === 0) return prev;
      const lastIdx = list.length - 1;
      const replaced = list.map((m, idx) => idx === lastIdx ? { ...m, ...patch, loading: true } : m);
      return { ...prev, [activeAgentId]: replaced };
    });
  };

  // LLM 真压缩摘要器（带缓存，失败自动降级本地摘要）
  const generateSummary = createLlmSummarizer({
    llmConfig,
    selectedModel: llmConfig?.selectedModel,
    parentSignal: abortController.signal,
  });

  let finalContent = '';
  let toolCallTrace = [];
  let stopped = false;
  try {
    const result = await runToolLoop({
      controller: abortController,
      toolSchemas,
      baseMessages,
      systemPrompt,
      llmConfig,
      selectedModel: llmConfig?.selectedModel,
      toolCtx,
      maxIterations: MAX_ITERATIONS,
      onProgress: patchLast,
      generateSummary,
    });
    finalContent = result.finalContent;
    toolCallTrace = result.toolCallTrace;
    stopped = result.aborted;
  } catch (err) {
    // 任何错误：保留已完成的 toolCalls 痕迹，写入错误信息
    if (!finalContent) {
      finalContent = `分析失败: ${err?.message || String(err)}`;
    }
  }

  if (!finalContent) finalContent = stopped ? '（已停止）' : '（agent 达到最大轮数仍未给出最终回复）';

  return {
    role: 'assistant',
    content: finalContent,
    toolCalls: toolCallTrace.slice(),
    toolCallCount: toolCallTrace.length,
    usage: null,
    loading: false,
    stopped,
    timestamp: Date.now(),
  };
}
