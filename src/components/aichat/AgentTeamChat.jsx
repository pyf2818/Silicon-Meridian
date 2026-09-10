/**
 * AgentTeamChat - 团队群聊页（「一个人的公司」协作空间）
 *
 * - 消息语义（v9，对齐微信群聊）：
 *   · 发言人是纯昵称（头像同色相小字），@ 只留给正文里的指派语义（用户消息中 @ 高亮）
 *   · role:'system' 居中系统行：建群/邀请/请出/更名 + 认领接力/中止/异常等流水线事件
 *   · 相邻消息间隔 >5 分钟插入居中时间分隔线；气泡自身时间 hover 才浮现
 *   · 接力产出带引用块（微信引用样式），点击定位并闪烁高亮原消息
 *   · 创始人消息右侧带头像（金色"创"）
 * - 右侧群信息面板（v9，对标微信桌面版群信息）：群公告（团队目标）/ 成员网格
 *   （点击开角色卡、悬停请出、＋邀请）/ 记录筛选（全部|产出|认领|系统）/ 执行记录入口；
 *   顶栏成员收敛为头像叠放，点击开面板
 * - 流式渐进渲染（v9）：runToolLoop onContentDelta → 占位气泡打字机式增长，
 *   贴底自动跟随；上翻阅读不吸底，底部浮出「有新消息」跳转浮标（带未读数）
 * - 失败可重试（v9）：失败/中止气泡带「重试」，按 runId 重建该成员的认领/产出任务
 * - 顶栏（v12）：居中群名 + 头像叠放 + 导出/清空/记录；群管理（建/名/删/切）移至左侧栏
 * - 两阶段广播流水线（v16 并行化）：全员同时认领 → 认领者并行独立产出（每个成员都是独立个体，互不等待）
 * - 执行核：复用 subagentRunner.runOneSubagent（独立工具白名单/预算/审批会话）
 */
import { useEffect, useMemo, useRef, useState, useCallback, Fragment } from 'react';
import { runOneSubagent } from './subagentRunner.js';
import AgentRoleCard from './AgentRoleCard.jsx';
import { renderMarkdown } from '../../utils/markdown.jsx';
import { downloadMarkdown } from '../../utils/workspace.js';
import {
  getGroupState, getActiveChat, subscribeGroup, inviteMember, removeMember,
  addGroupMessage, updateGroupMessage, setGroupRunning, clearGroupChat,
  setChatAnnouncement, setChatGoal, getChatGoal,
  resolveMemberPreset, getAllRolePresets, subscribeCustomRoles, hueOfMemberId,
} from './groupChatStore.js';
import { showToast } from '../../utils/toast.js';
import { buildRouterPrompt, parseRouterVerdict } from '../../domain/agent/teamCore.js';

/** 认领语义 → 标签文案（Phase 1 气泡角标） */
const KIND_LABEL = { claim: '认领', watch: '关注', bystander: '旁观' };
/** Goal 状态 → 面板徽标文案（v26 #12） */
const GOAL_STATUS_LABEL = { idle: '待启动', running: '推进中', done: '已达成', stopped: '已暂停', failed: '异常退出' };
/** 时间分隔线阈值：相邻消息间隔超过 5 分钟才插（微信同款节奏） */
const DIVIDER_GAP_MS = 5 * 60 * 1000;

/** 解析消息中的 @提及 → 按出现顺序返回去重后的成员 preset 列表（含自定义角色） */
function parseMentions(text, memberPresets) {
  const mentioned = [];
  const seen = new Set();
  const re = /@([^\s@，。,:;；！!？?]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    const preset = memberPresets.find(p => (
      p.id.toLowerCase() === token || p.name === m[1] || p.name.toLowerCase() === token
    ));
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id);
      mentioned.push(preset);
    }
  }
  return mentioned;
}

/** 群聊消息 → 共享上下文转写（全员可见的同一份"会议室白板"）。
 *  system 系统行是界面事件（邀请/接力等），不进 LLM 白板；
 *  团队目标（Goal）是环境设定，作为转写头注入每一轮（全员始终可见）。 */
function buildSharedTranscript(messages, limit = 14, announcement = '') {
  const head = announcement
    ? `【团队目标 · Goal】（环境设定：既定目标与约束，全员始终遵守）\n${announcement}\n\n`
    : '';
  const recent = messages
    .filter(m => m.role !== 'system' && m.status !== 'running' && m.content)
    .slice(-limit);
  if (!recent.length) return `${head}（群聊刚建立，还没有历史消息）`;
  return head + recent.map(m => m.role === 'user'
    ? `[创始人]: ${m.content}`
    : `[${m.agentName || m.agentId}]: ${String(m.content).slice(0, 1200)}`).join('\n\n');
}

function MemberAvatar({ preset, hue, size = 26 }) {
  return (
    <span
      className="gtc-avatar"
      style={{
        width: size, height: size,
        background: `hsl(${hue} 70% 22%)`,
        color: `hsl(${hue} 85% 70%)`,
        borderColor: `hsl(${hue} 70% 45%)`,
        fontSize: size * 0.42,
      }}
      title={preset?.name}
    >{(preset?.name || '?').slice(0, 1)}</span>
  );
}

/** 创始人头像（金色"创"，微信"自己也在群里"的右侧头像位） */
function FounderAvatar({ size = 26 }) {
  return <span className="gtc-avatar gtc-avatar-founder" style={{ width: size, height: size, fontSize: size * 0.42 }} title="我（创始人）">创</span>;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 用户消息正文渲染：@成员名 高亮成可辨识的指派语义（微信蓝色 @ 同款思路） */
function renderUserContent(text, presets) {
  const names = [...new Set(presets.map(p => p.name).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!text || !names.length) return text;
  const re = new RegExp(`@(${names.map(escapeRegExp).join('|')})`, 'g');
  const parts = String(text).split(re);
  return parts.map((seg, i) => (i % 2 === 1
    ? <span key={`mn_${i}`} className="gtc-mention">@{seg}</span>
    : seg));
}

const fmtClock = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 时间分隔线文案：今天只给时分，昨天加"昨天"，更早给日期 */
function fmtDivider(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const hm = fmtClock(ts);
  if (sameDay(d, now)) return hm;
  if (sameDay(d, yest)) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export default function AgentTeamChat({
  runtime = {},
  onSaveMaterial,
  onViewRecords,
  onNeedConfig,
  injection = null,      // 外部注入 { text, seq }：执行记录页发起 → 群聊 @ 预填
  onInjectConsumed,
}) {
  const [snap, setSnap] = useState(() => getGroupState());
  const [roleVersion, setRoleVersion] = useState(0); // 自定义角色库版本（触发 allPresets 重算）
  useEffect(() => subscribeGroup(() => setSnap({ ...getGroupState() })), []);
  useEffect(() => subscribeCustomRoles(() => setRoleVersion(v => v + 1)), []);
  const chats = snap.chats || [];
  const activeId = snap.activeId;
  const active = useMemo(
    () => chats.find(c => c.id === activeId) || chats[0] || { roster: [], messages: [] },
    [chats, activeId],
  );
  const roster = active.roster || [];
  const messages = active.messages || [];
  const running = Boolean(snap.running);
  // v26 #12：Goal 运行状态（旧群聊数据无 goal 字段时给默认值）
  const goalStatus = active.goal?.status || 'idle';
  const goalRound = Number(active.goal?.round) || 0;
  const goalMaxRounds = Number(active.goal?.maxRounds) || 8;

  const [input, setInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null); // null | string（@后的过滤词）
  // 顶栏状态：群名下拉 / 行内重命名 / 角色卡（null | {id, create}）
  const [roleCard, setRoleCard] = useState(null);
  // 右侧群信息面板：开合 / 公告编辑 / 记录筛选 / 面板内邀请菜单
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingAnn, setEditingAnn] = useState(false);
  const [annDraft, setAnnDraft] = useState('');
  const [streamFilter, setStreamFilter] = useState('all'); // all | work | claim | system
  const [invitingOpen, setInvitingOpen] = useState(false);
  // 滚动管理：贴底跟随 + 未读浮标
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const abortRef = useRef(null);
  const goalAbortRef = useRef(null); // Goal 自主循环的中止控制器（独立于单轮消息）
  const inputRef = useRef(null);
  const streamElRef = useRef(null);
  const panelRef = useRef(null);
  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);

  const rosterPresets = useMemo(
    () => roster.map(id => resolveMemberPreset(id)).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, roleVersion, snap],
  );
  const allPresets = useMemo(() => getAllRolePresets(), [roleVersion]);
  const mentionCandidates = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return rosterPresets.filter(p => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || q === '');
  }, [mentionQuery, rosterPresets]);

  /* ---------- 记录筛选（面板里选，作用于消息流） ---------- */
  const visibleMessages = useMemo(() => {
    if (streamFilter === 'all') return messages;
    if (streamFilter === 'system') return messages.filter(m => m.role === 'system');
    return messages.filter(m => m.role === 'agent' && m.meta?.phase === streamFilter);
  }, [messages, streamFilter]);

  /* ---------- 滚动：贴底跟随；上翻时新消息计入未读浮标 ---------- */
  useEffect(() => {
    prevCountRef.current = messages.length; // 切群/首挂载不记未读
    atBottomRef.current = true;
    setAtBottom(true);
    setUnread(0);
    const el = streamElRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 流式贴底锚定：合并到 rAF 下一帧执行，避免在布局中段强制写 scrollTop 引发抖动；
  // pending 标记防止同一帧堆积多个锚定任务。
  // ⚠️ 必须声明在所有引用它的 useEffect 之前：依赖数组在渲染阶段就会求值，
  //    声明靠后会命中 TDZ —— Cannot access 'anchorToBottom' before initialization。
  const anchorRafRef = useRef(0);
  const anchorToBottom = useCallback(() => {
    if (anchorRafRef.current) return;
    anchorRafRef.current = requestAnimationFrame(() => {
      anchorRafRef.current = 0;
      if (!atBottomRef.current) return;
      const el = streamElRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const grew = messages.length > prevCountRef.current;
    prevCountRef.current = messages.length;
    if (atBottomRef.current) {
      anchorToBottom();
    } else if (grew) {
      setUnread(u => u + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, anchorToBottom]);

  const lastLen = messages.length ? String(messages[messages.length - 1]?.content || '').length : 0;
  useEffect(() => {
    if (atBottomRef.current) anchorToBottom(); // 流式增长用瞬时锚定，避免 smooth 动画互相打架
  }, [lastLen, running, panelOpen, anchorToBottom]);
  useEffect(() => () => cancelAnimationFrame(anchorRafRef.current), []);

  const handleStreamScroll = useCallback(() => {
    const el = streamElRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setUnread(0);
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = streamElRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    atBottomRef.current = true;
    setAtBottom(true);
    setUnread(0);
  }, []);

  /** 引用块点击：定位原消息并闪烁高亮 */
  const jumpToMessage = useCallback((mid) => {
    const el = streamElRef.current?.querySelector(`[data-mid="${mid}"]`);
    if (!el) { showToast('原消息不在当前视图中（可能被筛选隐藏）'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('gtc-flash');
    void el.offsetWidth; // 强制 reflow，让闪烁动画可重复触发
    el.classList.add('gtc-flash');
    setTimeout(() => el.classList.remove('gtc-flash'), 1500);
  }, []);

  /* ---------- 外部注入：执行记录页「组建团队/派活」→ 切到群聊预填 @ 指派。
     用 seq + ref 去重：StrictMode 下 effect 双调用、以及重复点击同按钮时只注入一次 ---------- */
  const lastInjectSeqRef = useRef(0);
  useEffect(() => {
    if (!injection?.text || injection.seq === lastInjectSeqRef.current) return;
    lastInjectSeqRef.current = injection.seq;
    const text = injection.text;
    setInput(prev => (prev ? `${prev.trimEnd()} ${text}` : text));
    onInjectConsumed?.();
    setTimeout(() => { inputRef.current?.focus(); }, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injection]);

  /* ---------- @ 自动补全检测 ---------- */
  const handleInputChange = (e) => {
    const v = e.target.value;
    setInput(v);
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const atMatch = before.match(/@([^\s@]*)$/);
    setMentionQuery(atMatch ? atMatch[1] : null);
  };

  const pickMention = (preset) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/@([^\s@]*)$/, `@${preset.name} `);
    const next = before + input.slice(caret);
    setInput(next);
    setMentionQuery(null);
    setTimeout(() => { el?.focus(); }, 30);
  };

  /* ---------- 群信息面板 ---------- */
  const togglePanel = useCallback(() => {
    setPanelOpen(v => {
      if (v) { setStreamFilter('all'); setEditingAnn(false); } // 收起时还原筛选
      return !v;
    });
  }, []);
  const startEditAnn = useCallback(() => {
    setAnnDraft(active.announcement || '');
    setEditingAnn(true);
  }, [active.announcement]);
  const saveAnnouncement = useCallback(() => {
    if (setChatAnnouncement(annDraft)) showToast('团队目标（Goal）已更新');
    setEditingAnn(false);
  }, [annDraft]);

  /* ---------- 面板邀请菜单外点关闭 ---------- */
  useEffect(() => {
    if (!invitingOpen) return undefined;
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target)) setInvitingOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [invitingOpen]);

  /* ---------- 气泡/整群 导出与沉淀 ---------- */
  const saveMaterial = useCallback((payload) => {
    if (onSaveMaterial) {
      onSaveMaterial(payload);
      showToast('已保存到素材库');
    } else {
      downloadMarkdown(payload.title || 'team-chat', payload.fullContent || payload.content || '');
      showToast('已下载 Markdown');
    }
  }, [onSaveMaterial]);

  const handleCopyMessage = useCallback((m) => {
    const text = String(m.content || '');
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => showToast('已复制到剪贴板'))
      .catch(() => showToast('复制失败，请手动选择文本'));
  }, []);

  const handleSaveMessage = useCallback((m) => {
    saveMaterial({
      title: `群聊·${m.agentName || m.agentId}·${new Date(m.at || Date.now()).toLocaleDateString('zh-CN')}`,
      content: String(m.content || '').slice(0, 2000),
      fullContent: String(m.content || ''),
      type: 'note',
      source: '团队群聊',
      tags: ['团队群聊'],
    });
  }, [saveMaterial]);

  const handleExportChat = useCallback(() => {
    if (!messages.length) { showToast('群聊还没有消息可导出'); return; }
    const md = [
      `# ${active.name} · 团队群聊记录`,
      `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
      `- 成员：${rosterPresets.map(p => p.name).join('、') || '（无）'}`,
      `- 消息数：${messages.length}`,
      active.announcement ? `- 群公告：${active.announcement}` : '',
      '',
      '---',
      '',
      ...messages.map(m => {
        if (m.role === 'system') return `> ℹ️ ${m.content}`;
        if (m.role === 'user') return `## 🧑 创始人 · ${fmtClock(m.at)}\n\n${m.content}`;
        const tagLine = m.meta?.phase === 'claim' ? '（认领）' : m.meta?.phase === 'work' ? '（产出）' : '';
        return `## 🤖 ${m.agentName || m.agentId}${tagLine} · ${fmtClock(m.at)}\n\n${m.content}`;
      }).filter(Boolean),
    ].filter(Boolean).join('\n');
    saveMaterial({
      title: `群聊记录·${active.name}·${new Date().toLocaleDateString('zh-CN')}`,
      content: md.slice(0, 2000),
      fullContent: md,
      type: 'note',
      source: '团队群聊',
      tags: ['团队群聊', '导出'],
    });
  }, [messages, active, rosterPresets, saveMaterial]);

  /* ---------- 两阶段广播流水线（v7）+ 流式渲染 + 事件行（v9） ---------- */
  /** 认领阶段任务书 */
  const buildClaimObjective = useCallback((preset, shared, userText) => [
    '【群聊共享上下文】（全员可见的同一份白板）',
    shared,
    '',
    `【本轮用户消息】${userText}`,
    '',
    '【你的任务：认领阶段】',
    `你是群成员「${preset.name}」。请基于你的角色职责判断如何回应这条消息，只输出认领声明本身（不要执行任务、不要展开工作）。用你自己的性格和说话风格表达，一句话也要有你的味道：`,
    '- 消息与你的职责相关且你愿承担 → 第一行输出「【认领】」，随后 ≤60 字说明你打算做什么；',
    '- 值得补充观点但无需深度参与 → 第一行输出「【关注】」，随后一句简短看法（≤40 字）；',
    '- 与你职责无关 → 输出「【旁观】」即可（可带一句符合性格的短评）；',
    '- 简单提问不需要人人参与：职责最相关的成员回应即可，其他人请旁观——克制比热情更专业。',
  ].join('\n'), []);

  /** 产出阶段任务书（含认领声明与前序成员产出） */
  const buildWorkObjective = useCallback((preset, shared, userText, myClaim) => [
    '【群聊共享上下文】（含本轮各成员的认领声明，彼此可见）',
    shared,
    '',
    `【本轮用户指令】${userText}`,
    '',
    myClaim ? `【你已认领】${myClaim}` : '【你的认领】（被创始人点名参与，直接承担）',
    '',
    '【协作模式】成员并行独立执行：每人同时开工，各自完成自己认领的部分，不要等待或代替他人；全部产出会一起汇总展示。',
    '',
    '请执行你认领的部分，直接给出结构化产出（这是发到群里的回复，不要寒暄）。保持你的性格与说话风格。',
  ].join('\n'), []);

  /** 执行核工厂：注入流式回调（节流刷新占位气泡），认领/产出/重试共用 */
  const makeRunMember = useCallback((controller) => (preset, objective, placeholder) => {
    let lastFlush = 0;
    return runOneSubagent(
      { id: `gtc_${placeholder.id}`, index: 0, preset, objective },
      {
        llmConfig: runtime.llmConfig,
        selectedModel: runtime.selectedModel,
        parentCtx: {
          sessionId: 'team-group-chat',
          approvalMode: runtime.approvalMode || 'semi',
          tavilyKey: runtime.tavilyKey || '',
          doubaoSearchKey: runtime.doubaoSearchKey || '',
          webSearchEnabled: runtime.webSearchEnabled !== false,
        },
        signal: controller.signal,
        persist: false, // 群聊消息轮次不落盘，避免 outputs/ 噪音
        onContentDelta: ({ content }) => {
          const now = Date.now();
          if (now - lastFlush < 280) return; // 节流：约 3 次/秒，避免 localStorage 高频写
          lastFlush = now;
          updateGroupMessage(placeholder.id, { content });
        },
      },
    );
  }, [runtime]);

  /* ---------- 智能调度器（v26.8 #19）：发布消息后先分流，仅相关成员参与 ----------
   * 简单提问 → 最相关 1-2 人直接回复（跳过认领阶段）；
   * 任务 → 核心成员 + 可补充成员进入认领，无关成员零调用零气泡；
   * 调度失败/解析失败 → 降级全员认领（旧行为，安全兜底）。被 @ 者无条件参与。 */
  const runTaskRouter = useCallback(async ({ userText, signal }) => {
    const transcript = buildSharedTranscript(getActiveChat().messages, 6, '');
    const prompt = buildRouterPrompt({ userText, transcript, memberPresets: rosterPresets });
    try {
      const res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          baseUrl: runtime.llmConfig.baseUrl,
          apiKey: runtime.llmConfig.apiKey,
          model: runtime.selectedModel,
          action: 'chat',
          content: prompt,
          systemPrompt: '你是团队任务调度器，只按用户要求的格式输出，不要执行任务本身。',
          messages: [],
        }),
      });
      const data = await res.json();
      const verdict = parseRouterVerdict(String(data.content || ''), rosterPresets);
      return verdict.valid ? verdict : null; // null = 解析失败，调用方降级
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      return null; // 调度失败 → 降级全员认领
    }
  }, [rosterPresets, runtime]);

  /** 两阶段广播流水线（认领 → 产出）：普通消息与 Goal 自动循环共用。
   *  v26.8：respondIds = 被调度为「直接回应」的成员（跳过认领阶段直接产出，
   *  简单提问时 1-2 人快速回复，不再全员广播）。 */
  const runRoundPhases = useCallback(async ({ controller, runMember, ordered, mentionedIds, userText, runId, respondIds = new Set(), simpleMode = false }) => {
    /* ---- Phase 1：广播认领（v16 并行；v26.8：直接回应者跳过认领） ---- */
    const claimBroadcast = ordered.filter(p => !respondIds.has(p.id));
    const claimResults = await Promise.allSettled(claimBroadcast.map(async (preset) => {
      if (controller.signal.aborted) return null;
      const placeholder = addGroupMessage({
        role: 'agent', agentId: preset.id, agentName: preset.name,
        content: '', status: 'running', meta: { phase: 'claim', runId },
      });
      if (!placeholder?.id) throw new Error('占位消息创建失败');
      const shared = buildSharedTranscript(getActiveChat().messages.filter(m => m.id !== placeholder.id), 14, active.announcement);
      const objective = buildClaimObjective(preset, shared, userText);
      const result = await runMember(preset, objective, placeholder);
      const claimText = result.status === 'done' && result.report
        ? String(result.report).trim()
        : `⚠️ ${result.error || '认领未产出'}`;
      // 认领语义解析：标记优先；无标记时被 @ 者视为认领、其余视为关注
      const kind = claimText.startsWith('【认领】') ? 'claim'
        : claimText.startsWith('【关注】') ? 'watch'
          : claimText.startsWith('【旁观】') ? 'bystander'
            : (mentionedIds.has(preset.id) ? 'claim' : 'watch');
      updateGroupMessage(placeholder.id, {
        content: claimText,
        status: result.status === 'done' ? 'done' : result.status,
        meta: { phase: 'claim', kind, runId, turns: result.turns, tokens: result.usage?.total_tokens || 0 },
      });
      return { preset, claimText, kind };
    }));
    const claims = new Map(); // presetId → { preset, claimText, kind }
    for (const r of claimResults) {
      if (r.status === 'fulfilled' && r.value) claims.set(r.value.preset.id, r.value);
    }

    /* ---- 流水线事件行：谁接下了任务（微信系统行的"事件流"语义） ---- */
    const contributors = ordered.filter(p => {
      if (respondIds.has(p.id)) return true; // 被调度直接回应者必然参与
      const c = claims.get(p.id);
      return c && (c.kind === 'claim' || mentionedIds.has(p.id)); // 被 @ 点名者必然参与
    });
    if (respondIds.size) {
      const responders = ordered.filter(p => respondIds.has(p.id)).map(p => p.name).join('、');
      addGroupMessage({
        role: 'system',
        content: simpleMode
          ? `🧭 简单对话，${responders} 直接回应`
          : `🧭 智能调度：${responders} 直接回应，${contributors.filter(p => !respondIds.has(p.id)).map(p => p.name).join('、') || '无其他成员'}接力产出`,
      });
    } else if (contributors.length) {
      addGroupMessage({
        role: 'system',
        content: `${contributors.map(p => p.name).join('、')} 接下了任务，开始接力产出`,
      });
    } else if (!controller.signal.aborted) {
      addGroupMessage({ role: 'system', content: '本轮暂无成员认领——试试 @ 具体成员点名参与' });
    }

    /* ---- Phase 2：认领成员并行产出（v16：每个成员都是独立个体，共享同一份白板，互不等待） ---- */
    await Promise.allSettled(contributors.map(async (preset) => {
      if (controller.signal.aborted) return;
      const placeholder = addGroupMessage({
        role: 'agent', agentId: preset.id, agentName: preset.name,
        content: '', status: 'running', meta: { phase: 'work', runId },
      });
      if (!placeholder?.id) throw new Error('占位消息创建失败');
      const shared = buildSharedTranscript(getActiveChat().messages.filter(m => m.id !== placeholder.id), 14, active.announcement);
      const isResponder = respondIds.has(preset.id);
      const myClaim = isResponder
        ? (simpleMode
          ? '（创始人简单提问，你被调度为最相关的回应者：直接给出简洁准确的回复，不要长篇产出）'
          : '（被调度为直接回应者）')
        : (claims.get(preset.id)?.claimText || '');
      const objective = buildWorkObjective(preset, shared, userText, myClaim);
      const result = await runMember(preset, objective, placeholder);
      const ok = result.status === 'done' && result.report;
      updateGroupMessage(placeholder.id, {
        content: ok ? result.report : `⚠️ ${result.error || '未产出内容'}`,
        status: ok ? 'done' : result.status,
        meta: { phase: 'work', runId, turns: result.turns, tokens: result.usage?.total_tokens || 0 },
      });
    }));
    return claims;
  }, [active, buildClaimObjective, buildWorkObjective]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    if (roster.length === 0) { showToast('先邀请成员进群，再发消息协作'); return; }
    if (!runtime.llmConfig?.baseUrl || !runtime.selectedModel) { onNeedConfig?.(); return; }

    const mentioned = parseMentions(text, rosterPresets);
    const mentionedIds = new Set(mentioned.map(p => p.id));
    const runId = `run_${Date.now().toString(36)}`;

    addGroupMessage({ role: 'user', content: text });
    setInput('');
    setMentionQuery(null);
    setGroupRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const runMember = makeRunMember(controller);

    try {
      /* ---- v26.8 智能调度：先分流再广播（失败降级全员认领；被 @ 者无条件参与） ---- */
      let ordered = [
        ...rosterPresets.filter(p => mentionedIds.has(p.id)),
        ...rosterPresets.filter(p => !mentionedIds.has(p.id)),
      ];
      let respondIds = new Set();
      let simpleMode = false;
      const verdict = await runTaskRouter({ userText: text, signal: controller.signal });
      if (verdict) {
        simpleMode = verdict.simple;
        respondIds = new Set([...verdict.respond, ...mentionedIds]);
        const considerIds = verdict.consider.filter(id => !respondIds.has(id));
        ordered = [
          ...rosterPresets.filter(p => respondIds.has(p.id)),
          ...rosterPresets.filter(p => considerIds.includes(p.id)),
        ];
        // 透明度：未参与成员明确告知（而非无声消失）
        const silent = rosterPresets.filter(p => !respondIds.has(p.id) && !considerIds.includes(p.id));
        if (silent.length && !simpleMode) {
          addGroupMessage({
            role: 'system',
            content: `🧭 智能调度：${silent.map(p => p.name).join('、')} 与本条职责无关，本轮未参与`,
          });
        }
      }

      await runRoundPhases({ controller, runMember, ordered, mentionedIds, userText: text, runId, respondIds, simpleMode });
    } catch (err) {
      // 防御：unexpected 异常也以系统行落进群聊，而不是无声消失（中止由 finally 提示）
      if (err?.name !== 'AbortError') {
        addGroupMessage({ role: 'system', content: `⚠️ 团队协作异常中断：${err?.message || err}` });
      }
    } finally {
      if (controller.signal.aborted) {
        addGroupMessage({ role: 'system', content: '⏹ 团队协作已被创始人中止' });
      }
      setGroupRunning(false);
      abortRef.current = null;
    }
  }, [input, running, roster, rosterPresets, active, runtime, onNeedConfig, makeRunMember, runRoundPhases, runTaskRouter]);

  const handleStop = () => {
    abortRef.current?.abort();
    goalAbortRef.current?.abort(); // Goal 循环与普通消息共用「停止」按钮
  };

  /* ================= Goal 目标机制（v26 #12） =================
   * 设定目标 → 团队自主多轮推进（每轮 = 认领 + 产出）→ 每轮结束由评估器判定
   * 是否达成 → 达成即停 / 达到轮数上限即停 / 创始人随时安全退出（进度保留可续跑）。
   * 卸载兜底：组件卸载时 abort，store 加载时残留 running 自动落为 stopped。 */

  /** Goal 评估器：读最近产出，判定目标是否达成（独立轻量调用，不产生聊天气泡） */
  const evaluateGoalProgress = useCallback(async (goalText, round, signal) => {
    const recent = getActiveChat().messages
      .filter(m => m.role === 'agent' && m.meta?.phase === 'work' && m.status === 'done')
      .slice(-6)
      .map(m => `[${m.agentName || m.agentId}]: ${String(m.content || '').slice(0, 800)}`)
      .join('\n\n');
    const systemPrompt = [
      '你是团队目标评估器（中立裁判）。给定「团队目标」与最近一轮的「团队产出」，判定目标是否已经达成。',
      '判定标准：产出是否覆盖了目标的核心要求；形式上未完成但实质内容已达标的，也算达成。',
      '只输出两行，不要任何多余内容：',
      '第一行：仅输出「【达成】」或「【未达成】」',
      '第二行：不超过 80 字的判定理由；若未达成，附一句下一轮的推进建议',
    ].join('\n');
    const prompt = `【团队目标】\n${goalText}\n\n【第 ${round} 轮团队产出】\n${recent || '（本轮无有效产出）'}`;
    try {
      const res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          baseUrl: runtime.llmConfig.baseUrl,
          apiKey: runtime.llmConfig.apiKey,
          model: runtime.selectedModel,
          action: 'chat',
          content: prompt,
          systemPrompt,
          messages: [],
        }),
      });
      const data = await res.json();
      const text = String(data.content || '');
      const achieved = text.includes('【达成】') && !text.includes('【未达成】');
      const reason = text.replace(/【未?达成】/g, '').trim().slice(0, 200) || '（无判定理由）';
      return { achieved, reason };
    } catch (e) {
      if (e?.name === 'AbortError') return { achieved: false, reason: '', aborted: true };
      return { achieved: false, reason: `评估器调用失败：${e?.message || e}` };
    }
  }, [runtime]);

  /** Goal 主循环：自主多轮推进直至达成/上限/安全退出 */
  const runGoal = useCallback(async ({ resume = false } = {}) => {
    const goalText = String(active.announcement || '').trim();
    if (!goalText) { showToast('先在目标区写下目标内容，再启动 Goal'); return; }
    if (running || goalAbortRef.current) return;
    if (roster.length === 0) { showToast('先邀请成员进群，团队才能推进目标'); return; }
    if (!runtime.llmConfig?.baseUrl || !runtime.selectedModel) { onNeedConfig?.(); return; }

    const maxRounds = getChatGoal().maxRounds || 8;
    const startRound = resume ? (getChatGoal().round || 0) : 0;
    setChatGoal({ status: 'running', round: startRound });
    addGroupMessage({ role: 'system', content: resume
      ? `🎯 Goal 继续推进（已完成 ${startRound} 轮，从第 ${startRound + 1} 轮继续）`
      : `🎯 Goal 启动：团队将围绕目标自主多轮推进（上限 ${maxRounds} 轮），每轮结束自动评估是否达成，可随时安全退出` });
    setGroupRunning(true);
    const controller = new AbortController();
    goalAbortRef.current = controller;
    const runMember = makeRunMember(controller);

    try {
      let achieved = false;
      let aborted = false;
      for (let round = startRound + 1; round <= maxRounds; round += 1) {
        if (controller.signal.aborted) { aborted = true; break; }
        addGroupMessage({ role: 'system', content: `▶️ Goal 第 ${round}/${maxRounds} 轮开始自主推进` });
        const roundText = [
          `【Goal 目标推进 · 第 ${round}/${maxRounds} 轮】（Goal 自动循环发起，非创始人消息）`,
          `团队目标：${goalText}`,
          round === 1
            ? '这是目标模式第一轮，请从你的职责出发，认领本轮可执行的一步。'
            : '请结合此前各轮产出继续推进；如果你的部分已完成且本轮无新贡献点，可输出【旁观】。',
        ].join('\n');
        await runRoundPhases({
          controller, runMember,
          ordered: rosterPresets, mentionedIds: new Set(),
          userText: roundText,
          runId: `goal_${round}_${Date.now().toString(36)}`,
        });
        if (controller.signal.aborted) { aborted = true; break; }
        const verdict = await evaluateGoalProgress(goalText, round, controller.signal);
        if (verdict.aborted) { aborted = true; break; }
        addGroupMessage({ role: 'system', content: verdict.achieved
          ? `🎯 第 ${round} 轮评估：目标已达成 —— ${verdict.reason}`
          : `🔁 第 ${round} 轮评估：未达成 —— ${verdict.reason}` });
        setChatGoal({ round });
        if (verdict.achieved) { achieved = true; break; }
      }
      if (aborted) {
        const kept = getChatGoal().round;
        setChatGoal({ status: 'stopped' });
        addGroupMessage({ role: 'system', content: `⏹ Goal 已安全退出（已完成 ${kept}/${maxRounds} 轮，进度保留，可随时继续推进）` });
      } else if (achieved) {
        setChatGoal({ status: 'done' });
        addGroupMessage({ role: 'system', content: '🏁 Goal 达成！团队目标已完成' });
      } else {
        setChatGoal({ status: 'stopped' });
        addGroupMessage({ role: 'system', content: `⚠️ Goal 已达最大轮数（${maxRounds} 轮）自动停止——可继续推进，或调整目标后重新启动` });
      }
    } catch (err) {
      setChatGoal({ status: 'failed' });
      addGroupMessage({ role: 'system', content: `⚠️ Goal 执行异常终止：${err?.message || err}（可重试）` });
    } finally {
      goalAbortRef.current = null;
      setGroupRunning(false);
    }
  }, [active, running, roster, rosterPresets, runtime, onNeedConfig, makeRunMember, runRoundPhases, evaluateGoalProgress]);

  const handleGoalStop = useCallback(() => { goalAbortRef.current?.abort(); }, []);

  // 卸载兜底：Goal 循环随组件卸载安全退出（store 侧 sanitizeGoal 也会把残留 running 落为 stopped）
  useEffect(() => () => { goalAbortRef.current?.abort(); }, []);

  /* ---------- 失败重试：按 runId 重建该成员的认领/产出任务 ---------- */
  const retryMessage = useCallback(async (m) => {
    if (running) return;
    if (!runtime.llmConfig?.baseUrl || !runtime.selectedModel) { onNeedConfig?.(); return; }
    const preset = rosterPresets.find(p => p.id === m.agentId);
    if (!preset) { showToast('该成员已不在群聊中，无法重试'); return; }
    const phase = m.meta?.phase === 'claim' ? 'claim' : 'work';
    const lastUser = [...messages].reverse().find(x => x.role === 'user' && x.at <= m.at);
    if (!lastUser) { showToast('找不到原始任务消息，无法重试'); return; }
    const text = lastUser.content;
    const shared = buildSharedTranscript(messages.filter(x => x.id !== m.id && x.status !== 'running'), 14, active.announcement);
    // 同一轮（runId）的上下文：我的认领 + 我之前已完成成员的产出
    const sameRun = messages.filter(x => x.meta?.runId && x.meta.runId === m.meta?.runId);
    const myClaim = phase === 'work'
      ? (sameRun.find(x => x.role === 'agent' && x.agentId === m.agentId && x.meta?.phase === 'claim' && x.status === 'done')?.content || '')
      : '';
    const objective = phase === 'claim'
      ? buildClaimObjective(preset, shared, text)
      : buildWorkObjective(preset, shared, text, myClaim);

    updateGroupMessage(m.id, { content: '', status: 'running' });
    setGroupRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await makeRunMember(controller)(preset, objective, m);
      const ok = result.status === 'done' && result.report;
      const patch = {
        content: ok ? result.report : `⚠️ ${result.error || '未产出内容'}`,
        status: ok ? 'done' : result.status,
        meta: { ...m.meta, turns: result.turns, tokens: result.usage?.total_tokens || 0 },
      };
      if (phase === 'claim') {
        const claimText = String(patch.content);
        patch.meta.kind = claimText.startsWith('【认领】') ? 'claim'
          : claimText.startsWith('【关注】') ? 'watch'
            : claimText.startsWith('【旁观】') ? 'bystander' : 'claim';
      }
      updateGroupMessage(m.id, patch);
    } finally {
      if (controller.signal.aborted) {
        addGroupMessage({ role: 'system', content: '⏹ 团队协作已被创始人中止' });
      }
      setGroupRunning(false);
      abortRef.current = null;
    }
  }, [running, runtime, messages, rosterPresets, active, onNeedConfig, makeRunMember, buildClaimObjective, buildWorkObjective]);

  return (
    <div className="gtc">
      {/* ============ 顶栏：头像叠放 | 居中群名（只显示名称） | 记录/导出/清空/面板 ============
          群聊的创建/重命名/解散/切换统一在左侧栏团队 tab 管理（v12） */}
      <div className="gtc-topbar">
        {/* 成员头像叠放（微信桌面版顶栏头像堆同款）：点击开右侧群信息面板 */}
        <button
          type="button"
          className={`gtc-avatar-stack ${panelOpen ? 'open' : ''}`}
          onClick={togglePanel}
          title={`群信息：公告 / 成员（${roster.length}）/ 记录筛选`}
        >
          {rosterPresets.slice(0, 5).map(p => (
            <MemberAvatar key={p.id} preset={p} hue={hueOfMemberId(p.id)} size={20} />
          ))}
          <span className="gtc-avatar-stack-count">{roster.length}</span>
        </button>

        <div className="gtc-topbar-title">
          <h3 title={active.name || '团队群聊'}>{active.name || '团队群聊'}</h3>
        </div>

        <div className="gtc-topbar-actions">
          {onViewRecords && (
            <button type="button" className="gtc-topbar-btn" onClick={onViewRecords} title="spawn_agent_team 的任务板与邮箱记录">记录</button>
          )}
          <button type="button" className="gtc-topbar-btn" onClick={handleExportChat} title="导出群聊记录到素材库">导出</button>
          <button
            type="button"
            className="gtc-topbar-btn"
            onClick={() => { if (messages.length && window.confirm('清空当前群聊记录？')) clearGroupChat(); }}
            title="清空聊天记录"
          >清空</button>
          <button
            type="button"
            className={`gtc-topbar-btn gtc-panel-toggle ${panelOpen ? 'active' : ''}`}
            onClick={togglePanel}
            title="群信息面板（公告 / 成员 / 筛选）"
          >ⓘ</button>
        </div>
      </div>

      {/* ============ 主体：消息流 + 群信息面板 ============ */}
      <div className="gtc-body">
        <div className="gtc-main">
          <div className="gtc-stream custom-scrollbar" ref={streamElRef} onScroll={handleStreamScroll}>
            {messages.length === 0 && (
              <div className="gtc-empty">
                <p className="gtc-empty-title">建立你的第一个团队</p>
                <p className="gtc-empty-desc">
                  ① 点右上角 ⓘ 打开群信息面板，「＋ 邀请」拉成员进群；点成员可编辑角色卡<br />
                  ② 在「目标 · Goal」里写下目标，点「启动 Goal」，团队将自主多轮推进直到达成<br />
                  ③ 直接发消息；@ 某位成员可指定 TA 优先响应，全员认领协作<br />
                  ④ 气泡上可复制 / 保存到素材库，顶栏「导出」沉淀整群记录
                </p>
                <p className="gtc-empty-example">例：@探索者 检索今天端侧模型的资讯，@研究员 交叉验证，@撰写者 写成简报</p>
              </div>
            )}
            {messages.length > 0 && visibleMessages.length === 0 && (
              <div className="gtc-system-line">该筛选下暂无消息</div>
            )}
            {visibleMessages.map((m, i) => {
              const prev = visibleMessages[i - 1];
              const showDivider = !prev || (m.at - prev.at) > DIVIDER_GAP_MS;
              // Fragment 扁平渲染：分隔线与消息都是 .gtc-stream 的直接 flex 子项，
              // 不包 wrapper div（否则 align-self 对齐与 scrollIntoView 定位失效）
              if (m.role === 'system') {
                return (
                  <Fragment key={m.id}>
                    {showDivider && (
                      <div className="gtc-time-divider"><span>{fmtDivider(m.at)}</span></div>
                    )}
                    <div className="gtc-system-line" data-mid={m.id}>{m.content}</div>
                  </Fragment>
                );
              }
              if (m.role === 'user') {
                return (
                  <Fragment key={m.id}>
                    {showDivider && (
                      <div className="gtc-time-divider"><span>{fmtDivider(m.at)}</span></div>
                    )}
                    <div className="gtc-msg is-user" data-mid={m.id}>
                      <div className="gtc-bubble">
                        <div className="gtc-bubble-text">{renderUserContent(m.content, rosterPresets)}</div>
                        <div className="gtc-bubble-foot"><time>{fmtClock(m.at)}</time></div>
                      </div>
                      <FounderAvatar size={26} />
                    </div>
                  </Fragment>
                );
              }
              const hue = hueOfMemberId(m.agentId || preset.id || 'agent');
              const preset = rosterPresets.find(p => p.id === m.agentId) || { name: m.agentName || m.agentId || '系统' };
              const done = m.status === 'done' && m.content;
              const failed = m.status === 'failed' || m.status === 'aborted';
              const quote = m.meta?.quote;
              return (
                <Fragment key={m.id}>
                  {showDivider && (
                    <div className="gtc-time-divider"><span>{fmtDivider(m.at)}</span></div>
                  )}
                  <div className={`gtc-msg is-agent ${m.status === 'running' ? 'is-running' : ''} ${failed ? 'is-error' : ''}`} data-mid={m.id}>
                    <MemberAvatar preset={preset} hue={hue} />
                    <div className="gtc-bubble">
                      {/* 接力引用块（微信引用样式）：点按定位上一位产出者 */}
                      {quote && m.status !== 'running' && (
                        <button type="button" className="gtc-quote" onClick={() => jumpToMessage(quote.mid)} title="点击定位原消息">
                          <span className="gtc-quote-from">{quote.from}</span>
                          <span className="gtc-quote-text">{quote.text}</span>
                        </button>
                      )}
                      <div className="gtc-bubble-head">
                        <b style={{ color: `hsl(${hue} 85% 70%)` }}>{m.agentName || m.agentId}</b>
                        {m.meta?.phase === 'claim' && (
                          <span className={`gtc-phase-tag is-${m.meta?.kind || 'claim'}`}>{KIND_LABEL[m.meta?.kind] || '认领'}</span>
                        )}
                        {m.meta?.phase === 'work' && <span className="gtc-phase-tag is-work">产出</span>}
                        {m.status === 'running' && <span className="gtc-running-tag">执行中…</span>}
                      </div>
                      {m.status === 'running'
                        ? (m.content
                          ? <div className="gtc-bubble-text gtc-streaming">{m.content}</div>
                          : <div className="gtc-typing"><span /><span /><span /></div>)
                        : failed
                          ? <div className="gtc-bubble-text">{m.content}</div>
                          : (
                            /* 成员输出是结构化报告：走 Markdown 渲染（标题/列表/表格/代码块） */
                            <div
                              className="gtc-bubble-text markdown-body gtc-markdown"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(String(m.content || '')) }}
                            />
                          )}
                      <div className="gtc-bubble-foot">
                        <time>{fmtClock(m.at)}</time>
                        {m.meta?.turns > 0 && (
                          <span className="gtc-bubble-meta">
                            {m.meta.turns} 轮{m.meta.tokens ? ` · ${Number(m.meta.tokens).toLocaleString()} tok` : ''}
                          </span>
                        )}
                        {done && (
                          <span className="gtc-msg-actions">
                            <button type="button" onClick={() => handleCopyMessage(m)} title="复制内容">复制</button>
                            <button type="button" onClick={() => handleSaveMessage(m)} title="保存到素材库">存素材</button>
                          </span>
                        )}
                        {failed && (
                          <span className="gtc-msg-actions">
                            <button type="button" className="gtc-retry-btn" disabled={running} onClick={() => retryMessage(m)} title="按原任务重跑该成员">重试</button>
                            <button type="button" onClick={() => handleCopyMessage(m)} title="复制内容">复制</button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {running && <div className="gtc-pipeline-hint">团队协作中：成员正在认领与接力推进任务…</div>}
          </div>
          {!atBottom && (
            <button type="button" className="gtc-jump-latest" onClick={jumpToBottom}>
              ↓ 有新消息{unread > 0 ? ` · ${unread}` : ''}
            </button>
          )}
        </div>

        {/* ============ 右侧群信息面板（微信桌面版群信息同款布局） ============ */}
        {panelOpen && (
          <aside className="gtc-panel custom-scrollbar" ref={panelRef}>
            <section className="gtc-panel-sec">
              <div className="gtc-panel-cap">
                目标 · Goal
                <button type="button" className="gtc-panel-cap-act" onClick={editingAnn ? () => setEditingAnn(false) : startEditAnn}>
                  {editingAnn ? '收起' : '编辑'}
                </button>
              </div>
              {editingAnn ? (
                <div className="gtc-ann-editor">
                  <textarea
                    value={annDraft}
                    onChange={e => setAnnDraft(e.target.value)}
                    rows={4}
                    maxLength={600}
                    placeholder="设定团队目标（Goal）：启动后成员将自主多轮推进，直到评估达成（≤600 字）"
                    autoFocus
                  />
                  <div className="gtc-ann-actions">
                    <button type="button" className="gtc-panel-entry is-primary" onClick={saveAnnouncement}>保存目标</button>
                  </div>
                </div>
              ) : (
                <>
                  <p
                    className={`gtc-ann-body ${active.announcement ? '' : 'is-empty'}`}
                    onDoubleClick={startEditAnn}
                    title="双击编辑"
                  >
                    {active.announcement || '未设定——写下目标后启动 Goal，团队将自主多轮推进直到达成'}
                  </p>
                  {active.announcement && (
                    <div className="gtc-goal-bar">
                      <span className={`gtc-goal-status is-${goalStatus}`}>{GOAL_STATUS_LABEL[goalStatus] || goalStatus}</span>
                      <span className="gtc-goal-round">
                        第 {Math.min(goalRound + (goalStatus === 'running' ? 1 : 0), goalMaxRounds)} / {goalMaxRounds} 轮
                      </span>
                      {goalStatus === 'running' ? (
                        <button type="button" className="gtc-panel-entry" onClick={handleGoalStop} title="中止自主循环，保留当前进度">安全退出</button>
                      ) : goalStatus === 'done' || goalRound >= goalMaxRounds ? (
                        <button
                          type="button"
                          className="gtc-panel-entry is-primary"
                          disabled={running}
                          onClick={() => runGoal({ resume: false })}
                          title="重置轮数，从头推进目标"
                        >重新启动</button>
                      ) : (
                        <button
                          type="button"
                          className="gtc-panel-entry is-primary"
                          disabled={running}
                          onClick={() => runGoal({ resume: goalRound > 0 })}
                          title={goalRound > 0 ? '从已完成轮数之后继续推进' : '启动自主循环'}
                        >
                          {goalStatus === 'failed' ? '重试' : goalRound > 0 ? '继续推进' : '启动 Goal'}
                        </button>
                      )}
                    </div>
                  )}
                  {goalStatus === 'running' && (
                    <div className="gtc-goal-hint">成员正在自主多轮推进目标；「停止」或「安全退出」都会保留进度。</div>
                  )}
                </>
              )}
            </section>

            <section className="gtc-panel-sec">
              <div className="gtc-panel-cap">成员 {roster.length}/6</div>
              <div className="gtc-panel-members">
                {rosterPresets.map((p, i) => (
                  <div key={p.id} className="gtc-panel-member">
                    <button
                      type="button"
                      className="gtc-panel-member-main"
                      onClick={() => setRoleCard({ id: p.id, create: false })}
                      title="查看/编辑角色卡"
                    >
                      <MemberAvatar preset={p} hue={hueOfMemberId(p.id)} size={30} />
                      <span className="gtc-panel-member-info">
                        <b>{p.name}</b>
                        <small>{(p.description || '自定义成员').slice(0, 24)}</small>
                      </span>
                    </button>
                    {!running && (
                      <button type="button" className="gtc-member-remove" title="请出群聊" onClick={() => removeMember(p.id)}>×</button>
                    )}
                  </div>
                ))}
                <div className="gtc-invite-wrap gtc-panel-invite">
                  <button
                    type="button"
                    className="gtc-panel-member-add"
                    onClick={() => setInvitingOpen(v => !v)}
                    disabled={running || rosterPresets.length >= 6}
                    title="邀请成员进群"
                  >＋ 邀请</button>
                  {invitingOpen && (
                    <div className="gtc-invite-menu">
                      {allPresets.filter(p => !roster.includes(p.id)).map(p => (
                        <button key={p.id} type="button" onClick={() => { inviteMember(p.id); setInvitingOpen(false); }}>
                          <b>{p.name}{String(p.id).startsWith('cr_') ? ' ·自建' : ''}</b>
                          <small>{(p.description || '').slice(0, 20)}…</small>
                        </button>
                      ))}
                      {allPresets.every(p => roster.includes(p.id)) && <div className="gtc-invite-empty">现有成员都已在群里</div>}
                      <div className="gtc-invite-divider" />
                      <button type="button" className="gtc-invite-create" onClick={() => { setInvitingOpen(false); setRoleCard({ create: true }); }}>
                        ＋ 创建自定义角色
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="gtc-panel-sec">
              <div className="gtc-panel-cap">记录筛选</div>
              <div className="gtc-filter-chips">
                {[['all', '全部'], ['work', '产出'], ['claim', '认领'], ['system', '系统']].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={streamFilter === k ? 'active' : ''}
                    onClick={() => setStreamFilter(k)}
                  >{label}</button>
                ))}
              </div>
            </section>
          </aside>
        )}
      </div>

      {/* ============ 输入区 ============ */}
      <div className="gtc-input-wrap">
        {mentionQuery != null && (
          <div className="gtc-mention-pop">
            {mentionCandidates.length === 0 && <div className="gtc-mention-empty">群聊里没有匹配的成员</div>}
            {mentionCandidates.map(p => (
              <button key={p.id} type="button" onClick={() => pickMention(p)}>
                <b>@{p.name}</b>
                <small>{(p.description || '').slice(0, 24)}…</small>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="gtc-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && mentionQuery == null) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={running ? '团队协作执行中…' : '发消息给团队（@ 成员可指定优先响应；Enter 发送，Shift+Enter 换行）'}
          rows={2}
          disabled={running}
        />
        {running
          ? <button type="button" className="gtc-send is-stop" onClick={handleStop}>停止</button>
          : <button type="button" className="gtc-send" onClick={handleSend} disabled={!input.trim()}>发送</button>}
      </div>

      {/* ============ 成员角色卡（查看/编辑/创建） ============ */}
      {roleCard && (
        <AgentRoleCard
          role={roleCard.create
            ? null
            : (() => {
              const all = getAllRolePresets();
              const base = all.find(p => p.id === roleCard.id) || {};
              const eff = rosterPresets.find(p => p.id === roleCard.id) || base;
              return { ...base, ...eff, styleOverride: eff.styleOverride || '' };
            })()}
          isCustom={String(roleCard.id || '').startsWith('cr_')}
          isBuiltIn={Boolean(roleCard.id) && !String(roleCard.id).startsWith('cr_')}
          onCreateInvite={(saved) => { if (saved) inviteMember(saved.id); }}
          onClose={() => setRoleCard(null)}
        />
      )}
    </div>
  );
}
