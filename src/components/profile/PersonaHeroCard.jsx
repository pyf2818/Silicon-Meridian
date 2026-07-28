// src/components/profile/PersonaHeroCard.jsx
// Phase 6: 主画像卡，current/diff 两种模式，含置信度环 SVG
import PersonaDiffList from './PersonaDiffList.jsx';

function ConfidenceRing({ value }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const offset = circumference * (1 - safeValue / 100);
  return (
    <div className="confidence-ring">
      <svg viewBox="0 0 80 80">
        <defs>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4B576" />
            <stop offset="100%" stopColor="#9A7B3F" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={radius} fill="none"
                stroke="rgba(201,169,97,0.10)" strokeWidth="6" />
        <circle cx="40" cy="40" r={radius} fill="none"
                stroke="url(#goldGrad)" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 40 40)"
                style={{ filter: 'drop-shadow(0 0 6px rgba(201,169,97,0.4))' }} />
      </svg>
      <div className="confidence-value">
        <strong>{safeValue}</strong>
        <span>CONFIDENCE</span>
      </div>
    </div>
  );
}

function PersonaColumn({ title, items }) {
  if (!items || items.length === 0) {
    return (
      <div className="persona-col">
        <div className="persona-col-header">
          <span className="persona-col-title">{title}</span>
          <span className="persona-col-count">0</span>
        </div>
        <p className="persona-col-empty">暂无</p>
      </div>
    );
  }
  return (
    <div className="persona-col">
      <div className="persona-col-header">
        <span className="persona-col-title">{title}</span>
        <span className="persona-col-count">{items.length}</span>
      </div>
      <ul>
        {items.map((text, idx) => (
          <li key={idx}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

export default function PersonaHeroCard({
  personaSummary,
  confidence,
  diff,
  diffLabel,
  onClearDiff,
}) {
  const { habits = [], traits = [], needs = [], lastEvolvedAt } = personaSummary || {};
  const hasData = habits.length > 0 || traits.length > 0 || needs.length > 0;
  const isDiffMode = !!diff;

  return (
    <section className="persona-hero">
      <div className="hero-top">
        <div>
          <div className="hero-label">
            {isDiffMode ? 'Persona Diff' : 'Current Persona'}
          </div>
          <div className="hero-title">
            {isDiffMode ? '画像对比' : '当前画像'}
          </div>
          <div className="hero-subtitle">
            {isDiffMode
              ? `对比 ${diffLabel || '历史快照'} 与当前画像`
              : `最近进化 · ${lastEvolvedAt ? new Date(lastEvolvedAt).toLocaleString('zh-CN') : '未知'} · 来源：与 AI 对话累积`}
          </div>
        </div>
        {!isDiffMode && (
          <ConfidenceRing value={confidence} />
        )}
        {isDiffMode && (
          <button
            type="button"
            className="hero-clear-diff"
            onClick={onClearDiff}
            aria-label="关闭 diff 视图"
          >
            ×
          </button>
        )}
      </div>

      {isDiffMode ? (
        <PersonaDiffList diff={diff} />
      ) : hasData ? (
        <div className="persona-cols">
          <PersonaColumn title="用户习惯" items={habits} />
          <PersonaColumn title="用户性格" items={traits} />
          <PersonaColumn title="用户需求" items={needs} />
        </div>
      ) : (
        <div className="hero-empty">
          暂无 AI 画像 · 与 AI 对话累积 3 轮后自动生成
        </div>
      )}
    </section>
  );
}
