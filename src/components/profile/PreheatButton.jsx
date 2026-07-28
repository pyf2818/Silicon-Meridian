// src/components/profile/PreheatButton.jsx
// Phase 4 D5: 手动重跑预热按钮
// 调 POST /api/profile/snapshots/preheat，含 loading/error/success 状态

import { ICONS } from '../../constants/index.jsx';

export default function PreheatButton({ onPreheat, loading, result, error }) {
  return (
    <div className="dashboard-card preheat-card">
      <h3 className="card-title">手动重跑预热</h3>
      <p className="card-desc">触发今日推荐快照重新生成（会调用 LLM，可能耗时 30-60 秒）</p>
      <button
        className="preheat-btn"
        onClick={onPreheat}
        disabled={loading}
      >
        {loading
          ? '预热中...'
          : result?.cached
            ? '已预热（缓存命中）'
            : '重跑预热'}
      </button>
      {error && (
        <p className="preheat-error">{ICONS.x} {error}</p>
      )}
      {result && !result.cached && (
        <p className="preheat-success">
          预热完成（AI 状态：{result.aiStatus || 'unknown'}）
        </p>
      )}
    </div>
  );
}
