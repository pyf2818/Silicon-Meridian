/**
 * AgentTeamChat - 团队群聊页（「一个人的公司」协作空间）
 *
 * - 多群聊：可创建多个团队群聊、切换、重命名、删除（groupChatStore v2）
 * - 成员栏：从 4 个预置子代理中邀请进群（roster 持久化），可移除
 * - 群聊流：用户消息 + 各 agent 回复气泡（带执行 meta：轮次/tokens）
 * - @ 召唤：输入 @ 弹出成员选择器；支持一条消息 @ 多个成员
 * - 接力流水线：被召唤成员按提及顺序**依次执行**，每人都能看到
 *   完整群聊上下文（共享）+ 本轮前序成员的产出（彼此知晓进度），
 *   在此基础上接力完成任务 —— 共享上下文 + 显式接力，不是各说各话
 * - 执行核：复用 subagentRunner.runOneSubagent（独立工具白名单/预算/审批会话）
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { SUBAGENT_PRESETS } from '../../domain/agent/subagentCore.js';
import { runOneSubagent } from './subagentRunner.js';
import { renderMarkdown } from '../../utils/markdown.jsx';
import {
  getGroupState, getActiveChat, subscribeGroup, inviteMember, removeMember,
  addGroupMessage, updateGroupMessage, setGroupRunning, clearGroupChat,
  createChat, switchChat, renameChat, deleteChat,
} from './groupChatStore.js';
import { showToast } from '../../utils/toast.js';

const PRESET_INDEX = new Map(SUBAGENT_PRESETS.map(p => [p.id, p]));
const MEMBER_HUES = [190, 150, 40, 280, 20, 330]; // 成员头像色相（按入群顺序）

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 解析消息中的 @提及 → 按出现顺序返回去重后的 preset 列表 */
function parseMentions(text, roster) {
  const mentioned = [];
  const seen = new Set();
  const re = /@([^\s@，。,:;；！!？?]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    const preset = roster
      .map(id => PRESET_INDEX.get(id))
      .find(p => p && (p.id.toLowerCase() === token || p.name === m[1] || p.name.toLowerCase() === token));
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id);
      mentioned.push(preset);
    }
  }
  return mentioned;
}

/** 群聊消息 → 共享上下文转写（每个被召唤成员都能看到的同一份"会议室白板"） */
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

/* ---------- 单个群聊标签（切换 + 行内重命名 + 删除确认） ---------- */
function ChatChip({ chat, active, running, canDelete, onSwitch, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== chat.name) onRename(chat.id, next);
    setEditing(false);
  };

  return (
    <span
      className={`gtc-chat-chip ${active ? 'active' : ''} ${editing ? 'is-editing' : ''}`}
      onClick={() => !editing && onSwitch(chat.id)}
      title={active ? '当前群聊' : `切换到「${chat.name}」`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            else if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commitRename}
        />
      ) : (
        <>
          <span className="gtc-chat-chip-name">{chat.name}</span>
          <small>{chat.messages.length}</small>
          {active && !running && (
            <button
              type="button" className="gtc-chat-chip-act" title="重命名"
              onClick={e => { e.stopPropagation(); setDraft(chat.name); setEditing(true); }}
            >✎</button>
          )}
          {active && canDelete && !running && (
            <button
              type="button"
              className={`gtc-chat-chip-act is-danger ${confirmDel ? 'confirm' : ''}`}
              title={confirmDel ? '再次点击确认删除（群聊记录不可恢复）' : '删除该群聊'}
              onClick={e => {
                e.stopPropagation();
                if (confirmDel) { onDelete(chat.id); setConfirmDel(false); }
                else { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); }
              }}
            >{confirmDel ? '确认?' : '✕'}</button>
          )}
        </>
      )}
    </span>
  );
}

export default function AgentTeamChat({
  runtime = {},
  onViewRecords,
  onNeedConfig,
}) {
  const [snap, setSnap] = useState(() => getGroupState());
  useEffect(() => subscribeGroup(() => setSnap({ ...getGroupState() })), []);
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
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    streamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, running]);

  const rosterPresets = useMemo(() => roster.map(id => PRESET_INDEX.get(id)).filter(Boolean), [roster]);
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

  /* ---------- 接力流水线执行 ---------- */
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    if (roster.length === 0) { showToast('先邀请成员进群，再用 @ 召唤'); return; }
    const mentioned = parseMentions(text, roster);
    if (mentioned.length === 0) {
      showToast('用 @ 召唤成员参与，例如：@研究员 调研一下 XX');
      return;
    }
    if (!runtime.llmConfig?.baseUrl || !runtime.selectedModel) { onNeedConfig?.(); return; }

    addGroupMessage({ role: 'user', content: text });
    setInput('');
    setMentionQuery(null);
    setGroupRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // 防御： unexpected 异常也以失败气泡落进群聊，而不是无声消失
    let failureCaught = null;

    try {
      let priorRound = '';
      for (const preset of mentioned) {
        const placeholder = addGroupMessage({
          role: 'agent', agentId: preset.id, agentName: preset.name,
          content: '', status: 'running',
        });
        if (!placeholder?.id) {
          failureCaught = new Error('占位消息创建失败');
          break;
        }
        const shared = buildSharedTranscript(getActiveChat().messages.filter(m => m.id !== placeholder.id));
        const objective = [
          '【群聊共享上下文】（所有成员共享的同一份白板，彼此可见）',
          shared,
          '',
          `【本轮用户指令】${text}`,
          '',
          priorRound
            ? `【本轮前序成员产出】（请在接力时引用/校对/深化，不要重复劳动）\n${priorRound}`
            : '【本轮前序成员产出】（你是本轮第一个响应者，负责打好接力第一棒）',
          '',
          '请基于以上上下文接力完成任务，直接给出你的结构化产出（这是发到群里的回复，不要寒暄）。',
        ].join('\n');

        const result = await runOneSubagent(
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
          },
        );

        const ok = result.status === 'done' && result.report;
        updateGroupMessage(placeholder.id, {
          content: ok ? result.report : `⚠️ ${result.error || '未产出内容'}`,
          status: ok ? 'done' : result.status,
          meta: { turns: result.turns, tokens: result.usage?.total_tokens || 0 },
        });
        priorRound += `${priorRound ? '\n\n' : ''}### @${preset.name}（${result.status === 'done' ? '已完成' : result.status}）\n${String(result.report || result.error || '').slice(0, 2400)}`;
      }
    } catch (err) {
      failureCaught = err;
    } finally {
      if (failureCaught) {
        addGroupMessage({
          role: 'agent', agentId: 'system', agentName: '系统',
          content: `⚠️ 接力流水线异常中断：${failureCaught.message || failureCaught}`,
          status: 'failed',
        });
      }
      setGroupRunning(false);
      abortRef.current = null;
    }
  }, [input, running, roster, runtime, onNeedConfig]);

  const handleStop = () => { abortRef.current?.abort(); };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery == null) {
      e.preventDefault();
      handleSend();
    }
  };

  const hueOf = (idx) => MEMBER_HUES[idx % MEMBER_HUES.length];

  return (
    <div className="gtc">
      {/* ============ 成员栏 ============ */}
      <header className="gtc-head">
        <div className="gtc-head-main">
          <span className="team-center-kicker">TEAM</span>
          <h2>团队群聊</h2>
          <p>@ 召唤成员接力协作 · 全员共享同一份上下文 · 一个人的公司</p>
        </div>
        <div className="gtc-head-actions">
          {onViewRecords && (
            <button type="button" className="gtc-records-btn" onClick={onViewRecords} title="spawn_agent_team 的任务板与邮箱记录">
              执行记录
            </button>
          )}
          <button type="button" className="gtc-clear-btn" onClick={() => { if (messages.length && window.confirm('清空当前群聊记录？')) clearGroupChat(); }}>清空</button>
        </div>
      </header>

      {/* ============ 群聊切换条（多群聊管理） ============ */}
      <div className="gtc-chats-bar">
        <div className="gtc-chats-scroll">
          {chats.map(c => (
            <ChatChip
              key={c.id}
              chat={c}
              active={c.id === activeId}
              running={running}
              canDelete={chats.length > 1}
              onSwitch={switchChat}
              onRename={renameChat}
              onDelete={(id) => { if (deleteChat(id)) showToast('群聊已删除'); }}
            />
          ))}
        </div>
        <button
          type="button"
          className="gtc-chat-new"
          onClick={() => { const c = createChat(); if (c) showToast(`已创建「${c.name}」，邀请成员开始协作`); }}
          disabled={running || chats.length >= 20}
          title="新建团队群聊"
        >＋ 新建群聊</button>
      </div>

      <div className="gtc-roster">
        {rosterPresets.map((p, i) => (
          <span key={p.id} className="gtc-member">
            <MemberAvatar preset={p} hue={hueOf(i)} />
            <span className="gtc-member-name">{p.name}</span>
            <small>{p.id}</small>
            {!running && (
              <button type="button" className="gtc-member-remove" title="请出群聊" onClick={() => removeMember(p.id)}>×</button>
            )}
          </span>
        ))}
        <div className="gtc-invite-wrap">
          <button type="button" className="gtc-invite-btn" onClick={() => setInviting(v => !v)} disabled={running || rosterPresets.length >= 6}>
            ＋ 邀请成员
          </button>
          {inviting && (
            <div className="gtc-invite-menu">
              {SUBAGENT_PRESETS.filter(p => !roster.includes(p.id)).map(p => (
                <button key={p.id} type="button" onClick={() => { inviteMember(p.id); setInviting(false); }}>
                  <b>{p.name}</b>
                  <small>{p.description.slice(0, 18)}…</small>
                </button>
              ))}
              {SUBAGENT_PRESETS.every(p => roster.includes(p.id)) && <div className="gtc-invite-empty">全部成员已在群里</div>}
            </div>
          )}
        </div>
      </div>

      {/* ============ 群聊消息流 ============ */}
      <div className="gtc-stream custom-scrollbar">
        {messages.length === 0 && (
          <div className="gtc-empty">
            <p className="gtc-empty-title">建立你的第一个团队</p>
            <p className="gtc-empty-desc">
              ① 点「＋ 邀请成员」把专家拉进群<br />
              ② 在下方输入框 @ 成员发布任务，可以一次 @ 多人<br />
              ③ 被召唤的成员共享全部上下文、按顺序接力产出 —— 形成协作流水线
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
                  <time>{formatTime(m.at)}</time>
                </div>
              </div>
            );
          }
          const idx = roster.indexOf(m.agentId);
          const preset = PRESET_INDEX.get(m.agentId) || { name: m.agentName || m.agentId || '系统' };
          return (
            <div key={m.id} className={`gtc-msg is-agent ${m.status === 'running' ? 'is-running' : ''} ${m.status === 'failed' || m.status === 'aborted' ? 'is-error' : ''}`}>
              <MemberAvatar preset={preset} hue={hueOf(idx < 0 ? 4 : idx)} />
              <div className="gtc-bubble">
                <div className="gtc-bubble-head">
                  <b>@{m.agentName || m.agentId}</b>
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
                <time>{formatTime(m.at)}</time>
              </div>
            </div>
          );
        })}
        {running && <div className="gtc-pipeline-hint">接力流水线执行中，后一位成员正在阅读前序产出…</div>}
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
                <small>{p.description.slice(0, 24)}…</small>
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
          placeholder={running ? '流水线执行中…' : '@ 召唤成员发布任务（Enter 发送，Shift+Enter 换行）'}
          rows={2}
          disabled={running}
        />
        {running
          ? <button type="button" className="gtc-send is-stop" onClick={handleStop}>停止</button>
          : <button type="button" className="gtc-send" onClick={handleSend} disabled={!input.trim()}>发送</button>}
      </div>
    </div>
  );
}
