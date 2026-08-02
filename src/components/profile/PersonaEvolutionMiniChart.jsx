// src/components/profile/PersonaEvolutionMiniChart.jsx
// Phase 6: 精简 SVG 进化趋势图，3 条折线 + 节点 + 图例
// Index 映射：personaHistory 是 DESC（最新在前，index 0 = 今日）
// buildPersonaTrendSeries 内部 reverse 成 ASC（最早→最新，最右 = 今日 = history[0]）
// 所以趋势图节点 j（从左到右）对应 history[length-1-j]
import { buildPersonaTrendSeries } from '../../utils/dashboardBuilders.js';

const SERIES_STYLE = [
  { name: '习惯', stroke: '#00e5ff', dash: '' },
  { name: '性格', stroke: '#0088aa', dash: '3,3' },
  { name: '需求', stroke: 'rgba(0,229,255,0.4)', dash: '' },
];

export default function PersonaEvolutionMiniChart({ history, loading, selectedIdx, onSelectNode }) {
  if (loading) {
    return (
      <section className="evolution-card">
        <div className="info-card-header">
          <span className="info-card-title">画像进化趋势</span>
        </div>
        <p className="card-loading">加载中...</p>
      </section>
    );
  }
  if (!history || history.length === 0) return null;

  const { labels, series } = buildPersonaTrendSeries(history);
  // labels 和 series.values 都是 ASC（最早→最新，最右 = 今日 = history[0]）

  const W = 400, H = 80, PADDING = 20;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values));
  const stepX = (W - PADDING * 2) / Math.max(1, labels.length - 1);

  const toX = (i) => PADDING + i * stepX;
  const toY = (v) => H - PADDING - (v / maxVal) * (H - PADDING * 2);
  // 趋势图节点 i 对应 history[length - 1 - i]（反向映射）
  const trendIdxToHistoryIdx = (i) => history.length - 1 - i;

  return (
    <section className="evolution-card">
      <div className="info-card-header">
        <span className="info-card-title">画像进化趋势</span>
        <span className="info-card-meta">最近 {history.length} 次进化 · 点击节点查看 diff</span>
      </div>
      <div className="evolution-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[20, 40, 60].map(y => (
            <line key={y} x1="0" y1={y} x2={W} y2={y}
                  stroke="rgba(0,229,255,0.06)" strokeWidth="1" />
          ))}
          {series.map((s, si) => {
            const style = SERIES_STYLE[si];
            const points = s.values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
            return (
              <g key={s.name}>
                <polyline points={points} fill="none"
                          stroke={style.stroke} strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round"
                          strokeDasharray={style.dash} />
                {s.values.map((v, i) => {
                  const historyIdx = trendIdxToHistoryIdx(i);
                  const isActive = selectedIdx === historyIdx;
                  return (
                    <circle key={i} cx={toX(i)} cy={toY(v)}
                            r={isActive ? 4 : 3}
                            fill={style.stroke}
                            stroke="#0B0E11" strokeWidth={isActive ? 2 : 0}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onSelectNode(historyIdx)} />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="evolution-legend">
        {SERIES_STYLE.map((s, i) => (
          <span key={i}>
            <span className="legend-dot" style={{ background: s.stroke }} />
            {s.name}
          </span>
        ))}
      </div>
    </section>
  );
}
