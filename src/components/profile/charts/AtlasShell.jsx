// src/components/profile/charts/AtlasShell.jsx
// 认知星图设计语言的共享骨架：Panel 面板 / Tele 遥测块 / Brand 抬头。
// 画像中心 4 个分区（总览/洞察/偏好/社交）共用，保证同一套视觉语法。
// 样式类 pa-* 作用域在 .profile-center-page 下（hud-theme.css Section 19），
// 跨分区复用零额外成本。

export function Panel({ kicker, title, meta, children, className = '' }) {
  return (
    <section className={'pa-panel ' + className}>
      <div className="pa-panel-head">
        <div className="pa-panel-titles">
          <span className="pa-kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {meta && <span className="pa-panel-meta">{meta}</span>}
      </div>
      <div className="pa-panel-body">{children}</div>
    </section>
  );
}

export function Tele({ label, value, unit, note, pct = 0, tone = '' }) {
  return (
    <div className={'pa-tele ' + tone}>
      <span className="pa-tele-label">{label}</span>
      <div className="pa-tele-value-row">
        <strong className="pa-tele-value">{value}</strong>
        {unit && <span className="pa-tele-unit">{unit}</span>}
      </div>
      <span className="pa-tele-note">{note}</span>
      <span className="pa-tele-track"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>
    </div>
  );
}

export function Brand({ kicker, title, desc, tags }) {
  return (
    <div className="pa-header-brand">
      <span className="pa-kicker">{kicker}</span>
      <h2>{title}</h2>
      <p>
        {desc}
        {tags && tags.length > 0 && <em> / {tags.join(' / ')}</em>}
      </p>
    </div>
  );
}
