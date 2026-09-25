/**
 * AiChatPanel - AI 工作站三栏布局容器
 *
 * 三栏：SessionSidebar（左·会话管理）+ 对话主区（中）+ AgentPanel（右·智能管理）
 * - 撑满 feed 容器，内部 CSS grid 三栏
 * - 流式回复 / 引用校验 / 快捷指令 / 附件 / 消息操作栏
 * - 接收 pendingMessage（来自右栏「剖析」或其它入口）做深度分析
 */
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown } from '../utils/markdown.jsx';
import { stripLeadingOrdinal } from './aichat/stripLeadingOrdinal.js';
import { computePopoverPosition, toPlainRect } from '../utils/popoverPosition.js';
import SafeBoundary from './SafeBoundary.jsx';
import SessionSidebar from './SessionSidebar.jsx';
import AgentPanel from './AgentPanel.jsx';
import { retrieveRelevantMemories, rememberCompaction } from '../utils/sessionMemory.js';
import { searchFiles } from '../utils/workspaceIndex.js';
import { observeQuestion, observeReply, observeFeedback, observeSessionEnd, getLearnedPreferences } from '../utils/profileLearning.js';
import { evolveMemory, fetchPersonaSummary, fetchRelevantMemories } from '../utils/memoryEvolver.js';
import { extractTodos } from '../utils/todoExtractor.js';
import { selectToolSchemas } from '../utils/agentTools.js';
import {
  subscribePending, getPendingApprovals, respondApproval, cancelAllPending,
} from '../utils/sandbox.js';
import { PersonaDrawer } from './PersonaEditor.jsx';
import { ActivityStream, ApprovalCard, ReasoningBlock } from './aichat/ToolCards.jsx';
import AgentTeamPanel from './aichat/AgentTeamPanel.jsx';
import AgentTeamChat from './aichat/AgentTeamChat.jsx';
import {
  getActiveSpaceId, getDefaultSpaceId, deleteSpace, renameSpace, migrateSessionSpaces,
  getSpaces, subscribeSpaces, associateFiles, clearSpaceFiles, getSpace,
} from '../utils/workspaceStore.js';
import { sessionsStore, loadSessions, saveSessions } from './aichat/sessionsStore.js';
import { WELCOME_MSGS, EMPTY_MESSAGES, SUGGEST_ICONS } from './aichat/constants.jsx';
import { buildMaterialContext } from './aichat/buildMaterialContext.js';
import { buildSystemPrompt } from './aichat/buildSystemPrompt.js';
import { buildPlanSystemPrompt } from './aichat/planMode.js';
import { buildQuickActions } from './aichat/buildQuickActions.js';
import { runAgentLoop as runAgentLoopImpl } from './aichat/runAgentLoop.js';
import { useInputHistory } from './aichat/useInputHistory.js';
import { useSelfEvolution } from '../hooks/useSelfEvolution.js';
import { useSkills } from '../hooks/useSkills.js';
import { showToast } from '../utils/toast.js';
import { useProfileStore, useUiStore } from '../store';
import { ICONS } from '../constants/appConstants.jsx';
import { packConversation, estimateMessages, resolveContextBudget } from '../session/contextManager.js';
import { COMPLETION_MAX_TOKENS } from '../constants/agentLoop.js';
import { forkLinearSession } from '../session/trailStore.js';
import { useMultiAgentOrchestrator } from '../hooks/useMultiAgentOrchestrator.js';
import { recordAgentRun, depositExperience } from '../domain/agent/agentEvolution.js';
import {
  isTextLikeUpload,
  looksBinary,
  formatBytes,
  buildUserContentWithAttachments,
  toAttachmentMeta,
} from '../domain/agent/attachmentInjection.js';
import MaterialGraph from './MaterialGraph.jsx';
// spawn_subagent 工具注册（import 即注册进 toolRegistry，供 orchestrator 等白名单使用）
import '../utils/agentSubagentTool.js';
// Agent Team 工具注册（spawn_agent_team + 队友协作工具）
import '../utils/agentTeamTools.js';

import ChatHeader from './aichat/ChatHeader.jsx';

// 流式回复的上下文预算（token）。超预算时对中段做本地摘要压缩，替代 slice 硬截断。
// 轻量流式路径预算低于 agent 工具循环，且只做本地摘要（省一次 LLM 调用）。
const STREAM_CONTEXT_BUDGET = 40_000;
const STREAM_KEEP_RECENT = 15;
const STREAM_TAIL_LIMIT = 20;

// 模块级 abortController，跨组件生命周期保持
let activeAbortController = null;

export default function AiChatPanel({
  llmConfig,
  workflowOptions = [], // 无限画布工作流（当前画布 + 模板），输入框一键引用
  intelligenceProfile,
  workbenchItems,
  selectedInterests,
  categories,
  allLlmModels,
  onOpenLlmConfig,
  user,
  pendingMessage,
  onMessageSent,
  pinnedMaterialIds,
  intelligenceContext,
  onOpenNewspaper,
  todayBriefing,
  todayLanes,
  materials,
  toggleMaterial,
  addManualMaterial,
  agent,
  agents,
  onUpdateAgent,
  siliconstreamPersona,
  onUpdateSiliconstreamPersona,
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
  // ── 多会话并行流式（v15）──
  // 每个会话独立的运行状态与中断控制器：切换会话不打断后台生成，侧栏显示运行标记。
  // isStreaming 派生为「当前激活会话是否生成中」，其余会话在后台继续跑。
  const streamingSessionsRef = useRef(new Map()); // sessionId → AbortController
  const [streamingIds, setStreamingIds] = useState([]);
  // 排队管理弹层
  const [showQueueMenu, setShowQueueMenu] = useState(false);
  const [editingQueueIdx, setEditingQueueIdx] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const queueWrapRef = useRef(null);
  // v26.9e：弹层改挂 body（fixed 定位）。原先绝对定位在 .chat-composer-top 内，
  // 而该容器带 overflow-x:auto → 计算出的 overflow-y 也是 auto → 弹层整体被裁掉、点了没反应。
  const queueBtnRef = useRef(null);
  const queuePopRef = useRef(null);
  const [queuePopStyle, setQueuePopStyle] = useState(null);
  // 暴露给原 setSessions 调用点的兼容函数：写入 store + 持久化
  const setSessions = useCallback((updater) => {
    const prev = sessionsStore.state.sessions;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    sessionsStore.setState({ sessions: next });
  }, []);
  const setActiveSessionId = useCallback((id) => sessionsStore.setState({ activeSessionId: id }), []);
  const isStreaming = streamingIds.includes(activeSessionId);
  const setSessionStreaming = useCallback((id, on, controller = null) => {
    if (on) streamingSessionsRef.current.set(id, controller);
    else streamingSessionsRef.current.delete(id);
    setStreamingIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return [...next];
    });
    sessionsStore.setState({ isStreaming: streamingSessionsRef.current.size > 0 });
  }, []);

  const [workspaceVersion, setWorkspaceVersion] = useState(0); // 空间/关联文件变更版本（订阅 workspaceStore）
  useEffect(() => subscribeSpaces(() => setWorkspaceVersion(v => v + 1)), []);
  // 当前空间的关联文件 = 对话上下文里的 workspaceFiles（空间以本地文件为核心，随空间切换自动进出上下文）
  const activeSpace = useMemo(() =>
    getSpaces().find(s => s.id === getActiveSpaceId()) || null, [workspaceVersion]);
  const workspaceFiles = useMemo(() =>
    (activeSpace?.files || []).map(f => ({ name: f.name, path: f.path, content: f.content || '' })),
  [activeSpace]);
  const [memoriesVersion, setMemoriesVersion] = useState(0); // 会话记忆版本（摘要生成后刷新）
  const [learnedVersion, setLearnedVersion] = useState(0); // 学习画像版本（观测后刷新）
  const [autoTodos, setAutoTodos] = useState([]); // 对话自动提取的行动项
  // 2026-09-22：移除输入框的「情报/素材」胶囊与条目弹层（含条目排除/批量注入）——
  // 高质量资讯直接通过对话获取即可，注入链路（buildSystemPrompt 的 exclude 参数契约）保留但恒为默认值。

  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(llmConfig?.selectedModel || '');
  const [attachments, setAttachments] = useState([]);
  // 已就绪（上传成功）的附件——发送时真正随消息走的部分。
  // ⚠️ 必须在 sendMessage 声明之前初始化：它出现在 sendMessage 的 deps 数组（渲染期求值，先行会 TDZ 崩溃）。
  const readyAttachments = useMemo(
    () => attachments.filter(a => a?.status === 'ready' && a?.url),
    [attachments],
  );
  const [sessionCollapsed, setSessionCollapsed] = useState(false);
  // 中栏视图：'chat' 对话 | 'team' 执行记录（AgentTeamPanel 专有页面）
  const [centerView, setCenterView] = useState('chat');
  // 执行记录页发起 → 切到团队群聊并预填 @ 指派（任务在群里发布，不进单人对话）。
  // seq 单调递增：同文本重复点击也能再次注入，子组件按 seq 去重
  const [teamInject, setTeamInject] = useState(null);
  const teamInjectSeqRef = useRef(0);

  // 会话空间归属迁移（幂等）：老会话没有 spaceId / 指向已删空间 → 归入默认空间
  useEffect(() => {
    const migrated = migrateSessionSpaces(sessionsStore.state.sessions);
    if (migrated) sessionsStore.setState({ sessions: migrated });
  }, []);
  // 无 LLM 首屏：三级链接"为什么需要配置大模型"的内联说明展开态
  const [showWhyLlm, setShowWhyLlm] = useState(false);

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

  // 角色设定侧滑面板：从 chat-header 入口打开。
  // v26.9 身份隔离：抽屉编辑的是 SiliconStream 本体的灵魂（siliconstreamPersona），
  // 与工作站角色（agent 生态）完全解耦——切换/编辑角色不会影响这里的设定。
  const [showPersonaDrawer, setShowPersonaDrawer] = useState(false);
  const handleSavePersona = useCallback((_drawerAgentId, patch) => {
    if (!onUpdateSiliconstreamPersona) {
      console.warn('[AiChatPanel] onUpdateSiliconstreamPersona prop 未传入，无法保存 SiliconStream 灵魂设定');
      return;
    }
    onUpdateSiliconstreamPersona(patch);
  }, [onUpdateSiliconstreamPersona]);
  // PersonaDrawer 展示/编辑对象 = SiliconStream 本体
  const siliconstreamDrawerAgent = useMemo(() => ({
    id: 'siliconstream-main',
    name: 'SiliconStream',
    ...(siliconstreamPersona || {}),
  }), [siliconstreamPersona]);

  // 三栏拖拽调宽（v7）：左（会话栏）/ 右（智能管理栏）列宽，localStorage 持久化
  const WS_WIDTHS_KEY = 'aiWorkstationPanelWidths';
  const clampW = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const raw = localStorage.getItem(WS_WIDTHS_KEY);
      if (raw) {
        const p = JSON.parse(raw) || {};
        return { left: clampW(p.left, 160, 400, 200), right: clampW(p.right, 200, 480, 260) };
      }
    } catch { /* ignore */ }
    return { left: 200, right: 260 };
  });
  const panelWidthsRef = useRef(panelWidths);
  panelWidthsRef.current = panelWidths;
  const dragRef = useRef(null); // { side, startX, startW }
  const startPanelDrag = useCallback((side) => (e) => {
    e.preventDefault();
    dragRef.current = { side, startX: e.clientX, startW: panelWidthsRef.current[side] };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      if (d.side === 'left') {
        const w = clampW(d.startW + delta, 160, 400, 200);
        setPanelWidths(p => (p.left === w ? p : { ...p, left: w }));
      } else {
        const w = clampW(d.startW - delta, 200, 480, 260);
        setPanelWidths(p => (p.right === w ? p : { ...p, right: w }));
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(WS_WIDTHS_KEY, JSON.stringify(panelWidthsRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

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

  // 消息队列（v15）：按会话独立排队——流式生成中继续输入会排进「该会话」的队，
  // 流结束后自动依序发送。ref 为管道真源（异步回调可靠读取），state 仅供 UI 弹层渲染与编辑。
  const messageQueueMapRef = useRef({}); // sessionId → [msg, ...]
  const [messageQueueMap, setMessageQueueMap] = useState({});
  const syncQueueUI = useCallback(() => setMessageQueueMap({ ...messageQueueMapRef.current }), []);
  // 队列元素：字符串（纯文本）或 { text, attachments }（带附件的排队消息，v36）
  const queueItemText = (item) => (typeof item === 'string' ? item : item?.text || '');
  const enqueueQueued = useCallback((sid, msg, atts = null) => {
    const item = atts?.length ? { text: msg, attachments: atts } : msg;
    messageQueueMapRef.current[sid] = [...(messageQueueMapRef.current[sid] || []), item];
    syncQueueUI();
  }, [syncQueueUI]);
  const shiftQueued = useCallback((sid) => {
    const q = messageQueueMapRef.current[sid] || [];
    if (!q.length) return null;
    const [first, ...rest] = q;
    messageQueueMapRef.current[sid] = rest;
    syncQueueUI();
    return first;
  }, [syncQueueUI]);
  const clearQueued = useCallback((sid) => {
    messageQueueMapRef.current[sid] = [];
    syncQueueUI();
  }, [syncQueueUI]);
  const updateQueuedAt = useCallback((sid, idx, text) => {
    const q = messageQueueMapRef.current[sid] || [];
    if (!q[idx]) return;
    messageQueueMapRef.current[sid] = q.map((m, i) => {
      if (i !== idx) return m;
      // 对象消息（带附件）：编辑只更新文本，附件原样保留
      return typeof m === 'string' ? text : { ...m, text };
    });
    syncQueueUI();
  }, [syncQueueUI]);
  const moveQueued = useCallback((sid, idx, dir) => {
    const q = messageQueueMapRef.current[sid] || [];
    const j = idx + dir;
    if (j < 0 || j >= q.length) return;
    const next = [...q];
    [next[idx], next[j]] = [next[j], next[idx]];
    messageQueueMapRef.current[sid] = next;
    syncQueueUI();
  }, [syncQueueUI]);
  const removeQueuedAt = useCallback((sid, idx) => {
    const q = messageQueueMapRef.current[sid] || [];
    messageQueueMapRef.current[sid] = q.filter((_, i) => i !== idx);
    syncQueueUI();
  }, [syncQueueUI]);
  // v26 #13：拖拽排序支持——把 from 位置的消息移动到 to 位置
  const reorderQueued = useCallback((sid, from, to) => {
    const q = messageQueueMapRef.current[sid] || [];
    if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return;
    const next = [...q];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    messageQueueMapRef.current[sid] = next;
    syncQueueUI();
  }, [syncQueueUI]);
  const activeQueue = messageQueueMap[activeSessionId] || [];
  const dragQueueIdxRef = useRef(null); // v26 #13：排队消息拖拽中的源索引（拖拽过程无需重渲染）
  const abortControllerRef = useRef(null);
  // v26.9e：队首消费函数（在 sendMessage 之后赋值）。用 ref 打断「sendMessage ←→ drainQueue」的循环依赖。
  const drainQueueRef = useRef(null);

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

  // 素材库上下文（知识库联动）：按当前输入检索最相关素材，而非固定注入 top 6。
  // 输入为空时回退最近一条用户消息作查询；都空则走通用默认。
  // pinnedIds：素材「发送到工作站」时登记的置顶 ID——强制入选且排最前（结构化引用）。
  const materialContext = useMemo(() => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const query = (input || lastUser || '').slice(0, 120);
    return buildMaterialContext(materials, { query, limit: 12, pinnedIds: pinnedMaterialIds });
  }, [materials, input, messages, pinnedMaterialIds]);

  // 工作空间召回：异步检索相关文件（IndexedDB），debounce 避免频繁查询
  const [recalledFiles, setRecalledFiles] = useState([]);

  // 用户性格画像：Phase 3 Task B7 改读 profileStore（跨会话持久化）
  // 服务端 persona_summary 仍由 fetchPersonaSummary 拉取并写入 store
  const personaSummary = useProfileStore(s => s.personaSummary);
  const setPersonaSummary = useProfileStore(s => s.setPersonaSummary);

  // Agent 权限模式（v6：manual 手动 / semi 半自动 / auto 全自动，会话级非持久化）
  const agentPermissionMode = useUiStore(s => s.agentPermissionMode);
  const setAgentPermissionMode = useUiStore(s => s.setAgentPermissionMode);
  // 旧值归一化：v5 的 assist/autonomous/plan → manual/semi/semi
  useEffect(() => {
    if (agentPermissionMode === 'assist') setAgentPermissionMode('manual');
    else if (agentPermissionMode === 'autonomous' || agentPermissionMode === 'plan') setAgentPermissionMode('semi');
  }, [agentPermissionMode, setAgentPermissionMode]);

  // 权限模式选择弹层（输入框内左下角按钮）
  const PERMISSION_MODES = [
    { id: 'manual', label: '手动', desc: '每个工具调用都先征求我的同意', hue: 'var(--status-warn, #d29922)' },
    { id: 'semi', label: '半自动', desc: '仅危险操作（写文件/删文件/执行命令等）需要审批', hue: 'var(--accent-cyan)' },
    { id: 'auto', label: '全自动', desc: '不需要任何审批，智能体全托管执行', hue: 'var(--status-ok, #3fb950)' },
  ];
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeWrapRef = useRef(null);
  useEffect(() => {
    if (!showModeMenu) return;
    const onDown = (e) => {
      if (modeWrapRef.current && !modeWrapRef.current.contains(e.target)) setShowModeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showModeMenu]);
  const currentModeMeta = PERMISSION_MODES.find(m => m.id === agentPermissionMode) || PERMISSION_MODES[1];

  // 上下文深度模式（对齐 WorkBuddy fragments 语义）：deep 全量注入；quick 快问快答——
  // 砍掉证据目录/素材目录/历史记忆等重上下文，身份锚定与安全段无条件保留
  const [chatDepthMode, setChatDepthMode] = useState('deep');

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

  // 知识图谱 overlay：AI 工作站顶部的「知识图谱」按钮打开
  const [showGraph, setShowGraph] = useState(false);
  const [graphSelected, setGraphSelected] = useState(null); // 图谱中选中的素材

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

  // ===== 输入框模型胶囊：显示当前大模型 + 点击切换 =====
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelMenuPos, setModelMenuPos] = useState(null);
  const modelBtnRef = useRef(null);
  // 工作流选择弹层（无限画布）：状态 + 外点关闭锚点
  const [showWfMenu, setShowWfMenu] = useState(false);
  const wfWrapRef = useRef(null);
  const modelMenuRef = useRef(null);

  const toggleModelMenu = useCallback(() => {
    setShowModelMenu(prev => {
      if (prev) return false;
      if (modelBtnRef.current) {
        const rect = modelBtnRef.current.getBoundingClientRect();
        setModelMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (!showModelMenu) return;
    const onDown = (e) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target) &&
          modelBtnRef.current && !modelBtnRef.current.contains(e.target)) {
        setShowModelMenu(false);
      }
    };
    const update = () => {
      if (!modelBtnRef.current) return;
      const rect = modelBtnRef.current.getBoundingClientRect();
      setModelMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showModelMenu]);

  // 工作流选择弹层：外点关闭（v13 无限画布）
  useEffect(() => {
    if (!showWfMenu) return undefined;
    const onWfDown = (e) => {
      if (!wfWrapRef.current?.contains(e.target)) setShowWfMenu(false);
    };
    document.addEventListener('mousedown', onWfDown);
    return () => document.removeEventListener('mousedown', onWfDown);
  }, [showWfMenu]);

  // 排队管理弹层：外点关闭
  // 注意：弹层已 portal 到 body，不在 queueWrapRef 子树内，必须单独判断，
  // 否则在弹层里点「编辑/删除/拖拽」会被当成外点、瞬间关闭。
  useEffect(() => {
    if (!showQueueMenu) return undefined;
    const onQueueDown = (e) => {
      if (queueWrapRef.current?.contains(e.target)) return;
      if (queuePopRef.current?.contains(e.target)) return;
      setShowQueueMenu(false);
      setEditingQueueIdx(null);
    };
    document.addEventListener('mousedown', onQueueDown);
    return () => document.removeEventListener('mousedown', onQueueDown);
  }, [showQueueMenu]);

  // v26.9e：排队弹层定位（portal + fixed）。两趟测量——先量尺寸再定位，
  // 避免弹层高度（条目数/换行）变化后停留在错误位置。
  const placeQueuePop = useCallback(() => {
    const anchor = toPlainRect(queueBtnRef.current);
    if (!anchor) return;
    const rect = queuePopRef.current?.getBoundingClientRect();
    const size = rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
    const { left, top } = computePopoverPosition(anchor, size, { width: window.innerWidth, height: window.innerHeight });
    setQueuePopStyle(prev => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, []);

  useLayoutEffect(() => {
    if (!showQueueMenu) { setQueuePopStyle(null); return undefined; }
    placeQueuePop();
    const raf = requestAnimationFrame(placeQueuePop);
    window.addEventListener('resize', placeQueuePop);
    window.addEventListener('scroll', placeQueuePop, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', placeQueuePop);
      window.removeEventListener('scroll', placeQueuePop, true);
    };
  }, [showQueueMenu, placeQueuePop]);

  const pickModel = useCallback((modelId) => {
    setLlmConfig?.(prev => ({ ...(prev || {}), selectedModel: modelId }));
    setShowModelMenu(false);
    showToast(`已切换模型：${modelId}`);
  }, [setLlmConfig]);

  // 模型去重合并：allLlmModels（拉取 + 手动）+ 当前选中兜底
  const composerModels = useMemo(() => {
    const seen = new Set();
    const list = [];
    const push = (id, name) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      list.push({ id, name: name || id });
    };
    (Array.isArray(allLlmModels) ? allLlmModels : []).forEach(m => push(m?.id || m, m?.name));
    if (selectedModel) push(selectedModel, selectedModel);
    return list;
  }, [allLlmModels, selectedModel]);

  // ===== 上下文窗口进度环：定义见 systemPrompt 之后的 ctxUsage（TDZ 约束） =====

  // ===== 快捷指令收纳：单按钮弹层（情境指令 + 用户自定义），替代原横向 pill 行 =====
  const QUICK_CMD_KEY = 'aiWorkstationQuickCommands';
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [quickMenuPos, setQuickMenuPos] = useState(null);
  const [showQuickForm, setShowQuickForm] = useState(false);
  const [quickForm, setQuickForm] = useState({ label: '', prompt: '' });
  const [customQuickCommands, setCustomQuickCommands] = useState(() => {
    try {
      const raw = localStorage.getItem(QUICK_CMD_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(c => c?.id && c?.label && c?.prompt) : [];
    } catch { return []; }
  });
  const quickBtnRef = useRef(null);
  const quickMenuRef = useRef(null);

  const persistQuickCommands = useCallback((next) => {
    setCustomQuickCommands(next);
    try { localStorage.setItem(QUICK_CMD_KEY, JSON.stringify(next)); } catch { /* quota 忽略 */ }
  }, []);

  const addQuickCommand = useCallback(() => {
    const label = quickForm.label.trim().slice(0, 16);
    const prompt = quickForm.prompt.trim().slice(0, 2000);
    if (!label || !prompt) return;
    persistQuickCommands([...customQuickCommands, { id: `qc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, label, prompt }]);
    setQuickForm({ label: '', prompt: '' });
    setShowQuickForm(false);
  }, [quickForm, customQuickCommands, persistQuickCommands]);

  const removeQuickCommand = useCallback((id) => {
    persistQuickCommands(customQuickCommands.filter(c => c.id !== id));
  }, [customQuickCommands, persistQuickCommands]);

  const toggleQuickMenu = useCallback(() => {
    setShowQuickMenu(prev => {
      if (prev) { setShowQuickForm(false); return false; }
      if (quickBtnRef.current) {
        const rect = quickBtnRef.current.getBoundingClientRect();
        setQuickMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
      }
      return true;
    });
  }, []);

  // 点击外部 / 滚动时关闭与重定位（与 skill 菜单同款交互）
  useEffect(() => {
    if (!showQuickMenu) return;
    const onDown = (e) => {
      if (quickMenuRef.current && !quickMenuRef.current.contains(e.target) &&
          quickBtnRef.current && !quickBtnRef.current.contains(e.target)) {
        setShowQuickMenu(false); setShowQuickForm(false);
      }
    };
    const update = () => {
      if (!quickBtnRef.current) return;
      const rect = quickBtnRef.current.getBoundingClientRect();
      setQuickMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showQuickMenu]);

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

  // 存为素材：把当前 assistant 回复保存到素材库（materials），供后续创作引用
  const saveAsMaterial = useCallback(async (msg, idx) => {
    if (!msg?.content) {
      showToast('回复内容为空，无法保存');
      return;
    }
    const firstLine = String(msg.content)
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)[0] || 'AI 对话分析';
    const cleanTitle = firstLine
      .replace(/^#+\s*/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/[`*_~]/g, '')
      .slice(0, 60);

    const prevUserMsg = messages.slice(0, idx).reverse().find(m => m.role === 'user');
    const tools = Array.isArray(msg.toolCalls)
      ? msg.toolCalls.map(tc => tc?.name || tc?.toolName).filter(Boolean)
      : [];

    const materialItem = {
      id: `ai-${Date.now()}`,
      title: cleanTitle,
      summary: prevUserMsg?.content?.slice(0, 200) || cleanTitle,
      content: msg.content,
      source: 'AI 对话',
      category: agent?.category || 'ai-analysis',
      tags: ['AI分析', agent?.name || '智能体', ...new Set(tools)],
      url: '',
      imageUrl: '',
      type: tools.length > 0 ? 'case' : 'viewpoint',
      insight: msg.content.slice(0, 300),
      metadata: {
        agentId: agent?.id,
        agentName: agent?.name,
        userQuery: prevUserMsg?.content || '',
        toolCalls: tools,
        messageIndex: idx,
      },
      publishedAt: new Date().toISOString(),
    };

    try {
      if (toggleMaterial) {
        toggleMaterial(materialItem, materialItem.type, '来自 AI 工作站的分析回复');
      } else {
        showToast('已保存为素材（请刷新页面查看）');
      }
    } catch (err) {
      showToast(`保存失败：${err?.message || '未知错误'}`);
    }
  }, [messages, toggleMaterial, agent]);
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

  // v33：流式跟随——消息原地增长时（条数不变）也要持续滚动到底，
  // 否则增量内容全部在视口外，观感就是"卡住不动，等完才出全文"
  const lastMessage = messages[messages.length - 1];
  const lastContentLen = isStreaming && lastMessage?.role === 'assistant' ? String(lastMessage.content || '').length : 0;
  useEffect(() => {
    if (lastContentLen > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [lastContentLen]);

  // sessions 持久化由 sessionsStore.setState 自动处理（流式过程中持续写回）

  // Build system prompt：已抽离至 aichat/buildSystemPrompt.js
  // 2026-09-22：条目排除 UI 移除后不再传 exclude 参数（buildSystemPrompt 侧参数保留默认 false，契约兼容）
  const systemPrompt = useMemo(() => buildSystemPrompt({
    selectedInterests, categories, intelligenceProfile, workbenchItems, intelligenceContext,
    workspaceFiles, relevantMemories, agentMemories, recalledFiles, learnedPrefs,
    materialContext, agent,
    siliconstreamPersona, personaSummary,
    mode: chatDepthMode,
  }), [selectedInterests, categories, intelligenceProfile, workbenchItems?.length, intelligenceContext, workspaceFiles, relevantMemories, agentMemories, recalledFiles, learnedPrefs, materialContext, agent, siliconstreamPersona, personaSummary, chatDepthMode]);

  // ===== 上下文窗口进度环：与发送链路同源的估算器（systemPrompt + 历史 + 输入草稿） =====
  // 注意：必须在 systemPrompt 定义之后（TDZ）；分母 = 流式回复的真实压缩预算
  // STREAM_CONTEXT_BUDGET（循环超过它就会触发摘要压缩，所以这是"生效的上下文窗口"）
  const ctxUsage = useMemo(() => {
    const pending = input.trim() ? [{ role: 'user', content: input }] : [];
    const tokens = estimateMessages([
      { role: 'system', content: systemPrompt || '' },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
      ...pending,
    ]);
    const pct = Math.min(100, Math.round((tokens / STREAM_CONTEXT_BUDGET) * 1000) / 10);
    return { tokens, budget: STREAM_CONTEXT_BUDGET, pct };
  }, [messages, systemPrompt, input]);

  // 情境化快捷建议：已抽离至 aichat/buildQuickActions.js
  const quickActions = useMemo(() => buildQuickActions(intelligenceContext, workbenchItems, materialContext), [intelligenceContext, workbenchItems, materialContext]);

  // 多视角协作（AI 工作站多智能体编排）：一次任务多 agent 接力产出再综合
  const multiAgent = useMultiAgentOrchestrator({ agents, llmConfig, enabled: !!agents?.length });

  // 触发多视角协作：向会话写入用户任务 → 跑编排器 → 把各视角 + 综合报告写回会话
  const handleOrchestrate = useCallback(async (prompt) => {
    if (!prompt || !activeSessionId || isStreaming) return;
    // 1) 写入用户消息占位
    const userMsg = { role: 'user', content: prompt };
    const placeholder = { role: 'assistant', content: '', loading: true };
    setSessions(prev => prev.map(s => s.id === activeSessionId
      ? { ...s, messages: [...s.messages, userMsg, placeholder], updatedAt: Date.now() }
      : s));
    setActiveSessionId(activeSessionId);
    const controller = new AbortController();
    setSessionStreaming(activeSessionId, true, controller);

    // v26.9e 修复：原实现没有 try/finally —— 一旦 multiAgent.run 抛出，
    // setSessionStreaming(activeSessionId, false) 永远不会执行，该会话会**永久停在「生成中」**：
    // 停止按钮常亮、后续每条消息都被判定为「正在运行」而进队、而队列又永远没人消费。
    try {
      // 2) 跑编排器（v30：视角/合成产出实时直播进 placeholder 消息，流式可见；stop 按钮经 signal 真取消）
      let live = '';
      const flushLive = () => {
        setSessions(prev => prev.map(s => {
          if (s.id !== activeSessionId) return s;
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant' && last.loading) msgs[msgs.length - 1] = { ...last, content: live };
          return { ...s, messages: msgs, updatedAt: Date.now() };
        }));
      };
      const { ok, views, synthesis, error } = await multiAgent.run(prompt, {
        onViewDelta: (event) => {
          if (event.type === 'view-start') { live += `\n\n### ${event.seq} · ${event.label}\n`; flushLive(); }
          else if (event.type === 'view-delta') { live += event.delta || ''; flushLive(); }
          else if (event.type === 'view-error') { live += `\n> ${event.label} 视角执行失败：${event.error || '未知错误'}\n`; flushLive(); }
          else if (event.type === 'synthesis-start') { live += `\n\n## 综合判断\n\n`; flushLive(); }
          else if (event.type === 'synthesis-delta') { live += event.delta || ''; flushLive(); }
        },
      });

      // 3) 拼总报告：各视角 + 综合（综合在前，视角折叠其后）
      const viewsText = (views || []).length
        ? views.map((v, i) => `### ${i + 1} · ${v.viewLabel}\n${v.output}`).join('\n\n---\n\n')
        : '';
      const synthesisText = synthesis ? `## 综合判断\n\n${synthesis}\n` : '';
      const body = [synthesisText, viewsText ? `## ${(views || []).length} 个视角\n\n${viewsText}` : '', error ? `\n> 部分视角执行失败：${error}` : ''].filter(Boolean).join('\n\n') || '（无输出）';

      // 4) 写回会话
      setSessions(prev => prev.map(s => {
        if (s.id !== activeSessionId) return s;
        const msgs = [...s.messages];
        msgs[msgs.length - 1] = { role: 'assistant', content: body, loading: false };
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }));
      // 中止时把占位标记为已停止，避免 loading 卡死
      const aborted = controller.signal.aborted;
      setSessions(prev => prev.map(s => {
        if (s.id !== activeSessionId) return s;
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (aborted && last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, loading: false, stopped: true };
        return { ...s, messages: msgs };
      }));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setSessions(prev => prev.map(s => {
          if (s.id !== activeSessionId) return s;
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: `多视角协作失败：${err?.message || err}`, loading: false, error: true };
          return { ...s, messages: msgs };
        }));
      }
    } finally {
      setSessionStreaming(activeSessionId, false);
      if (controller.signal.aborted) clearQueued(activeSessionId);
      else drainQueueRef.current?.(activeSessionId);
    }
  }, [activeSessionId, isStreaming, setSessions, setSessionStreaming, multiAgent.run, clearQueued]);

  // 用户消息节点列表（用于侧边导航跳转）
  const userMessageNodes = useMemo(() => messages
    .map((m, i) => m.role === 'user' ? { idx: i, content: m.content } : null)
    .filter(Boolean), [messages]);
  const jumpToMessage = useCallback((idx) => {
    const el = document.getElementById(`chat-msg-${idx}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  /* ===== 节点导航（点状）：hover 变亮放大 + 悬浮 tip 显示消息内容，点击跳转 ===== */
  const [activeRailNode, setActiveRailNode] = useState(null);
  const [railTip, setRailTip] = useState(null); // { n, content, left, bottom }
  const railNodeRefs = useRef(new Map()); // idx → button element（tip 定位锚点）

  const showRailTip = useCallback((idx, n, content) => {
    const el = railNodeRefs.current.get(idx);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setRailTip({
      n,
      content: String(content || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      left: rect.left - 10,
      bottom: Math.min(window.innerHeight - rect.top, window.innerHeight - 130),
    });
  }, []);

  const createSession = useCallback(() => {
    const newSession = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: getActiveSpaceId(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setCenterView('chat');
  }, []);

  // 置顶/移动空间（SessionSidebar 多空间管理回调）
  const togglePin = useCallback((id) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s));
  }, []);

  // 删除空间：空间本身删除 + 其下会话迁回默认空间
  const handleDeleteSpace = useCallback((spaceId) => {
    if (!deleteSpace(spaceId)) return;
    const fallback = getDefaultSpaceId();
    setSessions(prev => prev.map(s => s.spaceId === spaceId ? { ...s, spaceId: fallback } : s));
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
    setCenterView('chat');
  }, []);

  // 重命名会话（由 SessionSidebar inline 编辑后回调，title 已是用户输入的新值）
  const renameSession = useCallback((id, title) => {
    const next = String(title || '').trim();
    if (!next) return;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: next } : s));
  }, []);

  // Agent loop：tool_calls 循环执行（已抽离至 aichat/runAgentLoop.js）
  const runAgentLoop = useCallback(async ({ targetId, userMessage, controller, toolSchemas, baseMessages, permissionMode, systemPromptOverride }) => {
    return runAgentLoopImpl({
      targetId, userMessage, controller, toolSchemas, baseMessages,
      systemPrompt: systemPromptOverride || systemPrompt, llmConfig, selectedModel,
      intelligenceContext, agent, sessions, messages,
      setSessions, setLearnedVersion, setAutoTodos, setMemoriesVersion,
      permissionMode: permissionMode || agentPermissionMode,
      // 技能创建成功回调：toolCreateSkill 写盘后立即刷新 skillsHook，与右侧边栏面板同步
      onSkillCreated: () => skillsHook.refresh(),
      // 知识沉淀回调：save_knowledge 工具把分析结论沉淀为素材，走 toggleMaterial 落库
      onSaveKnowledge: (payload) => {
        if (!payload || !toggleMaterial) return;
        toggleMaterial({
          id: `ai-knowledge-${Date.now()}`,
          title: String(payload.title || 'AI 知识沉淀').slice(0, 100),
          summary: String(payload.summary || '').slice(0, 300),
          content: String(payload.content || ''),
          source: payload.source || 'AI 智能体沉淀',
          category: payload.category || 'ai-knowledge',
          type: payload.type || 'knowledge',
          tags: [...new Set(['AI知识', agent?.name || '智能体', ...(Array.isArray(payload.tags) ? payload.tags : [])])],
          url: payload.url || '',
          insight: String(payload.insight || payload.content || '').slice(0, 300),
          metadata: payload.metadata || { origin: 'ai-agent', agentId: agent?.id },
        }, payload.type || 'knowledge', '由 AI 智能体主动沉淀的知识');
      },
    });
  }, [llmConfig, selectedModel, systemPrompt, intelligenceContext, sessions, messages, setSessions, setLearnedVersion, setAutoTodos, setMemoriesVersion, agentPermissionMode, skillsHook, toggleMaterial, agent]);

  const sendMessage = useCallback(async (text, opts = {}) => {
    const msg = text || input.trim();
    if (!msg) return;
    // 计划请求（P0-2）：只出方案不执行——清空工具强制纯文本路径，回复打 isPlan 供计划卡渲染
    const planRequest = opts?.planRequest === true;
    let targetId = opts.sessionId || activeSessionId;
    // 队列模式：该会话生成中 → 排进「该会话」的队（不阻塞其他会话并行）
    if (streamingSessionsRef.current.has(targetId)) {
      const pendingAtts = readyAttachments;
      enqueueQueued(targetId, msg, pendingAtts.length ? pendingAtts : null);
      setInput('');
      if (pendingAtts.length) setAttachments([]);
      return;
    }
    if (!llmConfig?.baseUrl || !selectedModel) {
      onOpenLlmConfig?.();
      return;
    }

    if (!targetId) {
      const newSession = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: msg.slice(0, 24),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        spaceId: getActiveSpaceId(),
      };
      setSessions(prev => [newSession, ...prev]);
      targetId = newSession.id;
      setActiveSessionId(targetId);
    }

    // 附件（v36）：上传完成的附件随消息真正发送——
    // content 注入附件说明/文本内容/URL 供 LLM 读取；attachments 元数据供气泡渲染；
    // displayContent 保留用户原文供 UI 展示（与 LLM 输入分离）。
    const sendAtts = (opts?.attachments?.length ? opts.attachments : readyAttachments)
      .filter(a => a?.status === 'ready' && a?.url);
    // v36.2 工作空间关联文件真送达：目标会话所属空间已关联的本地文件走附件同管道
    // ——内容随消息进 LLM + 气泡渲染空间文件卡。修掉旧「只进系统提示且每文件仅
    // 1200 字符」的假关联。用 getSpace 按目标会话空间即时取数（无 stale closure）；
    // 注入预算沿用附件上限（12KB/文件 · 36KB/消息），读取失败的占位内容不注入。
    const targetSpaceId = sessions.find(s => s.id === targetId)?.spaceId || getActiveSpaceId();
    const wsAtts = ((getSpace(targetSpaceId)?.files) || [])
      .filter(f => typeof f?.content === 'string' && f.content.trim() && !f.content.startsWith('读取失败:'))
      .map(f => ({
        id: `wsfile:${f.path}`,
        source: 'workspace',
        kind: 'file',
        name: f.name,
        path: f.path,
        size: f.content.length,
        textContent: f.content,
        truncated: Boolean(f.truncated),
      }));
    const allSendAtts = [...sendAtts, ...wsAtts];
    const attMeta = toAttachmentMeta(allSendAtts);
    const fullContent = attMeta.length ? buildUserContentWithAttachments(msg, allSendAtts) : msg;
    const userMessage = {
      role: 'user',
      content: fullContent,
      ...(attMeta.length ? { attachments: attMeta, displayContent: msg } : {}),
    };
    const assistantPlaceholder = { role: 'assistant', content: '', loading: true };
    // 目标会话自己的历史（并行时可能是后台会话，不能用当前激活会话的 messages）
    const targetHistory = (sessions.find(s => s.id === targetId)?.messages) || messages;

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
    if (attMeta.length) setAttachments([]); // 附件已随消息发出，清空输入区附件

    // 记录到输入历史（去重最新项，最多保留 50 条）
    const hist = inputHistoryRef.current;
    if (hist.length === 0 || hist[hist.length - 1] !== msg) {
      hist.push(msg);
      if (hist.length > 50) hist.shift();
    }
    draftRef.current = '';
    historyIndexRef.current = null;

    // 标记该会话流式生成中（send 按钮切为 stop；其他会话不受影响）
    const controller = new AbortController();
    setSessionStreaming(targetId, true, controller);

    try {

      // Agent 模式：当前智能体配置了 tools 时走 agent loop（非流式 + tool_calls 循环）
      let toolSchemas = agent?.tools?.length ? selectToolSchemas(agent.tools) : [];
      // 联网搜索总开关：关闭时从工具列表中过滤掉 web_search，LLM 看不到就不会调用，避免消耗额度
      if (llmConfig?.webSearchEnabled === false) {
        toolSchemas = toolSchemas.filter(s => s?.function?.name !== 'web_search');
      }
      // 计划请求：清空工具强制走纯文本路径（只出方案不执行；批准后由 executeApprovedPlan 全量工具执行）
      if (planRequest) toolSchemas = [];
      if (toolSchemas.length > 0) {
        await runAgentLoop({
          targetId,
          userMessage,
          controller,
          toolSchemas,
          baseMessages: [...targetHistory, userMessage],
        });
        return;
      }

      // 上下文预算检查（对标 pi/compaction）：超预算时把中段折叠为一条本地摘要，
      // 替代 slice 硬截断。本地摘要不额外调 LLM（summaryStrategy:'local'），失败自动回退。
      // 打包逻辑与 agent 工具循环、AI 精灵共用 contextManager.packConversation 一份实现。
      const fullHistory = [...targetHistory, userMessage];
      const packed = await packConversation(fullHistory, {
        // 预算随模型窗口自适应（未知模型 === 常量默认值，行为不变）
        budget: resolveContextBudget(selectedModel, STREAM_CONTEXT_BUDGET),
        keepRecent: STREAM_KEEP_RECENT,
        cutMin: 2,
        fallbackLimit: STREAM_TAIL_LIMIT,
        summaryStrategy: 'local',
      });
      const sendMessages = packed.messages;
      // 压缩是 lossy 的：沉淀为跨会话记忆，避免被压段"蒸发"（同会话去重）
      if (packed.compressed && targetId) {
        try { rememberCompaction(targetId, packed.summaryText || ''); } catch { /* silent */ }
      }

      // ── 带重试的流式 LLM 调用（仅对 429/5xx/网络瞬错重试，最多 3 次）──
      const MAX_CHAT_RETRIES = 3;
      let rawContent = '';
      let lastRetryErr = null;

      for (let attempt = 0; attempt <= MAX_CHAT_RETRIES; attempt++) {
        try {
          // 重试前清空上轮残留内容（避免重复追加）
          if (attempt > 0) rawContent = '';

          const response = await fetch('/api/ai-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
              model: selectedModel,
              action: 'chat',
              systemPrompt: planRequest ? buildPlanSystemPrompt(systemPrompt) : systemPrompt,
              messages: sendMessages.map(m => ({ role: m.role, content: m.content })),
              max_tokens: COMPLETION_MAX_TOKENS,
              stream: true,
            }),
          });
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = typeof errData.error === 'string' ? errData.error : errData.error?.message || `AI 请求失败 (${response.status})`;
            // 仅对可重试状态码重试（429 限流 / 5xx 服务端错）
            const retriable = response.status === 429 || response.status >= 500;
            if (retriable && attempt < MAX_CHAT_RETRIES) {
              lastRetryErr = new Error(errMsg);
              await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
              continue;
            }
            throw new Error(errMsg);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
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

          if (streamError) {
            // 流内错误也尝试重试（上游限流可能在流中间断开）
            if (attempt < MAX_CHAT_RETRIES && /繁忙|频繁|rate.limit|429/i.test(streamError)) {
              lastRetryErr = new Error(streamError);
              await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
              continue;
            }
            throw new Error(streamError);
          }

          // 成功完成，跳出重试循环
          lastRetryErr = null;
          break;

        } catch (err) {
          if (err?.name === 'AbortError') throw err; // 用户取消，不重试
          if (attempt < MAX_CHAT_RETRIES) {
            lastRetryErr = err;
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
            continue;
          }
          throw lastRetryErr || err;
        }
      }

      if (!rawContent) rawContent = '未能获取回复内容。';

      // 引用校验
      const allowedCitationIds = new Set((intelligenceContext?.items || []).map(item => String(item.id)));
      const citedIds = [...rawContent.matchAll(/\[资讯:([^\]]+)\]/g)].map(match => match[1].trim());
      const invalidIds = [...new Set(citedIds.filter(id => !allowedCitationIds.has(id)))];
      const finalContent = invalidIds.length
        ? `${rawContent}\n\n> 引用校验失败：以下资讯 ID 不在当前证据集中：${invalidIds.join('、')}`
        : rawContent;

      // 计划请求的回复打 isPlan 标记，前端据此渲染"批准执行/修改/放弃"操作条（P0-2 闭环）。
      // 注意：v6 权限重构曾删除 planMode 定义却遗留本处引用 → 每次纯文本回复完成即
      // ReferenceError，已流出的回复被 catch 替换成错误气泡（2026-09-11 对抗性审查修复）。
      const planFlag = planRequest ? { isPlan: true } : {};
      setSessions(prev => prev.map(s => {
        if (s.id !== targetId) return s;
        const msgs = [...s.messages];
        msgs[msgs.length - 1] = { role: 'assistant', content: finalContent, loading: false, ...planFlag };
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }));

      // 画像学习：观测 AI 回复格式与深度
      observeReply(finalContent);
      setLearnedVersion(v => v + 1);
      // v26 #13 Agent 进化：真实工作统计 + 工作经验沉淀（失败静默，不影响主流程）
      try {
        recordAgentRun(agent?.id || 'orchestrator', {});
        depositExperience(agent?.id || 'orchestrator', {
          topic: String(userMessage?.content || '').replace(/\s+/g, ' ').slice(0, 40),
          lesson: String(finalContent || '').replace(/\s+/g, ' ').slice(0, 200),
          source: 'chat',
        });
      } catch { /* 进化统计失败不影响主流程 */ }
      // 自动提取行动项
      const extracted = extractTodos(finalContent);
      if (extracted.length > 0) setAutoTodos(extracted);

      // 会话记忆：异步生成摘要（不阻塞对话），累积 3 轮以上才生成
      const currentSession = sessions.find(s => s.id === targetId) || { ...session, id: targetId, messages: [...messages, userMessage, { role: 'assistant', content: finalContent }] };
      const totalRounds = currentSession.messages.filter(m => m.role === 'user').length;
      observeSessionEnd(totalRounds);
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
      // 先捕获 abort 状态（本会话的 controller）
      const wasAborted = controller.signal.aborted;
      setSessionStreaming(targetId, false);
      // 消费该会话的消息队列：非用户主动停止时自动依序发送
      if (!wasAborted) {
        // 走 drainQueueRef（在 sendMessage 之后定义），避免 useCallback 的 TDZ/陈旧闭包
        drainQueueRef.current?.(targetId);
      } else {
        // 用户主动停止：清空该会话队列
        clearQueued(targetId);
      }
    }
  }, [input, messages, sessions, llmConfig, selectedModel, systemPrompt, onOpenLlmConfig, activeSessionId, intelligenceContext, agent, runAgentLoop, setSessionStreaming, enqueueQueued, shiftQueued, clearQueued, readyAttachments]);

  // v26.9e 队列自愈：仅在「该会话确实没有在跑」时才补发队首。
  // 加 2s 冷静期是刻意的——正常的队列消费会在 finally 里 50ms 内把 isStreaming 拉回 true，
  // 冷静期一到就被 effect cleanup 取消，因此不会和正常消费路径并发双发。
  const drainQueue = useCallback((sid) => {
    if (!sid) return;
    if (streamingSessionsRef.current.has(sid)) return;
    if (!llmConfig?.baseUrl || !selectedModel) return; // 无配置时不消费，避免消息被 shift 出来却发不出去
    const nextItem = shiftQueued(sid);
    if (!nextItem) return;
    const nextText = queueItemText(nextItem);
    const nextAtts = typeof nextItem === 'object' && nextItem?.attachments?.length ? nextItem.attachments : undefined;
    setTimeout(() => sendMessage(nextText, { sessionId: sid, attachments: nextAtts }), 50);
  }, [shiftQueued, sendMessage, llmConfig?.baseUrl, selectedModel]);
  drainQueueRef.current = drainQueue;

  useEffect(() => {
    if (isStreaming || !activeSessionId || activeQueue.length === 0) return undefined;
    const sid = activeSessionId;
    const timer = setTimeout(() => drainQueueRef.current?.(sid), 2000);
    return () => clearTimeout(timer);
  }, [isStreaming, activeSessionId, activeQueue.length]);

  // 停止生成：同时取消所有未决审批，让 Agent Loop 解除阻塞
  const stopGeneration = useCallback(() => {
    streamingSessionsRef.current.get(activeSessionId)?.abort();
    cancelAllPending('用户停止生成');
  }, [activeSessionId]);

  // ── P0-2 计划 → 执行闭环 ──
  // plan 模式下 Agent 只产出方案不执行；用户点"批准执行"后，这里真正跑一遍，
  // 并把已批准计划注入用户消息，让 Agent 直接照做、不再反复征求计划。
  // 权限语义：传入 'autonomous' 经注册表归一后实际按 semi 执行——敏感写操作
  // 仍会弹审批卡，批准"计划"不等于放权"执行"。
  // 双击防御：isStreaming 来自渲染闭包（异步置位有延迟），ref 立即生效，
  // 防止快速双击双开两个 runAgentLoop 并发写同一会话。
  const planExecutingRef = useRef(false);
  const executeApprovedPlan = useCallback(async (planText) => {
    if (isStreaming || planExecutingRef.current) return;
    if (!llmConfig?.baseUrl || !selectedModel) { onOpenLlmConfig?.(); return; }
    planExecutingRef.current = true;
    const targetId = activeSessionId;
    if (!targetId || !planText) return;
    const userMessage = {
      role: 'user',
      content: `（已批准执行计划，请严格按以下方案执行，不要重新征求计划或再次询问确认）\n${planText}`,
    };
    const assistantPlaceholder = { role: 'assistant', content: '', loading: true };
    setSessions(prev => prev.map(s => s.id === targetId
      ? { ...s, messages: [...s.messages, userMessage, assistantPlaceholder], updatedAt: Date.now() }
      : s));
    const controller = new AbortController();
    setSessionStreaming(targetId, true, controller);
    try {
      let toolSchemas = agent?.tools?.length ? selectToolSchemas(agent.tools) : [];
      if (llmConfig?.webSearchEnabled === false) {
        toolSchemas = toolSchemas.filter(s => s?.function?.name !== 'web_search');
      }
      await runAgentLoop({
        targetId, userMessage, controller, toolSchemas,
        baseMessages: [...messages, userMessage],
        permissionMode: 'autonomous',
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setSessions(prev => prev.map(s => {
          if (s.id !== targetId) return s;
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: `执行失败：${err?.message || err}`, loading: false, error: true };
          return { ...s, messages: msgs };
        }));
      }
    } finally {
      planExecutingRef.current = false;
      const wasAborted = controller.signal.aborted;
      setSessionStreaming(targetId, false);
      if (wasAborted) clearQueued(targetId);
    }
  }, [isStreaming, llmConfig, selectedModel, onOpenLlmConfig, activeSessionId, agent, messages, setSessions, runAgentLoop, setSessionStreaming, clearQueued]);

  // 计划卡交互：批准 / 修改 / 放弃
  const executePlan = useCallback((i) => {
    const session = sessions.find(s => s.id === activeSessionId);
    const plan = session?.messages?.[i]?.content;
    if (!plan) return;
    // 标记该计划消息已执行：隐藏按钮、显示"已提交"状态
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const msgs = [...s.messages];
      if (msgs[i]?.role === 'assistant') msgs[i] = { ...msgs[i], planExecuted: true };
      return { ...s, messages: msgs };
    }));
    executeApprovedPlan(plan);
  }, [sessions, activeSessionId, setSessions, executeApprovedPlan]);

  const modifyPlan = useCallback((i) => {
    // 聚焦输入框并预填修改提示，让用户在原 plan 基础上补指令（不自动重发）
    setInput(prev => (prev ? prev + '\n' : '') + '请调整上面的执行计划：');
    inputRef?.current?.focus?.();
  }, [setInput, inputRef]);

  // 右栏「工具能力」双击 → 预填该工具的调用指令到输入框并聚焦
  // 设计取舍（钢人论证）：工具需参数 + 经 LLM function calling 真正触发，
  // 故「双击调用」= 预填友好提示（而非空参直发），用户补参数回车即真正调用。
  const TOOL_INVOKE_PROMPTS = {
    search_news: '请检索科技资讯：',
    web_search: '请联网搜索：',
    fetch_page: '请抓取并总结这个网页：',
    list_mcp_tools: '请列出当前已配置的 MCP 服务器：',
    mcp_call: '请调用 MCP 工具（server / tool / args）：',
  };
  const handleInvokeTool = useCallback((name, label) => {
    const tmpl = TOOL_INVOKE_PROMPTS[name] || `请使用「${label || name}」工具执行：`;
    setInput(prev => (prev ? prev + '\n' : '') + tmpl);
    inputRef?.current?.focus?.();
  }, [setInput, inputRef]);

  const dismissPlan = useCallback((i) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const msgs = [...s.messages];
      if (msgs[i]?.role === 'assistant') msgs[i] = { ...msgs[i], planDismissed: true };
      return { ...s, messages: msgs };
    }));
  }, [activeSessionId, setSessions]);

  // 从这里分支（对标 pi /tree + fork）：在消息 i 处把当前会话 fork 出新会话并切换过去
  const forkFromMessage = useCallback((msgIndex) => {
    const session = sessions.find(s => s.id === activeSessionId);
    if (!session || isStreaming) return;
    const { messages: branchMsgs } = forkLinearSession(session, { anchorIndex: msgIndex });
    if (!branchMsgs.length) return;
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newSession = {
      id: newId,
      title: `${(session.title || '会话')} · 分支`,
      messages: branchMsgs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    if (showToast) showToast('已从该消息创建分支会话，可从此处继续');
  }, [sessions, activeSessionId, isStreaming, setSessions, setActiveSessionId]);

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
  // 关联文件到当前空间（AgentPanel 召回文件 / 外部入口统一走空间存储）
  const handleAddContextFiles = useCallback((files) => {
    if (!Array.isArray(files) || files.length === 0) return;
    const existing = new Set((activeSpace?.files || []).map(f => f.path));
    const fresh = files.filter(f => f?.path && !existing.has(f.path));
    if (fresh.length === 0) return;
    associateFiles(getActiveSpaceId(), fresh);
  }, [activeSpace]);

  // Watch for pending messages from external triggers (e.g. 右栏「剖析」按钮 / 快捷入口)
  // v26.9e：sendMessage 的依赖含 sessions/messages → 每次渲染都会换新引用，
  // 该 effect 在 pendingMessage 尚未被父级清空时会随每次渲染重跑。首次调用已把会话标记为
  // streaming（ref 同步写入），重入时就走进了「排队」分支 → 同一条消息被重复塞进队列。
  // 用「已处理负载」标记去重，父级清空 pendingMessage 时复位（同一内容可再次触发）。
  const pendingSentRef = useRef(null);
  useEffect(() => {
    if (!pendingMessage) { pendingSentRef.current = null; return; }
    if (isStreaming) return;
    if (pendingSentRef.current === pendingMessage) return;
    pendingSentRef.current = pendingMessage;
    sendMessage(pendingMessage);
    onMessageSent?.();
  }, [pendingMessage, isStreaming, sendMessage, onMessageSent]);

  // 输入历史导航 hook（已抽离至 aichat/useInputHistory.js）
  // inputHistoryRef/draftRef/historyIndexRef 由 hook 内部管理，handleKeyDown 由 hook 返回
  const { inputHistoryRef, draftRef, historyIndexRef, handleKeyDown } = useInputHistory({
    inputRef, input, setInput, sendMessage,
  });

  // ── 附件上传（v36 修复：此前附件只存本地 state，从未随消息发送）──
  // 流程：选择文件 → 立即 POST /api/community/uploads（multipart，登录态）→ chip 展示状态
  // → 发送时已就绪的附件随 userMessage 走（url 元数据 + 文本内容注入 LLM 输入，见 attachmentInjection.js）。
  // dataUrl 仅用于 chip/预览的本地展示，绝不进消息（防 localStorage 持久化膨胀）。
  const [imgPreview, setImgPreview] = useState(null); // { url, name, anchor: DOMRect } — 图片悬停预览小窗

  const patchAttachment = useCallback((key, patch) => {
    setAttachments(prev => prev.map(a => (a.key === key ? { ...a, ...patch } : a)));
  }, []);

  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });

  // 前端预检（与服务端 UPLOAD_LIMITS 同口径）：图 5MB / 视频 25MB / 其他 10MB
  const uploadSizeLimit = (mime) => {
    if (String(mime).startsWith('image/')) return 5 * 1024 * 1024;
    if (String(mime).startsWith('video/')) return 25 * 1024 * 1024;
    return 10 * 1024 * 1024;
  };

  const handleFileUpload = useCallback(async (e) => {
    const picked = [...(e.target.files || [])].slice(0, 4);
    e.target.value = '';
    if (!picked.length) return;
    // 注：不做前置 user 检查——user prop 异步 hydrate 的时序不可靠；
    // 未登录时上传请求自然收到 401，chip 标「失败」并提示，行为一致。
    for (const file of picked) {
      const mime = file.type || '';
      if (file.size > uploadSizeLimit(mime)) {
        showToast(`「${file.name}」超过大小限制（${formatBytes(uploadSizeLimit(mime))}）`);
        continue;
      }
      const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const att = {
        key,
        name: file.name,
        mime,
        size: file.size,
        kind: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file',
        status: 'uploading',
        localUrl: '',
        textContent: '',
      };
      try {
        // 图片：本地 dataUrl 供 chip 缩略图即时展示；文本类：读出内容供注入（二进制嗅探拦截）
        if (att.kind === 'image') {
          att.localUrl = await readAsDataUrl(file);
        } else if (isTextLikeUpload(file.name, mime) && file.size <= 2 * 1024 * 1024) {
          const text = await file.text();
          if (!looksBinary(text)) att.textContent = text;
        }
      } catch { /* 预读失败不阻断上传 */ }
      setAttachments(prev => [...prev, att]);
      try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const res = await fetch('/api/community/uploads', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        // 服务端错误响应的 error 可能是字符串或 { code, message } 对象——统一提取，避免 "[object Object]"
        const rawErr = data?.error;
        const errMsg = typeof rawErr === 'string' ? rawErr : rawErr?.message || `上传失败（${res.status}）`;
        if (!res.ok || data?.ok === false) throw new Error(errMsg);
        const up = data?.data?.uploads?.[0];
        if (!up?.url) throw new Error('上传响应缺少文件地址');
        patchAttachment(key, {
          status: 'ready',
          id: up.id,
          url: up.url,
          kind: up.kind || att.kind,
          mime: up.mime || att.mime,
          size: up.size ?? att.size,
        });
      } catch (err) {
        patchAttachment(key, { status: 'error', errorMsg: String(err?.message || err).slice(0, 100) });
        showToast(`「${file.name}」上传失败：${String(err?.message || err).slice(0, 60)}`);
      }
    }
  }, [patchAttachment]);

  const removeAttachment = useCallback((idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const hasConfig = Boolean(llmConfig?.baseUrl && selectedModel);

  // 计划模式触发（P0-2）：把输入框内容作为计划请求发送——智能体先出方案，
  // 用户在计划卡上「批准执行」后才由 executeApprovedPlan 全量工具执行。
  // 注意：必须定义在 hasConfig 声明之后（deps 数组渲染期求值，先行会 TDZ 崩溃）。
  const handlePlanRequest = useCallback(() => {
    setShowModeMenu(false); // 与权限胶囊同容器（外点检测不覆盖），手动收起
    if (!hasConfig) { onOpenLlmConfig?.(); return; } // 与 sendMessage 同口径：未配置不清空输入
    const text = input.trim();
    if (!text) { inputRef?.current?.focus?.(); return; }
    setInput('');
    sendMessage(`请为以下请求制定执行计划：\n${text}`, { planRequest: true });
  }, [hasConfig, onOpenLlmConfig, input, sendMessage, setInput, inputRef]);

  return (
    <div
      className={`ai-chat-panel ${variant === 'main' ? 'ai-chat-panel-main' : ''} ${variant === 'main' && sessionCollapsed ? 'session-collapsed' : ''}`}
      style={variant === 'main' ? { '--ws-left-w': `${panelWidths.left}px`, '--ws-right-w': `${panelWidths.right}px` } : undefined}
    >
      {/* 左栏：会话管理（可折叠） */}
      {variant === 'main' && !sessionCollapsed && (
        <SessionSidebar
          sessions={sessions}
          streamingIds={streamingIds}
          activeSessionId={activeSessionId}
          onCreate={createSession}
          onSwitch={switchSession}
          onDelete={deleteSession}
          onRename={renameSession}
          onTogglePin={togglePin}
          onRenameSpace={renameSpace}
          onDeleteSpace={handleDeleteSpace}
          onOpenTeamCenter={() => setCenterView('team')}
          onOpenRecords={() => setCenterView('teamRecords')}
          onOpenNewspaper={onOpenNewspaper}
          todayBriefing={todayBriefing}
          todayLanes={todayLanes}
          selectedDate={intelligenceContext?.date}
          materials={materials}
          onAddContextFiles={handleAddContextFiles}
        />
      )}

      {/* 中栏：对话主区 / 团队群聊 / 执行记录（看板） */}
      {centerView === 'team' ? (
        <div className="chat-main-col team-center-col">
          <div className="team-center-topbar">
            <button type="button" className="team-center-back" onClick={() => setCenterView('chat')}>
              ← 返回对话
            </button>
            <span className="team-center-crumb">AI 工作站 / 团队</span>
          </div>
            <div className="team-center-scroll custom-scrollbar">
              {/* v24 #3：SafeBoundary 兜底——存量群聊数据异常时只降级本区，不炸整个工作站 */}
              <SafeBoundary name="团队群聊">
                <AgentTeamChat
                  runtime={{
                    llmConfig,
                    selectedModel,
                    approvalMode: agentPermissionMode,
                  }}
                  onSaveMaterial={addManualMaterial}
                  onViewRecords={() => setCenterView('teamRecords')}
                  onNeedConfig={onOpenLlmConfig}
                  injection={teamInject}
                  onInjectConsumed={() => setTeamInject(null)}
                />
              </SafeBoundary>
            </div>
        </div>
      ) : centerView === 'teamRecords' ? (
        <div className="chat-main-col team-center-col">
          <div className="team-center-topbar">
            <button type="button" className="team-center-back" onClick={() => setCenterView('team')}>
              ← 返回群聊
            </button>
            <span className="team-center-crumb">AI 工作站 / 团队 / 执行记录</span>
          </div>
          <div className="team-center-scroll custom-scrollbar">
            <AgentTeamPanel
              onLaunch={(text) => {
                teamInjectSeqRef.current += 1;
                setTeamInject({ text, seq: teamInjectSeqRef.current });
                setCenterView('team');
              }}
            />
          </div>
        </div>
      ) : (
      <div className="chat-main-col">
      {/* Header（已抽离至 aichat/ChatHeader.jsx） */}
      <ChatHeader
        variant={variant}
        sessionCollapsed={sessionCollapsed}
        setSessionCollapsed={setSessionCollapsed}
        agent={agent}
        setShowPersonaDrawer={setShowPersonaDrawer}
        onOpenLlmConfig={onOpenLlmConfig}
        onOpenGraph={() => setShowGraph(true)}
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

            {/* 无 LLM 配置：行动型空态（主 CTA 配置 / 次 CTA 算法简报 / 三级说明），取代"请先配置大模型"死胡同 */}
            {!hasConfig ? (
              <div className="chat-empty-llm app-state">
                <div className="app-state__glyph" aria-hidden="true">
                  <svg viewBox="0 0 48 48" fill="none">
                    <rect x="10" y="14" width="28" height="20" rx="5" stroke="currentColor" strokeWidth="2" opacity="0.9" />
                    <path d="M17 24h.01M24 24h.01M31 24h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    <path d="M24 14v-4M19 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
                  </svg>
                </div>
                <h3 className="app-state__title">先给智能体接上大脑</h3>
                <p className="app-state__desc">
                  配置一个大模型 API 后，AI 就能基于今日 <strong>{workbenchItems?.length || 0}</strong> 条资讯、<strong>{materialContext.total}</strong> 条素材与你的关注领域，实时生成解读、机会与创作选题。也可以先体验无需大模型的<strong>算法简报</strong>。
                </p>
                <div className="app-state__actions">
                  <button className="app-btn app-btn--primary" onClick={() => onOpenLlmConfig?.()}>
                    去配置大模型
                  </button>
                  <button className="app-btn app-btn--ghost" onClick={() => onOpenNewspaper?.()}>
                    先用算法简报试试
                  </button>
                </div>
                <button className="app-btn app-btn--link" onClick={() => setShowWhyLlm(w => !w)}>
                  {showWhyLlm ? '收起说明' : '为什么需要配置大模型？'}
                </button>
                {showWhyLlm && (
                  <p className="app-state__why">
                    大模型（LLM）是 AI 智能体"思考与表达"的引擎：它负责把资讯、素材与你的偏好综合成可读的分析与文章。未配置时，对话、多智能体协作、自动洞察等功能暂不可用。<br />
                    而<strong>算法简报</strong>由平台的推荐引擎离线生成，不依赖大模型——配置前你也能先看今日要闻与机会雷达。配置入口在「设置 → 大模型」，支持 OpenAI / Anthropic / 兼容 OpenAI 的任意服务。
                  </p>
                )}
              </div>
            ) : (
              // 快捷指令：横向轻 chip 行（WorkBuddy 风格）——描述收进 title 悬停，
              // 首屏不再被 2 列大卡片占据
              <div className="chat-welcome-chips">
                {quickActions.map(action => (
                  <button
                    key={action.label}
                    className="chat-quick-pill"
                    onClick={() => (action.orchestrate ? handleOrchestrate(action.prompt) : sendMessage(action.prompt))}
                    title={action.desc}
                  >
                    <span className="chat-quick-pill-icon">{SUGGEST_ICONS[action.icon] || SUGGEST_ICONS.sparkle}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            )}
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
              {/* v36：用户消息附件——图片缩略图（悬停预览大图）/ 文件卡片（点击下载） */}
              {msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                <div className="chat-msg-attachments">
                  {msg.attachments.map((att, ai) => (att?.kind === 'image' ? (
                    <div key={att.id || ai} className="chat-att-image-wrap">
                      <img
                        src={att.url}
                        alt={att.name || '图片附件'}
                        className="chat-att-image"
                        loading="lazy"
                        onMouseEnter={(e) => {
                          const anchor = toPlainRect(e.currentTarget);
                          const { left, top } = computePopoverPosition(
                            anchor,
                            { width: 360, height: 360 },
                            { width: window.innerWidth, height: window.innerHeight },
                            { prefer: 'down', align: 'start' },
                          );
                          setImgPreview({ url: att.url, name: att.name, left, top });
                        }}
                        onMouseLeave={() => setImgPreview(null)}
                        onClick={() => window.open(att.url, '_blank', 'noopener')}
                      />
                    </div>
                  ) : att.source === 'workspace' ? (
                    // v36.2 空间文件卡：本地文件无下载 URL，内容已随消息提供给 AI
                    <div
                      key={att.id || ai}
                      className="chat-att-file chat-att-file-ws"
                      title={`本地工作空间文件 · ${att.path || att.name}（内容已随消息提供给 AI）`}
                    >
                      <span className="icon-sm chat-att-file-icon">{ICONS.document}</span>
                      <span className="chat-att-file-name">{att.name || '附件'}</span>
                      <span className="chat-att-file-size">{formatBytes(att.size)} · 空间</span>
                    </div>
                  ) : (
                    <a
                      key={att.id || ai}
                      className="chat-att-file"
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${att.name || '附件'} · ${formatBytes(att.size)}${att.textContent ? ' · 内容已随消息提供给 AI' : ''}`}
                    >
                      <span className="icon-sm chat-att-file-icon">{ICONS.document}</span>
                      <span className="chat-att-file-name">{att.name || '附件'}</span>
                      <span className="chat-att-file-size">{att.kind === 'video' ? '视频 · ' : ''}{formatBytes(att.size)}</span>
                    </a>
                  )))}
                </div>
              )}
              {/* v35：Codex 式过程流——thinking + 工具日志行统一编排，完成后折叠成摘要行 */}
              <ActivityStream
                thinking={msg.loading && !msg.reasoning ? msg.thinking : ''}
                thinkingKind={msg.thinkingKind || ''}
                toolCalls={msg.toolCalls}
                loading={Boolean(msg.loading)}
              />
              {/* v34：思维链块——推理模型 reasoning_content 实时流式 + 完成后按轮回看 */}
              {(msg.reasoning || (msg.loading && msg.reasoningTexts?.length) || (!msg.loading && msg.reasoningTexts?.length)) && (
                <ReasoningBlock
                  reasoning={msg.loading ? msg.reasoning : ''}
                  texts={msg.reasoningTexts}
                  loading={Boolean(msg.loading)}
                />
              )}
              {msg.loading ? (
                // v33 修复流式观感：内核每 delta 都在更新 msg.content，但旧渲染在
                // 「无工具调用」时只画三点动画——增量全部被吞，等完才一次性出全文。
                // 现在只要有内容片段就逐字渲染；内容未到时依次显示 thinking 文案 / 三点。
                msg.content ? (
                  <div
                    className="chat-bubble-content is-streaming"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(stripLeadingOrdinal(msg.content)) }}
                  />
                ) : msg.thinking ? null : (
                  <div className="chat-typing"><span /><span /><span /></div>
                )
              ) : (
                <div
                  className={`chat-bubble-content${(isStreaming && i === messages.length - 1) ? ' is-streaming' : ''}${msg.stopped ? ' is-stopped' : ''}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.role === 'user' ? (msg.displayContent || msg.content) : stripLeadingOrdinal(msg.content)) }}
                />
              )}
              {msg.stopped && (
                <div className="chat-stopped-mark">
                  <span>已停止生成</span>
                  {/* v36 中断恢复：会话状态（工具历史/产物路径）经 buildSessionContextText 注入下轮，
                      点「继续任务」即可从断点接力，不重复已完成的步骤 */}
                  <button
                    type="button"
                    className="chat-resume-btn"
                    disabled={isStreaming}
                    onClick={() => sendMessage('继续：请从上次中断的地方接着完成任务。先参考会话状态里已完成的步骤与产物路径，从断点继续，不要重复已完成的工作。')}
                    title="从断点继续执行该任务"
                  >
                    继续任务
                  </button>
                </div>
              )}
              {/* token 用量（上游报告时展示，成本可见化）
                  v36.2：部分上游只报总量不报分项——零值字段不再渲染，
                  杜绝「输入 980 / 输出 0」这种幽灵"0" */}
              {!msg.loading && !msg.error && msg.usage?.total_tokens > 0 && (() => {
                const parts = [];
                if (Number(msg.usage.prompt_tokens) > 0) parts.push(`输入 ${Number(msg.usage.prompt_tokens).toLocaleString()}`);
                if (Number(msg.usage.completion_tokens) > 0) parts.push(`输出 ${Number(msg.usage.completion_tokens).toLocaleString()}`);
                return (
                  <div className="chat-usage-mark">
                    本轮 {Number(msg.usage.total_tokens).toLocaleString()} tokens{parts.length ? `（${parts.join(' / ')}）` : ''}
                  </div>
                );
              })()}
            </div>
            {/* P0-2 计划卡操作条：批准执行 / 修改 / 放弃 */}
            {msg.isPlan && !msg.loading && !msg.error && !msg.planDismissed && (
              <div className="chat-plan-actions">
                {msg.planExecuted ? (
                  <span className="chat-plan-executed">✓ 已提交执行，智能体正在按此计划工作…</span>
                ) : (
                  <>
                    <button type="button" className="chat-plan-btn chat-plan-btn-approve" onClick={() => executePlan(i)}>
                      批准执行
                    </button>
                    <button type="button" className="chat-plan-btn chat-plan-btn-modify" onClick={() => modifyPlan(i)}>
                      修改
                    </button>
                    <button type="button" className="chat-plan-btn chat-plan-btn-discard" onClick={() => dismissPlan(i)}>
                      放弃
                    </button>
                  </>
                )}
              </div>
            )}
            {/* 用户消息操作（v12）：复制 / 重写（填回输入框重新编辑发送） */}
            {msg.role === 'user' && !msg.loading && (
              <div className="chat-msg-actions chat-msg-actions-user">
                <button type="button" className="chat-action-btn" title="复制" onClick={e => copyMessage(msg.content, e)}>
                  <span className="icon-sm">{ICONS.copy}</span>
                  复制
                </button>
                <button
                  type="button"
                  className="chat-action-btn"
                  title="把这条消息填回输入框，修改后重新发送"
                  onClick={() => { setInput(msg.displayContent || msg.content || ''); setTimeout(() => inputRef.current?.focus(), 60); }}
                  disabled={isStreaming}
                >
                  <span className="icon-sm">{ICONS.edit}</span>
                  重写
                </button>
              </div>
            )}
            {msg.role === 'assistant' && !msg.loading && !msg.error && (
              <div className="chat-msg-actions">
                <button type="button" className="chat-action-btn" title="复制" onClick={e => copyMessage(msg.content, e)}>
                  <span className="icon-sm">{ICONS.copy}</span>
                  复制
                </button>
                <button type="button" className="chat-action-btn" title="存为素材（保存到素材库，供后续创作引用）" onClick={() => saveAsMaterial(msg, i)}>
                  <span className="icon-sm">{ICONS.bookmark}</span>
                  存为素材
                </button>
                <button type="button" className="chat-action-btn" title="重新生成" onClick={() => regenerateLast()} disabled={isStreaming}>
                  <span className="icon-sm">{ICONS.refresh}</span>
                  重新生成
                </button>
                <button type="button" className="chat-action-btn" title="从这里分支出新会话继续" onClick={() => forkFromMessage(i)} disabled={isStreaming}>
                  <span className="icon-sm">{ICONS.fork}</span>
                  分支
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

      {/* 侧边节点导航：波浪短条，hover 变长并悬浮显示消息内容，点击跳转 */}
      {userMessageNodes.length > 0 && (
        <nav className="chat-side-rail" aria-label="对话节点导航" onMouseLeave={() => setRailTip(null)}>
          <div className="chat-side-rail-label">节点</div>
          {userMessageNodes.map((node, n) => (
            <button
              key={node.idx}
              type="button"
              ref={el => { if (el) railNodeRefs.current.set(node.idx, el); else railNodeRefs.current.delete(node.idx); }}
              className={`chat-side-rail-node ${activeRailNode === node.idx ? 'active' : ''}`}
              onClick={() => { setActiveRailNode(node.idx); jumpToMessage(node.idx); }}
              onMouseEnter={() => showRailTip(node.idx, n + 1, node.content)}
              onFocus={() => showRailTip(node.idx, n + 1, node.content)}
              onBlur={() => setRailTip(null)}
              aria-label={`第 ${n + 1} 条消息，点击跳转`}
            >
              <span className="chat-side-rail-bar" aria-hidden="true" />
            </button>
          ))}
        </nav>
      )}
      {railTip && createPortal(
        <div className="chat-side-rail-tip" style={{ position: 'fixed', left: railTip.left, bottom: railTip.bottom }} role="tooltip">
          <i className="chat-side-rail-tip-num">{railTip.n}</i>
          <span className="chat-side-rail-tip-text">{railTip.content || '（空消息）'}</span>
        </div>,
        document.body
      )}
      </div>

      {/* Attachments（v36：缩略图 + 上传状态——uploading 转圈 / ready 就绪 / error 失败原因） */}
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((att, i) => (
            <div key={att.key || i} className={`chat-attachment-chip is-${att.status || 'ready'}`} title={att.status === 'error' ? (att.errorMsg || '上传失败') : `${att.name || ''} · ${formatBytes(att.size)}`}>
              {att.kind === 'image' && (att.localUrl || att.url) ? (
                <img src={att.localUrl || att.url} alt="" className="chat-attachment-thumb" />
              ) : (
                <span className="icon-sm chat-attachment-fileicon">{ICONS.document}</span>
              )}
              <span className="chat-attachment-name">{att.name || '附件'}</span>
              <span className={`chat-attachment-state st-${att.status || 'ready'}`}>
                {att.status === 'uploading' ? '上传中' : att.status === 'error' ? '失败' : '就绪'}
              </span>
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
          {/* 消息排队（v15）：按钮在输入框上方，弹层可查看/二次编辑/调序/删除排队消息。
              v26.9e：弹层已改为 portal 到 body + fixed 定位——原先挂在 .chat-composer-top 内，
              该容器 overflow-x:auto 会把弹层整体裁掉，表现为「点了没反应」。 */}
          <div className="chat-queue-wrap" ref={queueWrapRef}>
            {activeQueue.length > 0 && (
              <>
                <button
                  ref={queueBtnRef}
                  type="button"
                  className={`chat-queue-btn ${showQueueMenu ? 'open' : ''}`}
                  onClick={() => setShowQueueMenu(v => !v)}
                  title={`${activeQueue.length} 条消息排队中，点击管理`}
                >
                  <span className="icon-sm">{ICONS.history}</span>
                  排队 {activeQueue.length}
                  <span className="chat-skill-caret">{ICONS.chevronUp || '▴'}</span>
                </button>
                {showQueueMenu && createPortal((
                  <div
                    className="chat-queue-pop"
                    ref={queuePopRef}
                    style={{
                      position: 'fixed',
                      left: queuePopStyle ? queuePopStyle.left : 0,
                      top: queuePopStyle ? queuePopStyle.top : 0,
                      right: 'auto',
                      visibility: queuePopStyle ? 'visible' : 'hidden',
                    }}
                  >
                    <div className="chat-queue-pop-label">排队消息（按顺序自动发送，可拖拽排序）</div>
                    {activeQueue.map((q, i) => (
                      <div
                        key={i}
                        className={`chat-queue-item ${dragQueueIdxRef.current === i ? 'is-dragging' : ''}`}
                        draggable={editingQueueIdx !== i}
                        onDragStart={(e) => {
                          dragQueueIdxRef.current = i;
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(i));
                        }}
                        onDragOver={(e) => {
                          if (dragQueueIdxRef.current == null) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragQueueIdxRef.current;
                          dragQueueIdxRef.current = null;
                          if (from != null && from !== i) reorderQueued(activeSessionId, from, i);
                        }}
                        onDragEnd={() => { dragQueueIdxRef.current = null; }}
                      >
                        {editingQueueIdx === i ? (
                          <textarea
                            autoFocus
                            className="chat-queue-item-edit"
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            rows={2}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                updateQueuedAt(activeSessionId, i, editDraft.trim() || queueItemText(q));
                                setEditingQueueIdx(null);
                              } else if (e.key === 'Escape') setEditingQueueIdx(null);
                            }}
                          />
                        ) : (
                          <span className="chat-queue-item-text" title={queueItemText(q)}>{queueItemText(q)}{typeof q === 'object' && q?.attachments?.length ? '（带附件）' : ''}</span>
                        )}
                        <span className="chat-queue-item-acts">
                          {editingQueueIdx === i ? (
                            <button type="button" onClick={() => { updateQueuedAt(activeSessionId, i, editDraft.trim() || queueItemText(q)); setEditingQueueIdx(null); }} title="保存">✓</button>
                          ) : (
                            <button type="button" onClick={() => { setEditingQueueIdx(i); setEditDraft(queueItemText(q)); }} title="二次编辑">✎</button>
                          )}
                          <button type="button" disabled={i === 0} onClick={() => moveQueued(activeSessionId, i, -1)} title="上移（提前发送）">↑</button>
                          <button type="button" disabled={i === activeQueue.length - 1} onClick={() => moveQueued(activeSessionId, i, 1)} title="下移（延后发送）">↓</button>
                          <button type="button" onClick={() => removeQueuedAt(activeSessionId, i)} title="移除">×</button>
                        </span>
                      </div>
                    ))}
                  </div>
                ), document.body)}
              </>
            )}
          </div>
          {/* v36：图片附件悬停预览小窗（portal 到 body，防气泡 overflow 裁剪） */}
          {imgPreview && createPortal(
            <div
              className="chat-img-preview-pop"
              style={{ left: imgPreview.left, top: imgPreview.top }}
              onMouseLeave={() => setImgPreview(null)}
              role="presentation"
            >
              <img src={imgPreview.url} alt={imgPreview.name || '图片预览'} />
              {imgPreview.name && <div className="chat-img-preview-name">{imgPreview.name}</div>}
            </div>,
            document.body,
          )}
          {/* 快捷指令收纳：单按钮弹层（情境指令 + 自定义），不再平铺占位 */}
          <div className="chat-quick-wrap">
            <button
              ref={quickBtnRef}
              type="button"
              className={`chat-quick-btn ${showQuickMenu ? 'open' : ''}`}
              onClick={toggleQuickMenu}
              title="快捷指令（含自定义）"
            >
              <span className="icon-sm">{ICONS.sparkles || ICONS.star}</span>
              快捷指令
              <span className="chat-skill-caret">{ICONS.chevronUp || '▴'}</span>
            </button>
          </div>
        </div>
        {/* 输入框：上=textarea+发送；下=权限模式+附件+模型/上下文胶囊（全部收进输入框内，v7） */}
        <div className="chat-input-area">
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md" style={{ display: 'none' }} onChange={handleFileUpload} />
          <div className="chat-input-main-row">
            <textarea ref={inputRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={hasConfig ? (isStreaming ? "正在生成中，输入下一条消息自动排队…" : "给智能体发消息…  (Shift+Enter 换行)") : "请先配置大模型"} rows={1} disabled={!hasConfig} />
            {/* 单按钮：生成中=停止，空闲=发送（不再并存） */}
            {isStreaming ? (
              <button className="chat-stop-btn" onClick={stopGeneration} title="停止生成" aria-label="停止生成">
                {ICONS.stopSquare}
              </button>
            ) : (
              <button className="chat-send-btn" onClick={() => sendMessage()} disabled={!input.trim() || !hasConfig} title="发送">
                {ICONS.send}
              </button>
            )}
          </div>
          <div className="chat-input-tools" ref={modeWrapRef}>
            {/* 权限模式胶囊（弹层向上） */}
            <button
              type="button"
              className={`chat-mode-chip ${showModeMenu ? 'open' : ''}`}
              onClick={() => setShowModeMenu(v => !v)}
              title={`权限模式：${currentModeMeta.label} — ${currentModeMeta.desc}`}
            >
              <span className="chat-mode-dot" style={{ background: currentModeMeta.hue }} />
              {currentModeMeta.label}
              <span className="chat-skill-caret">{ICONS.chevronUp || '▴'}</span>
            </button>
            {showModeMenu && (
              <div className="chat-mode-pop" role="menu">
                {PERMISSION_MODES.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className={`chat-mode-item ${agentPermissionMode === m.id ? 'selected' : ''}`}
                    onClick={() => { setAgentPermissionMode(m.id); setShowModeMenu(false); }}
                    title={m.desc}
                  >
                    <span className="chat-mode-dot" style={{ background: m.hue }} />
                    <span className="chat-mode-item-text">
                      <strong>{m.label}</strong>
                      <small>{m.desc}</small>
                    </span>
                    {agentPermissionMode === m.id && <span className="chat-model-item-check">✓</span>}
                  </button>
                ))}
              </div>
            )}
            {/* 上下文深度切换（quick/deep）：快问省 token，深研全量注入 */}
            <button
              type="button"
              className="chat-mode-chip"
              onClick={() => setChatDepthMode(m => (m === 'deep' ? 'quick' : 'deep'))}
              title={chatDepthMode === 'deep' ? '当前：深研模式（全量上下文注入）。点击切换为快问模式' : '当前：快问模式（轻量上下文，证据/记忆用工具按需拉取）。点击切回深研模式'}
            >
              <span className="chat-mode-dot" style={{ background: chatDepthMode === 'deep' ? 'var(--accent-cyan)' : 'var(--status-warn, #d29922)' }} />
              {chatDepthMode === 'deep' ? '深研' : '快问'}
            </button>
            {/* 计划模式触发（P0-2）：把输入框内容转为「先出方案、批准后执行」的计划请求 */}
            <button
              type="button"
              className="chat-mode-chip chat-plan-trigger"
              disabled={isStreaming || !input.trim()}
              onClick={handlePlanRequest}
              title="把输入框内容转为执行计划：智能体先出方案，你批准后再执行"
            >
              <span className="chat-mode-dot" style={{ background: 'var(--accent-cyan)' }} />
              计划
            </button>
            {/* 附件按钮（小图标） */}
            <button className="chat-attach-mini" onClick={() => fileInputRef.current?.click()} title="上传附件" disabled={!hasConfig}>
              {ICONS.paperclip}
            </button>
            {/* 工作流按钮（v13 无限画布）：弹层列出画布工作流，点击把蓝图填入输入框 */}
            {workflowOptions.length > 0 && (
              <div className="chat-wf-wrap" ref={wfWrapRef}>
                <button
                  type="button"
                  className={`chat-attach-mini ${showWfMenu ? 'open' : ''}`}
                  onClick={() => setShowWfMenu(v => !v)}
                  title="插入无限画布工作流"
                  disabled={!hasConfig}
                >
                  {ICONS.workflow}
                </button>
                {showWfMenu && (
                  <div className="chat-wf-pop">
                    <div className="chat-wf-pop-label">无限画布 · 工作流</div>
                    {workflowOptions.map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => {
                          setInput(prev => `${prev ? `${prev.trimEnd()}\n\n` : ''}请严格按以下工作流的节点顺序推进，每步给出产出，最后汇总：\n\n${o.blueprint}\n\n【我的目标】\n`);
                          setShowWfMenu(false);
                          setTimeout(() => inputRef.current?.focus(), 60);
                        }}
                      >
                        <b>{o.name}</b>
                        <small>{(o.blueprint.split('\n').find(l => /^\d+\./.test(l.trim())) || '工作流').trim().slice(0, 44)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* 模型胶囊 + 上下文进度环（v7：从底部一行收进输入框内，整体更干练） */}
            <div className="chat-model-wrap">
            <button
              ref={modelBtnRef}
              type="button"
              className={`chat-model-chip ${showModelMenu ? 'open' : ''}`}
              onClick={toggleModelMenu}
              title="当前大模型，点击切换"
            >
              <span className="chat-model-dot" aria-hidden="true" />
              <span className="chat-model-name">{selectedModel ? selectedModel.split('/').pop() : '未配置模型'}</span>
              <span className="chat-skill-caret">{ICONS.chevronUp || '▴'}</span>
            </button>
            <span
              className={`chat-ctx-ring ${ctxUsage.pct >= 90 ? 'is-critical' : ctxUsage.pct >= 70 ? 'is-warn' : ''}`}
              title={`上下文占用 ≈ ${ctxUsage.tokens.toLocaleString()} / ${ctxUsage.budget / 1000}k tokens（${ctxUsage.pct}%）· 与发送链路同源估算`}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                <circle className="chat-ctx-ring-bg" cx="10" cy="10" r="8" />
                <circle
                  className="chat-ctx-ring-fill"
                  cx="10" cy="10" r="8"
                  strokeDasharray={`${(ctxUsage.pct / 100) * 50.27} 50.27`}
                />
              </svg>
              <em>{ctxUsage.pct >= 100 ? 'FULL' : `${Math.round(ctxUsage.pct)}%`}</em>
            </span>
          </div>
          <div className="chat-context-group">
            {workspaceFiles.length > 0 && (
              <div className="chat-context-pill chat-context-pill-file" title={`已关联：${workspaceFiles.map(f => f.name).join('、')}（正文随每条消息自动提供给 AI）`}>
                <span className="icon-sm">{ICONS.document}</span>
                文件 {workspaceFiles.length}
                <button
                  type="button"
                  className="chat-context-pill-clear"
                  onClick={() => { clearSpaceFiles(getActiveSpaceId()); showToast('已清除当前空间的关联文件'); }}
                  title="清除（清空当前空间的关联文件）"
                >{ICONS.x}</button>
              </div>
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
          </div>
        </div>
      </div>
      {/* 知识图谱 overlay：AI 工作站顶部按钮打开，portal 到 body */}
      {showGraph && createPortal(
        <div className="graph-overlay" onClick={() => setShowGraph(false)}>
          <div className="graph-overlay-panel" onClick={(e) => e.stopPropagation()}>
            <div className="graph-overlay-head">
              <span className="graph-overlay-title">知识图谱</span>
              <span className="graph-overlay-sub">{materials?.length || 0} 条素材按标签聚类</span>
              <button className="graph-overlay-close" onClick={() => setShowGraph(false)} title="关闭">
                {ICONS.x}
              </button>
            </div>
            <MaterialGraph
              materials={materials || []}
              onOpenMaterial={(mat) => setGraphSelected(mat)}
            />
            {graphSelected && (
              <div className="graph-overlay-detail">
                <div className="graph-overlay-detail-head">
                  <span className="graph-overlay-detail-title">{graphSelected.title || '素材'}</span>
                  <span className="graph-overlay-detail-type">{graphSelected.type || 'material'}</span>
                </div>
                {graphSelected.tags?.length > 0 && (
                  <div className="graph-overlay-detail-tags">
                    {graphSelected.tags.map(t => <span key={t} className="graph-overlay-detail-tag">#{t}</span>)}
                  </div>
                )}
                {(graphSelected.content || graphSelected.summary) && (
                  <div className="graph-overlay-detail-body">
                    {String(graphSelected.content || graphSelected.summary || '').slice(0, 400)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

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

      {/* 快捷指令弹层：情境指令 + 我的自定义指令（可新建/删除） */}
      {showQuickMenu && quickMenuPos && createPortal(
        <div
          ref={quickMenuRef}
          className="chat-quick-menu custom-scrollbar"
          role="menu"
          style={{ position: 'fixed', left: quickMenuPos.left, bottom: quickMenuPos.bottom }}
        >
          <div className="chat-quick-menu-head">
            <span className="chat-quick-menu-title">快捷指令</span>
            {customQuickCommands.length > 0 && <span className="chat-quick-menu-count">{customQuickCommands.length} 条自定义</span>}
          </div>
          {quickActions.length > 0 && <div className="chat-quick-menu-label">情境推荐</div>}
          {quickActions.map(action => (
            <button
              key={`ctx-${action.label}`}
              type="button"
              className="chat-quick-menu-item"
              disabled={isStreaming}
              onClick={() => { setShowQuickMenu(false); setShowQuickForm(false); action.orchestrate ? handleOrchestrate(action.prompt) : sendMessage(action.prompt); }}
              title={action.desc}
            >
              <span className="chat-quick-pill-icon">{SUGGEST_ICONS[action.icon] || SUGGEST_ICONS.sparkle}</span>
              <span className="chat-quick-menu-item-text">
                <strong>{action.label}</strong>
                {action.desc && <small>{action.desc}</small>}
              </span>
            </button>
          ))}
          {customQuickCommands.length > 0 && <div className="chat-quick-menu-label">我的指令</div>}
          {customQuickCommands.map(cmd => (
            <div key={cmd.id} className="chat-quick-menu-row">
              <button
                type="button"
                className="chat-quick-menu-item is-custom"
                disabled={isStreaming}
                onClick={() => { setShowQuickMenu(false); setShowQuickForm(false); sendMessage(cmd.prompt); }}
                title={cmd.prompt}
              >
                <span className="chat-quick-pill-icon">✦</span>
                <span className="chat-quick-menu-item-text">
                  <strong>{cmd.label}</strong>
                  <small>{cmd.prompt}</small>
                </span>
              </button>
              <button
                type="button"
                className="chat-quick-menu-del"
                onClick={() => removeQuickCommand(cmd.id)}
                title="删除该指令"
                aria-label={`删除指令 ${cmd.label}`}
              >✕</button>
            </div>
          ))}
          {showQuickForm ? (
            <div className="chat-quick-form" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT') { e.preventDefault(); addQuickCommand(); } }}>
              <input
                autoFocus
                value={quickForm.label}
                onChange={e => setQuickForm(f => ({ ...f, label: e.target.value }))}
                placeholder="指令名称（如：周报生成）"
                maxLength={16}
              />
              <textarea
                value={quickForm.prompt}
                onChange={e => setQuickForm(f => ({ ...f, prompt: e.target.value }))}
                placeholder="指令内容：点击后发送给智能体的完整 prompt"
                rows={3}
                maxLength={2000}
              />
              <div className="chat-quick-form-actions">
                <button type="button" className="chat-quick-form-cancel" onClick={() => { setShowQuickForm(false); setQuickForm({ label: '', prompt: '' }); }}>取消</button>
                <button
                  type="button"
                  className="chat-quick-form-save"
                  onClick={addQuickCommand}
                  disabled={!quickForm.label.trim() || !quickForm.prompt.trim()}
                >保存</button>
              </div>
            </div>
          ) : (
            <button type="button" className="chat-quick-add" onClick={() => setShowQuickForm(true)}>
              ＋ 新建快捷指令
            </button>
          )}
        </div>,
        document.body
      )}

      {/* 模型切换弹层 */}
      {showModelMenu && modelMenuPos && createPortal(
        <div
          ref={modelMenuRef}
          className="chat-model-menu custom-scrollbar"
          role="menu"
          style={{ position: 'fixed', left: modelMenuPos.left, bottom: modelMenuPos.bottom }}
        >
          <div className="chat-quick-menu-head">
            <span className="chat-quick-menu-title">选择大模型</span>
            <span className="chat-quick-menu-count">{composerModels.length} 个可用</span>
          </div>
          {composerModels.length === 0 && (
            <div className="chat-skill-empty">暂无可用模型，请先在「设置 → 大模型」中配置。</div>
          )}
          {composerModels.map(m => (
            <button
              key={m.id}
              type="button"
              className={`chat-model-item ${m.id === selectedModel ? 'selected' : ''}`}
              onClick={() => pickModel(m.id)}
              title={m.id}
            >
              <span className="chat-model-item-name">{m.name}</span>
              {m.id === selectedModel && <span className="chat-model-item-check">✓ 使用中</span>}
            </button>
          ))}
          {onOpenLlmConfig && (
            <button type="button" className="chat-model-manage" onClick={() => { setShowModelMenu(false); onOpenLlmConfig(); }}>
              ⚙ 管理模型与密钥…
            </button>
          )}
        </div>,
        document.body
      )}
      </div>
      )}{/* 中栏条件渲染结束（chat | team） */}

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
          onInvokeTool={handleInvokeTool}
        />
      )}
      <PersonaDrawer
        open={showPersonaDrawer}
        onClose={() => setShowPersonaDrawer(false)}
        agent={siliconstreamDrawerAgent}
        onChange={handleSavePersona}
      />
      {/* 三栏拖拽手柄：贴在左右列边界上，hover 显色 */}
      {variant === 'main' && !sessionCollapsed && (
        <div
          className="ws-resize-handle ws-resize-left"
          onPointerDown={startPanelDrag('left')}
          title="拖动调整会话栏宽度"
        />
      )}
      {variant === 'main' && (
        <div
          className="ws-resize-handle ws-resize-right"
          onPointerDown={startPanelDrag('right')}
          title="拖动调整智能管理栏宽度"
        />
      )}
    </div>
  );
}
