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
import { observeReply, observeToolUsage, observeSessionEnd } from '../../utils/profileLearning.js';
import { evolveMemory } from '../../utils/memoryEvolver.js';
import { extractTodos } from '../../utils/todoExtractor.js';
import { createSkillDirect } from '../../utils/agentTools.js';
import { recordAgentRun, depositExperience } from '../../domain/agent/agentEvolution.js';
import {
  PRECIPITATION_SYSTEM_SUFFIX,
  buildPrecipitationPrompt,
  parsePrecipitationDecision,
  normalizeSkillDraft,
  shouldAttemptPrecipitation,
  MAX_SKILLS_PER_SESSION,
} from '../../domain/agent/skillPrecipitation.js';
import { getRootHandle } from '../../utils/workspaceHandleStore.js';
import { buildSessionContextText, appendHistory } from '../../utils/sessionStore.js';
import { rememberCompaction } from '../../utils/sessionMemory.js';
import { runToolLoop } from './agentLoopCore.js';
import { createLlmSummarizer } from '../../session/llmSummarizer.js';
import {
  WORKSTATION_MAX_ITERATIONS,
  COMPLETION_MAX_TOKENS,
  AUX_COMPLETION_MAX_TOKENS,
} from '../../constants/agentLoop.js';

/** 会话级自主沉淀计数（防单次会话刷出多条技能）：模块生命周期内有效 */
const precipitatedBySession = new Map();

export { mergeToolCallDeltas } from './agentLoopCore.js';

/**
 * 终答前的质量自检修复（P2-9 引用重试 + P2-10 对照 toolCallTrace 自检）。
 * 把"引用了不存在的资讯 ID / 断言了失败或被拒工具的结果"等问题回灌模型，
 * 要求它在不调用任何工具的前提下直接输出修正后的完整回答。
 * 仅尝试一次（不无限递归）；任何失败都返回 null，由调用方降级保留原答案。
 */
// v26.9e：两处收尾用的非流式 fetch 原先既没有 signal 也没有超时——
// 上游不响应时会永久挂起，而它们 await 在 sendMessage 的 try 内、拖住 finally，
// 导致「停止」按钮失效且该会话的 streaming 标志迟迟不复位（后续消息全进队）。
// 统一给：调用方 signal（用户停止）+ 单次请求超时。
const AUX_FETCH_TIMEOUT_MS = 60_000;

async function fetchAuxCompletion(url, body, parentSignal, timeoutMs = AUX_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (parentSignal?.aborted) ctrl.abort();
  else parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort', onAbort);
  }
}

async function selfVerifyRepair({ content, issues, llmConfig, selectedModel, systemPrompt, signal }) {
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
    const response = await fetchAuxCompletion('/api/ai-generate', {
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      model: selectedModel,
      action: 'chat',
      systemPrompt: systemPrompt || '',
      messages: repairMessages,
      max_tokens: COMPLETION_MAX_TOKENS,
    }, signal);
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
    maxIterations: WORKSTATION_MAX_ITERATIONS,
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
      signal: controller?.signal,
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
  // 进化档案统计：runAgentLoop 路径此前从未记录 → 进化数值只被流式路径累加，
  // 走本路径的对话完全不计入（用户「用了好久一点没增长」的根因）。
  recordAgentRun(agent?.id || 'orchestrator', {
    toolCalls: toolCallTrace.length,
    skillsUsed: toolCallTrace.filter(tc => tc?.name === 'create_skill' || String(tc?.args || '').includes('"title"')).length,
  });
  // 工具偏好与会话统计：此前从未接线（工具偏好/会话统计展示组件因数据恒空而永不渲染）
  observeToolUsage(toolCallTrace.map(tc => tc?.name).filter(Boolean));
  const extracted = extractTodos(finalFinalContent);
  if (extracted.length > 0) setAutoTodos(extracted);

  // ── 自主技能沉淀（静默 + Agent 自主判断）──────────────────────────────
  // 旧行为：用「有工具调用 + 输出够长」的粗糙阈值每轮都发起一次沉淀工具调用，
  // 而 create_skill 作为 LLM 可调工具需用户审批 → 每轮对话结束都弹「是否创建沉淀技能」。
  // 新行为：一次结构化复盘让模型自判「是否产生了可复用的方法/规则/经验」，
  // 判定有价值才经内核静默通道落盘（不过审批闸门），并把结论同步进经验层（进化档案）。
  const hadToolCalls = toolCallTrace.length > 0;
  const sessionSkillCount = precipitatedBySession.get(targetId) || 0;
  if (shouldAttemptPrecipitation({
    hadToolCalls,
    contentLength: finalFinalContent.length,
    sessionSkillCount,
    maxPerSession: MAX_SKILLS_PER_SESSION,
  })) {
    try {
      const precipitationResponse = await fetchAuxCompletion('/api/ai-generate', {
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: selectedModel,
        action: 'chat',
        systemPrompt: `${systemPrompt}\n\n${PRECIPITATION_SYSTEM_SUFFIX}`,
        messages: [
          ...baseMessages,
          { role: 'user', content: userMessage.content },
          { role: 'assistant', content: finalFinalContent, tool_calls: toolCallTrace.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })) },
          { role: 'user', content: buildPrecipitationPrompt() },
        ],
        max_tokens: AUX_COMPLETION_MAX_TOKENS,
        // 刻意不传 tools：让模型以 JSON 决策，而不是去调 create_skill（那会回到审批闸门弹卡）
      }, controller?.signal);

      if (precipitationResponse.ok) {
        const pData = await precipitationResponse.json();
        const decision = parsePrecipitationDecision(
          typeof pData?.content === 'string' ? pData.content : '',
        );
        if (decision.valuable) {
          const draft = normalizeSkillDraft(decision.skill);
          if (draft.ok) {
            const toolResult = await createSkillDirect({ ...draft.skill, source: 'work' }, toolCtx);
            if (!/^错误/.test(toolResult)) {
              precipitatedBySession.set(targetId, sessionSkillCount + 1);
              // 经验层同步：同一结论进「进化档案」（去重 + 封顶由 depositExperience 保证，
              // 后续对话经 evolutionPromptSnippet 回注，形成越用越懂的闭环）
              depositExperience(agent?.id || 'orchestrator', {
                topic: draft.skill.title,
                lesson: draft.skill.body.slice(0, 300),
                source: 'skill',
              });
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
  observeSessionEnd(totalRounds);
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
