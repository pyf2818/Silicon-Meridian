// Agent Loop：tool_calls 循环执行
// 流程：发请求 → 若返回 tool_calls 则执行工具并把结果回灌 → 重新请求，直到无 tool_calls 或达到最大轮数
// 用户点"停止"时通过 controller.abort() 中断当前 fetch；已完成的 toolCalls 痕迹保留展示
// 从 src/components/AiChatPanel.jsx 抽离，纯函数（无 React 依赖）

import { generateSessionSummary, retrieveRelevantMemories } from '../../utils/sessionMemory.js';
import { observeReply, observeToolUsage } from '../../utils/profileLearning.js';
import { evolveMemory } from '../../utils/memoryEvolver.js';
import { extractTodos } from '../../utils/todoExtractor.js';
import { executeAgentTool } from '../../utils/agentTools.js';
import { getTool, resolveApprovalDecision } from '../../utils/toolRegistry.js';
import { mergeToolCallDeltas } from '../../utils/toolCallMerge.js';
import { getRootHandle } from '../../utils/workspaceHandleStore.js';
import { buildSessionContextText, appendHistory } from '../../utils/sessionStore.js';
import { buildContext, estimateMessages, shouldCompact, localSummary } from '../../session/contextManager.js';
import { persistLongResult } from '../../session/outputSink.js';
import { rememberCompaction } from '../../utils/sessionMemory.js';

// 上下文预算：发送给 LLM 的消息总token上限。超过则触发「中段本地摘要压缩」而非硬截断。
const CONTEXT_BUDGET = 48_000;
const KEEP_RECENT = 25; // 压缩时保留的最近消息数

/**
 * 把流式 SSE 里的 tool_calls 分片按 index 合并还原为完整 tool_calls 数组。
 * 实现见 src/utils/toolCallMerge.js（独立导出，便于单测）。
 * @param {Array<Array>} batches
 * @returns {Array|undefined}
 */
export { mergeToolCallDeltas };

/**
 * 流式调用 /api/ai-generate（P1-6 流式化）。
 * 后端 SSE 会同时转发文本增量（delta）与 tool_calls 分片（toolCallDelta）。
 * 这里把两者合并，返回与旧非流式路径同构的 { content, tool_calls }：
 *   - content：完整文本（同时经 onChunk 实时回灌 UI，实现逐字渲染）
 *   - tool_calls：undefined 表示本次是最终回答；数组表示需要执行工具
 * 任一异常都带上 retriable 标记，供上层重试循环判断。
 */
async function streamAgentResponse({ controller, baseUrl, apiKey, model, systemPrompt, messages, maxTokens, tools, toolChoice, onChunk }) {
  const response = await fetch('/api/ai-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      baseUrl, apiKey, model, action: 'chat',
      systemPrompt, messages, max_tokens: maxTokens,
      stream: true,
      tools,
      tool_choice: toolChoice,
    }),
  });
  if (!response.ok) {
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
  const toolCallDeltas = []; // 收集每批 delta.tool_calls，结束统一合并

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
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
        if (Array.isArray(json.toolCallDelta)) {
          toolCallDeltas.push(json.toolCallDelta);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const toolCalls = mergeToolCallDeltas(toolCallDeltas);
  // 返回蛇形键名，与旧非流式路径（后端 { content, tool_calls }）保持完全一致，下游代码零改动
  return { content, tool_calls: toolCalls };
}

/**
 * 终答前的质量自检修复（P2-9 引用重试 + P2-10 对照 toolCallTrace 自检）。
 * 把"引用了不存在的资讯 ID / 断言了失败或被拒工具的结果"等问题回灌模型，
 * 要求它在不调用任何工具的前提下直接输出修正后的完整回答。
 * 仅尝试一次（不无限递归）；任何失败都返回 null，由调用方降级保留原答案。
 */
async function selfVerifyRepair({ content, issues, llmConfig, selectedModel, systemPrompt }) {
  try {
    const repairMessages = [
      {
        role: 'system',
        content: '你是答案质量校验员。用户已得到一份智能体回答，自检发现若干问题，请在不调用任何工具的前提下，直接输出修正后的完整回答：保留原结构与所有有价值内容，仅修复指出的问题。若某条信息无可靠依据，请明确说明"无法确认"而非编造。',
      },
      {
        role: 'user',
        content: `【原始回答】\n${content}\n\n【自检发现的问题】\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n请输出修正后的完整回答：`,
      },
    ];
    const response = await fetch('/api/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: selectedModel,
        action: 'chat',
        systemPrompt: systemPrompt || '',
        messages: repairMessages,
        max_tokens: 4000,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.ok === false) return null;
    const repaired = typeof data?.content === 'string' ? data.content.trim() : '';
    return repaired || null;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.targetId 当前会话 ID
 * @param {{role:string, content:string}} opts.userMessage 用户消息
 * @param {AbortController} opts.controller 中断控制器
 * @param {Array} opts.toolSchemas 工具 schema 列表
 * @param {Array<{role:string, content:string}>} opts.baseMessages 起始消息列表
 * @param {string} opts.systemPrompt 系统提示词
 * @param {object} opts.llmConfig LLM 配置（baseUrl/apiKey/tavilyKey 等）
 * @param {string} opts.selectedModel 模型名
 * @param {object} opts.intelligenceContext 情报上下文
 * @param {object} opts.agent 当前智能体配置
 * @param {Array} opts.sessions 当前所有会话
 * @param {Array} opts.messages 当前会话消息
 * @param {(updater:any)=>void} opts.setSessions 会话状态 setter
 * @param {(v:any)=>any} opts.setLearnedVersion 学习画像版本 setter
 * @param {(v:any)=>any} opts.setAutoTodos 自动待办 setter
 * @param {(v:any)=>any} opts.setMemoriesVersion 记忆版本 setter
 * @param {'assist'|'autonomous'|'plan'} opts.permissionMode Agent 权限模式
 * @param {(skill:object)=>void} [opts.onSkillCreated] 技能创建成功回调（用于刷新 skillsHook 缓存）
 */
export async function runAgentLoop({
  targetId,
  userMessage,
  controller,
  toolSchemas,
  baseMessages,
  systemPrompt,
  llmConfig,
  selectedModel,
  intelligenceContext,
  agent,
  sessions,
  messages,
  setSessions,
  setLearnedVersion,
  setAutoTodos,
  setMemoriesVersion,
  permissionMode = 'autonomous',
  onSkillCreated,
}) {
  const MAX_ITERATIONS = 12; // 防止无限循环；末轮会注入收敛指令强制收尾
  const CONVERGE_AT = MAX_ITERATIONS - 1; // 倒数第二轮起提示收敛
  const toolCtx = {
    rootHandle: getRootHandle(),
    sessionId: targetId,
    agentId: agent?.id || '',
    agentName: agent?.name || '',
    agentTools: Array.isArray(agent?.tools) ? agent.tools : [],
    // 权限模式下发给注册表层的唯一审批闸门（P0-1：删除循环层重复审批）
    approvalMode: permissionMode,
    // 中断信号：工具 executor 可透传给 fetch，让"停止生成"能真正掐断在途请求
    signal: controller?.signal,
    // 联网搜索 Key（用户在设置面板配置；未配置则后端使用环境变量）
    tavilyKey: llmConfig?.tavilyKey || '',
    doubaoSearchKey: llmConfig?.doubaoSearchKey || '',
    llmConfig,
    // 技能创建回调：toolCreateSkill 成功后通知前端刷新 skillsHook 缓存
    onSkillCreated,
  };
  // 工作中的消息列表（包含 user / assistant / tool 三种角色），逐步累积
  const conversationMessages = baseMessages.map(m => ({ role: m.role, content: m.content }));
  // 给 UI 用的工具调用记录（不带原始 messages 结构，便于渲染卡片）
  const toolCallTrace = [];
  let finalContent = '';
  let aborted = false;

  const updateAssistantMsg = (patch) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== targetId) return s;
      const msgs = [...s.messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch, loading: true };
      return { ...s, messages: msgs };
    }));
  };

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
      // 更新 UI：当前轮次的"思考中"状态
      updateAssistantMsg({
        content: finalContent,
        toolCalls: toolCallTrace.slice(),
        thinking: iter === 0 ? '正在思考...' : '继续推理...',
        toolCallCount: toolCallTrace.length,
      });

      // 注入会话级状态（执行计划 / 变量 / 黑板 / 最近工具调用），让 LLM 看到上下文
      const sessionContextText = buildSessionContextText(targetId);
      let fullSystemPrompt = sessionContextText
        ? `${systemPrompt}\n\n【会话状态】你正在执行一个多步任务，以下是当前会话的状态快照，可作为接力推理的依据：\n${sessionContextText}`
        : systemPrompt;

      // 收敛指令（P1-5）：轮数上限从 6 提到 12，但必须防止"轮数用尽却没给答案"。
      // 倒数第二轮开始软提醒，最后一轮硬要求禁止再调工具，直接基于已有证据成文。
      if (iter >= CONVERGE_AT) {
        fullSystemPrompt += `\n\n【收敛指令】你已用完全部 ${MAX_ITERATIONS} 轮推理预算中的第 ${iter + 1} 轮，这是最后一轮。**禁止再调用任何工具**，请立即基于已经获得的工具结果给出完整的最终回答；若信息仍不足，请明确说明缺口与建议的下一步，而不是留下空回复。`;
      } else if (iter === CONVERGE_AT - 1) {
        fullSystemPrompt += `\n\n【收敛提醒】你已进入第 ${iter + 1} / ${MAX_ITERATIONS} 轮，剩余预算有限。请优先收敛：只在信息确有缺口时再调用工具，否则直接产出最终答案。`;
      }

      // 上下文压缩（对标 pi/compaction）：超过预算时，把中段消息折叠为一条本地摘要再发送，
      // 而非只保留最近 KEEP_RECENT 条硬截断。summaryText 缺省用本地摘要降级，不额外增加 LLM 调用。
      let sendMessages;
      if (shouldCompact(conversationMessages, CONTEXT_BUDGET)) {
        const packed = await buildContext(conversationMessages, CONTEXT_BUDGET, {
          keepRecent: KEEP_RECENT,
          cutMin: 2,
          summaryText: localSummary(conversationMessages.slice(1, Math.max(1, conversationMessages.length - KEEP_RECENT))),
        });
        sendMessages = packed.compressed ? packed.messages : conversationMessages.slice(-30);
        // 压缩是 lossy 的：把摘要沉淀为跨会话记忆，避免被压段"蒸发"（同 sessionId 去重）
        if (packed.compressed && typeof rememberCompaction === 'function') {
          try { rememberCompaction(targetId, packed.summaryText || ''); } catch { /* silent */ }
        }
      } else {
        sendMessages = conversationMessages.slice(-30);
      }
      // 终极兜底：即使压缩后仍超长，也保留最近 30 条（与旧行为对齐，绝不越界）
      if (estimateMessages(sendMessages) > CONTEXT_BUDGET) sendMessages = sendMessages.slice(-30);

      // 最后一轮硬断工具：只靠 prompt 约束不可靠，直接不下发 tools，模型物理上无法再调
      const isFinalIteration = iter >= CONVERGE_AT;
      const iterTools = isFinalIteration ? undefined : toolSchemas;

      // ── 带重试的 LLM 调用（P1-6 流式：文本逐字回灌 + tool_calls 分片合并）──
      // 仅对 429/5xx/上游限流瞬错重试，最多 2 次
      const MAX_AGENT_RETRIES = 2;
      let data;
      for (let attempt = 0; attempt <= MAX_AGENT_RETRIES; attempt++) {
        try {
          data = await streamAgentResponse({
            controller,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            model: selectedModel,
            systemPrompt: fullSystemPrompt,
            messages: sendMessages,
            maxTokens: 4000,
            tools: iterTools,
            toolChoice: isFinalIteration ? undefined : 'auto',
            // 实时逐字渲染：把已累积的 content 推给 UI（工具卡片在工具执行阶段才出现）
            onChunk: (c) => updateAssistantMsg({
              content: c,
              toolCalls: toolCallTrace.slice(),
              thinking: '正在生成...',
              toolCallCount: toolCallTrace.length,
            }),
          });
          // 成功，跳出重试循环
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

      // 若无 tool_calls，本次即为最终答案
      if (!Array.isArray(data.tool_calls) || data.tool_calls.length === 0) {
        finalContent = data.content || '（无内容返回）';
        break;
      }

      // 有 tool_calls：先把 assistant 的 tool_calls 消息追加到 conversation
      conversationMessages.push({
        role: 'assistant',
        content: data.content || '',
        tool_calls: data.tool_calls,
      });
      // 若 LLM 同时返回了文本，更新到 UI
      if (data.content) finalContent = data.content;

      // ── 工具调用执行（P1-4 并行化）──
      // 同批次的 tool_calls 默认相互独立：把"免审批"的调用用 Promise.allSettled 并发执行提速；
      // 把"需要用户审批"的调用串行排队（审批是单模态卡片，并发会互相打架）。
      // 不论并行还是串行，最终都按原始 tool_calls 顺序回灌 tool message，
      // 保证 tool_call_id 与结果一一对应，LLM 不会错位。
      const calls = (data.tool_calls || []).map(tc => {
        let args = {};
        try { args = JSON.parse(tc?.function?.arguments || '{}'); } catch { args = {}; }
        return { tc, toolName: tc?.function?.name || 'unknown', args };
      });

      // 先把所有调用都标记为 running（UI 立即展示全部卡片）
      for (const c of calls) {
        toolCallTrace.push({
          id: c.tc.id,
          name: c.toolName,
          args: c.args,
          status: 'running',
          startedAt: Date.now(),
        });
      }
      observeToolUsage(calls.map(c => c.toolName));
      updateAssistantMsg({
        content: finalContent,
        toolCalls: toolCallTrace.slice(),
        thinking: `正在调用 ${calls.length} 个工具...`,
        toolCallCount: toolCallTrace.length,
      });

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

      /** 单个工具执行 + 统一错误兜底（abort 向上抛） */
      const runOne = async (c) => {
        let r;
        try {
          r = await executeAgentTool(c.toolName, c.args, toolCtx);
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

      // 回执收集：tc.id -> resultText
      const resultMap = new Map();
      auto.forEach((c, i) => {
        const settled = autoResults[i];
        if (settled.status === 'fulfilled') {
          resultMap.set(c.tc.id, String(settled.value));
        } else {
          // runOne 已兜底普通异常；仅 AbortError 会穿透为 rejected，这里重新抛出以中断整轮
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

      // 按原始顺序统一回灌：更新 trace / 历史 / 长结果落盘 / tool message
      for (const c of calls) {
        const resultText = resultMap.get(c.tc.id) ?? '（无返回）';
        // 审批被拒 / 被取消 = "未执行"，标 skipped；其余"错误："前缀 = 执行失败
        const wasSkipped = /^错误：(用户拒绝授权|审批被取消|审批失败)/.test(resultText);
        const wasFailed = !wasSkipped && resultText.startsWith('错误：');

        const traceItem = toolCallTrace.find(t => t.id === c.tc.id);
        if (traceItem) {
          traceItem.status = wasSkipped ? 'skipped' : 'done';
          traceItem.result = resultText.slice(0, 8000);
          traceItem.completedAt = Date.now();
        }
        updateAssistantMsg({
          content: finalContent,
          toolCalls: toolCallTrace.slice(),
          thinking: wasSkipped
            ? `工具 ${c.toolName} 审批未通过，继续推理...`
            : `工具 ${c.toolName} 已返回，继续推理...`,
          toolCallCount: toolCallTrace.length,
        });

        try {
          appendHistory(targetId, {
            toolName: c.toolName,
            args: c.args,
            result: resultText.slice(0, 2000),
            status: wasSkipped ? 'skipped' : (wasFailed ? 'failed' : 'done'),
          });
        } catch { /* ignore */ }

        // 超长结果落盘工作空间（对标 pi/bash 输出截断进 temp 文件），只回灌截断+路径提示
        const toolResult = await persistLongResult({
          result: String(resultText),
          rootHandle: toolCtx.rootHandle,
          toolName: c.toolName,
          sessionId: targetId,
        });
        conversationMessages.push({
          role: 'tool',
          tool_call_id: c.tc.id,
          content: toolResult.text,
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
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      aborted = true;
    } else {
      // 其他错误：向上传播，由 sendMessage 的 catch 统一处理
      throw err;
    }
  }

  if (aborted) {
    if (!finalContent) finalContent = '（已停止）';
    // 写入最终消息：保留 toolCalls 痕迹，标记 stopped
    setSessions(prev => prev.map(s => {
      if (s.id !== targetId) return s;
      const msgs = [...s.messages];
      msgs[msgs.length - 1] = {
        role: 'assistant',
        content: finalContent,
        toolCalls: toolCallTrace.slice(),
        toolCallCount: toolCallTrace.length,
        loading: false,
        stopped: true,
      };
      return { ...s, messages: msgs, updatedAt: Date.now() };
    }));
    return;
  }

  if (!finalContent) finalContent = '（agent 达到最大轮数仍未给出最终回复）';

  // ── 终答质量自检（P2-9 引用校验 + P2-10 对照工具执行痕迹）──
  // 收集两类问题：① 引用了不在证据集中的资讯 ID；② 断言了失败 / 被拒工具的成功结果。
  const allowedCitationIds = new Set((intelligenceContext?.items || []).map(item => String(item.id)));
  const citedIds = [...finalContent.matchAll(/\[资讯:([^\]]+)\]/g)].map(match => match[1].trim());
  const invalidIds = [...new Set(citedIds.filter(id => !allowedCitationIds.has(id)))];
  const failedCalls = toolCallTrace.filter(t =>
    t.status === 'skipped' || (typeof t.result === 'string' && /^错误：/.test(t.result)));
  const issues = [];
  if (invalidIds.length) {
    issues.push(`引用了不存在的资讯 ID：${invalidIds.join('、')}（请从当前证据集中引用，或删除该引用）`);
  }
  failedCalls.forEach(t => {
    const reason = t.status === 'skipped' ? '被用户拒绝或取消' : '执行失败';
    issues.push(`工具 ${t.name} ${reason}，回答中不应断言其成功产出的结果或数据`);
  });

  let finalFinalContent = finalContent;
  if (issues.length) {
    // 一次性回灌修复（不调用工具），失败则降级保留原答案并附警告
    const repaired = await selfVerifyRepair({
      content: finalContent,
      issues,
      llmConfig,
      selectedModel,
      systemPrompt,
    });
    if (repaired) {
      finalFinalContent = repaired;
      // 复检引用：仍无效的给出温和提示（不再二次修复，避免无限循环）
      const reCited = [...repaired.matchAll(/\[资讯:([^\]]+)\]/g)].map(m => m[1].trim());
      const stillInvalid = [...new Set(reCited.filter(id => !allowedCitationIds.has(id)))];
      if (stillInvalid.length) {
        finalFinalContent += `\n\n> 引用校验提示：以下资讯 ID 不在当前证据集中：${stillInvalid.join('、')}`;
      }
    } else if (invalidIds.length) {
      finalFinalContent = `${finalContent}\n\n> 引用校验失败：以下资讯 ID 不在当前证据集中：${invalidIds.join('、')}`;
    }
  }

  // 写入最终 assistant 消息（保留 toolCalls 痕迹供 UI 展示）
  setSessions(prev => prev.map(s => {
    if (s.id !== targetId) return s;
    const msgs = [...s.messages];
    msgs[msgs.length - 1] = {
      role: 'assistant',
      content: finalFinalContent,
      toolCalls: toolCallTrace.slice(),
      loading: false,
    };
    return { ...s, messages: msgs, updatedAt: Date.now() };
  }));

  // 画像学习与摘要（与流式路径一致）
  observeReply(finalFinalContent);
  setLearnedVersion(v => v + 1);
  const extracted = extractTodos(finalFinalContent);
  if (extracted.length > 0) setAutoTodos(extracted);

  // 自动技能沉淀：任务完成后，若有工具调用且输出有结构化内容，Agent 自我反思沉淀经验
  // 这不是用户手动"存为技能"，而是 Agent 主动从工作过程中提炼方法论、步骤、决策点
  const hadToolCalls = toolCallTrace.length > 0;
  const hadStructuredOutput = /\n\s*[#>*\-\d]/.test(finalFinalContent) || finalFinalContent.length > 500;
  if (hadToolCalls && hadStructuredOutput) {
    try {
      const skillPrecipitationPrompt = [
        '你刚完成了一个任务。现在请反思并沉淀本次工作的经验为一个可复用的技能（Skill）。',
        '',
        '请按以下结构输出技能内容：',
        '',
        '# 技能标题：<用一句话概括这个技能能做什么>',
        '',
        '## 适用场景',
        '- 什么时候应该使用这个技能？',
        '- 典型的触发关键词是什么？',
        '',
        '## 工作流程与方法论',
        '1. 第一步做什么，为什么',
        '2. 第二步做什么，关键判断标准是什么',
        '3. 第三步做什么，注意事项有哪些',
        '',
        '## 关键决策点',
        '- 在哪些情况下需要调整策略？',
        '- 有哪些常见的陷阱或误区？',
        '',
        '## 工具使用经验',
        '- 本次用到了哪些工具？各自的作用是什么？',
        '- 工具组合的最佳实践是什么？',
        '',
        '## 输出模板',
        '- 最终交付物应该包含哪些部分？',
        '- 格式/结构要求是什么？',
      ].join('\n');

      const precipitationMessages = [
        ...baseMessages,
        { role: 'user', content: userMessage.content },
        { role: 'assistant', content: finalFinalContent, tool_calls: toolCallTrace.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })) },
        { role: 'user', content: skillPrecipitationPrompt },
      ];

      const precipitationResponse = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
          model: selectedModel,
          action: 'chat',
          systemPrompt: `${systemPrompt}\n\n【技能沉淀模式】你正在进行工作反思。你的任务是把刚才完成的工作过程、方法论、经验教训沉淀为一个可复用的 Skill。重点描述过程和方法，而不是重复输出结果。`,
          messages: precipitationMessages,
          max_tokens: 3000,
          tools: toolSchemas.filter(s => s.function?.name === 'create_skill'),
          tool_choice: 'auto',
        }),
      });

      if (precipitationResponse.ok) {
        const pData = await precipitationResponse.json();
        // 如果 Agent 调用了 create_skill，技能已由工具执行层写入
        // 如果没有调用工具，说明 Agent 判断本次工作不值得沉淀（正常情况）
        if (Array.isArray(pData.tool_calls) && pData.tool_calls.length > 0) {
          // 执行 create_skill 工具调用
          for (const tc of pData.tool_calls) {
            const toolName = tc?.function?.name;
            let args = {};
            try { args = JSON.parse(tc?.function?.arguments || '{}'); } catch { args = {}; }
            if (toolName === 'create_skill') {
              args.source = 'work'; // 强制标记为工作沉淀
              const toolResult = await executeAgentTool(toolName, args, toolCtx);
              // create_skill 内部已通过 onSkillCreated 回调通知前端刷新
            }
          }
        }
      }
    } catch {
      // 技能沉淀失败不影响主流程，静默失败
    }
  }

  const currentSession = sessions.find(s => s.id === targetId) || { id: targetId, messages: [...messages, userMessage, { role: 'assistant', content: finalFinalContent }] };
  const totalRounds = currentSession.messages.filter(m => m.role === 'user').length;
  if (totalRounds >= 3) {
    generateSessionSummary(currentSession, { baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, selectedModel }).then(mem => {
      if (mem) setMemoriesVersion(v => v + 1);
    });
    // 自我进化记忆闭环：每 N 轮触发 LLM 总结用户行为，写入服务端 persona_summary
    // fire-and-forget，失败不影响对话流
    evolveMemory({
      messages: currentSession.messages,
      sessionId: targetId,
      agentId: agent?.id || 'orchestrator',
      llmConfig: { baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, selectedModel },
      totalRounds,
    }).catch(() => { /* 静默失败 */ });
  }
}
