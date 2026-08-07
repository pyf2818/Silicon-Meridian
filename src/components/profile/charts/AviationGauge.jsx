// src/components/profile/charts/AviationGauge.jsx
// 航空仪表盘风格圆盘 —— 模拟飞机仪表：分层刻度、指针、中心数字、四角标注
// 纯 SVG，无外部依赖，颜色跟随主题系统（useThemeColors 实时读取）。
import { useRef } from 'react';
import { useThemeColors } from '../../../hooks/useThemeColors.js';

let _seq = 0;
function useStableId() {
  const ref = useRef(null);
  if (ref.current == null) ref.current = `av${_seq++}${Math.random().toString(36).slice(2, 6)}`;
  return ref.current;
}

const withAlpha = (hex, a) => {
  try {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  } catch { return 'rgba(0,229,255,0.5)'; }
};

/**
 * 航空仪表盘：240° 扫描扇区 + 主/次刻度 + 指针 + 中心读数。
 * @param {number} value  0-100 的当前值
 * @param {string} label  仪表名称（下方）
 * @param {string} unit   读数单位（中心，如 "分"、"%"）
 * @param {string} sub    副标注（角落）
 * @param {number} size   直径 px
 */
export function AviationGauge({ value = 0, label = '', unit = '', sub = '', size = 168 }) {
  const c = useThemeColors();
  const cyan = c.cyan;
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const cx = size / 2;
  const cy = size / 2;
  const uid = useStableId();
  const r = size / 2 - 10;        // 外刻度半径
  const rInner = r - 12;          // 内刻度半径

  // 240° 扇形（-120° ~ +120°，即 240° ~ 480° 的数学角）
  const ANG_START = -120;
  const ANG_SWEEP = 240;
  const polar = (deg, radius) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };

  // 刻度线（主刻度 9 条，次刻度 4 条/区间）
  const ticks = [];
  for (let i = 0; i <= 48; i++) {
    const angle = ANG_START + (ANG_SWEEP / 48) * i;
    const major = i % 6 === 0;
    const [x1, y1] = polar(angle, r);
    const [x2, y2] = polar(angle, major ? rInner - 4 : rInner);
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={major ? cyan : withAlpha(cyan, 0.35)}
      strokeWidth={major ? 2.2 : 1}
      strokeLinecap="round" />);
  }

  // 指针角度（value 0~100 映射到 -120°~+120°）
  const ptrAngle = ANG_START + (ANG_SWEEP * v) / 100;
  const ptrLen = rInner - 14;
  const [px, py] = polar(ptrAngle, ptrLen);
  const [tx, ty] = polar(ptrAngle, ptrLen + 6); // 指针头延伸

  // 弧进度条
  const ARC = ANG_SWEEP;
  const circ = 2 * Math.PI * rInner;
  const arcLen = (ARC / 360) * circ;
  const arcOffset = arcLen * (1 - v / 100);

  return (
    <div className="aviation-gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${v}${unit}`}>
        <defs>
          <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={cyan} />
            <stop offset="100%" stopColor={withAlpha(cyan, 0.4)} />
          </linearGradient>
        </defs>

        {/* 面板底 */}
        <circle cx={cx} cy={cy} r={r + 4} fill={withAlpha(cyan, 0.04)}
          stroke={withAlpha(cyan, 0.2)} strokeWidth="1" />
        {/* 内圈暗面 */}
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke={withAlpha(cyan, 0.12)} strokeWidth="1" />

        {/* 240° 弧进度条
             SVG circle 的 dasharray 起点在 3 点钟方向（数学角 0°），rotate 直接映射到数学角。
             刻度/指针起点在 ANG_START(-120°)，故弧必须 rotate(ANG_START) 才能对齐。 */}
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke={withAlpha(cyan, 0.1)} strokeWidth="7"
          strokeLinecap="round" strokeDasharray={`${arcLen} ${circ}`} transform={`rotate(${ANG_START} ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke={`url(#${uid}-g)`} strokeWidth="7"
          strokeLinecap="round" strokeDasharray={`${arcLen} ${circ}`} strokeDashoffset={arcOffset}
          transform={`rotate(${ANG_START} ${cx} ${cy})`}
          style={{ filter: `drop-shadow(0 0 5px ${withAlpha(cyan, 0.45)})` }} />

        {/* 刻度线 */}
        {ticks}

        {/* 指针 */}
        <line x1={cx} y1={cy} x2={px} y2={py} stroke={cyan} strokeWidth="2.5"
          strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${withAlpha(cyan, 0.6)})` }} />
        <line x1={px} y1={py} x2={tx} y2={ty} stroke={withAlpha(cyan, 0.5)} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill="#0a0e14" stroke={cyan} strokeWidth="2" />
        <circle cx={cx} cy={cy} r="2" fill={cyan} />

        {/* 中心读数 */}
        <text x={cx} y={cy - 6} textAnchor="middle" className="aviation-gauge-value">{v}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="aviation-gauge-unit">{unit}</text>
      </svg>

      {(label || sub) && (
        <div className="aviation-gauge-cap">
          <span className="aviation-gauge-label">{label}</span>
          {sub && <span className="aviation-gauge-sub">{sub}</span>}
        </div>
      )}
    </div>
  );
}
