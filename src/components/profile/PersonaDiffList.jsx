// src/components/profile/PersonaDiffList.jsx
// Phase 6: diff 模式下的三栏列表
// diff 结构（diffPersonaSnapshots 实际返回）:
// { habits: { added: [], removed: [] },
//   traits: { added: [], removed: [] },
//   needs:  { added: [], removed: [] } }
// 注意：原函数不返回 unchanged，diff 视图只展示 added/removed

function DiffColumn({ title, diffCol }) {
  const { added = [], removed = [] } = diffCol || {};
  return (
    <div className="persona-col">
      <div className="persona-col-header">
        <span className="persona-col-title">{title}</span>
        <span className="persona-col-count">
          {added.length > 0 && <span className="count-added">+{added.length}</span>}
          {removed.length > 0 && <span className="count-removed">−{removed.length}</span>}
          {added.length === 0 && removed.length === 0 && <span className="count-none">无变化</span>}
        </span>
      </div>
      <ul>
        {added.map((t, i) => <li key={`a${i}`} className="added">{t}</li>)}
        {removed.map((t, i) => <li key={`r${i}`} className="removed">{t}</li>)}
      </ul>
    </div>
  );
}

export default function PersonaDiffList({ diff }) {
  return (
    <div className="persona-cols diff-mode">
      <DiffColumn title="用户习惯" diffCol={diff?.habits} />
      <DiffColumn title="用户性格" diffCol={diff?.traits} />
      <DiffColumn title="用户需求" diffCol={diff?.needs} />
    </div>
  );
}
