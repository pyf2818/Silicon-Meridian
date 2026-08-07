// src/components/profile/dashboard/HudPanel.jsx
// 电影指挥中心面板外壳 + KPI 火花线条
import { HudSparkline } from '../charts/HudCharts.jsx';

/* 面板外壳：切角 + 四角 HUD 角标 + 扫描线 + mono 标题 */
export function HudPanel({
  title,
  kicker,
  accent = '#00e5ff',
  right,
  scan = true,
  className = '',
  children,
}) {
  return (
    <section className={`hud-panel ${className}`} style={{ '--panel-accent': accent }}>
      {scan && <span className="hud-panel-scan" aria-hidden="true" />}
      <span className="hud-corner hud-corner-tl" aria-hidden="true" />
      <span className="hud-corner hud-corner-tr" aria-hidden="true" />
      <span className="hud-corner hud-corner-bl" aria-hidden="true" />
      <span className="hud-corner hud-corner-br" aria-hidden="true" />
      {(title || kicker || right) && (
        <header className="hud-panel-head">
          <div className="hud-panel-titles">
            {kicker && <span className="hud-panel-kicker">{kicker}</span>}
            {title && <h3 className="hud-panel-title">{title}</h3>}
          </div>
          {right && <div className="hud-panel-right">{right}</div>}
        </header>
      )}
      <div className="hud-panel-body">{children}</div>
    </section>
  );
}

/* KPI 条：大数字 + 火花线 / 装饰电平条 */
export function KpiStripHud({ items = [] }) {
  return (
    <div className="hud-kpi-strip">
      {items.map((it, i) => (
        <div className="hud-kpi" key={i} style={{ '--kpi-accent': it.color || '#00e5ff' }}>
          <div className="hud-kpi-top">
            <span className="hud-kpi-value">{it.value}</span>
            {it.trend != null && <span className={`hud-kpi-trend ${it.trend >= 0 ? 'up' : 'down'}`}>{it.trend >= 0 ? '▲' : '▼'}{Math.abs(it.trend)}</span>}
          </div>
          <span className="hud-kpi-label">{it.label}</span>
          {it.sub && <span className="hud-kpi-sub">{it.sub}</span>}
          <div className="hud-kpi-foot">
            {it.spark && it.spark.length > 0 ? (
              <HudSparkline values={it.spark} color={it.color || '#00e5ff'} />
            ) : it.meter != null ? (
              <div className="hud-kpi-meter">
                {Array.from({ length: 12 }).map((_, b) => (
                  <i key={b} style={{ opacity: b / 12 <= it.meter / 100 ? 1 : 0.18 }} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
