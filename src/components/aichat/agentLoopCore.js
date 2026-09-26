// Agent Loop Core：AI 工作站与 AI 精灵共用的工具调用循环内核
// 抽离自 runAgentLoop.js（此前 elf 有一份语义漂移的复制版：无流式/无重试/无取消/绕审批）。
// 职责：LLM 流式调用(带重试) → tool_calls 解析与运行时校验 → 审批分流 → 并行/串行执行
//       → 不可信输出包裹回灌 → 上下文压缩 → 收敛指令 → 中断处理。
// 差异化（工作站 vs 精灵）通过参数注入：maxIterations / buildSystemSuffix / onToolComplete / onProgress。
// 纯编排（无 React 依赖）；UI 进度通过回调上抛。

import { executeAgentTool } from '../../utils/agentTools.js';
import { getTool, resolveApprovalDecision } from '../../utils/toolRegistry.js';
import { mergeToolCallDeltas } from '../../utils/toolCallMerge.js';
import { validateToolArgs } from '../../utils/toolArgsValidator.js';
import { AGENT_DEFAULT_MAX_ITERATIONS, COMPLETION_MAX_TOKENS, MAX_COMPLETION_CONTINUATIONS } from '../../constants/agentLoop.js';
import { wrapUntrusted } from '../../session/untrusted.js';
import { packConversation, resolveContextBudget } from '../../session/contextManager.js';
import { persistLongResult } from '../../session/outputSink.js';
import { stripLeadingOrdinal } from './stripLeadingOrdinal.js';

// 上下文预算：发送给 LLM 的消息总 token 上限。超过则触发「中段摘要压缩」而非硬截断。
const CONTEXT_BUDGET = 48_000;
const KEEP_RECENT = 25; // 压缩时保留的最近消息数
const TAIL_LIMIT = 30; // 未压缩/压缩失败时尾部兜底条数（工具循环比轻量路径留更多）

// v26.9e：流式「静默看门狗」超时（毫秒）。
// 原实现只挂了调用方的 controller，没有任何超时——上游建连后既不返回数据也不关闭时，
// 这个 await 会**永久挂起**：该会话一直停在「生成中」、后续消息全部进队、而队列永远没人消费。
// 注意这是**静默**超时而非总时长超时：只要还在持续吐增量就一直续期，长回答不会被误杀。
const STREAM_STALL_TIMEOUT_MS = 90_000;

export { mergeToolCallDeltas, STREAM_STALL_TIMEOUT_MS };

/**
 * 流式调用 /api/ai-generate。
 * 后端 SSE 转发文本增量（delta）、tool_calls 分片（toolCallDelta）与 token 用量（usage）。
 * 返回 { content, tool_calls, usage }：usage 为上游报告的本轮 token 消耗（可能为 null）。
 * 任一异常带 retriable 标记，供重试循环判断。
 *
 * 取消语义：调用方 controller 中止 → 原样抛 AbortError（上层识别为「用户停止」）；
 * 静默超时 → 抛带 retriable 的普通 Error（上层识别为「上游异常」可重试）。
 */
export async function streamAgentResponse({ controller, baseUrl, apiKey, model, systemPrompt, messages, maxTokens, tools, toolChoice, onChunk, onReasoning, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS }) {
  // 组合信号：调用方 controller（用户停止）+ 内部看门狗。分开是为了能区分两种中止原因。
  const internal = new AbortController();
  const forwardAbort = () => internal.abort();
  if (controller?.signal?.aborted) internal.abort();
  else controller?.signal?.addEventListener('abort', forwardAbort, { once: true });

  let stalled = false;
  let stallTimer = null;
  const armStall = () => {
    if (!stallTimeoutMs) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { stalled = true; internal.abort(); }, stallTimeoutMs);
  };
  const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
  const makeStallError = () => {
    const e = new Error(`上游 ${Math.round(stallTimeoutMs / 1000)} 秒无响应，已中断本次生成`);
    e.retriable = true;
    return e;
  };

  armStall();
  let response;
  try {
    response = await fetch('/api/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: internal.signal,
      body: JSON.stringify({
        baseUrl, apiKey, model, action: 'chat',
        systemPrompt, messages, max_tokens: maxTokens,
        stream: true,
        includeUsage: true, // 服务端据此附加 stream_options.include_usage，透传 usage
        tools,
        tool_choice: toolChoice,
      }),
    });
  } catch (err) {
    clearStall();
    controller?.signal?.removeEventListener?.('abort', forwardAbort);
    if (stalled) throw makeStallError();
    throw err;
  }

  if (!response.ok) {
    clearStall();
    controller?.signal?.removeEventListener?.('abort', forwardAbort);
    const errData = await response.json().catch(() => ({}));
    const errMsg = typeof errData.error === 'string' ? errData.error : errData.error?.message || `AI 请求失败 (${response.status})`;
    const e = new Error(errMsg);
    e.status = response.status;
    e.retriable = response.status === 429 || response.status >= 500;
    throw e;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = ''; // v36：stop | length | tool_calls
  const toolCallDeltas = []; // 收集每批 delta.tool_calls，结束统一合并

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      armStall(); // 收到数据即续期：只有「持续静默」才算卡死
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        if (json.ok === false) {
          const e = new Error(json.error || 'AI 请求失败');
          e.retriable = /繁忙|频繁|rate\.limit|429/i.test(json.error || '');
          throw e;
        }
        if (typeof json.delta === 'string') {
          content += json.delta;
          if (onChunk) onChunk(content); // 实时逐字渲染
        }
        // v34：推理模型思维链（delta.reasoning_content）——服务端透传为 reasoning 帧，
        // 累计后经 onReasoning 实时回调；此前被丢弃，"思考过程"无数据可显示
        if (typeof json.reasoning === 'string' && json.reasoning) {
          reasoning += json.reasoning;
          if (onReasoning) onReasoning(json.reasoning, reasoning);
        }
        if (Array.isArray(json.toolCallDelta)) {
          toolCallDeltas.push(json.toolCallDelta);
        }
        // token 用量（上游在最后一个 chunk 报告；多报告时取最后一次）
        if (json.usage && typeof json.usage === 'object') {
          usage = json.usage;
        }
        // v36：结束原因透传（stop=正常完成 / length=因 max_tokens 截断）——
        // 上层据此触发「长输出自动续写」，保证长报告完整性
        if (json.finish_reason) {
          finishReason = json.finish_reason;
        }
      }
    }
  } catch (err) {
    // 看门狗中止会把 reader.read() 变成 AbortError —— 必须转成可重试错误，
    // 否则上层会误判为「用户主动停止」而丢弃已生成内容。
    if (stalled) throw makeStallError();
    throw err;
  } finally {
    clearStall();
    controller?.signal?.removeEventListener?.('abort', forwardAbort);
    reader.cancel().catch(() => {});
  }

  const toolCalls = mergeToolCallDeltas(toolCallDeltas);
  return { content, tool_calls: toolCalls, usage, reasoning, finishReason };
}

/**
 * 统一工具调用循环。
 *
 * @param {Object} opts
 * @param {AbortController} opts.controller 中断控制器
 * @param {Array} opts.toolSchemas 工具 schema 列表
 * @param {Array<{role,content}>} opts.baseMessages 起始消息列表
 * @param {string} opts.systemPrompt 系统提示词
 * @param {Object} opts.llmConfig { baseUrl, apiKey, ... }
 * @param {string} opts.selectedModel 模型名
 * @param {Object} opts.toolCtx 工具执行上下文（透传给 executeAgentTool）
 * @param {number} [opts.maxIterations] 最大轮数；末轮撤走工具强制收敛（默认见 constants/agentLoop.js）
 * @param {number} [opts.contextBudget=48000]
 * @param {number} [opts.keepRecent=25]
 * @param {(iter:number, maxIterations:number, isFinal:boolean) => string} [opts.buildSystemSuffix]
 *        每轮追加到 system prompt 的差异化内容（如工作站注入会话状态快照）
 * @param {(patch:Object) => void} [opts.onProgress] UI 进度回调（thinking/toolCalls/content）
 * @param {({toolName, args, result, status}) => void} [opts.onToolComplete] 每个工具完成回调（历史落账等）
 * @param {(region:Array) => Promise<string>} [opts.generateSummary] LLM 真压缩摘要器（失败自动降级本地摘要）
 * @returns {Promise<{finalContent:string, toolCallTrace:Array, aborted:boolean, usage:Object, conversationMessages:Array}>}
 */
export async function runToolLoop({
  controller,
  toolSchemas,
  baseMessages,
  systemPrompt,
  llmConfig,
  selectedModel,
  toolCtx,
  maxIterations = AGENT_DEFAULT_MAX_ITERATIONS,
  // 预算随模型窗口自适应：大窗口模型 === 默认值（行为不变），小窗口模型自动收紧防上游溢出
  contextBudget = resolveContextBudget(selectedModel, CONTEXT_BUDGET),
  keepRecent = KEEP_RECENT,
  buildSystemSuffix,
  onProgress,
  onContentDelta, // (delta:string) => void：纯增量文本流（区别于 onProgress 的混合补丁），群聊流式气泡用
  onReasoning, // (delta, full) => void：v34 推理模型思维链流式回调（思考过程展示）
  onToolComplete,
  generateSummary,
}) {
  const CONVERGE_AT = maxIterations - 1; // 倒数第二轮起提示收敛
  const toolCallTrace = [];
  const reasoningTexts = []; // v34：每轮思维链文本（[{iter, text}]），供 UI"思考过程"展开
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, turns: 0 };
  const conversationMessages = baseMessages.map(m => ({ ...m }));
  let finalContent = '';
  let aborted = false;

  const emit = (patch) => { if (onProgress) onProgress(patch); };

  /** trace 更新后统一刷 UI（深拷贝避免 React 引用相等跳过渲染） */
  const flushTrace = (extra = {}) => emit({
    toolCalls: toolCallTrace.map(t => ({ ...t })),
    ...extra,
  });

  /** 单个 trace 项的进度补丁（子代理等长任务用） */
  const patchTrace = (id, patch) => {
    const item = toolCallTrace.find(t => t.id === id);
    if (!item) return;
    // 僵尸进度守卫：仅在 running 状态接受进度。被超时弃等的 executor 若在卡片
    // 完结（done/skipped）后才回来 emitProgress（如嵌套子代理残存的 onProgress），
    // 不得再刷新已完成卡片。
    if (item.status !== 'running') return;
    Object.assign(item, patch);
    flushTrace();
  };

  try {
    for (let iter = 0; iter < maxIterations; iter += 1) {
      // v35：flushTrace 让上一轮已完成的工具行实时可见（Codex 式过程流）
      flushTrace({
        content: finalContent,
        thinking: iter === 0 ? '正在思考...' : '继续推理...',
        thinkingKind: 'think',
        toolCallCount: toolCallTrace.length,
      });

      // 每轮差异化 system prompt 后缀（会话状态注入等）
      const isFinalIteration = iter >= CONVERGE_AT;
      let fullSystemPrompt = systemPrompt;
      if (typeof buildSystemSuffix === 'function') {
        const suffix = buildSystemSuffix(iter, maxIterations, isFinalIteration);
        if (suffix) fullSystemPrompt = `${fullSystemPrompt}\n\n${suffix}`;
      }
      // 收敛指令：倒数第二轮软提醒，最后一轮硬要求禁止再调工具
      if (isFinalIteration) {
        fullSystemPrompt += `\n\n【收敛指令】你已用完全部 ${maxIterations} 轮推理预算中的第 ${iter + 1} 轮，这是最后一轮。**禁止再调用任何工具**，请立即基于已经获得的工具结果给出完整的最终回答；若信息仍不足，请明确说明缺口与建议的下一步，而不是留下空回复。`;
      } else if (iter === CONVERGE_AT - 1) {
        fullSystemPrompt += `\n\n【收敛提醒】你已进入第 ${iter + 1} / ${maxIterations} 轮，剩余预算有限。请优先收敛：只在信息确有缺口时再调用工具，否则直接产出最终答案。`;
      }

      // 上下文压缩：超过预算时把中段折叠为一条摘要消息。摘要优先 LLM 生成（generateSummary），
      // 失败/缺省降级为本地截断摘要（buildContext 内部处理）。
      // 打包逻辑（判定 → 压缩 → 尾部兜底）统一走 packConversation，与工作站/精灵两条流式路径共用一份实现。
      const packed = await packConversation(conversationMessages, {
        budget: contextBudget,
        keepRecent,
        cutMin: 2,
        // 工具循环保留更多尾部：工具结果本身就是后续推理的证据，截太狠会丢依据
        fallbackLimit: TAIL_LIMIT,
        summaryStrategy: 'llm',
        generateSummary,
      });
      const sendMessages = packed.messages;
      if (packed.compressed && typeof toolCtx?.onCompacted === 'function') {
        try { toolCtx.onCompacted(packed.summaryText || ''); } catch { /* silent */ }
      }

      // 最后一轮硬断工具：直接不下发 tools，模型物理上无法再调
      const iterTools = isFinalIteration ? undefined : toolSchemas;
      const allowedToolNames = new Set((iterTools || []).map(t => t.function?.name));

      // ── 带重试的 LLM 调用：仅对 429/5xx/上游限流瞬错重试，最多 2 次 ──
      const MAX_AGENT_RETRIES = 2;
      let data;
      let iterReasoning = ''; // v34：本轮思维链累计
      for (let attempt = 0; attempt <= MAX_AGENT_RETRIES; attempt += 1) {
        try {
          data = await streamAgentResponse({
            controller,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            model: selectedModel,
            systemPrompt: fullSystemPrompt,
            messages: sendMessages,
            maxTokens: COMPLETION_MAX_TOKENS,
            tools: iterTools,
            toolChoice: isFinalIteration ? undefined : 'auto',
            onChunk: (c) => {
              emit({ content: c, thinking: '正在生成...', thinkingKind: 'generate' });
              if (onContentDelta) {
                try { onContentDelta(c); } catch { /* 流式回调失败不拖垮执行 */ }
              }
            },
            onReasoning: (delta, full) => {
              iterReasoning = full;
              emit({ reasoning: full, thinking: '正在深度思考…', thinkingKind: 'think' });
              if (onReasoning) {
                try { onReasoning(delta, full); } catch { /* 思维链回调失败不拖垮执行 */ }
              }
            },
          });
          finalContent = data.content || '';
          break;
        } catch (err) {
          if (err?.name === 'AbortError') throw err; // 用户取消
          const retriable = err?.retriable || err?.status === 429 || (typeof err?.status === 'number' && err.status >= 500);
          if (retriable && attempt < MAX_AGENT_RETRIES) {
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
            continue;
          }
          throw err;
        }
      }

      // 累计本轮 token 用量（上游可能不报告，字段缺省按 0 计）
      usageTotal.turns += 1;
      usageTotal.prompt_tokens += Number(data.usage?.prompt_tokens) || 0;
      usageTotal.completion_tokens += Number(data.usage?.completion_tokens) || 0;
      usageTotal.total_tokens += Number(data.usage?.total_tokens)
        || (Number(data.usage?.prompt_tokens) || 0) + (Number(data.usage?.completion_tokens) || 0);

      // v34：本轮思维链有内容则入档（"思考过程"步骤展示 + 展开回看）
      if (iterReasoning.trim()) {
        reasoningTexts.push({ iter: iter + 1, text: iterReasoning.trim() });
        emit({ reasoningTexts: reasoningTexts.map(r => ({ ...r })) });
      }

      // 若无 tool_calls，本次即为最终答案
      if (!Array.isArray(data.tool_calls) || data.tool_calls.length === 0) {
        finalContent = data.content || '（无内容返回）';

        // ── v36 长输出完整性：因 max_tokens 截断（finish_reason=length）时自动续写 ──
        // 续写轮不带工具（纯文本接续），从截断处直接继续，最多 MAX_COMPLETION_CONTINUATIONS 次。
        // 失败/中止即停，保留已生成的部分（不丢字）。
        let continuations = 0;
        let contAsstIdx = -1; // 续写轮的 assistant 全文槽位：原地替换而非追加（防长文重复膨胀对话）
        let contUserIdx = -1;
        while (
          data?.finishReason === 'length'
          && finalContent
          && continuations < MAX_COMPLETION_CONTINUATIONS
          && !controller?.signal?.aborted
        ) {
          continuations += 1;
          emit({ content: finalContent, thinking: `输出较长，正在自动续写（第 ${continuations} 段）...`, thinkingKind: 'generate' });
          const asstMsg = { role: 'assistant', content: finalContent };
          const userMsg = {
            role: 'user',
            content: '你的上一条回复因长度限制被截断。请从中断处直接继续输出剩余内容：不要重复任何已输出的文字，不要重新开头，直接接着写到完整为止。若内容已自然完结，请回复「（已完结）」。',
          };
          if (contAsstIdx >= 0) {
            conversationMessages[contAsstIdx] = asstMsg;
            conversationMessages[contUserIdx] = userMsg;
          } else {
            conversationMessages.push(asstMsg);
            contAsstIdx = conversationMessages.length - 1;
            conversationMessages.push(userMsg);
            contUserIdx = conversationMessages.length - 1;
          }
          try {
            data = await streamAgentResponse({
              controller,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
              model: selectedModel,
              systemPrompt: fullSystemPrompt,
              messages: conversationMessages,
              maxTokens: COMPLETION_MAX_TOKENS,
              // 刻意不带 tools/toolChoice：续写轮纯文本，物理上无法再调工具
              onChunk: (c) => {
                emit({ content: finalContent + c, thinking: '正在生成...', thinkingKind: 'generate' });
                if (onContentDelta) {
                  try { onContentDelta(c); } catch { /* 流式回调失败不拖垮执行 */ }
                }
              },
            });
            usageTotal.turns += 1;
            usageTotal.prompt_tokens += Number(data.usage?.prompt_tokens) || 0;
            usageTotal.completion_tokens += Number(data.usage?.completion_tokens) || 0;
            usageTotal.total_tokens += Number(data.usage?.total_tokens)
              || (Number(data.usage?.prompt_tokens) || 0) + (Number(data.usage?.completion_tokens) || 0);
            if (!data.content) break; // 无增量：模型认为已完结，收
            const piece = data.content;
            finalContent += piece.replace(/（已完结）\s*$/, ''); // 模型按指令宣告完结时去掉标记
          } catch (contErr) {
            if (contErr?.name === 'AbortError') throw contErr; // 用户停止照常上抛
            break; // 续写失败：保留已有内容（不丢字）
          }
        }
        break;
      }

      // 有 tool_calls：先把 assistant 的 tool_calls 消息追加到 conversation
      conversationMessages.push({
        role: 'assistant',
        content: data.content || '',
        tool_calls: data.tool_calls,
      });
      if (data.content) finalContent = data.content;

      // ── 参数解析 + 运行时校验（温和矫正）──
      // 此前 JSON.parse 失败静默变 {}，schema 只是给模型看的装饰；现在校验失败/缺必填
      // 直接以结构化错误回灌，让模型下一轮自修，不进入执行。
      const calls = [];
      const allCalls = [];
      const resultMap = new Map(); // tc.id -> resultText（含校验失败预填）
      for (const tc of (data.tool_calls || [])) {
        const toolName = tc?.function?.name || 'unknown';
        let args = {};
        let invalidReason = '';
        let rejection = '';
        if (!allowedToolNames.has(toolName)) {
          rejection = `错误：当前智能体未授权工具 "${toolName}"，本次调用未执行。`;
        }
        try {
          args = JSON.parse(tc?.function?.arguments || '{}');
        } catch (parseErr) {
          invalidReason = `参数不是合法 JSON（${parseErr?.message || 'parse error'}）`;
        }
        if (!rejection && !invalidReason) {
          const entry = getTool(toolName);
          if (typeof entry?.meta?.normalizeArgs === 'function') {
            try { args = entry.meta.normalizeArgs(args); } catch { /* 与注册表保持一致 */ }
          }
          if (entry?.schema?.function?.parameters) {
            const verdict = validateToolArgs(entry.schema.function.parameters, args);
            if (!verdict.ok) {
              invalidReason = verdict.error;
            } else {
              args = verdict.args; // 温和矫正后的参数（string→number 等）
            }
          }
        }
        const call = { tc, toolName, args };
        allCalls.push(call);
        if (rejection || invalidReason) {
          const result = rejection || `错误：工具 "${toolName}" 参数校验失败：${invalidReason}。请修正参数后重新调用。`;
          resultMap.set(tc.id, result);
          toolCallTrace.push({
            id: tc.id,
            name: toolName,
            args: typeof args === 'object' && args !== null ? args : {},
            status: 'failed',
            result,
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
        } else {
          calls.push(call);
        }
      }

      // 先把所有可执行调用都标记为 running（v35：flushTrace 让工具行带 spinner 实时出现）
      for (const c of calls) {
        toolCallTrace.push({
          id: c.tc.id,
          name: c.toolName,
          args: c.args,
          status: 'running',
          startedAt: Date.now(),
        });
      }
      flushTrace({ content: finalContent, thinking: `正在调用 ${calls.length} 个工具...`, thinkingKind: 'tool', toolCallCount: toolCallTrace.length });

      // 分流：需要审批的串行，免审批的并行
      const needsApproval = [];
      const auto = [];
      for (const c of calls) {
        const entry = getTool(c.toolName);
        const decision = entry
          ? resolveApprovalDecision(entry, toolCtx, c.args)
          : { required: false };
        (decision.required ? needsApproval : auto).push(c);
      }

      /**
       * 单个工具执行 + 统一错误兜底（abort 向上抛）。
       * 每次执行注入独立的 emitProgress（子代理等长任务可向对应卡片推进度）。
       */
      const runOne = async (c) => {
        controller?.signal?.throwIfAborted();
        const callCtx = { ...toolCtx, signal: controller?.signal || toolCtx?.signal, emitProgress: (patch) => patchTrace(c.tc.id, { progress: patch }) };
        let r;
        try {
          r = await executeAgentTool(c.toolName, c.args, callCtx);
        } catch (err) {
          if (err?.name === 'AbortError') throw err; // 用户取消：穿透到外层
          r = `工具执行失败：${err?.message || String(err)}`;
        }
        return r;
      };

      // 免审批调用：并发执行（提速主路径）
      const autoResults = auto.length
        ? await Promise.allSettled(auto.map(c => runOne(c)))
        : [];

      auto.forEach((c, i) => {
        const settled = autoResults[i];
        if (settled.status === 'fulfilled') {
          resultMap.set(c.tc.id, String(settled.value));
        } else {
          const err = settled.reason;
          if (err?.name === 'AbortError') throw err;
          resultMap.set(c.tc.id, `工具执行失败：${err?.message || String(err)}`);
        }
      });

      // 需审批调用：串行逐个（每个等待自己的审批卡片）
      for (const c of needsApproval) {
        const r = await runOne(c);
        resultMap.set(c.tc.id, String(r));
        if (controller.signal.aborted) { aborted = true; break; }
      }

      // 按原始顺序统一回灌：trace / 历史钩子 / 长结果落盘 / 不可信包裹后的 tool message
      for (const c of allCalls) {
        const resultText = resultMap.get(c.tc.id) ?? '（无返回）';
        // 审批被拒 / 被取消 = "未执行"，标 skipped；"错误："前缀 = 执行失败
        const wasSkipped = /^错误：(用户拒绝授权|审批被取消|审批失败|精灵未授权|当前智能体未授权)/.test(resultText);
        const wasFailed = !wasSkipped && resultText.startsWith('错误：');

        const traceItem = toolCallTrace.find(t => t.id === c.tc.id);
        if (traceItem) {
          traceItem.status = wasSkipped ? 'skipped' : (wasFailed ? 'failed' : 'done');
          traceItem.result = resultText.slice(0, 8000);
          traceItem.completedAt = Date.now();
        }
        // v35：flushTrace 把刚完成的工具行（spinner→✓ 转变）实时推给前端
        flushTrace({
          content: finalContent,
          thinking: wasSkipped
            ? `工具 ${c.toolName} 审批未通过，继续推理...`
            : `工具 ${c.toolName} 已返回，继续推理...`,
          toolCallCount: toolCallTrace.length,
        });

        if (typeof onToolComplete === 'function') {
          try {
            onToolComplete({ toolName: c.toolName, args: c.args, result: resultText, status: wasSkipped ? 'skipped' : (wasFailed ? 'failed' : 'done') });
          } catch { /* 历史落账失败不阻断循环 */ }
        }

        // 超长结果落盘工作空间，只回灌截断+路径提示；送入 LLM 前包不可信定界（prompt 注入防线）。
        // UI（traceItem.result）仍展示未包裹原文，保持可读。
        const toolResult = await persistLongResult({
          result: String(resultText),
          rootHandle: toolCtx?.rootHandle,
          toolName: c.toolName,
          sessionId: toolCtx?.sessionId,
        });
        conversationMessages.push({
          role: 'tool',
          tool_call_id: c.tc.id,
          content: wrapUntrusted(c.toolName, toolResult.text),
        });
      }
      // 用户已 abort：跳出 LLM 循环
      if (controller.signal.aborted) {
        aborted = true;
        break;
      }
      // 进入下一轮：LLM 看到 tool 结果后继续推理
    }
  } catch (err) {
    // abort：标记并保留已有内容与 toolCalls
    if (err?.name === 'AbortError' || controller?.signal?.aborted) {
      aborted = true;
    } else {
      // 其他错误：向上传播，由调用方统一处理
      throw err;
    }
  }

  // 个别兼容层会忽略 tool_choice/no-tools 约束，在最后一轮仍返回工具调用。
  // 此时不能把空字符串作为成功回复交给 UI。
  if (!finalContent && toolCallTrace.length >= maxIterations) {
    finalContent = '已达到本次推理轮次上限，未能生成完整回答。请缩小任务范围后重试。';
  }

  // v37：最终答案落库前剥离开头孤立序号行（「0」/「O」/全角数字独占一行）。
  // 此前只在渲染层剥（AiChatPanel），存储的 content 仍带序号——复制出去有 0，
  // 且历史消息回传 LLM 时模型看到自己的历史带 0，形成自我强化、永远剥不干净。
  // 在共享内核出口剥一处 = 工作站/群聊/精灵三条路径的落库与上下文同时干净。
  // （流式过程中的 onProgress/onContentDelta 增量不动，避免破坏流式状态机。）
  if (typeof finalContent === 'string') {
    finalContent = stripLeadingOrdinal(finalContent);
  }

  return {
    finalContent,
    toolCallTrace,
    reasoningTexts, // v34：每轮思维链（思考过程展示与回看）
    aborted,
    usage: usageTotal,
    conversationMessages,
  };
}
