// src/components/profile/BehaviorObservedCard.jsx
// Phase 6: 行为观测卡（重命名自 LearnedPrefsCard）
// 展示 learnedPreferences 的 topics/preferredDepth/preferredFormat
const DEPTH_LABEL = { deep: '深入详细', shallow: '简洁' };
const FORMAT_LABEL = { detailed: '详细', concise: '简洁' };

export default function BehaviorObservedCard({ prefs, loading }) {
  const { topics = [], preferredDepth = '', preferredFormat = '' } = prefs || {};
  return (
    <div className="info-card behavior-card">
      <div className="info-card-header">
        <span className="info-card-title">行为观测</span>
        <span className="info-card-meta">从阅读/收藏自动派生</span>
      </div>
      {loading ? (
        <p className="card-loading">加载中...</p>
      ) : topics.length === 0 && !preferredDepth && !preferredFormat ? (
        <p className="card-empty">暂无行为观测数据</p>
      ) : (
        <>
          {topics.length > 0 && (
            <div className="prefs-tags">
              {topics.map((t, i) => (
                <span key={i} className="pref-tag">{t}</span>
              ))}
            </div>
          )}
          {preferredDepth && (
            <div className="prefs-row">
              <span className="label">偏好深度</span>
              <span className="value">{DEPTH_LABEL[preferredDepth] || preferredDepth}</span>
            </div>
          )}
          {preferredFormat && (
            <div className="prefs-row">
              <span className="label">偏好格式</span>
              <span className="value">{FORMAT_LABEL[preferredFormat] || preferredFormat}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
