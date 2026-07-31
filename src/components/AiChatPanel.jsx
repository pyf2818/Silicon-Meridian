/**
 * AiChatPanel - AI 工作站三栏布局容器
 *
 * 三栏：SessionSidebar（左·会话管理）+ 对话主区（中）+ AgentPanel（右·智能管理）
 * - 撑满 feed 容器，内部 CSS grid 三栏
 * - 流式回复 / 引用校验 / 快捷指令 / 附件 / 消息操作栏
 * - 接收 pendingMessage（来自右栏「剖析」或其它入口）做深度分析
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown } from '../utils/markdown.jsx';
import SessionSidebar from './SessionSidebar.jsx';
import AgentPanel from './AgentPanel.jsx';
import { retrieveRelevantMemories } from '../utils/sessionMemory.js';
import { searchFiles } from '../utils/workspaceIndex.js';
import { observeQuestion, observeReply, observeFeedback, getLearnedPreferences } from '../utils/profileLearning.js';
import { evolveMemory, fetchPersonaSummary, fetchRelevantMemories } from '../utils/memoryEvolver.js';
import { extractTodos } from '../utils/todoExtractor.js';
import { selectToolSchemas } from '../utils/agentTools.js';
import {
  subscribePending, getPendingApprovals, respondApproval, cancelAllPending,
} from '../utils/sandbox.js';
import { PersonaDrawer } from './PersonaEditor.jsx';
import { ToolCallCard, ApprovalCard } from './aichat/ToolCards.jsx';
import { sessionsStore, loadSessions, saveSessions } from './aichat/sessionsStore.js';
import { WELCOME_MSGS, EMPTY_MESSAGES, SUGGEST_ICONS } from './aichat/constants.jsx';
import { buildMaterialContext } from './aichat/buildMaterialContext.js';
import { buildSystemPrompt } from './aichat/buildSystemPrompt.js';
import { buildQuickActions } from './aichat/buildQuickActions.js';
import { runAgentLoop as runAgentLoopImpl } from './aichat/runAgentLoop.js';
import { useInputHistory } from './aichat/useInputHistory.js';
import { useSelfEvolution } from '../hooks/useSelfEvolution.js';
import { useSkills } from '../hooks/useSkills.js';
import { showToast } from '../utils/toast.js';
import { useProfileStore, useUiStore } from '../store';
import { ICONS } from '../constants/appConstants.jsx';
import ChatHeader from './aichat/ChatHeader.jsx';

// 模块级 abortController，跨组件生命周期保持
let activeAbortController = null;

export default function AiChatPanel({
  llmConfig,
  intelligenceProfile,
  workbenchItems,
  selectedInterests,
  categories,
  allLlmModels,
  onOpenLlmConfig,
  user,
  pendingMessage,
  onMessageSent,
  intelligenceContext,
  onOpenNewspaper,
  todayBriefing,
  todayLanes,
  materials,
  agent,
  onUpdateAgent,
  setLlmConfig,
  variant = 'copilot',
}) {
  // 订阅模块级 sessionsStore：组件 unmount 后流式 fetch 继续更新 store，
  // 重新 mount 时 useState 初始化从 store 读取最新状态
  const [storeSnapshot, setStoreSnapshot] = useState(sessionsStore.state);
  useEffect(() => sessionsStore.subscribe(setStoreSnapshot), []);
  const sessions = storeSnapshot.sessions;
  const activeSessionId = storeSnapshot.activeSessionId
    || (storeSnapshot.sessions.length > 0 ? storeSnapshot.sessions[0].id : null);
  const isStreaming = storeSnapshot.isStreaming;
  // 暴露给原 setSessions 调用点的兼容函数：写入 store + 持久化
  const setSessions = useCallback((updater) => {
    const prev = sessionsStore.state.sessions;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    sessionsStore.setState({ sessions: next });
  }, []);
  const setActiveSessionId = useCallback((id) => sessionsStore.setState({ activeSessionId: id }), []);
  const setIsStreaming = useCallback((v) => sessionsStore.setState({ isStreaming: v }), []);

  const [workspaceFiles, setWorkspaceFiles] = useState([]); // 工作空间加入上下文的文件
  const [memoriesVersion, setMemoriesVersion] = useState(0); // 会话记忆版本（摘要生成后刷新）
  const [learnedVersion, setLearnedVersion] = useState(0); // 学习画像版本（观测后刷新）
  const [autoTodos, setAutoTodos] = useState([]); // 对话自动提取的行动项
  const [excludeAllEvidence, setExcludeAllEvidence] = useState(false); // 一键排除全部情报上下文
  const [excludeAllMaterials, setExcludeAllMaterials] = useState(false); // 一键排除全部素材库上下文

  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(llmConfig?.selectedModel || '');
  const [attachments, setAttachments] = useState([]);
  const [sessionCollapsed, setSessionCollapsed] = useState(false);

  // 输入历史：上下键浏览之前发送的消息（Claude Code / shell 风格）
  // 已抽离至 aichat/useInputHistory.js，下方通过 hook 注入
  // inputHistoryRef/draftRef/historyIndexRef 由 hook 内部管理；handleKeyDown 由 hook 返回

  // 沙箱审批：订阅 pending 列表，UI 在聊天流末尾渲染审批卡片
  const [pendingApprovals, setPendingApprovals] = useState(() => getPendingApprovals());
  useEffect(() => subscribePending(() => setPendingApprovals(getPendingApprovals())), []);
  // 切换会话时取消所有未决审批（避免错乱）
  useEffect(() => {
    return () => { /* 不在切换时取消，让 abort 流程自己处理 */ };
  }, [activeSessionId]);

  // 角色设定侧滑面板：从 chat-header 入口打开，编辑当前 agent 的 persona/soul/voice/habits
  const [showPersonaDrawer, setShowPersonaDrawer] = useState(false);
  const handleSavePersona = useCallback((agentId, patch) => {
    if (!onUpdateAgent) {
      console.warn('[AiChatPanel] onUpdateAgent prop 未传入，无法保存角色设定');
      return;
    }
    onUpdateAgent(agentId, patch);
  }, [onUpdateAgent]);

  // Sync model selection when llmConfig changes externally (e.g. from LLM modal)
  useEffect(() => {
    if (llmConfig?.selectedModel && llmConfig.selectedModel !== selectedModel) {
      setSelectedModel(llmConfig.selectedModel);
    }
  }, [llmConfig?.selectedModel]);

  const [welcomeMsg] = useState(() => WELCOME_MSGS[Math.floor(Math.random() * WELCOME_MSGS.length)]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // 消息队列：流式生成中允许用户继续输入下一条消息并排队，流结束后自动发送
  // 类似 Codex / Claude Code 的多消息排队体验
  const messageQueueRef = useRef([]);
  const [queueCount, setQueueCount] = useState(0);
  const abortControllerRef = useRef(null);

  const currentSession = sessions.find(s => s.id === activeSessionId);
  const messages = currentSession?.messages || EMPTY_MESSAGES;
  const userName = user?.username || '你';

  // 检索与当前输入相关的历史记忆（跨对话不失忆）
  const relevantMemories = useMemo(() => {
    const query = input || messages.filter(m => m.role === 'user').pop()?.content || '';
    return retrieveRelevantMemories(query, activeSessionId, 3);
  }, [input, messages, activeSessionId, memoriesVersion]);

  // Phase 3 Task B11: 服务端 agent_memories 异步检索（debounce 500ms，失败静默）
  // 与本地 relevantMemories 互补：本地走 sessionMemory，服务端走 agent_memories 表
  const [agentMemories, setAgentMemories] = useState([]);
  useEffect(() => {
    const query = input || messages.filter(m => m.role === 'user').pop()?.content || '';
    if (!query || query.length < 4) { setAgentMemories([]); return; }
    const timer = setTimeout(async () => {
      try {
        const memories = await fetchRelevantMemories(query, 5);
        setAgentMemories(memories);
      } catch {
        /* silent: 服务端记忆失败不影响主流程 */
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [input, messages]);

  // 学习画像：从用户行为观测到的偏好（高频主题/格式/深度）
  const learnedPrefs = useMemo(() => getLearnedPreferences(), [learnedVersion]);

  const materialContext = useMemo(() => buildMaterialContext(materials), [materials]);

  // 工作空间召回：异步检索相关文件（IndexedDB），debounce 避免频繁查询
  const [recalledFiles, setRecalledFiles] = useState([]);

  // 用户性格画像：Phase 3 Task B7 改读 profileStore（跨会话持久化）
  // 服务端 persona_summary 仍由 fetchPersonaSummary 拉取并写入 store
  const personaSummary = useProfileStore(s => s.personaSummary);
  const setPersonaSummary = useProfileStore(s => s.setPersonaSummary);

  // Agent 权限模式：assist / autonomous / plan（会话级，非持久化）
  const agentPermissionMode = useUiStore(s => s.agentPermissionMode);
  const setAgentPermissionMode = useUiStore(s => s.setAgentPermissionMode);

  // 联网搜索切换：直接打补丁到 llmConfig（持久化由 useLlmConfig effect 负责）
  const webSearchEnabled = llmConfig?.webSearchEnabled !== false;
  const toggleWebSearch = useCallback(() => {
    if (!setLlmConfig) return;
    setLlmConfig(prev => ({ ...prev, webSearchEnabled: prev?.webSearchEnabled === false }));
  }, [setLlmConfig]);

  // P4 自进化记忆：暴露健康度给 AgentPanel（轻量，仅 variant==='main' 时启用）
  const selfEvolution = useSelfEvolution({
    llmConfig,
    personaSummary,
    enabled: variant === 'main',
  });
  const memoryHealth = selfEvolution.health;
  const lastEvolvedAt = selfEvolution.lastEvolvedAt;

  // P5 Skills：左上角 skill 按钮弹出的可滚动菜单（portal 渲染到 body，向上弹出）
  const skillsHook = useSkills({ enabled: true });
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [activeSkill, setActiveSkill] = useState(null);
  const [skillMenuPos, setSkillMenuPos] = useState(null);
  const skillBtnRef = useRef(null);
  const skillMenuRef = useRef(null);

  // 打开菜单时计算位置（按钮左下角为锚点，菜单向上展开）
  const openSkillMenu = useCallback(() => {
    if (!skillBtnRef.current) return;
    const rect = skillBtnRef.current.getBoundingClientRect();
    setSkillMenuPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6, // 菜单底部距按钮顶部 6px
    });
    setShowSkillMenu(true);
  }, []);

  const toggleSkillMenu = useCallback(() => {
    if (showSkillMenu) setShowSkillMenu(false);
    else openSkillMenu();
  }, [showSkillMenu, openSkillMenu]);

  // 点击外部关闭 skill 菜单
  useEffect(() => {
    if (!showSkillMenu) return;
    const handler = (e) => {
      if (skillMenuRef.current && !skillMenuRef.current.contains(e.target) &&
          skillBtnRef.current && !skillBtnRef.current.contains(e.target)) {
        setShowSkillMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSkillMenu]);

  // 窗口滚动/resize 时更新位置
  useEffect(() => {
    if (!showSkillMenu) return;
    const update = () => {
      if (!skillBtnRef.current) return;
      const rect = skillBtnRef.current.getBoundingClientRect();
      setSkillMenuPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 6,
      });
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showSkillMenu]);

  // 选中 skill：把 skill 的 prompt 模板注入到输入框（或作为 systemPrompt 追加）
  const applySkill = useCallback((skill) => {
    setActiveSkill(skill.id);
    setShowSkillMenu(false);
    // 把 skill body 的前 200 字作为引导注入输入框（轻量，不覆盖已有输入）
    const hint = skill.triggers?.[0] ? `【技能：${skill.title}】` : '';
    if (hint && !input.trim()) {
      setInput(hint);
      inputRef.current?.focus();
    } else if (hint) {
      setInput(prev => prev + ' ' + hint);
      inputRef.current?.focus();
    }
  }, [input]);

  // 工作沉淀：把当前 assistant 回复存为 work 来源的 skill
  // 提取标题/正文/触发词/使用工具，调用 createSkill 落地到 skills/work/<id>/SKILL.md
  const saveAsSkill = useCallback(async (msg, idx) => {
    if (!msg?.content) {
      showToast('回复内容为空，无法沉淀');
      return;
    }
    // 标题：取正文首行非空文本（去掉 markdown 标记），最多 30 字
    const firstLine = String(msg.content)
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)[0] || '工作沉淀技能';
    const cleanTitle = firstLine
      .replace(/^#+\s*/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/[`*_~]/g, '')
      .slice(0, 30);
    // id：基于标题生成 kebab-case，避免冲突加 4 位随机后缀
    const baseId = (cleanTitle.toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'work-skill');
    const id = `${baseId}-${Math.random().toString(36).slice(2, 6)}`;
    // 触发词：从前一条用户消息提取关键词（去停用词，取前 5 个）
    const prevUserMsg = messages.slice(0, idx).reverse().find(m => m.role === 'user');
    const stopWords = new Set(['的', '了', '是', '在', '和', '与', '或', '一个', '一些', '我', '你', '他', '她', '它', '这', '那', '请', '帮', '给', '把', '让', 'the', 'a', 'an', 'is', 'are', 'to', 'of', 'in', 'on', 'for', 'with', 'and', 'or']);
    const triggers = (prevUserMsg?.content || '')
      .split(/[\s,，。.;；!！?？::]+/)
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length >= 2 && s.length <= 12 && !stopWords.has(s))
      .slice(0, 5);
    // 工具：取本条消息调用的工具名（去重）
    const tools = Array.isArray(msg.toolCalls)
      ? [...new Set(msg.toolCalls.map(tc => tc?.name || tc?.toolName).filter(Boolean))]
      : [];
    const skill = {
      id,
      title: cleanTitle,
      description: prevUserMsg?.content?.slice(0, 60) || '从对话中沉淀的工作技能',
      category: 'work',
      triggers,
      tools,
      tags: [],
      version: '0.1.0',
      author: '工作沉淀',
      body: `# ${cleanTitle}\n\n> 由对话沉淀自动生成，可基于此模板继续编辑。\n\n## Prompt 模板\n\n用户原始问题：\n\n${prevUserMsg?.content || '（无）'}\n\n## 回复内容（可作为输出参考）\n\n${msg.content}`,
      source: 'work',
    };
    try {
      await skillsHook.createSkill(skill);
      showToast(`已沉淀为技能：${cleanTitle}`);
    } catch (err) {
      showToast(`沉淀失败：${err?.message || '未知错误'}`);
    }
  }, [messages, skillsHook]);
  useEffect(() => {
    let cancelled = false;
    fetchPersonaSummary().then(ps => {
      if (!cancelled && ps) setPersonaSummary(ps);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [memoriesVersion, setPersonaSummary]); // memoriesVersion 变化时重新拉取（记忆进化后刷新画像）

  useEffect(() => {
    const query = input || messages.filter(m => m.role === 'user').pop()?.content || '';
    if (!query || query.length < 4) { setRecalledFiles([]); return; }
    const timer = setTimeout(async () => {
      const results = await searchFiles(query, 3);
      // 排除已手动加入上下文的文件
      const existing = new Set(workspaceFiles.map(f => f.name));
      setRecalledFiles(results.filter(r => !existing.has(r.name)));
    }, 500);
    return () => clearTimeout(timer);
  }, [input, messages, workspaceFiles]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // sessions 持久化由 sessionsStore.setState 自动处理（流式过程中持续写回）

  // Build system prompt：已抽离至 aichat/buildSystemPrompt.js
  const systemPrompt = useMemo(() => buildSystemPrompt({
    selectedInterests, categories, intelligenceProfile, workbenchItems, intelligenceContext,
    workspaceFiles, relevantMemories, agentMemories, recalledFiles, learnedPrefs,
    excludeAllEvidence, excludeAllMaterials, materialContext, agent, personaSummary,
  }), [selectedInterests, categories, intelligenceProfile, workbenchItems?.length, intelligenceContext, workspaceFiles, relevantMemories, agentMemories, recalledFiles, learnedPrefs, excludeAllEvidence, excludeAllMaterials, materialContext, agent, personaSummary]);

  // 情境化快捷建议：已抽离至 aichat/buildQuickActions.js
  const quickActions = useMemo(() => buildQuickActions(intelligenceContext, workbenchItems, materialContext), [intelligenceContext, workbenchItems, materialContext]);

  // 用户消息节点列表（用于侧边导航跳转）
  const userMessageNodes = useMemo(() => messages
    .map((m, i) => m.role === 'user' ? { idx: i, content: m.content } : null)
    .filter(Boolean), [messages]);
  const jumpToMessage = useCallback((idx) => {
    const el = document.getElementById(`chat-msg-${idx}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const createSession = useCallback(() => {
    const newSession = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }, [activeSessionId]);

  const switchSession = useCallback((id) => {
    setActiveSessionId(id);
  }, []);

  // 重命名会话（由 SessionSidebar inline 编辑后回调，title 已是用户输入的新值）
  const renameSession = useCallback((id, title) => {
    const next = String(title || '').trim();
    if (!next) return;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: next } : s));
  }, []);

  // Agent loop：tool_calls 循环执行（已抽离至 aichat/runAgentLoop.js）
  const runAgentLoop = useCallback(async ({ targetId, userMessage, controller, toolSchemas, baseMessages }) => {
    return runAgentLoopImpl({
      targetId, userMessage, controller, toolSchemas, baseMessages,
      systemPrompt, llmConfig, selectedModel,
      intelligenceContext, agent, sessions, messages,
      setSessions, setLearnedVersion, setAutoTodos, setMemoriesVersion,
      permissionMode: agentPermissionMode,
      // 技能创建成功回调：toolCreateSkill 写盘后立即刷新 skillsHook，与右侧边栏面板同步
      onSkillCreated: () => skillsHook.refresh(),
    });
  }, [llmConfig, selectedModel, systemPrompt, intelligenceContext, sessions, messages, setSessions, setLearnedVersion, setAutoTodos, setMemoriesVersion, agentPermissionMode, skillsHook]);

  const sendMessage = useCallback(async (text) => {
    const msg = text || input.trim();
    if (!msg) return;
    // 队列模式：流式生成中允许排队，不阻塞用户输入
    if (isStreaming) {
      messageQueueRef.current.push(msg);
      setQueueCount(messageQueueRef.current.length);
      setInput('');
      return;
    }
    if (!llmConfig?.baseUrl || !selectedModel) {
      onOpenLlmConfig?.();
      return;
    }

    let targetId = activeSessionId;
    if (!targetId) {
      const newSession = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: msg.slice(0, 24),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSessions(prev => [newSession, ...prev]);
      targetId = newSession.id;
      setActiveSessionId(targetId);
    }

    const userMessage = { role: 'user', content: msg };
    const assistantPlaceholder = { role: 'assistant', content: '', loading: true };

    setSessions(prev => prev.map(s => {
      if (s.id !== targetId) return s;
      const title = s.messages.length === 0 ? msg.slice(0, 24) : s.title;
      return { ...s, title, messages: [...s.messages, userMessage, assistantPlaceholder], updatedAt: Date.now() };
    }));

    // 画像学习：观测用户提问主题 + 兴趣领域 + 提问模式 + 时段 + 实体
    observeQuestion(msg);
    // 负面反馈信号识别：用户的"不对/太长/再想想"等
    observeFeedback(msg);
    setLearnedVersion(v => v + 1);
    setInput('');

    // 记录到输入历史（去重最新项，最多保留 50 条）
    const hist = inputHistoryRef.current;
    if (hist.length === 0 || hist[hist.length - 1] !== msg) {
      hist.push(msg);
      if (hist.length > 50) hist.shift();
    }
    draftRef.current = '';
    historyIndexRef.current = null;

    // 标记流式生成中：触发 send 按钮变为 stop 按钮，输入框允许继续输入排队
    setIsStreaming(true);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      activeAbortController = controller; // 模块级引用，组件 unmount 后仍可 abort

      // Agent 模式：当前智能体配置了 tools 时走 agent loop（非流式 + tool_calls 循环）
      let toolSchemas = agent?.tools?.length ? selectToolSchemas(agent.tools) : [];
      // 联网搜索总开关：关闭时从工具列表中过滤掉 web_search，LLM 看不到就不会调用，避免消耗额度
      if (llmConfig?.webSearchEnabled === false) {
        toolSchemas = toolSchemas.filter(s => s?.function?.name !== 'web_search');
      }
      // plan 模式：仅生成计划与思路，不实际调用任何工具
      // 通过清空 toolSchemas 强制走流式回复，并在 systemPrompt 后追加计划模式约束
      const planMode = agentPermissionMode === 'plan';
      const finalSystemPrompt = planMode && toolSchemas.length > 0
        ? `${systemPrompt}\n\n【当前为计划模式】请仅输出详细执行计划与思路，不要尝试调用任何工具。分步骤说明你将如何完成用户请求，包括需要哪些工具/数据/步骤，以及预期产出。`
        : systemPrompt;
      if (planMode) toolSchemas = [];
      if (toolSchemas.length > 0) {
        await runAgentLoop({
          targetId,
          userMessage,
          controller,
          toolSchemas,
          baseMessages: [...messages, userMessage],
        });
        return;
      }

      const response = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
          model: selectedModel,
          action: 'chat',
          systemPrompt: finalSystemPrompt,
          messages: [...messages, userMessage].slice(-20).map(m => ({ role: m.role, content: m.content })),
          max_tokens: 4000,
          stream: true,
        }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(typeof errData.error === 'string' ? errData.error : errData.error?.message || `AI 请求失败 (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let rawContent = '';
      let streamError = null;

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
          if (payload === '[DONE]') { buffer = ''; continue; }
          try {
            const json = JSON.parse(payload);
            if (json.ok === false) { streamError = json.error || 'AI 请求失败'; break; }
            if (json.delta) {
              rawContent += json.delta;
              // 逐字更新最后一条 assistant 消息
              setSessions(prev => prev.map(s => {
                if (s.id !== targetId) return s;
                const msgs = [...s.messages];
                msgs[msgs.length - 1] = { role: 'assistant', content: rawContent, loading: false };
                return { ...s, messages: msgs };
              }));
            }
          } catch { /* 跳过不完整行 */ }
        }
        if (streamError) break;
      }

      if (streamError) throw new Error(streamError);
      if (!rawContent) rawContent = '未能获取回复内容。';

      // 引用校验
      const allowedCitationIds = new Set((intelligenceContext?.items || []).map(item => String(item.id)));
      const citedIds = [...rawContent.matchAll(/\[资讯:([^\]]+)\]/g)].map(match => match[1].trim());
      const invalidIds = [...new Set(citedIds.filter(id => !allowedCitationIds.has(id)))];
      const finalContent = invalidIds.length
        ? `${rawContent}\n\n> 引用校验失败：以下资讯 ID 不在当前证据集中：${invalidIds.join('、')}`
        : rawContent;

      setSessions(prev => prev.map(s => {
        if (s.id !== targetId) return s;
        const msgs = [...s.messages];
        msgs[msgs.length - 1] = { role: 'assistant', content: finalContent, loading: false };
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }));

      // 画像学习：观测 AI 回复格式与深度
      observeReply(finalContent);
      setLearnedVersion(v => v + 1);
      // 自动提取行动项
      const extracted = extractTodos(finalContent);
      if (extracted.length > 0) setAutoTodos(extracted);

      // 会话记忆：异步生成摘要（不阻塞对话），累积 3 轮以上才生成
      const currentSession = sessions.find(s => s.id === targetId) || { ...session, id: targetId, messages: [...messages, userMessage, { role: 'assistant', content: finalContent }] };
      const totalRounds = currentSession.messages.filter(m => m.role === 'user').length;
      if (totalRounds >= 3) {
        generateSessionSummary(currentSession, { baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, selectedModel }).then(mem => {
          if (mem) setMemoriesVersion(v => v + 1);
        });
        // 自我进化记忆闭环：流式 chat 路径也触发
        evolveMemory({
          messages: currentSession.messages,
          sessionId: targetId,
          agentId: agent?.id || 'orchestrator',
          llmConfig: { baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, selectedModel },
          totalRounds,
        }).catch(() => { /* 静默失败 */ });
      }
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      setSessions(prev => prev.map(s => {
        if (s.id !== targetId) return s;
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (aborted && last?.role === 'assistant' && last.content) {
          // 用户主动停止：保留已生成内容，标记已停止
          msgs[msgs.length - 1] = { ...last, loading: false, stopped: true };
        } else {
          msgs[msgs.length - 1] = { role: 'assistant', content: `请求失败：${err.message}`, loading: false, error: true };
        }
        return { ...s, messages: msgs };
      }));
    } finally {
      // 先捕获 abort 状态再清空 ref（避免 race）
      const wasAborted = abortControllerRef.current?.signal?.aborted || activeAbortController?.signal?.aborted || false;
      abortControllerRef.current = null;
      activeAbortController = null;
      setIsStreaming(false);
      // 消费消息队列：若用户在流式生成期间排队了下一条消息，自动发送
      // 仅当本次非用户主动停止时才消费（避免停止后还自动发下一条）
      if (!wasAborted && messageQueueRef.current.length > 0) {
        const nextMsg = messageQueueRef.current.shift();
        setQueueCount(messageQueueRef.current.length);
        // 异步触发下一条，避免在 finally 中嵌套调用
        setTimeout(() => sendMessage(nextMsg), 50);
      } else if (wasAborted) {
        // 用户主动停止：清空队列
        messageQueueRef.current = [];
        setQueueCount(0);
      }
    }
  }, [input, messages, isStreaming, llmConfig, selectedModel, systemPrompt, onOpenLlmConfig, activeSessionId, intelligenceContext, agent, runAgentLoop]);

  // 停止生成：同时取消所有未决审批，让 Agent Loop 解除阻塞
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort() || activeAbortController?.abort();
    cancelAllPending('用户停止生成');
  }, []);

  // 复制消息内容到剪贴板
  const copyMessage = useCallback(async (content, e) => {
    try {
      await navigator.clipboard.writeText(content);
      const btn = e?.currentTarget;
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      }
    } catch {}
  }, []);

  // 沙箱审批响应
  const handleRespondApproval = useCallback((id, decision) => {
    respondApproval(id, decision);
    setPendingApprovals(getPendingApprovals());
  }, []);

  // 重新生成最后一条 AI 回复：移除末尾 assistant 消息后重发上一条 user 消息
  const regenerateLast = useCallback(() => {
    if (isStreaming || !activeSessionId) return;
    const session = sessions.find(s => s.id === activeSessionId);
    if (!session || session.messages.length < 2) return;
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    // 移除末尾的 assistant 消息
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const msgs = [...s.messages];
      while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
      return { ...s, messages: msgs, updatedAt: Date.now() };
    }));
    // 用上一条 user 消息重新发送（不带 input，避免清空逻辑干扰）
    sendMessage(lastUser.content);
  }, [isStreaming, activeSessionId, sessions, sendMessage]);

  // 工作空间文件加入对话上下文
  const handleAddContextFiles = useCallback((files) => {
    setWorkspaceFiles(prev => {
      const existing = new Set(prev.map(f => f.path));
      return [...prev, ...files.filter(f => !existing.has(f.path))];
    });
  }, []);

  // Watch for pending messages from external triggers (e.g. 右栏「剖析」按钮 / 快捷入口)
  useEffect(() => {
    if (pendingMessage && !isStreaming) {
      sendMessage(pendingMessage);
      onMessageSent?.();
    }
  }, [pendingMessage, isStreaming, sendMessage, onMessageSent]);

  // 输入历史导航 hook（已抽离至 aichat/useInputHistory.js）
  // inputHistoryRef/draftRef/historyIndexRef 由 hook 内部管理，handleKeyDown 由 hook 返回
  const { inputHistoryRef, draftRef, historyIndexRef, handleKeyDown } = useInputHistory({
    inputRef, input, setInput, sendMessage,
  });

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachments(prev => [...prev, { name: file.name, type: file.type, size: file.size, dataUrl: reader.result }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const hasConfig = Boolean(llmConfig?.baseUrl && selectedModel);

  return (
    <div className={`ai-chat-panel ${variant === 'main' ? 'ai-chat-panel-main' : ''} ${variant === 'main' && sessionCollapsed ? 'session-collapsed' : ''}`}>
      {/* 左栏：会话管理（可折叠） */}
      {variant === 'main' && !sessionCollapsed && (
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onCreate={createSession}
          onSwitch={switchSession}
          onDelete={deleteSession}
          onRename={renameSession}
          onOpenNewspaper={onOpenNewspaper}
          todayBriefing={todayBriefing}
          todayLanes={todayLanes}
          selectedDate={intelligenceContext?.date}
          materials={materials}
          onAddContextFiles={handleAddContextFiles}
        />
      )}

      {/* 中栏：对话主区 */}
      <div className="chat-main-col">
      {/* Header（已抽离至 aichat/ChatHeader.jsx） */}
      <ChatHeader
        variant={variant}
        sessionCollapsed={sessionCollapsed}
        setSessionCollapsed={setSessionCollapsed}
        agent={agent}
        setShowPersonaDrawer={setShowPersonaDrawer}
        onOpenLlmConfig={onOpenLlmConfig}
      />

      {/* Messages area + 侧边节点导航 */}
      <div className="chat-messages-wrap">
      <div className="chat-messages custom-scrollbar">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-greeting">
              <span className="chat-welcome-typed">{userName}，{welcomeMsg}</span>
            </div>
            <p className="chat-welcome-meta">
              已加载 {workbenchItems?.length || 0} 条资讯 · {materialContext.total} 条素材{materialContext.hasElf ? `（AI 精灵 ${materialContext.elfCount}）` : ''} · {selectedInterests?.length || 0} 个关注领域 · {intelligenceProfile?.confidence || 0}% 置信度
            </p>
            <p className="chat-welcome-tip">万般硅川汇集于此，亦可取一瓢独饮</p>
            <div className="chat-welcome-cards">
              {quickActions.map(action => (
                <button key={action.label} className="chat-suggest-card" onClick={() => sendMessage(action.prompt)}>
                  <span className="chat-suggest-icon">{SUGGEST_ICONS[action.icon] || SUGGEST_ICONS.sparkle}</span>
                  <span className="chat-suggest-text">
                    <strong>{action.label}</strong>
                    <small>{action.desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} id={`chat-msg-${i}`} className={`chat-msg chat-msg-${msg.role}${msg.error ? ' chat-msg-error' : ''}`}>
            {/* 用户消息标识：头像 + 用户名 */}
            {msg.role === 'user' && (
              <div className="chat-role-header chat-role-user">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="chat-avatar chat-avatar-user-img" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className="chat-avatar chat-avatar-user-fallback" aria-hidden="true">
                    {(userName || '你').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="chat-role-name">{userName || '你'}</span>
              </div>
            )}
            {/* AI 头像 + 角色名 */}
            {msg.role === 'assistant' && (
              <div className="chat-avatar-wrap">
                <div className="chat-avatar chat-avatar-ai" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
                    {/* 旋转方框：几何科技感外环 */}
                    <rect x="8" y="8" width="32" height="32" rx="2" stroke="var(--accent-cyan)" strokeWidth="1.4" opacity="0.4" transform="rotate(45 24 24)"/>
                    {/* 内部菱形核心 */}
                    <path d="M24 14 L34 24 L24 34 L14 24 Z" fill="var(--accent-cyan)" opacity="0.15" stroke="var(--accent-cyan)" strokeWidth="1.3"/>
                    {/* 中心四芒星 */}
                    <path d="M24 18 L26 24 L24 30 L22 24 Z" fill="var(--accent-cyan)" opacity="0.95"/>
                    <path d="M18 24 L24 22 L30 24 L24 26 Z" fill="var(--accent-cyan)" opacity="0.7"/>
                  </svg>
                </div>
                <span className="chat-role-name">SiliconStream</span>
              </div>
            )}
            <div className={`chat-bubble ${msg.error ? 'chat-bubble-error' : ''}${msg.toolCalls?.length ? ' chat-bubble-has-tools' : ''}`}>
              {/* Agent 工具调用痕迹：agent loop 进行中与完成后均展示 */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="chat-tool-calls">
                  {msg.thinking && msg.loading && (
                    <div className="chat-tool-thinking">
                      <span className="chat-tool-thinking-dot" />
                      {msg.thinking}
                    </div>
                  )}
                  {msg.toolCalls.map((tc, idx) => (
                    <ToolCallCard key={tc.id || idx} tc={tc} />
                  ))}
                </div>
              )}
              {msg.loading ? (
                msg.toolCalls && msg.toolCalls.length > 0 ? (
                  // agent loop 进行中：展示已有内容片段（可能为空），不再显示三点动画
                  msg.content ? (
                    <div
                      className="chat-bubble-content is-streaming"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  ) : null
                ) : (
                  <div className="chat-typing"><span /><span /><span /></div>
                )
              ) : (
                <div
                  className={`chat-bubble-content${(isStreaming && i === messages.length - 1) ? ' is-streaming' : ''}${msg.stopped ? ' is-stopped' : ''}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              )}
              {msg.stopped && (
                <div className="chat-stopped-mark">已停止生成</div>
              )}
            </div>
            {msg.role === 'assistant' && !msg.loading && !msg.error && (
              <div className="chat-msg-actions">
                <button type="button" className="chat-action-btn" title="复制" onClick={e => copyMessage(msg.content, e)}>
                  <span className="icon-sm">{ICONS.copy}</span>
                  复制
                </button>
                <button type="button" className="chat-action-btn" title="存为技能（沉淀到 skills/work）" onClick={() => saveAsSkill(msg, i)}>
                  <span className="icon-sm">{ICONS.bookmark}</span>
                  存为技能
                </button>
                <button type="button" className="chat-action-btn" title="重新生成" onClick={() => regenerateLast()} disabled={isStreaming}>
                  <span className="icon-sm">{ICONS.refresh}</span>
                  重新生成
                </button>
              </div>
            )}
          </div>
        ))}
        {/* 沙箱审批卡片：当前会话有 pending 时在聊天流末尾渲染 */}
        {pendingApprovals.length > 0 && (
          <div className="approval-cards-wrap">
            {pendingApprovals.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onRespond={handleRespondApproval}
              />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 侧边节点导航：记录用户每条消息，点击跳转 */}
      {userMessageNodes.length > 0 && (
        <nav className="chat-side-rail custom-scrollbar" aria-label="对话节点导航">
          <div className="chat-side-rail-label">节点</div>
          {userMessageNodes.map((node, n) => (
            <button
              key={node.idx}
              type="button"
              className="chat-side-rail-node"
              onClick={() => jumpToMessage(node.idx)}
              title={node.content}
            >
              <span className="chat-side-rail-num">{n + 1}</span>
              <span className="chat-side-rail-text">{node.content}</span>
            </button>
          ))}
        </nav>
      )}
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((att, i) => (
            <div key={i} className="chat-attachment-chip">
              <span>{att.name}</span>
              <button onClick={() => removeAttachment(i)} title="移除">{ICONS.x}</button>
            </div>
          ))}
        </div>
      )}

      {/* Input - ChatGPT 风格大圆角容器
          上方一行：skill 按钮 + 快捷指令（分析素材库、信源对比等）
          中间：输入框
          下方一行：上下文胶囊 + 联网搜索 + 权限模式（单行并排） */}
      <div className="chat-composer">
        {/* 上方工具栏：skill 按钮 + 快捷指令 */}
        <div className="chat-composer-top">
          <div className="chat-skill-wrap">
            <button
              ref={skillBtnRef}
              type="button"
              className={`chat-skill-btn ${activeSkill ? 'active' : ''} ${showSkillMenu ? 'open' : ''}`}
              onClick={toggleSkillMenu}
              title="选择技能"
              disabled={skillsHook.loading || skillsHook.skills.length === 0}
            >
              <span className="icon-sm">{ICONS.sparkles || ICONS.star}</span>
              技能
              {activeSkill && <span className="chat-skill-badge" />}
              <span className="chat-skill-caret">{ICONS.chevronUp || '▴'}</span>
            </button>
          </div>
          {messages.length > 0 && (
            <div className="chat-quick-bar">
              {quickActions.map(action => (
                <button key={action.label} className="chat-quick-pill" onClick={() => sendMessage(action.prompt)} disabled={isStreaming} title={action.desc}>
                  <span className="chat-quick-pill-icon">{SUGGEST_ICONS[action.icon] || SUGGEST_ICONS.sparkle}</span>
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 输入框 */}
        <div className="chat-input-area">
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md" style={{ display: 'none' }} onChange={handleFileUpload} />
          <button className="chat-attach-btn" onClick={() => fileInputRef.current?.click()} title="上传附件" disabled={!hasConfig}>
            {ICONS.paperclip}
          </button>
          <textarea ref={inputRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={hasConfig ? (isStreaming ? "正在生成中，输入下一条消息自动排队…" : "给智能体发消息…  (Shift+Enter 换行)") : "请先配置大模型"} rows={1} disabled={!hasConfig} />
          {queueCount > 0 && (
            <span className="chat-queue-indicator" title={`${queueCount} 条消息排队中`}>
              <span className="icon-sm">{ICONS.history}</span>
              {queueCount}
            </span>
          )}
          {isStreaming && (
            <button className="chat-stop-btn" onClick={stopGeneration} title="停止生成" aria-label="停止生成">
              {ICONS.stopSquare}
            </button>
          )}
          <button className="chat-send-btn" onClick={() => sendMessage()} disabled={!input.trim() || !hasConfig} title={isStreaming ? '排队发送' : '发送'}>
            {ICONS.send}
          </button>
        </div>
        {/* 底部一行：上下文胶囊 + 联网搜索 + 权限模式（单行并排，溢出滚动） */}
        <div className="chat-composer-bottom">
          <div className="chat-context-group">
            {intelligenceContext?.items?.length > 0 && (
              <button type="button" className={`chat-context-pill chat-context-pill-toggle ${excludeAllEvidence ? 'excluded' : ''}`} onClick={() => setExcludeAllEvidence(v => !v)} title={excludeAllEvidence ? '已排除情报上下文，点击恢复' : '已附加情报上下文，点击排除'}>
                <span className="icon-sm">{ICONS.messageSquare}</span>
                {excludeAllEvidence ? '已排除情报' : `情报 ${intelligenceContext.items.length}`}
              </button>
            )}
            {workspaceFiles.length > 0 && (
              <div className="chat-context-pill chat-context-pill-file" title={workspaceFiles.map(f => f.name).join(', ')}>
                <span className="icon-sm">{ICONS.document}</span>
                文件 {workspaceFiles.length}
                <button type="button" className="chat-context-pill-clear" onClick={() => setWorkspaceFiles([])} title="清除">{ICONS.x}</button>
              </div>
            )}
            {materialContext.total > 0 && (
              <button type="button" className={`chat-context-pill chat-context-pill-toggle chat-context-pill-material ${excludeAllMaterials ? 'excluded' : ''} ${materialContext.hasElf ? 'has-elf' : ''}`} onClick={() => setExcludeAllMaterials(v => !v)} title={excludeAllMaterials ? '已排除素材库上下文，点击恢复' : '已附加素材库上下文，点击排除'}>
                <span className="icon-sm">{ICONS.layers}</span>
                {excludeAllMaterials ? '已排除素材' : (materialContext.hasElf ? `精灵素材 ${materialContext.elfCount}` : `素材 ${materialContext.total}`)}
              </button>
            )}
            <button
              type="button"
              className={`chat-context-pill chat-websearch-toggle ${webSearchEnabled ? 'active' : 'inactive'}`}
              onClick={toggleWebSearch}
              title={webSearchEnabled ? '联网搜索已开启，点击关闭' : '联网搜索已关闭，点击开启'}
            >
              <span className="icon-sm">{ICONS.globe || ICONS.compass}</span>
              {webSearchEnabled ? '联网' : '离线'}
            </button>
          </div>
          <div className="chat-permission-mode" role="group" aria-label="Agent 权限模式">
            {[
              { id: 'assist', label: '协助', title: '协助模式：每步工具调用前征求同意' },
              { id: 'autonomous', label: '自主', title: '自主模式：白名单工具自动执行' },
              { id: 'plan', label: '计划', title: '计划模式：仅生成思路，不调用工具' },
            ].map(m => (
              <button
                key={m.id}
                type="button"
                className={`chat-permission-pill ${agentPermissionMode === m.id ? 'active' : ''}`}
                onClick={() => setAgentPermissionMode(m.id)}
                title={m.title}
                aria-pressed={agentPermissionMode === m.id}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* P5 Skills 菜单：portal 渲染到 body，向上弹出，避免被父容器 overflow 裁剪 */}
      {showSkillMenu && skillMenuPos && createPortal(
        <div
          ref={skillMenuRef}
          className="chat-skill-menu custom-scrollbar"
          role="menu"
          style={{ position: 'fixed', left: skillMenuPos.left, bottom: skillMenuPos.bottom }}
        >
          <div className="chat-skill-menu-head">
            <span className="chat-skill-menu-title">技能库</span>
            <button
              type="button"
              className="chat-skill-menu-refresh"
              onClick={() => skillsHook.refresh()}
              title="重新扫描 skills 目录"
            >
              {ICONS.refresh || ICONS.history}
            </button>
          </div>
          {skillsHook.bySource.builtin.length > 0 && (
            <div className="chat-skill-group">
              <div className="chat-skill-group-label">
                <span className="chat-skill-group-tag chat-skill-source-builtin">内置</span>
                <span className="chat-skill-group-count">{skillsHook.bySource.builtin.length}</span>
              </div>
              {skillsHook.bySource.builtin.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`chat-skill-item ${activeSkill === s.id ? 'selected' : ''}`}
                  onClick={() => applySkill(s)}
                  title={s.description}
                >
                  <span className="chat-skill-item-title">{s.title}</span>
                  {s.description && <span className="chat-skill-item-desc">{s.description}</span>}
                  {s.triggers?.length > 0 && (
                    <span className="chat-skill-item-triggers">{s.triggers.slice(0, 3).join(' · ')}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {skillsHook.bySource.work.length > 0 && (
            <div className="chat-skill-group">
              <div className="chat-skill-group-label">
                <span className="chat-skill-group-tag chat-skill-source-work">工作沉淀</span>
                <span className="chat-skill-group-count">{skillsHook.bySource.work.length}</span>
              </div>
              {skillsHook.bySource.work.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`chat-skill-item ${activeSkill === s.id ? 'selected' : ''}`}
                  onClick={() => applySkill(s)}
                  title={s.description}
                >
                  <span className="chat-skill-item-title">{s.title}</span>
                  {s.description && <span className="chat-skill-item-desc">{s.description}</span>}
                  {s.triggers?.length > 0 && (
                    <span className="chat-skill-item-triggers">{s.triggers.slice(0, 3).join(' · ')}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {skillsHook.bySource.user.length > 0 && (
            <div className="chat-skill-group">
              <div className="chat-skill-group-label">
                <span className="chat-skill-group-tag chat-skill-source-user">用户创建</span>
                <span className="chat-skill-group-count">{skillsHook.bySource.user.length}</span>
              </div>
              {skillsHook.bySource.user.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`chat-skill-item ${activeSkill === s.id ? 'selected' : ''}`}
                  onClick={() => applySkill(s)}
                  title={s.description}
                >
                  <span className="chat-skill-item-title">{s.title}</span>
                  {s.description && <span className="chat-skill-item-desc">{s.description}</span>}
                  {s.triggers?.length > 0 && (
                    <span className="chat-skill-item-triggers">{s.triggers.slice(0, 3).join(' · ')}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {skillsHook.skills.length === 0 && !skillsHook.loading && (
            <div className="chat-skill-empty">
              暂无可用技能。在项目根 <code>skills/builtin/</code> 目录下创建 SKILL.md 即可。
            </div>
          )}
          {skillsHook.error && (
            <div className="chat-skill-error">加载失败：{skillsHook.error}</div>
          )}
        </div>,
        document.body
      )}
      </div>{/* /.chat-main-col */}

      {/* 右栏：智能管理面板 */}
      {variant === 'main' && (
        <AgentPanel
          messages={messages}
          llmConfig={llmConfig}
          selectedModel={selectedModel}
          isStreaming={isStreaming}
          intelligenceProfile={intelligenceProfile}
          relevantMemories={relevantMemories}
          recalledFiles={recalledFiles}
          onAddContextFiles={handleAddContextFiles}
          learnedPrefs={learnedPrefs}
          agent={agent}
          memoryHealth={memoryHealth}
          lastEvolvedAt={lastEvolvedAt}
          skillsHook={skillsHook}
          input={input}
        />
      )}
      <PersonaDrawer
        open={showPersonaDrawer}
        onClose={() => setShowPersonaDrawer(false)}
        agent={agent}
        onChange={handleSavePersona}
      />
    </div>
  );
}
