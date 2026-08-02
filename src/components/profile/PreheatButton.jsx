// src/components/profile/PreheatButton.jsx
// Phase 4 D5: 手动刷新推荐按钮
// 调 POST /api/profile/snapshots/preheat，含 loading/error/success 状态
// 错误以 { code, message } 结构化传入，按 code 给出引导式提示（而非甩锅式红叉）

import { ICONS } from '../../constants/index.jsx';

// 把 error（可能是 {code,message} / 字符串 / null）翻译成用户友好的引导文案
function describeError(error) {
  const code = error && typeof error === 'object' ? error.code : 'UNKNOWN';
  const message = error && typeof error === 'object'
    ? error.message
    : (typeof error === 'string' ? error : '');
  if (!message) return null;
  if (code === 'UNAUTHORIZED') {
    return { tone: 'warn', text: '会话已失效，请刷新页面或重新登录后再试' };
  }
  if (code === 'LLM_CONFIG_MISSING') {
    return { tone: 'warn', text: '请先在设置中配置大模型，再运行推荐刷新' };
  }
  if (code === 'NETWORK') {
    return { tone: 'warn', text: '网络异常，请稍后重试' };
  }
  return { tone: 'warn', text: message };
}

export default function PreheatButton({ onPreheat, loading, result, error }) {
  const err = describeError(error);
  return (
    <div className="dashboard-card preheat-card">
      <h3 className="card-title">刷新我的推荐</h3>
      <p className="card-desc">按你的偏好重新生成今日推荐，通常几秒到一分钟</p>
      <button
        className="preheat-btn"
        onClick={onPreheat}
        disabled={loading}
      >
        {loading
          ? '刷新中...'
          : result?.cached
            ? '已是最新（缓存命中）'
            : '刷新推荐'}
      </button>
      {err && (
        <p className="preheat-error">
          <span className="preheat-error-icon">{ICONS.x}</span>
          <span className="preheat-error-text">{err.text}</span>
        </p>
      )}
      {result && !result.cached && (
        <p className="preheat-success">
          已刷新（AI 状态：{result.aiStatus || 'unknown'}）
        </p>
      )}
    </div>
  );
}
