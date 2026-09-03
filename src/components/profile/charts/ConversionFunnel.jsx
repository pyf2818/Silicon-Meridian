// src/components/profile/charts/ConversionFunnel.jsx
// 信息转化漏斗 —— 浏览 → 收藏 → 沉淀。
//
// 为什么用漏斗而不是三个数字：画像的价值不在「读了多少」，
// 而在「信息被消化了多少」。漏斗把留存率画成形状，一眼看出断在哪一层。
import { useMemo } from 'react';
import { ratio, useAtlasPalette, useStableId, withAlpha } from './atlasPrimitives.js';

const W = 420;
const ROW_H = 46;
const GAP = 14;
const CX = 132;          // 漏斗中轴
const MAX_W = 224;       // 最宽层宽度
const MIN_W = 46;

export default function ConversionFunnel({ stages = [] }) {
  const palette = useAtlasPalette();
  const uid = useStableId('funnel');

  const shaped = useMemo(() => {
    const max = Math.max(1, ...stages.map(s => s.value || 0));
    const rows = stages.map((s, i) => {
      const top = i === 0 ? null : stages[i - 1].value || 0;
      return {
        ...s,
        color: s.color || palette[i % palette.length],
        w: MIN_W + (MAX_W - MIN_W) * ratio(s.value, max),
        rate: top === null ? 100 : Math.round(((s.value || 0) / Math.max(top, 1)) * 100),
      };
    });
    return { rows, max };
  }, [stages, palette]);

  const height = shaped.rows.length * ROW_H + Math.max(0, shaped.rows.length - 1) * GAP;
  if (!shaped.rows.length) return null;

  return (
    <div className="pa-funnel">
      <svg viewBox={`0 0 ${W} ${height}`} className="pa-funnel-svg" role="img" aria-label="信息转化漏斗">
        <defs>
          {shaped.rows.map((r, i) => (
            <linearGradient key={i} id={`${uid}-f${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={withAlpha(r.color, 0.85)} />
              <stop offset="100%" stopColor={withAlpha(r.color, 0.28)} />
            </linearGradient>
          ))}
        </defs>

        {shaped.rows.map((r, i) => {
          const y = i * (ROW_H + GAP);
          const nextW = i === shaped.rows.length - 1
            ? r.w * 0.78
            : MIN_W + (MAX_W - MIN_W) * ratio(shaped.rows[i + 1].value, shaped.max);
          const lT = CX - r.w / 2, rT = CX + r.w / 2;
          const lB = CX - nextW / 2, rB = CX + nextW / 2;
          // 侧边用三次贝塞尔收腰，比直线更像真实漏斗
          const d = [
            `M${lT},${y}`,
            `C${lT},${y + ROW_H * 0.55} ${lB},${y + ROW_H * 0.45} ${lB},${y + ROW_H}`,
            `L${rB},${y + ROW_H}`,
            `C${rB},${y + ROW_H * 0.45} ${rT},${y + ROW_H * 0.55} ${rT},${y}`,
            'Z',
          ].join(' ');
          return (
            <g key={r.label}>
              <path
                d={d}
                fill={`url(#${uid}-f${i})`}
                stroke={r.color}
                strokeWidth="1"
                strokeOpacity="0.75"
                className="pa-funnel-row"
                style={{ '--pa-i': i }}
              />
              <text x={CX} y={y + ROW_H / 2 + 5} textAnchor="middle" className="pa-funnel-label">{r.label}</text>
              {/* 右侧读数 */}
              <text x={268} y={y + ROW_H / 2 - 2} className="pa-funnel-value">{r.value || 0}</text>
              <text x={268} y={y + ROW_H / 2 + 14} className="pa-funnel-meta">{r.note || ''}</text>
              {/* 层间转化率 */}
              {i > 0 && (
                <g>
                  <path
                    d={`M${CX + r.w / 2 + 10},${y - GAP / 2 + 1} l-6,-3 l0,6 Z`}
                    fill={withAlpha(palette[0], 0.5)}
                  />
                  <text x={CX + r.w / 2 + 20} y={y - GAP / 2 + 4} className="pa-funnel-rate">
                    {r.rate}%
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
