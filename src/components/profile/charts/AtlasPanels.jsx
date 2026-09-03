// src/components/profile/charts/AtlasPanels.jsx
// 认知星图的卫星面板：信号溯源条 / 认知偏好频谱 / 观测日志。
// 这些是「解释层」——罗盘回答「你是什么形状」，它们回答「为什么」。
import { useMemo } from 'react';
import { useAtlasPalette, withAlpha } from './atlasPrimitives.js';

/* ============================================================
   信号溯源：信息从哪里来，以及系统有多信任它
   ============================================================ */
export function SourceTrust({ sources = [], emptyText = '还没有稳定的信任来源' }) {
  const palette = useAtlasPalette();
  const max = Math.max(1, ...sources.map(s => s.score || 0));
  if (!sources.length) return <div className="pa-empty">{emptyText}</div>;
  return (
    <ul className="pa-trust-list">
      {sources.map((s, i) => {
        const color = palette[i % palette.length];
        const pct = Math.round(((s.score || 0) / max) * 100);
        return (
          <li key={`${s.name}-${i}`} className="pa-trust-row">
            <span className="pa-trust-name" title={s.name}>{s.name}</span>
            <span className="pa-trust-track">
              <i style={{ width: `${Math.max(3, pct)}%`, background: `linear-gradient(90deg, ${withAlpha(color, 0.35)}, ${color})` }} />
            </span>
            <span className="pa-trust-score">{s.score}</span>
            {s.tierLabel && <span className="pa-trust-tier" data-tier={s.tier}>{s.tierLabel}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/* ============================================================
   认知偏好频谱：把「系统认为你喜欢什么」摊开成可核对的刻度
   —— 分格条比标签云强的地方：能同时看到「选中了什么」和「证据有多强」
   ============================================================ */
export function SpectrumRow({ label, options = [], selected = '', counts = {} }) {
  const total = options.reduce((sum, o) => sum + (counts[o.key] || 0), 0) || 1;
  return (
    <div className="pa-spectrum-row">
      <span className="pa-spectrum-label">{label}</span>
      <div className="pa-spectrum-cells">
        {options.map(o => {
          const c = counts[o.key] || 0;
          const strength = c / total;
          return (
            <span
              key={o.key}
              className={'pa-spectrum-cell' + (selected === o.key ? ' is-on' : '')}
              style={selected === o.key ? undefined : { opacity: 0.42 + 0.5 * strength }}
              title={`${o.label} · ${c} 次观测`}
            >
              {o.label}
              {c > 0 && <b>{c}</b>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 24 小时时段条带。
 * 主数据 = 真实阅读小时分布（hourDist，来自浏览行为，几乎总有）；
 * 对话偏好（timePreference 的 morning/afternoon/...）退化为柱顶高亮标记——
 * 行为是事实，偏好是推断，两者画在同一根轴上互相印证。
 */
export function TimeBand({ hourDist = [], timePref = {}, emptyText = '暂无时段数据' }) {
  const palette = useAtlasPalette();

  const { cells, prefHours, source } = useMemo(() => {
    const RANGE = {
      morning: [6, 12], afternoon: [12, 18], evening: [18, 24], night: [0, 6],
    };
    // 偏好时段 → 覆盖的小时集合（取观测最强的前两个时段）
    const ranked = Object.entries(timePref)
      .filter(([key]) => RANGE[key])
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, 2);
    const marks = new Set();
    ranked.forEach(([key]) => {
      const [from, to] = RANGE[key];
      for (let h = from; h < to; h++) marks.add(h);
    });

    let values;
    let src;
    const real = Array.from({ length: 24 }, (_, h) => Number(hourDist[h]) || 0);
    if (real.some(v => v > 0)) {
      values = real;
      src = 'reading';
    } else {
      // 无阅读数据时，把偏好时段摊平成近似分布（6 格均匀），保证格子不空
      values = Array(24).fill(0);
      Object.entries(timePref).forEach(([key, count]) => {
        const range = RANGE[key];
        if (!range) return;
        const per = (Number(count) || 0) / (range[1] - range[0]);
        for (let h = range[0]; h < range[1]; h++) values[h] += per;
      });
      src = values.some(v => v > 0) ? 'inferred' : 'none';
    }
    return { cells: values, prefHours: marks, source: src };
  }, [hourDist, timePref]);

  const max = Math.max(...cells, 0);
  if (max <= 0 || source === 'none') return <div className="pa-empty">{emptyText}</div>;

  return (
    <div className="pa-timeband-wrap">
      <div className="pa-timeband" role="img" aria-label={source === 'inferred' ? '对话偏好时段分布' : '阅读活跃时段分布'}>
        {cells.map((v, h) => (
          <i
            key={h}
            className={prefHours.has(h) ? 'is-pref' : undefined}
            title={`${String(h).padStart(2, '0')}:00 · ${Math.round(v * 10) / 10} 次${prefHours.has(h) ? ' · 偏好时段' : ''}`}
            style={{
              height: `${18 + Math.max(0, v / max) * 82}%`,
              background: v ? withAlpha(palette[0], 0.28 + 0.62 * (v / max)) : 'var(--hud-track, rgba(128,138,150,0.14))',
            }}
          />
        ))}
        <span className="pa-timeband-axis"><em>00</em><em>06</em><em>12</em><em>18</em><em>24</em></span>
      </div>
      {prefHours.size > 0 && (
        <div className="pa-timeband-legend">
          <span><i className="lg-bar" />阅读分布</span>
          <span><i className="lg-mark" />对话偏好</span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   观测日志：系统的自述 + 证据链 + 盲区 + 下一步
   ============================================================ */
export function ObservationLog({
  summary = '',
  evidence = [],
  blindSpots = [],
  nextActions = [],
  onAction,
  statusLabel = 'LIVE',
}) {
  return (
    <div className="pa-log">
      <div className="pa-log-main">
        <div className="pa-log-head">
          <span className="pa-kicker">OBSERVATION LOG</span>
          <span className="pa-log-status"><i />{statusLabel}</span>
        </div>
        <p className="pa-log-summary">{summary || '继续阅读与收藏，系统会逐步形成更稳定的偏好判断。'}</p>
        {evidence.length > 0 && (
          <div className="pa-log-why">
            <span className="pa-log-why-title">判断依据</span>
            <div className="pa-log-chips">
              {evidence.map((e, i) => <span key={i} className="pa-log-chip">{e}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="pa-log-side">
        <div className="pa-log-block">
          <span className="pa-log-block-title">认知盲区</span>
          {blindSpots.length
            ? <ul>{blindSpots.map((b, i) => <li key={i} className="pa-log-warn">{b}</li>)}</ul>
            : <p className="pa-log-ok">覆盖较均衡</p>}
        </div>
        <div className="pa-log-block">
          <span className="pa-log-block-title">建议下一步</span>
          {nextActions.length
            ? <ul>{nextActions.map((a, i) => (
                <li key={i}>
                  <button type="button" onClick={() => onAction?.(a)}>{a}</button>
                </li>
              ))}</ul>
            : <p className="pa-log-ok">保持当前节奏即可</p>}
        </div>
      </div>
    </div>
  );
}
