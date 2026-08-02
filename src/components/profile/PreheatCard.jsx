// src/components/profile/PreheatCard.jsx
// Phase 6: 包装 PreheatButton，加 info-card 样式
// 错误以结构化 { code, message } 透传，由 PreheatButton 做引导式呈现
import PreheatButton from './PreheatButton.jsx';

export default function PreheatCard({ onPreheat, loading, result, error }) {
  return (
    <div className="info-card preheat-card">
      <div className="info-card-header">
        <span className="info-card-title">刷新我的推荐</span>
      </div>
      <p className="card-desc">按你的偏好重新生成今日推荐，通常几秒到一分钟</p>
      <PreheatButton
        onPreheat={onPreheat}
        loading={loading}
        result={result}
        error={error}
      />
    </div>
  );
}
