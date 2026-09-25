/**
 * ResultsPane.jsx - 结果区抽屉（对齐 WorkBuddy「产物 / 文件」视图）
 *
 * 用法：<ResultsPane sessionId={...} onClose={() => ...} />
 * 挂载点：AiChatPanel 右侧（接线见 patches/0002-*.patch）。
 */
import { useMemo, useState } from 'react';
import ArtifactCard from './ArtifactCard.jsx';
import { useArtifacts } from './useArtifacts.js';
import { ARTIFACT_FILTERS, filterArtifacts, groupArtifactsByDate } from './artifactViews.js';

export default function ResultsPane({ sessionId = '', onClose }) {
  const { artifacts, loading, error, refresh, remove } = useArtifacts({ sessionId });
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const visible = useMemo(() => filterArtifacts(artifacts, { kind, search }), [artifacts, kind, search]);
  const groups = useMemo(() => groupArtifactsByDate(visible), [visible]);

  const handleDelete = (artifact) => {
    if (confirmId !== artifact.id) {
      setConfirmId(artifact.id);
      return;
    }
    setConfirmId('');
    remove(artifact.id);
  };

  return (
    <aside className="ws-results-pane" aria-label="产物结果区">
      <div className="ws-results-header">
        <div className="ws-results-title">
          <span className="ws-results-title-mark">◆</span>
          <span>结果区</span>
          <span className="ws-results-count">{visible.length}</span>
        </div>
        <div className="ws-results-header-actions">
          <button type="button" className="ws-results-btn" onClick={refresh} title="刷新产物列表">⟳</button>
          {onClose && (
            <button type="button" className="ws-results-btn" onClick={onClose} title="收起结果区">×</button>
          )}
        </div>
      </div>

      <div className="ws-results-toolbar">
        <input
          className="ws-results-search"
          type="search"
          placeholder="搜索产物标题…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="ws-results-filters" role="tablist" aria-label="产物类型过滤">
          {ARTIFACT_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={kind === f.id}
              className={`ws-results-filter${kind === f.id ? ' is-active' : ''}`}
              onClick={() => setKind(f.id)}
            >
              {f.icon ? `${f.icon} ` : ''}{f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ws-results-body">
        {error && (
          <div className="ws-results-state ws-results-state-error">
            {error}
            <button type="button" className="ws-results-btn" onClick={refresh}>重试</button>
          </div>
        )}
        {!error && loading && <div className="ws-results-state">加载中…</div>}
        {!error && !loading && groups.length === 0 && (
          <div className="ws-results-state">
            <div className="ws-results-empty-icon">🗂️</div>
            <div>还没有产物</div>
            <div className="ws-results-empty-hint">让 agent 生成报告、代码或图表后，产物会自动归档到这里</div>
          </div>
        )}
        {!error && !loading && groups.map(group => (
          <section key={group.key} className="ws-results-group">
            <div className="ws-results-group-label">{group.label}</div>
            {group.items.map(a => (
              <ArtifactCard
                key={a.id}
                artifact={a}
                onDelete={handleDelete}
                compact
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
