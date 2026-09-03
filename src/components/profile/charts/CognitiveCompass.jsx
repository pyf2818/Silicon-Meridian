// src/components/profile/charts/CognitiveCompass.jsx
// 认知罗盘 —— 「认知星图」主视觉。
//
// 设计动机：仪表盘的老问题是「一张图讲一件事」，于是页面越堆越长。
// 罗盘反其道而行：把三层彼此相关的时间/结构数据压进同一个极坐标系，
//   外环 = 昼夜节律（24h）  中环 = 领域力场（结构）  内旋 = 30 天时间螺旋
// 半径即语义，鼠标落在哪一层就解读哪一层，一瞥可得全局。
//
// 全部纯 SVG，无第三方依赖；颜色随主题系统实时切换。
import { useMemo, useRef, useState, useCallback } from 'react';
import { useThemeColors } from '../../../hooks/useThemeColors.js';
import {
  annularSector,
  polar,
  ratio,
  svgPoint,
  toPolar,
  useAtlasPalette,
  useStableId,
  withAlpha,
} from './atlasPrimitives.js';

const SIZE = 540;
const C = SIZE / 2;

/* 各层半径带（从外到内） */
const R = {
  clockLabel: 262,   // 时刻文字
  dayTrack: [208, 216],   // 昼夜环底轨
  dayBar: [216, 250],     // 昼夜环柱体
  domainTrack: [140, 146],
  domainBar: [146, 192],
  spiral: [98, 136],      // 30 天螺旋半径区间
  tick: 88,               // 核心刻度环
  gauge: 72,              // 置信度进度环
};

const SPIRAL_TURNS = 1.5;          // 螺旋圈数
const SPIRAL_START_DEG = 180;      // 最旧一天起点（正下方），最新一天收在正上方

function isNight(hour) { return hour < 6 || hour >= 22; }

/* 30 天螺旋：返回采样路径 + 30 个节点坐标 */
function buildSpiral(count, rMin, rMax) {
  const total = SPIRAL_TURNS * 360;
  const at = t => {
    const deg = SPIRAL_START_DEG + (count > 1 ? (t / (count - 1)) * total : 0);
    const r = rMax - (count > 1 ? (t / (count - 1)) : 0) * (rMax - rMin);
    return polar(C, C, r, deg);
  };
  const path = [];
  const steps = Math.max(120, count * 8);
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at((i / steps) * (count - 1));
    path.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  const nodes = Array.from({ length: count }, (_, i) => at(i));
  return { path: path.join(' '), nodes };
}

function layerOf(radius) {
  if (radius >= R.dayTrack[0] - 6 && radius <= R.clockLabel) return 'day';
  if (radius >= R.domainTrack[0] - 6 && radius <= R.domainBar[1] + 6) return 'domain';
  if (radius >= R.spiral[0] - 12 && radius <= R.spiral[1] + 12) return 'time';
  return null;
}

export default function CognitiveCompass({
  hourDist = [],
  trendData = [],
  day30 = [],
  domains = [],
  confidence = 0,
  confidenceLabel = '',
  behaviorDepth = '',
  empty = false,
}) {
  const palette = useAtlasPalette();
  const theme = useThemeColors();
  const uid = useStableId('compass');
  const svgRef = useRef(null);
  const [probe, setProbe] = useState(null); // { layer, deg, radius, tip, x, y }

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => hourDist[i] || 0), [hourDist]);
  const hourMax = useMemo(() => Math.max(1, ...hours), [hours]);
  const trend = useMemo(() => (trendData.length ? trendData : Array(30).fill(0)), [trendData]);
  const trendMax = useMemo(() => Math.max(1, ...trend), [trend]);

  const domainMax = useMemo(() => Math.max(1, ...domains.map(d => d.score || 0)), [domains]);
  const domainCount = Math.max(domains.length, 1);

  const spiral = useMemo(() => buildSpiral(trend.length, R.spiral[0], R.spiral[1]), [trend.length]);

  /* 领域图例（罗盘上不塞文字，避免和时刻标签打架） */
  const domainLegend = useMemo(() => domains.slice(0, 8).map((d, i) => ({
    ...d,
    color: palette[i % palette.length],
    pct: Math.round(ratio(d.score, domainMax) * 100),
  })), [domains, domainMax, palette]);

  const handleMove = useCallback((event) => {
    const p = svgPoint(svgRef.current, event.clientX, event.clientY);
    if (!p) return;
    const { radius, deg } = toPolar(C, C, p.x, p.y);
    const layer = layerOf(radius);
    if (!layer) { setProbe(null); return; }

    let tip = null;
    if (layer === 'day') {
      const h = Math.floor(deg / 15) % 24;
      const totalReads = hours.reduce((a, b) => a + b, 0);
      const pct = totalReads ? Math.round((hours[h] / totalReads) * 100) : 0;
      tip = {
        title: `${String(h).padStart(2, '0')}:00`,
        rows: [[`${hours[h]} 次阅读`, palette[0]], [`占全天 ${pct}%`, '']],
      };
    } else if (layer === 'domain') {
      if (!domainLegend.length) { setProbe(null); return; }
      const idx = Math.min(domainLegend.length - 1, Math.floor((deg / 360) * domainLegend.length));
      const d = domainLegend[idx];
      tip = { title: d.label, rows: [[`权重 ${d.score}`, d.color], [`占比 ${d.pct}%`, '']] };
    } else {
      // 螺旋：取欧氏距离最近的节点
      let best = -1;
      let bestDist = Infinity;
      spiral.nodes.forEach(([nx, ny], i) => {
        const dist = Math.hypot(nx - p.x, ny - p.y);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      if (best < 0 || bestDist > 26) { setProbe(null); return; }
      tip = {
        title: (day30[best] || `第 ${best + 1} 天`).slice(5),
        rows: [[`${trend[best]} 条`, palette[1]], [best === trend.length - 1 ? '今天' : `${trend.length - 1 - best} 天前`, '']],
      };
    }
    setProbe({ layer, deg, radius, tip, x: p.x, y: p.y });
  }, [hours, domainLegend, spiral.nodes, trend, day30, palette]);

  const leave = useCallback(() => setProbe(null), []);

  const gaugeLen = 2 * Math.PI * R.gauge;
  const conf = Math.max(0, Math.min(100, Number(confidence) || 0));
  const gaugeOffset = gaugeLen * (1 - conf / 100);

  return (
    <div className="pa-compass">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="pa-compass-svg"
        role="img"
        aria-label={`认知罗盘：画像置信度 ${conf}%，${domains.length} 个领域维度，近 30 天阅读节律`}
        onMouseMove={handleMove}
        onMouseLeave={leave}
      >
        <defs>
          <radialGradient id={`${uid}-core`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={withAlpha(palette[0], 0.16)} />
            <stop offset="70%" stopColor={withAlpha(palette[0], 0.05)} />
            <stop offset="100%" stopColor={withAlpha(palette[0], 0)} />
          </radialGradient>
          <linearGradient id={`${uid}-gauge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette[0]} />
            <stop offset="100%" stopColor={palette[1]} />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* 中心辉光 */}
        <circle cx={C} cy={C} r={R.tick + 4} fill={`url(#${uid}-core)`} />

        {/* ---------- 层 1：昼夜节律环（24h） ---------- */}
        <g className="pa-layer-day">
          {hours.map((v, h) => {
            const deg0 = h * 15;
            const deg1 = deg0 + 15;
            const night = isNight(h);
            return (
              <path
                key={`dt${h}`}
                d={annularSector(C, C, R.dayTrack[0], R.dayTrack[1], deg0 + 0.6, deg1 - 0.6)}
                fill={withAlpha(palette[0], night ? 0.05 : 0.1)}
              />
            );
          })}
          {hours.map((v, h) => {
            if (!v) return null;
            const len = (R.dayBar[1] - R.dayBar[0]) * Math.max(0.12, ratio(v, hourMax));
            const hot = v >= hourMax * 0.75;
            const color = isNight(h) ? palette[2] : palette[0];
            return (
              <path
                key={`db${h}`}
                d={annularSector(C, C, R.dayBar[0], R.dayBar[0] + len, h * 15 + 1.4, h * 15 + 13.6)}
                fill={color}
                opacity={isNight(h) ? 0.42 : hot ? 1 : 0.62 + 0.3 * ratio(v, hourMax)}
                className="pa-bar-in"
                style={hot && !isNight(h) ? { filter: `drop-shadow(0 0 5px ${withAlpha(palette[0], 0.55)})` } : undefined}
              />
            );
          })}
          {[0, 3, 6, 9, 12, 15, 18, 21].map(h => {
            const [x, y] = polar(C, C, R.clockLabel, h * 15 + 7.5);
            return <text key={`cl${h}`} x={x} y={y + 3.5} textAnchor="middle" className="pa-clock-label">{String(h).padStart(2, '0')}</text>;
          })}
        </g>

        {/* ---------- 层 2：领域力场 ---------- */}
        <g className="pa-layer-domain">
          {domainLegend.map((d, i) => {
            const span = 360 / domainLegend.length;
            const deg0 = i * span + 2;
            const deg1 = (i + 1) * span - 2;
            return (
              <path
                key={`dm${i}`}
                d={annularSector(C, C, R.domainTrack[0], R.domainBar[1], deg0, deg1)}
                fill={withAlpha(d.color, 0.07)}
              />
            );
          })}
          {domainLegend.map((d, i) => {
            const span = 360 / domainLegend.length;
            const deg0 = i * span + 2;
            const deg1 = (i + 1) * span - 2;
            const len = (R.domainBar[1] - R.domainBar[0]) * Math.max(0.18, ratio(d.score, domainMax));
            return (
              <path
                key={`dv${i}`}
                d={annularSector(C, C, R.domainBar[0], R.domainBar[0] + len, deg0, deg1)}
                fill={d.color}
                opacity={0.34 + 0.5 * ratio(d.score, domainMax)}
                stroke={d.color}
                strokeWidth="1"
                strokeOpacity="0.9"
                className="pa-bar-in"
              />
            );
          })}
          <circle cx={C} cy={C} r={R.domainTrack[0] - 2} fill="none" stroke={withAlpha(palette[0], 0.14)} strokeWidth="1" />
        </g>

        {/* ---------- 层 3：30 天时间螺旋 ---------- */}
        <g className="pa-layer-time">
          <polyline
            points={spiral.path}
            fill="none"
            stroke={withAlpha(palette[0], 0.16)}
            strokeWidth="1"
            strokeDasharray="2 4"
          />
          {spiral.nodes.map(([x, y], i) => {
            const v = trend[i] || 0;
            const r = 2 + ratio(v, trendMax) * 7;
            const isToday = i === trend.length - 1;
            const isPeak = v > 0 && v === trendMax;
            return (
              <g key={`sp${i}`}>
                <circle
                  cx={x} cy={y} r={r}
                  fill={isToday ? palette[1] : palette[0]}
                  fillOpacity={v ? 0.22 + 0.6 * ratio(v, trendMax) : 0.12}
                  stroke={isToday ? palette[1] : isPeak ? palette[3] : withAlpha(palette[0], 0.45)}
                  strokeWidth={isToday ? 2 : 1}
                  className="pa-dot-in"
                />
                {isToday && (
                  <circle
                    cx={x} cy={y} r={r + 3} fill="none"
                    stroke={palette[1]} strokeWidth="1" strokeOpacity="0.55"
                    className="pa-ping"
                    style={{ transformOrigin: `${x}px ${y}px` }}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* ---------- 层 4：置信度核心 ---------- */}
        <g className="pa-layer-core">
          <g className="pa-tick-ring" style={{ transformOrigin: `${C}px ${C}px` }}>
            {Array.from({ length: 60 }, (_, i) => {
              const deg = i * 6;
              const long = i % 5 === 0;
              const [x1, y1] = polar(C, C, R.tick, deg);
              const [x2, y2] = polar(C, C, R.tick - (long ? 7 : 3.5), deg);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={withAlpha(palette[0], long ? 0.42 : 0.18)} strokeWidth={long ? 1.4 : 1} />;
            })}
          </g>
          <circle cx={C} cy={C} r={R.gauge} fill="none" stroke={withAlpha(palette[0], 0.12)} strokeWidth="9" />
          <circle
            cx={C} cy={C} r={R.gauge} fill="none"
            stroke={`url(#${uid}-gauge)`} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={gaugeLen} strokeDashoffset={gaugeOffset}
            transform={`rotate(-90 ${C} ${C})`}
            className="pa-gauge-arc"
          />
          <text x={C} y={C - 4} textAnchor="middle" className="pa-core-value">{conf}</text>
          <text x={C} y={C + 14} textAnchor="middle" className="pa-core-unit">% 置信度</text>
          <text x={C} y={C + 32} textAnchor="middle" className="pa-core-sub">{confidenceLabel || '待校准'}</text>
        </g>

        {/* ---------- 径向游标 ---------- */}
        {probe && (
          <g className="pa-probe">
            <line
              x1={polar(C, C, 92, probe.deg)[0]} y1={polar(C, C, 92, probe.deg)[1]}
              x2={polar(C, C, 254, probe.deg)[0]} y2={polar(C, C, 254, probe.deg)[1]}
              stroke={withAlpha(palette[0], 0.5)} strokeWidth="1" strokeDasharray="3 4"
            />
            {[R.dayBar[0] - 4, R.domainBar[1] + 4, R.spiral[0] - 4].map((r, i) => {
              const [x, y] = polar(C, C, r, probe.deg);
              return <circle key={i} cx={x} cy={y} r="2" fill={withAlpha(palette[0], 0.65)} />;
            })}
          </g>
        )}

        {/* 空数据骨架提示 */}
        {empty && (
          <text x={C} y={C + 58} textAnchor="middle" className="pa-core-hint">等待行为信号</text>
        )}
      </svg>

      {probe?.tip && (
        <div
          className="pa-compass-tip"
          style={{ left: `${(probe.x / SIZE) * 100}%`, top: `${(probe.y / SIZE) * 100}%` }}
        >
          <strong>{probe.tip.title}</strong>
          {probe.tip.rows.map(([text, color], i) => (
            <span key={i}>{color && <i style={{ background: color }} />}{text}</span>
          ))}
        </div>
      )}

      {domainLegend.length > 0 && (
        <div className="pa-compass-legend">
          {domainLegend.map(d => (
            <span key={d.id || d.label} className="pa-legend-chip">
              <i style={{ background: d.color }} />
              {d.label}
              <b>{d.pct}%</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
