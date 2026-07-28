// src/components/profile/PreheatCard.jsx
// Phase 6: 包装 PreheatButton，加 info-card 样式 + normalizeError
import PreheatButton from './PreheatButton.jsx';
import { normalizeError } from '../../utils/dashboardBuilders.js';

export default function PreheatCard({ onPreheat, loading, result, error }) {
  const normalizedError = normalizeError(error);
  return (
    <div className="info-card preheat-card">
      <div className="info-card-header">
        <span className="info-card-title">手动重跑预热</span>
      </div>
      <p className="card-desc">触发今日推荐快照重新生成，会调用 LLM，可能耗时 30-60 秒</p>
      <PreheatButton
        onPreheat={onPreheat}
        loading={loading}
        result={result}
        error={normalizedError}
      />
    </div>
  );
}
