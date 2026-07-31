/**
 * SessionSidebar - AI 工作站左侧会话管理栏
 *
 * 从 AiChatPanel 抽出的独立左栏：
 * - 顶部：搜索框 + 新建对话按钮
 * - 列表：按时间分组（今天/昨天/7 天内/更早），当前会话高亮
 * - 单击切换、hover 显示重命名/删除按钮、双击也可重命名
 * - 重命名为 inline 编辑模式（input 替换标题，回车保存/Esc 取消）
 * - 底部：今日速报入口（展开完整日报）
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import WorkspacePanel from './WorkspacePanel.jsx';
import { ICONS } from '../constants/appConstants.jsx';

function timeGroup(ts) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const sevenDaysAgo = today - 7 * 86400000;
  if (ts >= today) return '今天';
  if (ts >= yesterday) return '昨天';
  if (ts >= sevenDaysAgo) return '7 天内';
  return '更早';
}

function formatTime(ts) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* 会话项：管理 inline 重命名编辑态，避免整个列表 re-render */
function SessionItem({ session, isActive, onSwitch, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title || '');
  const inputRef = useRef(null);

  // 进入编辑模式时聚焦 + 选中全部
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // session 标题外部变更时同步草稿（非编辑态）
  useEffect(() => {
    if (!editing) setDraft(session.title || '');
  }, [session.title, editing]);

  const startEdit = (e) => {
    e?.stopPropagation?.();
    setDraft(session.title || '');
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(session.title || '');
    setEditing(false);
  };
  const commitEdit = () => {
    const next = draft.trim();
    if (next && next !== session.title) {
      onRename(session.id, next);
    }
    setEditing(false);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''} ${editing ? 'is-editing' : ''}`}
      onClick={() => !editing && onSwitch(session.id)}
      onDoubleClick={startEdit}
      title={editing ? '回车保存 · Esc 取消' : '双击或点编辑按钮重命名'}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="session-item-edit-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onKeyDown={onKeyDown}
          onBlur={commitEdit}
          placeholder="输入新名称"
        />
      ) : (
        <>
          <span className="session-item-title">{session.title || '新对话'}</span>
          <span className="session-item-meta">{formatTime(session.updatedAt)}</span>
          <div className="session-item-actions">
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

export default function SessionSidebar({
  sessions = [],
  activeSessionId,
  onCreate,
  onSwitch,
  onDelete,
  onRename,
  onOpenNewspaper,
  todayBriefing,
  todayLanes,
  selectedDate,
  materials = [],
  onAddContextFiles,
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('sessions'); // 'sessions' | 'workspace'

  const filtered = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!query.trim()) return sorted;
    const q = query.trim().toLowerCase();
    return sorted.filter(s => (s.title || '').toLowerCase().includes(q) || (s.messages || []).some(m => (m.content || '').toLowerCase().includes(q)));
  }, [sessions, query]);

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach(s => {
      const g = timeGroup(s.updatedAt || Date.now());
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(s);
    });
    return [...map.entries()];
  }, [filtered]);

  return (
    <aside className="session-sidebar">
      {/* Tab 切换：会话 / 工作空间 */}
      <div className="session-tabs">
        <button
          type="button"
          className={`session-tab ${tab === 'sessions' ? 'active' : ''}`}
          onClick={() => setTab('sessions')}
        >会话</button>
        <button
          type="button"
          className={`session-tab ${tab === 'workspace' ? 'active' : ''}`}
          onClick={() => setTab('workspace')}
        >工作空间</button>
      </div>

      {tab === 'sessions' ? (
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
          {groups.map(([group, items]) => (
            <div key={group} className="session-group">
              <div className="session-group-label">{group}</div>
              {items.map(s => (
                <SessionItem
                  key={s.id}
                  session={s}
                  isActive={s.id === activeSessionId}
                  onSwitch={onSwitch}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ))}
        </div>
        </>
      ) : (
        <WorkspacePanel
          onAddContextFiles={onAddContextFiles}
          materials={materials}
          todayBriefing={todayBriefing}
          todayLanes={todayLanes}
        />
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
