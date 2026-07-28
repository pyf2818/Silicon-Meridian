// src/components/profile/PersonaSummaryCard.jsx
// Phase 4 D3: 当前画像卡片（紧凑版，与 LearnedPrefsCard 并排展示）

export default function PersonaSummaryCard({ personaSummary, loading }) {
  const { habits = [], traits = [], needs = [], lastEvolvedAt } = personaSummary || {};
  const hasData = habits.length > 0 || traits.length > 0 || needs.length > 0;

  return (
    <div className="dashboard-card persona-summary-card">
      <h3 className="card-title">当前画像</h3>
      {loading ? (
        <p className="card-loading">加载中...</p>
      ) : !hasData ? (
        <p className="card-empty">暂无画像，与 AI 对话累积 3 轮后自动生成</p>
      ) : (
        <div className="persona-summary-grid">
          <div className="persona-column">
            <h4>习惯</h4>
            <ul>{habits.map((t, i) => <li key={i}>{String(t)}</li>)}</ul>
          </div>
          <div className="persona-column">
            <h4>性格</h4>
            <ul>{traits.map((t, i) => <li key={i}>{String(t)}</li>)}</ul>
          </div>
          <div className="persona-column">
            <h4>需求</h4>
            <ul>{needs.map((t, i) => <li key={i}>{String(t)}</li>)}</ul>
          </div>
        </div>
      )}
      {lastEvolvedAt && (
        <p className="card-meta">最近进化：{new Date(lastEvolvedAt).toLocaleString('zh-CN')}</p>
      )}
    </div>
  );
}
