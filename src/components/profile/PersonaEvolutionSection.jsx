// src/components/profile/PersonaEvolutionSection.jsx
// Phase 5: 仪表盘第 6 区块「画像进化趋势」
// TrendLineChart（3 条 series：习惯/性格/需求长度）+ 点击某点展开 diff

import { useState } from 'react';
import TrendLineChart from '../TrendLineChart.jsx';
import PersonaDiffCard from './PersonaDiffCard.jsx';
import { buildPersonaTrendSeries, diffPersonaSnapshots } from '../../utils/dashboardBuilders.js';

export default function PersonaEvolutionSection({ history = [], loading, currentPersonaSummary }) {
  const [selectedIdx, setSelectedIdx] = useState(null);

  if (loading) {
    return (
      <section className="dashboard-section persona-evolution-section">
        <div className="section-header">
          <h2 className="section-title">画像进化趋势</h2>
        </div>
        <div className="dashboard-loading">加载中...</div>
      </section>
    );
  }

  if (!Array.isArray(history) || history.length === 0) {
    return (
      <section className="dashboard-section persona-evolution-section">
        <div className="section-header">
          <h2 className="section-title">画像进化趋势</h2>
        </div>
        <div className="dashboard-empty">暂无画像进化记录，与 AI 对话累积 3 轮后开始记录</div>
      </section>
    );
  }

  const { labels, series } = buildPersonaTrendSeries(history);
  const canDiff = history.length >= 2;
  const selectedSnapshot = selectedIdx != null ? history[history.length - 1 - selectedIdx]?.snapshot : null;
  const diff = selectedIdx != null && canDiff
    ? diffPersonaSnapshots(selectedSnapshot || {}, currentPersonaSummary || {})
    : null;
  const selectedLabel = selectedIdx != null ? labels[selectedIdx] : '';

  return (
    <section className="dashboard-section persona-evolution-section">
      <div className="section-header">
        <h2 className="section-title">画像进化趋势</h2>
        <p className="section-desc">最近 {history.length} 次画像进化（点击某点查看 diff）</p>
      </div>
      <TrendLineChart
        labels={labels}
        series={series}
        onSelect={canDiff ? ({ index }) => setSelectedIdx(index) : null}
      />
      {selectedIdx != null && diff && (
        <div className="persona-diff-wrap">
          <div className="persona-diff-toolbar">
            <span className="diff-selected-label">已选：{selectedLabel}</span>
            <button
              className="diff-close-btn"
              onClick={() => setSelectedIdx(null)}
              aria-label="关闭 diff"
            >
              ×
            </button>
          </div>
          <PersonaDiffCard
            diff={diff}
            prevLabel={selectedLabel}
            currentLabel="当前"
          />
        </div>
      )}
      {selectedIdx != null && !canDiff && (
        <p className="persona-diff-hint">历史记录不足 2 条，无法计算 diff</p>
      )}
    </section>
  );
}
