// src/components/profile/charts/atlasPrimitives.js
// 「认知星图」共享图元 —— 纯 SVG，无外部依赖。
// 只做三件事：颜色解析（深浅主题安全）、稳定 id、极坐标换算。
import { useMemo, useRef } from 'react';
import { useThemeColors } from '../../../hooks/useThemeColors.js';

/* ------------------------------------------------------------------
   颜色：主题 accent 通常是 #rrggbb，但个别 palette 可能给 rgb()/8 位 hex。
   SVG 的 presentation attribute 不解析 var()，所以必须拿到具体色值。
   解析失败时退回中性灰，绝不抛错（图表不能拖垮整页）。
------------------------------------------------------------------ */
export function parseColor(input) {
  if (typeof input !== 'string') return { r: 128, g: 138, b: 150 };
  const c = input.trim();
  try {
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const n = parseInt(hex.slice(0, 3).split('').map(ch => ch + ch).join(''), 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      }
      if (hex.length >= 6) {
        const n = parseInt(hex.slice(0, 6), 16);
        if (Number.isNaN(n)) return { r: 128, g: 138, b: 150 };
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      }
    }
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(',').map(s => parseFloat(s));
      if (parts.length >= 3 && parts.slice(0, 3).every(v => Number.isFinite(v))) {
        return { r: parts[0], g: parts[1], b: parts[2] };
      }
    }
  } catch { /* fall through */ }
  return { r: 128, g: 138, b: 150 };
}

export function withAlpha(color, alpha) {
  const { r, g, b } = parseColor(color);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/* 生成不含冒号的稳定 id（useId 的 ":" 会破坏 SVG url(#...) 引用） */
let _seq = 0;
export function useStableId(prefix = 'atlas') {
  const ref = useRef(null);
  if (ref.current == null) ref.current = `${prefix}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return ref.current;
}

/* 主题色板：多系列可视化按项目规范取跨调色板固定的 --chart-*，
   保证香槟金/樱花粉等任何 palette 下系列之间都有区分度；
   --chart-* 缺失时退回 accent 色（并借用 useThemeColors 的主题监听触发重渲染）。 */
const ACCENT_ORDER = ['cyan', 'green', 'amber', 'violet', 'blue', 'red'];
export function useAtlasPalette() {
  const accent = useThemeColors();
  return useMemo(() => {
    const fallback = ACCENT_ORDER.map(k => accent[k]);
    try {
      const cs = getComputedStyle(document.documentElement);
      return [1, 2, 3, 4, 5, 6].map((i, idx) => cs.getPropertyValue(`--chart-${i}`).trim() || fallback[idx]);
    } catch {
      return fallback;
    }
  }, [accent]);
}

/* ------------------------------------------------------------------
   极坐标：角度以「正上方为 0°，顺时针递增」，贴合时钟直觉。
------------------------------------------------------------------ */
export function polar(cx, cy, radius, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

/** 环形扇区路径（annular sector）：外弧 + 内弧闭合 */
export function annularSector(cx, cy, rInner, rOuter, degStart, degEnd) {
  const large = degEnd - degStart > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, degStart);
  const [x2, y2] = polar(cx, cy, rOuter, degEnd);
  const [x3, y3] = polar(cx, cy, rInner, degEnd);
  const [x4, y4] = polar(cx, cy, rInner, degStart);
  return [
    `M${x1.toFixed(2)},${y1.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`,
    `L${x3.toFixed(2)},${y3.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** 把鼠标事件换算成 SVG viewBox 坐标（兼容 preserveAspectRatio 缩放） */
export function svgPoint(svgEl, clientX, clientY) {
  if (!svgEl || typeof svgEl.getScreenCTM !== 'function') return null;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const pt = svgEl.createSVGPoint ? svgEl.createSVGPoint() : null;
  if (!pt) return null;
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** 相对圆心的极坐标：deg 以正上方为 0，顺时针 */
export function toPolar(cx, cy, x, y) {
  const dx = x - cx;
  const dy = y - cy;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  return { radius: Math.hypot(dx, dy), deg: deg % 360 };
}

/** 数值归一化到 0..1，分母为 0 时返回 0（而不是 NaN/Infinity） */
export function ratio(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}
