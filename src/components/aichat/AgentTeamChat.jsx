/**
 * AgentTeamChat - 团队群聊页（「一个人的公司」协作空间）
 *
 * - 紧凑顶栏（v8）：群名下拉（切换/重命名/解散/新建）+ 成员 chips（点击开角色卡）
 *   + ＋邀请 + 导出/清空/执行记录；移除旧大标题与群聊切换条，为对话区让空间
 * - 成员灵魂（v8）：每个成员有职责 + 性格风格（内置成员本群覆盖，自定义角色全局），
 *   注入 systemPrompt，认领与产出都带独特口吻；角色卡可查看/编辑/保存
 * - 自定义角色（v8）：角色库持久化，创建即入群；工具白名单给默认读集
 * - 气泡常用操作（v8）：hover 复制 / 保存到素材库；顶栏导出整群记录
 * - 两阶段广播流水线（v7）：每条消息全员收到 → Phase 1 角色认领 → Phase 2 协作产出
 * - 执行核：复用 subagentRunner.runOneSubagent（独立工具白名单/预算/审批会话）
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { runOneSubagent } from './subagentRunner.js';
import AgentRoleCard from './AgentRoleCard.jsx';
import { renderMarkdown } from '../../utils/markdown.jsx';
import { downloadMarkdown } from '../../utils/workspace.js';
import {
  getGroupState, getActiveChat, subscribeGroup, inviteMember, removeMember,
  addGroupMessage, updateGroupMessage, setGroupRunning, clearGroupChat,
  createChat, switchChat, renameChat, deleteChat,
  resolveMemberPreset, getAllRolePresets, subscribeCustomRoles,
} from './groupChatStore.js';
import { showToast } from '../../utils/toast.js';

const MEMBER_HUES = [190, 150, 40, 280, 20, 330]; // 成员头像色相（按入群顺序）

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

/** 群聊消息 → 共享上下文转写（全员可见的同一份"会议室白板"） */
function buildSharedTranscript(messages, limit = 14) {
  const recent = messages.filter(m => m.status !== 'running' && m.content).slice(-limit);
  if (!recent.length) return '（群聊刚建立，还没有历史消息）';
  return recent.map(m => m.role === 'user'
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

export default function AgentTeamChat({
  runtime = {},
  onSaveMaterial,
  onViewRecords,
  onNeedConfig,
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

  const [input, setInput] = useState('');
  const [inviting, setInviting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null); // null | string（@后的过滤词）
  // 顶栏状态：群名下拉 / 行内重命名 / 角色卡（null | {id, create}）
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [roleCard, setRoleCard] = useState(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const streamRef = useRef(null);
  const topbarMenuRef = useRef(null);

  useEffect(() => {
    streamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, running]);

  // 角色解析：内置 preset + 自定义角色 + 本群性格档案覆盖（灵魂注入后的生效版）
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

  /* ---------- 群聊管理：重命名 / 解散 / 切换（顶栏下拉） ---------- */
  const startRename = () => {
    setRenameDraft(active.name || '');
    setShowChatMenu(false);
    setRenaming(true);
  };
  const commitRename = () => {
    const next = renameDraft.trim();
    if (next && next !== active.name) {
      if (renameChat(active.id, next)) showToast('群聊已重命名');
    }
    setRenaming(false);
  };
  const dissolveChat = () => {
    if (chats.length <= 1) { showToast('至少保留一个群聊'); return; }
    if (window.confirm(`解散群聊「${active.name}」？聊天记录将不可恢复。`)) {
      if (deleteChat(active.id)) showToast('群聊已解散');
    }
    setShowChatMenu(false);
  };
  const newChat = () => {
    const c = createChat();
    if (c) showToast(`已创建「${c.name}」，邀请成员开始协作`);
    setShowChatMenu(false);
  };

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
      '',
      '---',
      '',
      ...messages.map(m => (m.role === 'user'
        ? `## 🧑 创始人 · ${formatTime(m.at)}\n\n${m.content}`
        : `## 🤖 ${m.agentName || m.agentId}${m.meta?.phase === 'claim' ? '（认领）' : ''} · ${formatTime(m.at)}\n\n${m.content}`)),
    ].join('\n');
    saveMaterial({
      title: `群聊记录·${active.name}·${new Date().toLocaleDateString('zh-CN')}`,
      content: md.slice(0, 2000),
      fullContent: md,
      type: 'note',
      source: '团队群聊',
      tags: ['团队群聊', '导出'],
    });
  }, [messages, active, rosterPresets, saveMaterial]);

  /* ---------- 两阶段广播流水线（v7） ---------- */
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    if (roster.length === 0) { showToast('先邀请成员进群，再发消息协作'); return; }
    if (!runtime.llmConfig?.baseUrl || !runtime.selectedModel) { onNeedConfig?.(); return; }

    const mentioned = parseMentions(text, rosterPresets);
    const mentionedIds = new Set(mentioned.map(p => p.id));
    // 广播顺序：被 @ 的成员优先接收，其余按入群顺序
    const ordered = [
      ...rosterPresets.filter(p => mentionedIds.has(p.id)),
      ...rosterPresets.filter(p => !mentionedIds.has(p.id)),
    ];

    addGroupMessage({ role: 'user', content: text });
    setInput('');
    setMentionQuery(null);
    setGroupRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // 防御： unexpected 异常也以失败气泡落进群聊，而不是无声消失
    let failureCaught = null;

    const parentCtx = {
      sessionId: 'team-group-chat',
      approvalMode: runtime.approvalMode || 'semi',
      tavilyKey: runtime.tavilyKey || '',
      doubaoSearchKey: runtime.doubaoSearchKey || '',
      webSearchEnabled: runtime.webSearchEnabled !== false,
    };
    const runMember = (preset, objective, placeholder) => runOneSubagent(
      { id: `gtc_${placeholder.id}`, index: 0, preset, objective },
      {
        llmConfig: runtime.llmConfig,
        selectedModel: runtime.selectedModel,
        parentCtx,
        signal: controller.signal,
        persist: false, // 群聊消息轮次不落盘，避免 outputs/ 噪音
      },
    );

    try {
      /* ---- Phase 1：全员广播 · 角色认领（systemPrompt 已带性格灵魂） ---- */
      const claims = new Map(); // presetId → { preset, claimText, kind }
      for (const preset of ordered) {
        if (controller.signal.aborted) break;
        const placeholder = addGroupMessage({
          role: 'agent', agentId: preset.id, agentName: preset.name,
          content: '', status: 'running', meta: { phase: 'claim' },
        });
        if (!placeholder?.id) { failureCaught = new Error('占位消息创建失败'); break; }
        const shared = buildSharedTranscript(getActiveChat().messages.filter(m => m.id !== placeholder.id));
        const objective = [
          '【群聊共享上下文】（全员可见的同一份白板）',
          shared,
          '',
          `【本轮用户消息】${text}`,
          '',
          '【你的任务：认领阶段】',
          `你是群成员「${preset.name}」。请基于你的角色职责判断如何回应这条消息，只输出认领声明本身（不要执行任务、不要展开工作）。用你自己的性格和说话风格表达，一句话也要有你的味道：`,
          '- 消息与你的职责相关且你愿承担 → 第一行输出「【认领】」，随后 ≤60 字说明你打算做什么；',
          '- 值得补充观点但无需深度参与 → 第一行输出「【关注】」，随后一句简短看法（≤40 字）；',
          '- 与你职责无关 → 输出「【旁观】」即可（可带一句符合性格的短评）。',
        ].join('\n');
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
          meta: { phase: 'claim', turns: result.turns, tokens: result.usage?.total_tokens || 0 },
        });
        claims.set(preset.id, { preset, claimText, kind });
      }

      /* ---- Phase 2：认领成员协作产出（共享转写含彼此认领与前序产出） ---- */
      const contributors = ordered.filter(p => {
        const c = claims.get(p.id);
        return c && (c.kind === 'claim' || mentionedIds.has(p.id)); // 被 @ 点名者必然参与
      });
      let priorRound = '';
      for (const preset of contributors) {
        if (controller.signal.aborted) break;
        const placeholder = addGroupMessage({
          role: 'agent', agentId: preset.id, agentName: preset.name,
          content: '', status: 'running', meta: { phase: 'work' },
        });
        if (!placeholder?.id) { failureCaught = new Error('占位消息创建失败'); break; }
        const shared = buildSharedTranscript(getActiveChat().messages.filter(m => m.id !== placeholder.id));
        const myClaim = claims.get(preset.id)?.claimText || '';
        const objective = [
          '【群聊共享上下文】（含本轮各成员的认领声明，彼此可见）',
          shared,
          '',
          `【本轮用户指令】${text}`,
          '',
          myClaim ? `【你已认领】${myClaim}` : '【你的认领】（被创始人点名参与，直接承担）',
          '',
          priorRound
            ? `【前序成员产出】（请引用/校对/深化，不要重复劳动；有不同意见可以直接在产出里回应队友）\n${priorRound}`
            : '【前序成员产出】（你是本轮第一个执行者，负责打好第一棒）',
          '',
          `请执行你认领的部分，直接给出结构化产出（这是发到群里的回复，不要寒暄）。保持你的性格与说话风格${priorRound ? '，并与前序成员的产出形成呼应或讨论' : ''}。`,
        ].join('\n');
        const result = await runMember(preset, objective, placeholder);
        const ok = result.status === 'done' && result.report;
        updateGroupMessage(placeholder.id, {
          content: ok ? result.report : `⚠️ ${result.error || '未产出内容'}`,
          status: ok ? 'done' : result.status,
          meta: { phase: 'work', turns: result.turns, tokens: result.usage?.total_tokens || 0 },
        });
        priorRound += `${priorRound ? '\n\n' : ''}### @${preset.name}（${result.status === 'done' ? '已完成' : result.status}）\n${String(result.report || result.error || '').slice(0, 2400)}`;
      }
    } catch (err) {
      failureCaught = err;
    } finally {
      if (failureCaught) {
        addGroupMessage({
          role: 'agent', agentId: 'system', agentName: '系统',
          content: `⚠️ 团队协作异常中断：${failureCaught.message || failureCaught}`,
          status: 'failed',
        });
      }
      setGroupRunning(false);
      abortRef.current = null;
    }
  }, [input, running, roster, rosterPresets, runtime, onNeedConfig]);

  const handleStop = () => { abortRef.current?.abort(); };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery == null) {
      e.preventDefault();
      handleSend();
    }
  };

  // 点击顶栏外部关闭下拉
  useEffect(() => {
    if (!showChatMenu && !inviting) return undefined;
    const onDown = (e) => {
      if (!topbarMenuRef.current?.contains(e.target)) {
        setShowChatMenu(false);
        setInviting(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showChatMenu, inviting]);

  const hueOf = (idx) => MEMBER_HUES[idx % MEMBER_HUES.length];

  return (
    <div className="gtc">
      {/* ============ 紧凑顶栏：群名下拉 | 成员 chips + 邀请 | 导出/清空/记录 ============ */}
      <div className="gtc-topbar">
        <div className="gtc-topbar-left" ref={topbarMenuRef}>
          {renaming ? (
            <input
              className="gtc-rename-input"
              autoFocus
              value={renameDraft}
              onChange={e => setRenameDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                else if (e.key === 'Escape') setRenaming(false);
              }}
              onBlur={commitRename}
              maxLength={24}
            />
          ) : (
            <button
              type="button"
              className={`gtc-chatmenu-btn ${showChatMenu ? 'open' : ''}`}
              onClick={() => setShowChatMenu(v => !v)}
              title="切换 / 重命名 / 解散 / 新建群聊"
            >
              <i className="gtc-chatmenu-dot" aria-hidden="true" />
              <span className="gtc-chatmenu-name">{active.name || '团队群聊'}</span>
              <small>{messages.length}</small>
              <span className="gtc-chatmenu-caret">▾</span>
            </button>
          )}
          {showChatMenu && (
            <div className="gtc-chatmenu-pop" role="menu">
              <div className="gtc-chatmenu-label">群聊列表</div>
              {chats.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`gtc-chatmenu-item ${c.id === activeId ? 'selected' : ''}`}
                  onClick={() => { if (switchChat(c.id)) setShowChatMenu(false); }}
                  disabled={running && c.id !== activeId}
                  title={running && c.id !== activeId ? '协作执行中，暂不能切换' : `切换到「${c.name}」`}
                >
                  <span className="gtc-chatmenu-item-name">{c.name}</span>
                  <small>{c.messages.length}</small>
                  {c.id === activeId && <span className="gtc-chatmenu-check">✓</span>}
                </button>
              ))}
              <div className="gtc-chatmenu-actions">
                <button type="button" onClick={startRename} disabled={running}>✎ 重命名</button>
                <button type="button" className="is-danger" onClick={dissolveChat} disabled={running || chats.length <= 1}>✕ 解散</button>
                <button type="button" onClick={newChat} disabled={running}>＋ 新建</button>
              </div>
            </div>
          )}
        </div>

        <div className="gtc-topbar-members">
          {rosterPresets.map((p, i) => (
            <span key={p.id} className="gtc-member">
              <button
                type="button"
                className="gtc-member-chip"
                onClick={() => setRoleCard({ id: p.id, create: false })}
                title={`查看/编辑「${p.name}」的角色卡`}
              >
                <MemberAvatar preset={p} hue={hueOf(i)} size={20} />
                <span className="gtc-member-name">{p.name}</span>
              </button>
              {!running && (
                <button type="button" className="gtc-member-remove" title="请出群聊" onClick={() => removeMember(p.id)}>×</button>
              )}
            </span>
          ))}
          <div className="gtc-invite-wrap">
            <button
              type="button"
              className="gtc-invite-btn"
              onClick={() => setInviting(v => !v)}
              disabled={running || rosterPresets.length >= 6}
              title="邀请成员进群"
            >＋ 邀请</button>
            {inviting && (
              <div className="gtc-invite-menu">
                {allPresets.filter(p => !roster.includes(p.id)).map(p => (
                  <button key={p.id} type="button" onClick={() => { inviteMember(p.id); setInviting(false); }}>
                    <b>{p.name}{String(p.id).startsWith('cr_') ? ' ·自建' : ''}</b>
                    <small>{(p.description || '').slice(0, 20)}…</small>
                  </button>
                ))}
                {allPresets.every(p => roster.includes(p.id)) && <div className="gtc-invite-empty">现有成员都已在群里</div>}
                <div className="gtc-invite-divider" />
                <button type="button" className="gtc-invite-create" onClick={() => { setInviting(false); setRoleCard({ create: true }); }}>
                  ＋ 创建自定义角色
                </button>
              </div>
            )}
          </div>
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
        </div>
      </div>

      {/* ============ 群聊消息流 ============ */}
      <div className="gtc-stream custom-scrollbar">
        {messages.length === 0 && (
          <div className="gtc-empty">
            <p className="gtc-empty-title">建立你的第一个团队</p>
            <p className="gtc-empty-desc">
              ① 点「＋ 邀请」拉成员进群，点成员名可查看并编辑 TA 的角色卡（性格/职责）<br />
              ② 也可以「创建自定义角色」——设定职责与灵魂，保存即入群<br />
              ③ 直接发消息；@ 某位成员可指定 TA 优先响应，全员认领协作<br />
              ④ 气泡上可复制 / 保存到素材库，顶栏「导出」沉淀整群记录
            </p>
            <p className="gtc-empty-example">例：@探索者 检索今天端侧模型的资讯，@研究员 交叉验证，@撰写者 写成简报</p>
          </div>
        )}
        {messages.map(m => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="gtc-msg is-user">
                <div className="gtc-bubble">
                  <div className="gtc-bubble-text">{m.content}</div>
                  <time>{new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                </div>
              </div>
            );
          }
          const idx = roster.indexOf(m.agentId);
          const preset = rosterPresets.find(p => p.id === m.agentId) || { name: m.agentName || m.agentId || '系统' };
          const done = m.status === 'done' && m.content;
          return (
            <div key={m.id} className={`gtc-msg is-agent ${m.status === 'running' ? 'is-running' : ''} ${m.status === 'failed' || m.status === 'aborted' ? 'is-error' : ''}`}>
              <MemberAvatar preset={preset} hue={hueOf(idx < 0 ? 4 : idx)} />
              <div className="gtc-bubble">
                <div className="gtc-bubble-head">
                  <b>@{m.agentName || m.agentId}</b>
                  {m.meta?.phase === 'claim' && <span className="gtc-phase-tag">认领</span>}
                  {m.status === 'running' && <span className="gtc-running-tag">执行中…</span>}
                  {m.meta?.turns > 0 && <small>{m.meta.turns} 轮{m.meta.tokens ? ` · ${Number(m.meta.tokens).toLocaleString()} tokens` : ''}</small>}
                </div>
                {m.status === 'running'
                  ? <div className="gtc-typing"><span /><span /><span /></div>
                  : (
                    /* 成员输出是结构化报告：走 Markdown 渲染（标题/列表/表格/代码块） */
                    <div
                      className="gtc-bubble-text markdown-body gtc-markdown"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(String(m.content || '')) }}
                    />
                  )}
                <div className="gtc-bubble-foot">
                  <time>{new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                  {done && (
                    <span className="gtc-msg-actions">
                      <button type="button" onClick={() => handleCopyMessage(m)} title="复制内容">复制</button>
                      <button type="button" onClick={() => handleSaveMessage(m)} title="保存到素材库">存素材</button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {running && <div className="gtc-pipeline-hint">团队协作中：成员正在认领与接力推进任务…</div>}
        <div ref={streamRef} />
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
          onKeyDown={handleKeyDown}
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
