// src/components/profile/charts/BubbleField.jsx
// 兴趣气泡场 —— 用圆形密铺（circle packing）替代词云。
//
// 为什么不用词云：词云的字号是线性映射权重，人眼对「面积」远比对「字号」敏感，
// 而且词云会留下大量锯齿状空白。密铺把每个主题变成一个可比较面积的实体，
// 密铺本身也暗示了「这些兴趣共同占满了你的注意力」。
import { useMemo } from 'react';
import { useAtlasPalette, withAlpha } from './atlasPrimitives.js';

const VB_W = 380;
const VB_H = 296;
const R_MIN = 13;
const R_MAX = 44;
const PAD = 3;

/** 黄金角螺旋密铺：先放大圆，放不下的直接丢弃（视觉上宁缺毋挤） */
function pack(circles) {
  const cx = VB_W / 2;
  const cy = VB_H / 2;
  const placed = [];
  for (const c of circles) {
    let found = null;
    for (let t = 0; t < 2400 && !found; t += 0.4) {
      const rad = 4.6 * Math.sqrt(t) * (VB_W / 380);
      const ang = t * 2.39996323;
      const x = cx + rad * Math.cos(ang);
      const y = cy + rad * Math.sin(ang);
      if (x - c.r < PAD || x + c.r > VB_W - PAD || y - c.r < PAD || y + c.r > VB_H - PAD) continue;
      if (placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + c.r + PAD)) found = { x, y };
    }
    if (found) placed.push({ ...c, ...found });
  }
  return placed;
}

function clip(text, maxChars) {
  const s = String(text || '');
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

export default function BubbleField({ items = [], emptyText = '暂无主题信号' }) {
  const palette = useAtlasPalette();

  const bubbles = useMemo(() => {
    const clean = items
      .filter(it => it && it.name)
      .map(it => ({ ...it, weight: Number(it.weight) || 1 }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 16);
    if (!clean.length) return [];
    const max = Math.max(1, ...clean.map(i => i.weight));
    const min = Math.min(...clean.map(i => i.weight));
    const span = Math.max(1, max - min);
    const shaped = clean.map(it => {
      // sqrt 映射：面积正比于权重（半径线性会让视觉权重失真）
      const norm = (it.weight - min) / span;
      return { ...it, r: R_MIN + (R_MAX - R_MIN) * Math.sqrt(0.18 + 0.82 * norm), norm };
    });
    return pack(shaped).map((b, i) => ({
      ...b,
      color: palette[i % palette.length],
      fontSize: Math.max(9, Math.min(15, b.r * 0.52)),
    }));
  }, [items, palette]);

  if (!bubbles.length) return <div className="pa-empty">{emptyText}</div>;

  return (
    <div className="pa-bubbles">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="pa-bubbles-svg" role="img" aria-label="兴趣主题气泡场">
        {bubbles.map((b, i) => (
          <g
            key={`${b.name}-${i}`}
            className="pa-bubble"
            style={{ transformOrigin: `${b.x}px ${b.y}px`, '--pa-bi': i }}
          >
            <circle
              cx={b.x} cy={b.y} r={b.r}
              fill={withAlpha(b.color, 0.16 + 0.24 * b.norm)}
              stroke={b.color}
              strokeWidth="1.2"
              strokeOpacity={0.45 + 0.45 * b.norm}
            />
            <circle
              cx={b.x} cy={b.y} r={b.r * 0.42}
              fill={withAlpha(b.color, 0.1 + 0.22 * b.norm)}
            />
            <text
              x={b.x} y={b.y + b.fontSize * 0.35}
              textAnchor="middle"
              className="pa-bubble-text"
              style={{ fontSize: b.fontSize, fill: 'var(--hud-text)' }}
            >
              {clip(b.name, Math.max(3, Math.floor((b.r * 1.7) / (b.fontSize * 0.6))))}
            </text>
            <title>{`${b.name} · 权重 ${Math.round(b.weight * 10) / 10}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}
