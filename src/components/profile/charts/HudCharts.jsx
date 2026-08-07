// src/components/profile/charts/HudCharts.jsx
// 电影级科技面板图表库 —— 纯 SVG，无外部依赖，viewBox 自适应。
// 提供：多系列线图 / 雷达图 / 柱状图 / 迷你火花线 / 弧形仪表盘。
// 颜色跟随主题系统（data-mode + data-palette），切换主题时图表实时换色。
import { useState, useRef } from 'react';
import { useThemeColors } from '../../../hooks/useThemeColors.js';

/* 生成不含冒号的稳定 id，避免 useId 的 ":" 破坏 SVG url(#...) 引用 */
let _hudSeq = 0;
function useStableId() {
  const ref = useRef(null);
  if (ref.current == null) ref.current = `hud${_hudSeq++}${Math.random().toString(36).slice(2, 6)}`;
  return ref.current;
}

/* ============================ 工具 ============================ */

function niceMax(value) {
  if (value <= 0) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  let step;
  if (n <= 1) step = 1;
  else if (n <= 2) step = 2;
  else if (n <= 5) step = 5;
  else step = 10;
  return step * pow;
}

/* hex(#rrggbb) + alpha -> rgba()，供 SVG 网格线/描边使用 */
const withAlpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/* 主题动态色板（SVG 需要具体色值，不能直接用 CSS 变量） */
function usePalette() {
  const c = useThemeColors();
  return [c.cyan, c.green, c.amber, c.violet, c.red, c.blue];
}

/* ====================== 多系列线图（带扫描游标） ====================== */

export function HudLineChart({
  labels = [],
  series = [],
  height = 240,
  unit = '',
  animate = true,
  area = true,
}) {
  const palette = usePalette();
  const W = 640;
  const H = height;
  const PAD = { t: 18, r: 18, b: 28, l: 34 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const allVals = series.flatMap(s => s.values);
  const rawMax = Math.max(1, ...allVals);
  const max = niceMax(rawMax);

  const n = labels.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const xFor = i => PAD.l + (n > 1 ? i * stepX : innerW / 2);
  const yFor = v => PAD.t + innerH - (v / max) * innerH;

  const [hover, setHover] = useState(null);

  const gridY = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    gridY.push({ y: yFor(v), v: Math.round(v) });
  }

  const handleMove = e => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let idx = Math.round((x - PAD.l) / stepX);
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover(idx);
  };

  const uid = useStableId();

  return (
    <div className="hud-linechart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="hud-linechart-svg"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="趋势折线图"
      >
        <defs>
          {series.map((s, i) => {
            const color = s.color || palette[i % palette.length];
            return (
              <linearGradient key={i} id={`${uid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            );
          })}
        </defs>

        {/* 网格 */}
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={g.y} x2={W - PAD.r} y2={g.y} stroke={withAlpha(palette[0], 0.08)} strokeWidth="1" />
            <text x={PAD.l - 6} y={g.y + 3} textAnchor="end" className="hud-axis-text">{g.v}</text>
          </g>
        ))}

        {/* 悬停游标 */}
        {hover != null && (
          <line x1={xFor(hover)} y1={PAD.t} x2={xFor(hover)} y2={PAD.t + innerH}
                stroke={withAlpha(palette[0], 0.5)} strokeWidth="1" strokeDasharray="3,3" />
        )}

        {/* 面积 + 折线 */}
        {series.map((s, i) => {
          const color = s.color || palette[i % palette.length];
          const pts = s.values.map((v, j) => `${xFor(j)},${yFor(v)}`);
          const linePath = `M${pts.join(' L')}`;
          const areaPath = `M${xFor(0)},${PAD.t + innerH} L${pts.join(' L')} L${xFor(n - 1)},${PAD.t + innerH} Z`;
          return (
            <g key={i}>
              {area && <path d={areaPath} fill={`url(#${uid}-area-${i})`} />}
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength="1"
                style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
                className={animate ? 'hud-draw-line' : undefined}
              />
              {s.values.map((v, j) => {
                const active = hover === j;
                return (
                  <circle key={j} cx={xFor(j)} cy={yFor(v)} r={active ? 4 : 2.5}
                          fill={color} stroke="#0b0e11" strokeWidth={active ? 2 : 0}
                          style={{ cursor: 'pointer' }} />
                );
              })}
            </g>
          );
        })}

        {/* X 轴标签（稀疏） */}
        {labels.map((lab, i) => {
          if (n > 8 && i % Math.ceil(n / 8) !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={xFor(i)} y={H - 8} textAnchor="middle" className="hud-axis-text">{lab}</text>
          );
        })}
      </svg>

      {hover != null && (
        <div className="hud-linechart-tip" style={{ left: `${(xFor(hover) / W) * 100}%` }}>
          <span className="hud-tip-label">{labels[hover]}</span>
          {series.map((s, i) => {
            const color = s.color || palette[i % palette.length];
            return (
              <span key={i} className="hud-tip-row">
                <i style={{ background: color }} />
                {s.name}：<b>{s.values[hover]}{unit}</b>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================ 雷达图 ============================ */

export function HudRadarChart({ axes = [], values = [], max = 100, color = '' }) {
  const palette = usePalette();
  if (!color) color = palette[0];
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 38;
  const rings = 4;
  const N = axes.length;
  if (N === 0) return <div className="hud-radar-empty">暂无维度</div>;

  const angleFor = i => (Math.PI * 2 * i) / N - Math.PI / 2;
  const point = (i, r) => [cx + Math.cos(angleFor(i)) * r, cy + Math.sin(angleFor(i)) * r];

  const ringPolys = Array.from({ length: rings }, (_, r) => {
    const rr = (R * (r + 1)) / rings;
    return Array.from({ length: N }, (_, i) => point(i, rr).join(',')).join(' ');
  });

  const dataPts = values.map((v, i) => point(i, (Math.max(0, Math.min(max, v)) / max) * R));
  const dataPoly = dataPts.map(p => p.join(',')).join(' ');
  const uid = useStableId();

  return (
    <div className="hud-radar">
      <svg viewBox={`0 0 ${size} ${size}`} className="hud-radar-svg" role="img" aria-label="维度雷达图">
        <defs>
          <radialGradient id={`${uid}-fill`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.08" />
          </radialGradient>
        </defs>
        {ringPolys.map((poly, i) => (
          <polygon key={i} points={poly} fill="none" stroke={withAlpha(palette[0], 0.12)} strokeWidth="1" />
        ))}
        {Array.from({ length: N }, (_, i) => {
          const [x, y] = point(i, R);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={withAlpha(palette[0], 0.12)} strokeWidth="1" />;
        })}
        <polygon
          points={dataPoly}
          fill={`url(#${uid}-fill)`}
          stroke={color}
          strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 6px ${color}99)` }}
          className="hud-draw-poly"
        />
        {dataPts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} stroke="#0b0e11" strokeWidth="1.5" />
        ))}
        {axes.map((ax, i) => {
          const [x, y] = point(i, R + 18);
          const anchor = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end';
          return (
            <text key={i} x={x} y={y + 3} textAnchor={anchor} className="hud-radar-label">{ax}</text>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================ 柱状图 ============================ */

export function HudBarChart({ items = [], height = 200, unit = '' }) {
  const palette = usePalette();
  const W = 640;
  const H = height;
  const PAD = { t: 16, r: 14, b: 28, l: 30 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(1, ...items.map(d => d.value)));
  const n = items.length;
  const gap = n > 0 ? innerW / n : 0;
  const bw = Math.min(54, gap * 0.52);
  const uid = useStableId();

  const gridY = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    gridY.push({ y: PAD.t + innerH - (v / max) * innerH, v: Math.round(v) });
  }

  return (
    <div className="hud-barchart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="hud-barchart-svg" role="img" aria-label="柱状图">
        <defs>
          {items.map((it, i) => (
            <linearGradient key={i} id={`${uid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={it.color || palette[i % palette.length]} stopOpacity="0.95" />
              <stop offset="100%" stopColor={it.color || palette[i % palette.length]} stopOpacity="0.35" />
            </linearGradient>
          ))}
        </defs>
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={g.y} x2={W - PAD.r} y2={g.y} stroke={withAlpha(palette[0], 0.07)} strokeWidth="1" />
            <text x={PAD.l - 6} y={g.y + 3} textAnchor="end" className="hud-axis-text">{g.v}</text>
          </g>
        ))}
        {items.map((it, i) => {
          const x = PAD.l + gap * i + (gap - bw) / 2;
          const h = (it.value / max) * innerH;
          const y = PAD.t + innerH - h;
          const color = it.color || palette[i % palette.length];
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx="3"
                    fill={`url(#${uid}-bar-${i})`}
                    style={{ filter: `drop-shadow(0 0 5px ${color}66)` }}
                    className="hud-bar-grow" />
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="hud-bar-value">{it.value}{unit}</text>
              <text x={x + bw / 2} y={H - 9} textAnchor="middle" className="hud-axis-text">{it.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================ 迷你火花线 ============================ */

export function HudSparkline({ values = [], color = '', width = 120, height = 34 }) {
  const palette = usePalette();
  if (!color) color = palette[0];
  if (values.length === 0) return <svg viewBox={`0 0 ${width} ${height}`} className="hud-sparkline" />;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const n = values.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const pts = values.map((v, i) => `${(n > 1 ? i * stepX : width / 2).toFixed(1)},${(height - ((v - min) / range) * (height - 6) - 3).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="hud-sparkline" preserveAspectRatio="none" role="img" aria-label="迷你趋势">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${color}88)` }} />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}

/* ============================ 弧形仪表盘 ============================ */

export function HudGauge({ value = 0, label = '', sub = '', size = 150 }) {
  const palette = usePalette();
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;
  const start = 135;
  const sweep = 270;
  const circ = 2 * Math.PI * r;
  const arcLen = (sweep / 360) * circ;
  const offset = arcLen * (1 - v / 100);
  const uid = useStableId();
  const polar = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [sx, sy] = polar(start);
  const [ex, ey] = polar(start + sweep);

  return (
    <div className="hud-gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${v}%`}>
        <defs>
          <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette[0]} />
            <stop offset="100%" stopColor={palette[1]} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={withAlpha(palette[0], 0.1)} strokeWidth="9"
                strokeLinecap="round" strokeDasharray={`${arcLen} ${circ}`} transform={`rotate(${start} ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${uid}-g)`} strokeWidth="9"
                strokeLinecap="round" strokeDasharray={`${arcLen} ${circ}`} strokeDashoffset={offset}
                transform={`rotate(${start} ${cx} ${cy})`}
                style={{ filter: `drop-shadow(0 0 6px ${withAlpha(palette[0], 0.5)})` }} className="hud-gauge-arc" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="hud-gauge-value">{v}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="hud-gauge-pct">%</text>
      </svg>
      {(label || sub) && (
        <div className="hud-gauge-cap">
          {label && <span className="hud-gauge-label">{label}</span>}
          {sub && <span className="hud-gauge-sub">{sub}</span>}
        </div>
      )}
    </div>
  );
}
