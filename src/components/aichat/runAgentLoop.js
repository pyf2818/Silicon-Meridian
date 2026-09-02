// Agent Loop（AI 工作站）：tool_calls 循环执行
// 内核循环（LLM 流式调用 / 校验 / 审批 / 并行执行 / 压缩 / 中断）抽离至 agentLoopCore.js，
// 与 AI 精灵（runElfAgentLoop.js）共用同一内核，消除两份循环的语义漂移。
// 本文件只保留工作站差异化部分：
//   - 会话状态注入（buildSessionContextText）
//   - 压缩摘要沉淀为跨会话记忆（rememberCompaction）
//   - 工具调用历史落账（appendHistory）
//   - 终答质量自检（引用校验 + 失败工具对照）与一次性修复
//   - 自动技能沉淀 / 会话摘要 / 记忆进化（fire-and-forget）
// 用户点"停止"时通过 controller.abort() 中断；已完成的 toolCalls 痕迹保留展示。

import { generateSessionSummary, retrieveRelevantMemories } from '../../utils/sessionMemory.js';
import { observeReply, observeToolUsage } from '../../utils/profileLearning.js';
import { evolveMemory } from '../../utils/memoryEvolver.js';
import { extractTodos } from '../../utils/todoExtractor.js';
import { executeAgentTool } from '../../utils/agentTools.js';
import { getRootHandle } from '../../utils/workspaceHandleStore.js';
import { buildSessionContextText, appendHistory } from '../../utils/sessionStore.js';
import { rememberCompaction } from '../../utils/sessionMemory.js';
import { runToolLoop } from './agentLoopCore.js';
import { createLlmSummarizer } from '../../session/llmSummarizer.js';

export { mergeToolCallDeltas } from './agentLoopCore.js';

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
 * @param {(payload:object)=>void} [opts.onSaveKnowledge] 知识沉淀回调（save_knowledge 落素材库）
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
  onSaveKnowledge,
}) {
  const MAX_ITERATIONS = 12; // 防止无限循环；末轮会注入收敛指令强制收尾
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
    // 知识沉淀回调：save_knowledge 双落点之一（素材库 toggleMaterial）
    // 修复：此前该回调只传到 runAgentLoop 选项层，从未转发进 toolCtx，导致
    // agent 模式下 save_knowledge 始终走"无法自动保存"兜底
    onSaveKnowledge,
    // 情报聚焦引用登记：read_intelligence_focus 返回的事件 ID 收集于此，
    // 终答引用校验时与 intelligenceContext.items 一并视为合法引用
    focusCitations: [],
    // 压缩摘要沉淀为跨会话记忆（内核在压缩发生时回调，同 sessionId 去重）
    onCompacted: (summaryText) => {
      if (summaryText && typeof rememberCompaction === 'function') {
        try { rememberCompaction(targetId, summaryText); } catch { /* silent */ }
      }
    },
  };

  // 给 UI 用的工具调用记录（不带原始 messages 结构，便于渲染卡片）
  const updateAssistantMsg = (patch) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== targetId) return s;
      const msgs = [...s.messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch, loading: true };
      return { ...s, messages: msgs };
    }));
  };

  // LLM 真压缩摘要器：超预算时由内核调用生成结构化摘要（带缓存，失败自动降级本地摘要）
  const generateSummary = createLlmSummarizer({
    llmConfig,
    selectedModel,
    parentSignal: controller?.signal,
  });

  const result = await runToolLoop({
    controller,
    toolSchemas,
    baseMessages,
    systemPrompt,
    llmConfig,
    selectedModel,
    toolCtx,
    maxIterations: MAX_ITERATIONS,
    onProgress: updateAssistantMsg,
    // 会话状态注入：执行计划 / 变量 / 黑板 / 最近工具调用，让 LLM 看到接力上下文
    buildSystemSuffix: () => {
      const sessionContextText = buildSessionContextText(targetId);
      return sessionContextText
        ? `【会话状态】你正在执行一个多步任务，以下是当前会话的状态快照，可作为接力推理的依据：\n${sessionContextText}`
        : '';
    },
    onToolComplete: ({ toolName, args, result: toolResult, status }) => {
      try {
        appendHistory(targetId, { toolName, args, result: String(toolResult).slice(0, 2000), status });
      } catch { /* ignore */ }
    },
    generateSummary,
  });

  let { finalContent } = result;
  const { toolCallTrace, aborted, usage } = result;

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
  // 合法引用集 = 情报上下文条目 + read_intelligence_focus 工具按需拉取的事件（focusCitations）
  const allowedCitationIds = new Set([
    ...(intelligenceContext?.items || []).map(item => String(item.id)),
    ...(toolCtx.focusCitations || []),
  ]);
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

  // 写入最终 assistant 消息（保留 toolCalls 痕迹供 UI 展示 + 本轮 token 用量）
  setSessions(prev => prev.map(s => {
    if (s.id !== targetId) return s;
    const msgs = [...s.messages];
    msgs[msgs.length - 1] = {
      role: 'assistant',
      content: finalFinalContent,
      toolCalls: toolCallTrace.slice(),
      usage,
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
