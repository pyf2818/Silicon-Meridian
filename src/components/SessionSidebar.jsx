/**
 * SessionSidebar - AI 工作站左侧栏（WorkBuddy 式三分区）
 *
 * Tab 1「对话」：置顶会话 + 多工作空间分区 —— 每个空间可展开/收起，
 *   会话嵌套在空间下（对标 WorkBuddy 的「空间 (3) > Silicon Meridian > 会话」）；
 *   空间支持行内新建/重命名/删除；会话支持置顶与跨空间移动。
 * Tab 2「文件」：工作空间文件上下文（原 WorkspacePanel，保留）。
 * Tab 3「智能体」：多智能体能力一览（4 个子代理 preset + 团队）+ 团队中心入口，
 *   运行中团队带实时角标 —— spawn 能力此前对用户不可见，这里首次前端化。
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import WorkspacePanel from './WorkspacePanel.jsx';
import { ICONS } from '../constants/appConstants.jsx';
import { SUBAGENT_PRESETS } from '../domain/agent/subagentCore.js';
import { listTeams, subscribeTeams } from '../store/teamStore.js';
import { getGroupState, subscribeGroup } from './aichat/groupChatStore.js';
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

/* ---------- 会话项：inline 重命名 + 置顶 + 移动空间 ---------- */
function SessionItem({ session, isActive, spaces, activeSpaceId, onSwitch, onRename, onDelete, onTogglePin, onMove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title || '');
  const [moving, setMoving] = useState(false);
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

  const targetSpaces = spaces.filter(sp => sp.id !== session.spaceId);

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''} ${editing ? 'is-editing' : ''}`}
      onClick={() => !editing && onSwitch(session.id)}
      onDoubleClick={startEdit}
      title={editing ? '回车保存 · Esc 取消' : preview}
    >
      <span className="session-dot" aria-hidden="true" />
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
              title={session.pinned ? '取消置顶' : '置顶'}
              aria-label={session.pinned ? '取消置顶' : '置顶会话'}
            >⌖</button>
            {targetSpaces.length > 0 && (
              <button
                className={`session-item-btn session-item-move ${moving ? 'is-open' : ''}`}
                onClick={e => { e.stopPropagation(); setMoving(m => !m); }}
                title="移动到其他空间"
                aria-label="移动到其他空间"
              >⇄</button>
            )}
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
          {moving && (
            <div className="session-move-menu" onClick={e => e.stopPropagation()}>
              <span className="session-move-title">移动到</span>
              {targetSpaces.map(sp => (
                <button
                  key={sp.id}
                  type="button"
                  className={sp.id === activeSpaceId ? 'is-here' : ''}
                  onClick={() => { onMove(session.id, sp.id); setMoving(false); }}
                >
                  <i aria-hidden="true">▸</i>{sp.name}
                  {sp.id === activeSpaceId && <em>当前</em>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- 空间分区行（WorkBuddy 式：▸ 名称 (n) + 展开嵌套会话） ---------- */
function SpaceSection({ space, expanded, sessions, activeSessionId, spaces, activeSpaceId, handlers }) {
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
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              onSwitch={handlers.onSwitch}
              onRename={handlers.onRename}
              onDelete={handlers.onDelete}
              onTogglePin={handlers.onTogglePin}
              onMove={handlers.onMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Agent Team Tab：群聊入口 + 成员预览 + 执行记录 ---------- */
function AgentsTab({ teams, onOpenTeamCenter, onOpenRecords }) {
  const running = teams.filter(t => t.status === 'running');
  const [roster, setRoster] = useState(() => getGroupState().roster || []);
  useEffect(() => subscribeGroup(() => setRoster([...(getGroupState().roster || [])])), []);
  const members = roster.map(id => PRESET_INDEX.get(id)).filter(Boolean);

  return (
    <div className="agents-tab custom-scrollbar">
      <button type="button" className="agents-team-entry is-chat" onClick={onOpenTeamCenter}>
        <span className="agents-team-entry-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </span>
        <span className="agents-team-entry-text">
          <strong>进入团队群聊</strong>
          <small>{members.length ? `${members.length} 名成员在群` : '邀请 preset 专家进群协作'}</small>
        </span>
        {running.length > 0 && <span className="agents-team-badge" title="执行中团队数">{running.length}</span>}
      </button>

      {members.length > 0 && (
        <div className="agents-roster-preview">
          {members.map(m => <span key={m.id} className="agents-roster-chip" title={m.description}>{m.name}</span>)}
        </div>
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

      <button type="button" className="agents-open-center" onClick={onOpenTeamCenter}>
        打开群聊协作 →
      </button>

      <div className="agents-cap-label">编排能力</div>
      <div className="agents-mode-list">
        <div className="agents-mode-item">
          <code>@ 召唤</code>
          <p>群聊里 @ 成员接力协作，共享上下文流水线</p>
        </div>
        <div className="agents-mode-item">
          <code>spawn_subagent</code>
          <p>对话里派活收报告 · 独立上下文 · 深度封顶 1 层</p>
        </div>
        <div className="agents-mode-item">
          <code>spawn_agent_team</code>
          <p>常驻团队 · 共享任务板 + 成员邮箱 · lead 汇总</p>
        </div>
      </div>
    </div>
  );
}

/* ================= 主组件 ================= */
export default function SessionSidebar({
  sessions = [],
  activeSessionId,
  onCreate,
  onSwitch,
  onDelete,
  onRename,
  onTogglePin,
  onMoveSession,
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

  const pinned = useMemo(() =>
    filtered.filter(s => s.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
  [filtered]);

  const bySpace = useMemo(() => {
    const map = new Map();
    spaces.forEach(sp => map.set(sp.id, []));
    filtered.filter(s => !s.pinned).forEach(s => {
      const list = map.get(s.spaceId);
      if (list) list.push(s);
    });
    map.forEach(list => list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
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
    onSwitch, onRename, onDelete, onTogglePin, onMove: onMoveSession,
    onRenameSpace, onDeleteSpace,
    // 点空间行 = 激活该空间（文件模块/新会话归属跟随）+ 折叠展开
    onToggleSpace: (spaceId) => { setActiveSpace(spaceId); toggleSpace(spaceId); },
  };

  return (
    <aside className="session-sidebar">
      {/* Tab 切换：对话 / 文件 / Agent Team */}
      <div className="session-tabs">
        <button type="button" className={`session-tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>对话</button>
        <button type="button" className={`session-tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>文件</button>
        <button
          type="button"
          className={`session-tab ${tab === 'agents' ? 'active' : ''}`}
          onClick={() => { setTab('agents'); onOpenTeamCenter?.(); }}
          title="Agent Team 群聊协作"
        >
          Agent Team{teams.some(t => t.status === 'running') && <i className="session-tab-dot" aria-hidden="true" />}
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

            {/* 置顶区（跨空间） */}
            {pinned.length > 0 && (
              <div className="session-group session-group-pinned">
                <div className="session-group-label">📌 置顶 ({pinned.length})</div>
                {pinned.map(s => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={s.id === activeSessionId}
                    spaces={spaces}
                    activeSpaceId={activeSpaceId}
                    onSwitch={onSwitch}
                    onRename={onRename}
                    onDelete={onDelete}
                    onTogglePin={onTogglePin}
                    onMove={onMoveSession}
                  />
                ))}
              </div>
            )}

            {/* 空间分区 */}
            {spaces.map(sp => (
              <SpaceSection
                key={sp.id}
                space={sp}
                expanded={expanded.has(sp.id)}
                sessions={bySpace.get(sp.id) || []}
                activeSessionId={activeSessionId}
                spaces={spaces}
                activeSpaceId={activeSpaceId}
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
        <WorkspacePanel
          materials={materials}
          todayBriefing={todayBriefing}
          todayLanes={todayLanes}
        />
      )}

      {tab === 'agents' && (
        <AgentsTab teams={teams} onOpenTeamCenter={onOpenTeamCenter} onOpenRecords={onOpenRecords} />
      )}

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
