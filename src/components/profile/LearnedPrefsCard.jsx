// src/components/profile/LearnedPrefsCard.jsx
// Phase 4 D4: 行为观测卡片
// 展示 learned_preferences 的 topics/preferredDepth/preferredFormat
// 与 AgentMemorySection 的"记忆"明确区分（记忆来自 agent_memories，行为观测来自行为派生）

export default function LearnedPrefsCard({ prefs, loading }) {
  const { topics = [], preferredDepth = '', preferredFormat = '' } = prefs || {};
  const hasData = topics.length > 0 || !!preferredDepth || !!preferredFormat;

  return (
    <div className="dashboard-card learned-prefs-card">
      <h3 className="card-title">行为观测</h3>
      {loading ? (
        <p className="card-loading">加载中...</p>
      ) : !hasData ? (
        <p className="card-empty">暂无行为观测数据</p>
      ) : (
        <div className="learned-prefs-content">
          {topics.length > 0 && (
            <div className="prefs-row">
              <span className="prefs-label">高频主题</span>
              <div className="prefs-tags">
                {topics.map((t, i) => <span key={i} className="prefs-tag">{t}</span>)}
              </div>
            </div>
          )}
          {preferredDepth && (
            <div className="prefs-row">
              <span className="prefs-label">偏好深度</span>
              <span className="prefs-value">
                {preferredDepth === 'deep' ? '深入详细' : '简洁'}
              </span>
            </div>
          )}
          {preferredFormat && (
            <div className="prefs-row">
              <span className="prefs-label">偏好格式</span>
              <span className="prefs-value">
                {preferredFormat === 'detailed' ? '详细' : '简洁'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
