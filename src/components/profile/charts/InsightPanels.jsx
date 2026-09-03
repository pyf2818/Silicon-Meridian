// src/components/profile/charts/InsightPanels.jsx
// 行为洞察 / 我的社交 / 偏好设置共用的新图元。
// 原则与认知星图一致：面积/长度可比 > 字号戏法；多系列色用跨调色板固定的 --chart-1..5。
import { useAtlasPalette, withAlpha } from './atlasPrimitives.js';

/* ============================================================
   加权横条：名次 + 名称 + 长度可比的条 + 数值
   —— 兴趣分布 / 高频来源 / 提问模式 / 记忆关键词的统一表达
   ============================================================ */
export function WeightedBars({ items = [], emptyText = '暂无数据', unit = '' }) {
  const palette = useAtlasPalette();
  const max = Math.max(1, ...items.map(i => Number(i.count) || 0));
  if (!items.length) return <div className="pa-empty">{emptyText}</div>;
  return (
    <ul className="pi-bars">
      {items.map((it, i) => {
        const count = Number(it.count) || 0;
        const pct = (count / max) * 100;
        const color = palette[i % palette.length];
        return (
          <li key={`${it.label}-${i}`} className="pi-bar-row" title={`${it.label} · ${count}${unit}`}>
            <span className="pi-bar-rank">{String(i + 1).padStart(2, '0')}</span>
            <span className="pi-bar-name">{it.label}</span>
            <span className="pi-bar-track">
              <i style={{ width: `${Math.max(3, pct)}%`, background: `linear-gradient(90deg, ${withAlpha(color, 0.3)}, ${color})` }} />
            </span>
            <b className="pi-bar-val">{count}</b>
          </li>
        );
      })}
    </ul>
  );
}

/* ============================================================
   偏好强度计：四个维度（格式/深度/长度/语言）各自的观测强度
   —— 不只给结论，还给出「这个结论有多硬」
   ============================================================ */
export function PreferenceMeters({ prefs = [], emptyText = '对话样本不足，多和 AI 聊几句就会形成偏好判断' }) {
  const palette = useAtlasPalette();
  const rows = prefs.filter(p => p && p.selectedLabel);
  if (!rows.length) return <div className="pa-empty">{emptyText}</div>;
  const max = Math.max(1, ...rows.map(p => Number(p.count) || 0));
  return (
    <div className="pi-meters">
      {rows.map((p, i) => {
        const count = Number(p.count) || 0;
        const pct = (count / max) * 100;
        const color = palette[i % palette.length];
        return (
          <div key={p.label} className="pi-meter-row" title={`${p.label} → ${p.selectedLabel} · ${count} 次观测`}>
            <span className="pi-meter-dim">{p.label}</span>
            <span className="pi-meter-chip" style={{ borderColor: color, color }}>
              {p.selectedLabel}
            </span>
            <span className="pi-meter-track">
              <i style={{ width: `${Math.max(4, pct)}%`, background: `linear-gradient(90deg, ${withAlpha(color, 0.3)}, ${color})` }} />
            </span>
            <b className="pi-meter-count">{count}</b>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   置信环：一个 0-100 的环形仪表（SVG 弧线，dashoffset 动画）
   ============================================================ */
export function ConfidenceRing({ value = 0, size = 92, label = '', sub = '' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 40;
  const c = 2 * Math.PI * r;
  const arc = 0.75; // 270° 仪表弧
  return (
    <span className="pi-ring" style={{ width: size, height: size }} role="img" aria-label={`${label || '置信度'} ${v}%`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="pi-ring-track" cx="50" cy="50" r={r} style={{ strokeDasharray: `${c * arc} ${c}`, transform: 'rotate(135deg)', transformOrigin: '50% 50%' }} />
        <circle
          className="pi-ring-val"
          cx="50" cy="50" r={r}
          style={{
            strokeDasharray: `${c * arc * (v / 100)} ${c}`,
            transform: 'rotate(135deg)',
            transformOrigin: '50% 50%',
          }}
        />
      </svg>
      <span className="pi-ring-text">
        <b>{v}<i>%</i></b>
        {label && <em>{label}</em>}
        {sub && <u>{sub}</u>}
      </span>
    </span>
  );
}

/* ============================================================
   影响力仪表：社交版大号置信环（粉丝/关注/发布/获赞 加权合成）
   ============================================================ */
export function InfluenceGauge({ value = 0, level = '' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className={'pi-ring ps-influence-ring' + (v >= 66 ? ' is-high' : v >= 33 ? ' is-mid' : '')} role="img" aria-label={`社区影响力 ${v}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="pi-ring-track" cx="50" cy="50" r="40" style={{ strokeDasharray: `${2 * Math.PI * 40 * 0.75} ${2 * Math.PI * 40}`, transform: 'rotate(135deg)', transformOrigin: '50% 50%' }} />
        <circle className="pi-ring-val" cx="50" cy="50" r="40" style={{ strokeDasharray: `${2 * Math.PI * 40 * 0.75 * (v / 100)} ${2 * Math.PI * 40}`, transform: 'rotate(135deg)', transformOrigin: '50% 50%' }} />
      </svg>
      <span className="pi-ring-text">
        <b>{Math.round(v)}</b>
        <em>影响力指数</em>
        {level && <u>{level}</u>}
      </span>
    </span>
  );
}

/* ============================================================
   会话 habits 瓦片：总场次 / 总轮次 / 场均 / 峰值
   ============================================================ */
export function SessionTiles({ stats = {} }) {
  const tiles = [
    { label: '对话场次', value: stats.totalSessions ?? 0 },
    { label: '总轮次', value: stats.totalRounds ?? 0 },
    { label: '场均轮次', value: stats.avgRounds ?? 0 },
    { label: '单场峰值', value: stats.maxRounds ?? 0 },
  ];
  const max = Math.max(1, ...tiles.map(t => Number(t.value) || 0));
  return (
    <div className="pi-sessions">
      {tiles.map(t => (
        <div key={t.label} className="pi-session">
          <b>{t.value}</b>
          <span>{t.label}</span>
          <i style={{ width: `${Math.max(3, ((Number(t.value) || 0) / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
