// Agent Loop：tool_calls 循环执行
// 流程：发请求 → 若返回 tool_calls 则执行工具并把结果回灌 → 重新请求，直到无 tool_calls 或达到最大轮数
// 用户点"停止"时通过 controller.abort() 中断当前 fetch；已完成的 toolCalls 痕迹保留展示
// 从 src/components/AiChatPanel.jsx 抽离，纯函数（无 React 依赖）

import { generateSessionSummary, retrieveRelevantMemories } from '../../utils/sessionMemory.js';
import { observeReply, observeToolUsage } from '../../utils/profileLearning.js';
import { evolveMemory } from '../../utils/memoryEvolver.js';
import { extractTodos } from '../../utils/todoExtractor.js';
import { executeAgentTool } from '../../utils/agentTools.js';
import { getRootHandle } from '../../utils/workspaceHandleStore.js';
import { buildSessionContextText, appendHistory } from '../../utils/sessionStore.js';
import { requestApproval } from '../../utils/sandbox.js';
import { buildContext, estimateMessages, shouldCompact, localSummary } from '../../session/contextManager.js';
import { persistLongResult } from '../../session/outputSink.js';
import { rememberCompaction } from '../../utils/sessionMemory.js';

// 上下文预算：发送给 LLM 的消息总token上限。超过则触发「中段本地摘要压缩」而非硬截断。
const CONTEXT_BUDGET = 48_000;
const KEEP_RECENT = 25; // 压缩时保留的最近消息数

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
  const MAX_ITERATIONS = 6; // 防止无限循环
  const toolCtx = {
    rootHandle: getRootHandle(),
    sessionId: targetId,
    agentId: agent?.id || '',
    agentName: agent?.name || '',
    agentTools: Array.isArray(agent?.tools) ? agent.tools : [],
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
      const fullSystemPrompt = sessionContextText
        ? `${systemPrompt}\n\n【会话状态】你正在执行一个多步任务，以下是当前会话的状态快照，可作为接力推理的依据：\n${sessionContextText}`
        : systemPrompt;

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

      // ── 带重试的 LLM 调用（仅对 429/5xx 瞬错重试，最多 2 次）──
      const MAX_AGENT_RETRIES = 2;
      let data;
      for (let attempt = 0; attempt <= MAX_AGENT_RETRIES; attempt++) {
        try {
          const response = await fetch('/api/ai-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
              model: selectedModel,
              action: 'chat',
              systemPrompt: fullSystemPrompt,
              messages: sendMessages,
              max_tokens: 4000,
              tools: toolSchemas,
              tool_choice: 'auto',
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = typeof errData.error === 'string' ? errData.error : errData.error?.message || `AI 请求失败 (${response.status})`;
            const retriable = response.status === 429 || response.status >= 500;
            if (retriable && attempt < MAX_AGENT_RETRIES) {
              await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
              continue;
            }
            throw new Error(errMsg);
          }

          data = await response.json();
          if (data.ok === false) {
            // 流式/上游限流错误也尝试重试
            if (/繁忙|频繁|rate.limit|429/i.test(data.error || '') && attempt < MAX_AGENT_RETRIES) {
              await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
              continue;
            }
            throw new Error(data.error || 'AI 请求失败');
          }
          // 成功，跳出重试循环
          break;

        } catch (err) {
          if (err?.name === 'AbortError') throw err; // 用户取消
          if (attempt < MAX_AGENT_RETRIES) {
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

      // 逐个执行工具调用
      for (const tc of data.tool_calls) {
        const toolName = tc?.function?.name || 'unknown';
        let args = {};
        try { args = JSON.parse(tc?.function?.arguments || '{}'); } catch { args = {}; }

        // 更新 UI：开始执行工具
        toolCallTrace.push({
          id: tc.id,
          name: toolName,
          args,
          status: 'running',
          startedAt: Date.now(),
        });
        // 画像学习：记录用户偏好的工具
        observeToolUsage([toolName]);
        updateAssistantMsg({
          content: finalContent,
          toolCalls: toolCallTrace.slice(),
          thinking: `正在调用工具：${toolName}`,
          toolCallCount: toolCallTrace.length,
        });

        // 执行工具（executeAgentTool 内部已 try/catch，不抛异常；但 fetch 自身可能因 abort 抛出）
        let result;
        try {
          // assist 模式：每个工具调用前请求用户审批（用户可 allow-once / allow-always / deny）
          // allow-always 会写入 session 级 grant，本会话内同工具免问
          if (permissionMode === 'assist') {
            try {
              await requestApproval({
                sessionId: targetId,
                toolName,
                args,
                reason: `协助模式：智能体请求调用工具 "${toolName}"`,
              });
            } catch (denyErr) {
              if (denyErr?.code === 'USER_DENIED') {
                result = `用户拒绝授权工具 "${toolName}"，已跳过执行。`;
              } else if (denyErr?.code === 'CANCELLED') {
                const cancelErr = new Error('cancelled');
                cancelErr.name = 'AbortError';
                throw cancelErr;
              } else {
                result = `工具审批失败：${denyErr?.message || String(denyErr)}`;
              }
              // 跳过实际执行，直接进入结果回灌
              const traceItem = toolCallTrace.find(t => t.id === tc.id);
              if (traceItem) {
                traceItem.status = 'skipped';
                traceItem.result = String(result).slice(0, 8000);
                traceItem.completedAt = Date.now();
              }
              updateAssistantMsg({
                content: finalContent,
                toolCalls: toolCallTrace.slice(),
                thinking: `工具 ${toolName} 审批未通过，继续推理...`,
                toolCallCount: toolCallTrace.length,
              });
              try {
                appendHistory(targetId, {
                  toolName,
                  args,
                  result: String(result).slice(0, 2000),
                  status: 'skipped',
                });
              } catch { /* ignore */ }
              conversationMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: String(result).slice(0, 20000),
              });
              if (controller.signal.aborted) { aborted = true; break; }
              continue;
            }
          }
          result = await executeAgentTool(toolName, args, toolCtx);
        } catch (err) {
          // abort 时 fetch 抛 AbortError，向上传播让外层捕获
          if (err?.name === 'AbortError') throw err;
          result = `工具执行失败：${err?.message || String(err)}`;
        }

        // 更新 UI：工具执行完成
        const traceItem = toolCallTrace.find(t => t.id === tc.id);
        if (traceItem) {
          traceItem.status = 'done';
          traceItem.result = String(result).slice(0, 8000);
          traceItem.completedAt = Date.now();
        }
        updateAssistantMsg({
          content: finalContent,
          toolCalls: toolCallTrace.slice(),
          thinking: `工具 ${toolName} 已返回，继续推理...`,
          toolCallCount: toolCallTrace.length,
        });

        // 追加到会话历史（sessionStore），供后续轮次的 LLM 看到「最近调用」
        try {
          appendHistory(targetId, {
            toolName,
            args,
            result: String(result).slice(0, 2000),
            status: String(result).startsWith('错误：') ? 'failed' : 'done',
          });
        } catch { /* ignore */ }

        // 把工具结果作为 tool message 追加到 conversation。
        // 超长结果落盘工作空间（对标 pi/bash 输出截断进 temp 文件），只回灌截断+路径提示。
        const toolResult = await persistLongResult({
          result: String(result),
          rootHandle: toolCtx.rootHandle,
          toolName,
          sessionId: targetId,
        });
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult.text,
        });

        // 用户已 abort：停止后续工具调用
        if (controller.signal.aborted) {
          aborted = true;
          break;
        }
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

  // 引用校验（与流式路径一致）
  const allowedCitationIds = new Set((intelligenceContext?.items || []).map(item => String(item.id)));
  const citedIds = [...finalContent.matchAll(/\[资讯:([^\]]+)\]/g)].map(match => match[1].trim());
  const invalidIds = [...new Set(citedIds.filter(id => !allowedCitationIds.has(id)))];
  const finalFinalContent = invalidIds.length
    ? `${finalContent}\n\n> 引用校验失败：以下资讯 ID 不在当前证据集中：${invalidIds.join('、')}`
    : finalContent;

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
