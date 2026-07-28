// src/components/profile/PersonaTimelineRail.jsx
// Phase 6: 左侧时间轴，节点显示日期 + delta chip
// history 是 DESC（最新在前，index 0 = 今日）
import { formatEvolvedAt } from '../../utils/dashboardBuilders.js';

function computeDelta(prev, current) {
  if (!prev || !current) return null;
  const prevH = prev.habits?.length || 0;
  const prevT = prev.traits?.length || 0;
  const prevN = prev.needs?.length || 0;
  const currH = current.habits?.length || 0;
  const currT = current.traits?.length || 0;
  const currN = current.needs?.length || 0;
  const delta = (currH - prevH) + (currT - prevT) + (currN - prevN);
  if (delta === 0) return null;
  const labels = [
    currH !== prevH && '习惯',
    currT !== prevT && '性格',
    currN !== prevN && '需求',
  ].filter(Boolean);
  return {
    delta,
    isPositive: delta > 0,
    labels,
  };
}

export default function PersonaTimelineRail({ history, loading, selectedIdx, onSelectNode }) {
  return (
    <aside className="timeline-rail">
      <div className="timeline-header">画像进化轨迹</div>
      {loading ? (
        <div className="timeline-loading">加载中...</div>
      ) : history.length === 0 ? (
        <div className="timeline-empty">暂无历史快照</div>
      ) : (
        <div className="timeline-list">
          {history.map((item, idx) => {
            const prev = history[idx + 1];
            const current = item.snapshot;
            const delta = idx === 0 ? null : computeDelta(prev, current);
            const isActive = selectedIdx === idx;
            const isToday = idx === 0;
            return (
              <div
                key={item.evolved_at || idx}
                className={`timeline-node ${isActive ? 'active' : ''}`}
                onClick={() => onSelectNode(idx)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectNode(idx);
                  }
                }}
              >
                <div className="timeline-node-date">
                  {isToday ? '今日' : formatEvolvedAt(item.evolved_at)}
                </div>
                <div className="timeline-node-meta">
                  {isToday ? (
                    <span>当前画像</span>
                  ) : delta ? (
                    <>
                      <span className={`delta-chip ${delta.isPositive ? 'positive' : 'negative'}`}>
                        {delta.isPositive ? '+' : ''}{delta.delta}
                      </span>
                      <span>{delta.labels.join(' / ')}</span>
                    </>
                  ) : (
                    <span>无变化</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="timeline-footer">共 {history.length} 次进化</div>
    </aside>
  );
}
