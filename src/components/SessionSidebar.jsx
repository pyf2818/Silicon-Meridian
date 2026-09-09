/**
 * SessionSidebar - AI 工作站左侧栏（WorkBuddy 式三分区）
 *
 * Tab 1「对话」：多工作空间分区 —— 每个空间可展开/收起，会话嵌套在空间下；
 *   空间支持行内新建/重命名/删除。空间是一个个独立主体：会话归属创建时的空间，
 *   不可跨空间移动；置顶是空间内置顶（浮到本空间列表顶部，不跨空间）。
 * Tab 2「文件」：工作空间文件上下文（原 WorkspacePanel，保留）。
 * Tab 3「智能体」：群聊列表（四宫格头像）+ 群成员预览（带头像）+ 编排能力速览。
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import WorkspacePanel from './WorkspacePanel.jsx';
import { ICONS } from '../constants/appConstants.jsx';
import { SUBAGENT_PRESETS } from '../domain/agent/subagentCore.js';
import { listTeams, subscribeTeams } from '../store/teamStore.js';
import { getGroupState, getActiveChat, subscribeGroup, switchChat, createChat, renameChat, deleteChat, getAllRolePresets, hueOfMemberId, hueOfChat } from './aichat/groupChatStore.js';
import TeamOfficePanel from './aichat/TeamOfficePanel.jsx';
import { showToast } from '../utils/toast.js';

/** 稳定的群头像：群名前 4 字拼 2×2（成员变动不影响，仅重命名才变），底色按群 id 哈希 */
function GroupChatAvatar({ chat, size = 22 }) {
  const base = String(chat.name || '群').replace(/\s+/g, '') || '群';
  const chars = [0, 1, 2, 3].map(i => base[i % base.length]);
  const hue = hueOfChat(chat.id);
  return (
    <span className="agents-chat-gavatar" style={{ width: size, height: size }} aria-hidden="true">
      {chars.map((ch, i) => (
        <i
          key={i}
          style={{
            background: `hsl(${hue} 55% ${20 + (i % 2) * 5}%)`,
            color: `hsl(${hue} 80% 72%)`,
            fontSize: size * 0.34,
          }}
        >{ch}</i>
      ))}
    </span>
  );
}
import {
  isFileSystemSupported, pickDirectoryHandle, saveHandleToSlot,
} from '../utils/workspace.js';
import {
  getSpaces, getActiveSpaceId, setActiveSpace,
  createSpace, renameSpace, deleteSpace, getDefaultSpaceId, subscribeSpaces,
} from '../utils/workspaceStore.js';

const PRESET_INDEX = new Map(SUBAGENT_PRESETS.map(p => [p.id, p]));

function formatTime(ts) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function relTime(ts) {
  const diff = Date.now() - (ts || 0);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

/* ---------- 订阅 spaces / teams 的轻量 hook ---------- */
function useSpaces() {
  const [snap, setSnap] = useState(() => ({ spaces: getSpaces(), activeId: getActiveSpaceId() }));
  useEffect(() => subscribeSpaces(() => setSnap({ spaces: getSpaces(), activeId: getActiveSpaceId() })), []);
  return snap;
}

function useTeamsLite() {
  const [teams, setTeams] = useState(() => listTeams());
  useEffect(() => subscribeTeams(() => setTeams(listTeams())), []);
  return teams;
}

/* ---------- 会话项：inline 重命名 + 空间内置顶 ---------- */
function SessionItem({ session, isActive, isRunning = false, onSwitch, onRename, onDelete, onTogglePin }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);
  useEffect(() => {
    if (!editing) setDraft(session.title || '');
  }, [session.title, editing]);

  const startEdit = (e) => { e?.stopPropagation?.(); setDraft(session.title || ''); setEditing(true); };
  const commitEdit = () => {
    const next = draft.trim();
    if (next && next !== session.title) onRename(session.id, next);
    setEditing(false);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  };

  const preview = useMemo(() => {
    const msgs = session.messages || [];
    const firstUser = msgs.find(m => m.role === 'user')?.content || '';
    const lines = [
      `${session.pinned ? '📌 ' : ''}${String(session.title || '新对话')}`,
      `${msgs.length} 条消息 · 更新于 ${formatTime(session.updatedAt)}`,
    ];
    if (firstUser) lines.push('', `首条：${firstUser.replace(/\s+/g, ' ').slice(0, 120)}`);
    return lines.join('\n');
  }, [session]);

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''} ${editing ? 'is-editing' : ''}`}
      onClick={() => !editing && onSwitch(session.id)}
      onDoubleClick={startEdit}
      title={editing ? '回车保存 · Esc 取消' : preview}
    >
      <span className={`session-dot ${isRunning ? 'running' : ''}`} aria-hidden="true" title={isRunning ? '生成中' : undefined} />
      {editing ? (
        <input
          ref={inputRef}
          className="session-item-edit-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onKeyDown={onKeyDown}
          onBlur={commitEdit}
          placeholder="输入新名称"
        />
      ) : (
        <>
          {session.pinned && <span className="session-pin-mark" title="已置顶">📌</span>}
          <span className="session-item-title">{session.title || '新对话'}</span>
          <span className="session-item-meta">{relTime(session.updatedAt)}</span>
          <div className="session-item-actions">
            <button
              className="session-item-btn session-item-pin"
              onClick={e => { e.stopPropagation(); onTogglePin(session.id); }}
              title={session.pinned ? '取消置顶' : '置顶（本空间内）'}
              aria-label={session.pinned ? '取消置顶' : '置顶会话'}
            >⌖</button>
            <button
              className="session-item-btn session-item-rename"
              onClick={startEdit}
              title="重命名"
              aria-label="重命名会话"
            >{ICONS.edit}</button>
            <button
              className="session-item-btn session-item-del"
              onClick={e => { e.stopPropagation(); onDelete(session.id); }}
              title="删除"
              aria-label="删除会话"
            >{ICONS.x}</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- 空间分区行（WorkBuddy 式：▸ 名称 (n) + 展开嵌套会话） ---------- */
function SpaceSection({ space, expanded, sessions, activeSessionId, activeSpaceId, streamingIds = [], handlers }) {
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const nameRef = useRef(null);
  const isDefault = space.id === getDefaultSpaceId();

  useEffect(() => {
    if (renaming && nameRef.current) nameRef.current.focus();
  }, [renaming]);

  const count = sessions.length;
  const commitRename = () => {
    const el = nameRef.current;
    if (el?.value?.trim()) handlers.onRenameSpace(space.id, el.value.trim());
    setRenaming(false);
  };

  return (
    <div className={`space-section ${expanded ? 'is-open' : ''} ${space.id === activeSpaceId ? 'is-active' : ''}`}>
      <div className="space-row">
        <button
          type="button"
          className="space-row-main"
          onClick={() => handlers.onToggleSpace(space.id)}
          title={expanded ? '收起空间' : '展开空间'}
        >
          <span className={`space-arrow ${expanded ? 'open' : ''}`} aria-hidden="true">▸</span>
          <span className="space-icon" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </span>
          {renaming ? (
            <input
              ref={nameRef}
              className="space-rename-input"
              defaultValue={space.name}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                else if (e.key === 'Escape') setRenaming(false);
              }}
              onBlur={commitRename}
            />
          ) : (
            <span className="space-name">{space.name}</span>
          )}
          <span className="space-count">({count})</span>
        </button>
        <div className="space-row-actions">
          {!isDefault && (
            <>
              <button type="button" className="space-act" title="重命名空间" onClick={e => { e.stopPropagation(); setRenaming(true); }}>✎</button>
              <button
                type="button"
                className={`space-act is-danger ${confirmDel ? 'confirm' : ''}`}
                title={confirmDel ? '再次点击确认删除（会话将迁回默认空间）' : '删除空间'}
                onClick={e => {
                  e.stopPropagation();
                  if (confirmDel) { handlers.onDeleteSpace(space.id); setConfirmDel(false); }
                  else { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); }
                }}
              >{confirmDel ? '确认?' : '✕'}</button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-sessions">
          {count === 0 && <div className="space-empty">该空间暂无对话</div>}
          {sessions.map(s => (
            <SessionItem
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              isRunning={streamingIds.includes(s.id)}
              onSwitch={handlers.onSwitch}
              onRename={handlers.onRename}
              onDelete={handlers.onDelete}
              onTogglePin={handlers.onTogglePin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 团队 Tab：群聊列表（切换 + 新建/重命名/解散） + 成员预览 + 执行记录 ---------- */
function AgentsTab({ teams, onOpenTeamCenter, onOpenRecords }) {
  const running = teams.filter(t => t.status === 'running');
  const [groupSnap, setGroupSnap] = useState(() => {
    const s = getGroupState();
    return { chats: [...(s.chats || [])], activeId: s.activeId, roster: [...(getActiveChat()?.roster || [])] };
  });
  useEffect(() => subscribeGroup(() => {
    const s = getGroupState();
    setGroupSnap({ chats: [...(s.chats || [])], activeId: s.activeId, roster: [...(getActiveChat()?.roster || [])] });
  }), []);
  const { chats, activeId } = groupSnap;
  const allPresets = getAllRolePresets();
  const members = groupSnap.roster
    .map(id => allPresets.find(p => p.id === id))
    .filter(Boolean);
  // 行内重命名（群聊管理在侧栏完成：新建/重命名/解散）
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameRef = useRef(null);
  useEffect(() => { if (renamingId && renameRef.current) renameRef.current.focus(); }, [renamingId]);

  const doSwitch = (id) => {
    if (!switchChat(id)) {
      showToast('协作执行中，暂不能切换群聊');
      return;
    }
    onOpenTeamCenter?.();
  };
  const startRename = (c) => { setRenameDraft(c.name || ''); setRenamingId(c.id); };
  const commitRename = (c) => {
    const next = renameDraft.trim();
    if (next && next !== c.name && !renameChat(c.id, next)) showToast('重命名失败（名称为空或与其他群聊重名）');
    setRenamingId(null);
  };
  const removeChat = (c) => {
    if (window.confirm(`解散群聊「${c.name}」？聊天记录将不可恢复。`)) {
      if (deleteChat(c.id)) showToast('群聊已解散');
      else showToast(c.id === activeId ? '协作执行中，不能解散当前群聊' : '至少保留一个群聊');
    }
  };

  return (
    <div className="agents-tab custom-scrollbar">
      <div className="agents-cap-label">团队群聊</div>
      <div className="agents-chats">
        {chats.map(c => (
          <div key={c.id} className={`agents-chat-row ${c.id === activeId ? 'active' : ''}`}>
            {renamingId === c.id ? (
              <input
                ref={renameRef}
                className="agents-chat-rename"
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(c); }
                  else if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={() => commitRename(c)}
                maxLength={24}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="agents-chat-item"
                  onClick={() => doSwitch(c.id)}
                  title={`切换到「${c.name}」（${c.messages.length} 条消息）；悬停可重命名/解散`}
                >
                  <GroupChatAvatar chat={c} />
                  <span className="agents-chat-name">{c.name}</span>
                  <em>{c.messages.length}</em>
                </button>
                <span className="agents-chat-acts">
                  <button
                    type="button"
                    title="重命名"
                    onClick={e => { e.stopPropagation(); startRename(c); }}
                  >✎</button>
                  <button
                    type="button"
                    className="is-danger"
                    title="解散群聊"
                    onClick={e => { e.stopPropagation(); removeChat(c); }}
                  >✕</button>
                </span>
              </>
            )}
          </div>
        ))}
        <button
          type="button"
          className="agents-chat-new"
          onClick={() => { createChat(); onOpenTeamCenter?.(); }}
          title="新建团队群聊"
        >＋ 新建群聊</button>
      </div>

      {members.length > 0 && (
        <>
          <div className="agents-cap-label">当前群成员</div>
          <div className="agents-roster-preview">
            {members.map((m, i) => (
              <span key={m.id} className="agents-roster-chip" title={m.description}>
                <i
                  className="agents-roster-avatar"
                  style={{
                    background: `hsl(${hueOfMemberId(m.id)} 70% 22%)`,
                    color: `hsl(${hueOfMemberId(m.id)} 85% 70%)`,
                    borderColor: `hsl(${hueOfMemberId(m.id)} 70% 45%)`,
                  }}
                  aria-hidden="true"
                >{m.name.slice(0, 1)}</i>
                {m.name}
              </span>
            ))}
          </div>
        </>
      )}

      {running.length > 0 && (
        <div className="agents-running">
          <div className="agents-running-label">spawn 团队执行中</div>
          {running.map(t => (
            <button key={t.id} type="button" className="agents-running-item" onClick={onOpenRecords} title={t.goal}>
              <i className="agents-running-dot" aria-hidden="true" />
              <span className="agents-running-goal">{(t.goal || '').slice(0, 22)}</span>
              <em>{relTime(t.updatedAt)}</em>
            </button>
          ))}
        </div>
      )}

      {/* 编排能力速览：纯文本行（不放卡片，省空间） */}
      <div className="agents-cap-label">编排能力</div>
      <div className="agents-mode-hints">
        <p><code>@召唤</code>群里 @ 成员接力协作</p>
        <p><code>spawn_subagent</code>派活收报告 · 深度封顶 1 层</p>
        <p><code>spawn_agent_team</code>常驻团队 · 任务板 + 邮箱</p>
      </div>
    </div>
  );
}

/* ================= 主组件 ================= */
export default function SessionSidebar({
  sessions = [],
  streamingIds = [],
  activeSessionId,
  onCreate,
  onSwitch,
  onDelete,
  onRename,
  onTogglePin,
  onRenameSpace,
  onDeleteSpace,
  onOpenTeamCenter,
  onOpenRecords,
  onOpenNewspaper,
  todayBriefing,
  todayLanes,
  selectedDate,
  materials = [],
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('sessions'); // 'sessions' | 'files' | 'agents'
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const { spaces, activeId: activeSpaceId } = useSpaces();
  const teams = useTeamsLite();

  // 展开状态：默认展开当前激活空间；用户手动展开/收起后以本地状态为准
  const [expanded, setExpanded] = useState(() => new Set([getActiveSpaceId()]));
  const toggleSpace = useCallback((spaceId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s =>
      (s.title || '').toLowerCase().includes(q)
      || (s.messages || []).some(m => (m.content || '').toLowerCase().includes(q)));
  }, [sessions, query]);

  const bySpace = useMemo(() => {
    const map = new Map();
    spaces.forEach(sp => map.set(sp.id, []));
    filtered.forEach(s => {
      // 会话归属创建时的空间（空间是独立主体），不提供跨空间移动
      const list = map.get(s.spaceId);
      if (list) list.push(s);
    });
    // 置顶是空间内置顶：置顶会话浮到本空间列表顶部，其余按更新时间
    map.forEach(list => list.sort((a, b) =>
      (Number(b.pinned || false) - Number(a.pinned || false))
      || ((b.updatedAt || 0) - (a.updatedAt || 0))));
    return map;
  }, [filtered, spaces]);

  const submitNewSpace = () => {
    if (newSpaceName.trim()) {
      const sp = createSpace(newSpaceName.trim());
      if (sp) setExpanded(prev => new Set(prev).add(sp.id));
      else setErrorHint('空间已存在同名或数量达上限');
    }
    setNewSpaceName('');
    setCreatingSpace(false);
  };

  /* 新建空间 = 直接选本地文件夹（文件夹名即空间名）；不支持 FSA API 或同名冲突时降级为手动输入 */
  const [errorHint, setErrorHint] = useState('');
  const handleCreateSpace = async () => {
    setErrorHint('');
    if (isFileSystemSupported()) {
      try {
        const handle = await pickDirectoryHandle();
        if (!handle) return; // 用户取消
        const sp = createSpace(handle.name);
        if (!sp) {
          // 同名空间已存在：降级为输入框（预填文件夹名，用户改名即可）
          setNewSpaceName(handle.name);
          setCreatingSpace(true);
          setErrorHint(`空间「${handle.name}」已存在，请换一个名字`);
          return;
        }
        await saveHandleToSlot(sp.id, handle);
        setExpanded(prev => new Set(prev).add(sp.id)); // createSpace 已自动激活
      } catch (e) {
        if (e.name !== 'AbortError') {
          setCreatingSpace(true);
          setErrorHint(e.message || '文件夹选择失败，可手动输入空间名');
        }
      }
    } else {
      setCreatingSpace(true);
    }
  };

  const handlers = {
    onSwitch, onRename, onDelete, onTogglePin,
    onRenameSpace, onDeleteSpace,
    // 点空间行 = 激活该空间（文件模块/新会话归属跟随）+ 折叠展开
    onToggleSpace: (spaceId) => { setActiveSpace(spaceId); toggleSpace(spaceId); },
  };

  return (
    <aside className="session-sidebar">
      {/* Tab 切换：对话 / 文件 / 团队 */}
      <div className="session-tabs">
        <button type="button" className={`session-tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>对话</button>
        <button type="button" className={`session-tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>文件</button>
        <button
          type="button"
          className={`session-tab ${tab === 'agents' ? 'active' : ''}`}
          onClick={() => { setTab('agents'); onOpenTeamCenter?.(); }}
          title="团队群聊协作"
        >
          团队{teams.some(t => t.status === 'running') && <i className="session-tab-dot" aria-hidden="true" />}
        </button>
      </div>

      {tab === 'sessions' && (
        <>
          <div className="session-sidebar-top">
            <button type="button" className="session-new-btn" onClick={onCreate}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              新对话
            </button>
            <div className="session-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索对话..." />
            </div>
          </div>

          <div className="session-list custom-scrollbar">
            {filtered.length === 0 && (
              <div className="session-list-empty">{query ? '没有匹配的对话' : '尚无对话记录'}</div>
            )}

            {/* 空间分区（置顶会话在各自空间内浮顶） */}
            {spaces.map(sp => (
              <SpaceSection
                key={sp.id}
                space={sp}
                expanded={expanded.has(sp.id)}
                sessions={bySpace.get(sp.id) || []}
                activeSessionId={activeSessionId}
                activeSpaceId={activeSpaceId}
                streamingIds={streamingIds}
                handlers={handlers}
              />
            ))}

            {/* 新建空间：直接选本地文件夹（文件夹名即空间名）；不支持的浏览器降级为手动输入 */}
            <div className="space-create">
              {errorHint && <div className="space-create-hint">{errorHint}</div>}
              {creatingSpace ? (
                <input
                  className="space-create-input"
                  autoFocus
                  value={newSpaceName}
                  onChange={e => setNewSpaceName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); submitNewSpace(); }
                    else if (e.key === 'Escape') { setCreatingSpace(false); setNewSpaceName(''); }
                  }}
                  onBlur={submitNewSpace}
                  placeholder="空间名称，回车创建"
                />
              ) : (
                <button type="button" className="space-create-btn" onClick={handleCreateSpace} title="选择一个本地文件夹创建空间，文件夹名即空间名">
                  ＋ 新建空间（选择文件夹）
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'files' && (
        <WorkspacePanel />
      )}

      {tab === 'agents' && (
        <AgentsTab teams={teams} onOpenTeamCenter={onOpenTeamCenter} onOpenRecords={onOpenRecords} />
      )}

      {/* v26 #15 像素办公室：实时协作监测面板（左侧栏底部空白区，可折叠，不干扰既有功能） */}
      <TeamOfficePanel />

      {onOpenNewspaper && (
        <div className="session-sidebar-bottom">
          <button type="button" className="session-newspaper-btn" onClick={onOpenNewspaper}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6z"/></svg>
            <span>
              <strong>今日速报</strong>
              <small>{todayBriefing?.date || selectedDate || ''}</small>
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
