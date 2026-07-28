import { useState } from 'react';
import { useAgentMemories } from '../../hooks/useAgentMemories.js';

const MEMORY_TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'user_habit', label: '习惯' },
  { value: 'user_thought', label: '想法' },
  { value: 'user_trait', label: '特质' },
  { value: 'user_need', label: '需求' },
  { value: 'agent_insight', label: '洞察' },
];

const TYPE_LABELS = Object.fromEntries(MEMORY_TYPE_OPTIONS.map(o => [o.value, o.label]));

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return iso; }
}

function MemoryItem({ memory, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const hasEvidence = Array.isArray(memory.evidence) && memory.evidence.length > 0;

  return (
    <div className="memory-item">
      <div className="memory-header">
        <span className={`memory-type-tag type-${memory.memory_type}`}>
          {TYPE_LABELS[memory.memory_type] || memory.memory_type}
        </span>
        <span className="memory-weight">权重 {memory.weight || 1}</span>
        <span className="memory-created">{formatTime(memory.created_at)}</span>
        <button
          className="btn btn-ghost btn-sm memory-delete"
          onClick={() => onDelete(memory.id)}
          aria-label="删除"
        >删除</button>
      </div>
      <div className="memory-content">{memory.content}</div>
      {hasEvidence && (
        <>
          <button
            className="btn btn-ghost btn-sm memory-expand"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? '收起证据' : `查看证据 (${memory.evidence.length})`}
          </button>
          {expanded && (
            <div className="memory-evidence">
              {memory.evidence.map((ev, i) => (
                <div key={i} className="evidence-item">
                  {ev.type && <span className="evidence-type">{ev.type}</span>}
                  <span className="evidence-snippet">{ev.snippet || JSON.stringify(ev)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AgentMemorySection() {
  const {
    items, loading, error, hasMore,
    page, setPage,
    memoryType, setMemoryType,
    searchQuery, setSearchQuery,
    refresh, search, remove,
  } = useAgentMemories();

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    search(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    refresh();
  };

  const handleMemoryTypeChange = (e) => {
    setMemoryType(e.target.value);
    setPage(0);
  };

  return (
    <section className="profile-agent-memory">
      <div className="section-header">
        <h2 className="section-title">AI 跨会话记忆</h2>
        <p className="section-desc">AI 在对话中累积的对你的观察，可搜索/删除以保持记忆准确</p>
      </div>
      <div className="memory-toolbar">
        <select
          className="memory-type-filter"
          value={memoryType}
          onChange={handleMemoryTypeChange}
        >
          {MEMORY_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <form className="memory-search-form" onSubmit={handleSearchSubmit}>
          <input
            type="text"
            className="memory-search-input"
            placeholder="搜索记忆..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-ghost btn-sm">搜索</button>
          {searchQuery && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleClearSearch}>清除</button>
          )}
        </form>
        <button className="btn btn-ghost btn-sm" onClick={refresh}>刷新</button>
      </div>
      {error && <div className="memory-error">{error}</div>}
      {loading && <div className="memory-loading">加载中...</div>}
      {!loading && !error && items.length === 0 && (
        <div className="profile-empty-state">暂无 AI 记忆</div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="memory-list">
          {items.map(m => <MemoryItem key={m.id} memory={m} onDelete={remove} />)}
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="memory-pagination">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >上一页</button>
          <span className="page-indicator">第 {page + 1} 页</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
          >下一页</button>
        </div>
      )}
    </section>
  );
}
