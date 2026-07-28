// src/components/profile/PersonaDiffCard.jsx
// Phase 5: personaSummary 两个快照的 diff 详情面板
// 三列布局：习惯/性格/需求，每列显示 added（绿）/removed（红）

export default function PersonaDiffCard({ diff, prevLabel = '历史快照', currentLabel = '当前快照' }) {
  if (!diff) return null;

  const { habits = { added: [], removed: [] }, traits = { added: [], removed: [] }, needs = { added: [], removed: [] } } = diff;
  const hasAnyChange =
    habits.added.length > 0 || habits.removed.length > 0 ||
    traits.added.length > 0 || traits.removed.length > 0 ||
    needs.added.length > 0 || needs.removed.length > 0;

  return (
    <div className="persona-diff-card">
      <div className="persona-diff-header">
        <span className="diff-label-prev">{prevLabel}</span>
        <span className="diff-arrow">→</span>
        <span className="diff-label-current">{currentLabel}</span>
      </div>
      {!hasAnyChange ? (
        <p className="persona-diff-empty">本次进化无变化</p>
      ) : (
        <div className="persona-diff-grid">
          <DiffColumn title="习惯" added={habits.added} removed={habits.removed} />
          <DiffColumn title="性格" added={traits.added} removed={traits.removed} />
          <DiffColumn title="需求" added={needs.added} removed={needs.removed} />
        </div>
      )}
    </div>
  );
}

function DiffColumn({ title, added = [], removed = [] }) {
  return (
    <div className="diff-column">
      <h4 className="diff-column-title">{title}</h4>
      {added.length > 0 && (
        <div className="diff-group diff-added">
          <span className="diff-group-label">新增</span>
          <ul>
            {added.map((item, i) => <li key={`a-${i}`}>{String(item)}</li>)}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div className="diff-group diff-removed">
          <span className="diff-group-label">删除</span>
          <ul>
            {removed.map((item, i) => <li key={`r-${i}`}>{String(item)}</li>)}
          </ul>
        </div>
      )}
      {added.length === 0 && removed.length === 0 && (
        <p className="diff-column-empty">无变化</p>
      )}
    </div>
  );
}
