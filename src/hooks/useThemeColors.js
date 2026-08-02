// src/hooks/useThemeColors.js
// 读取主题系统（data-mode + data-palette）的 accent 色，供 SVG 图表等需要具体色值的地方使用。
// 通过 MutationObserver 监听 html 属性变化，主题切换时自动重取色值触发重渲染。
import { useState, useEffect } from 'react';

const FALLBACK = {
  cyan: '#00e5ff',
  blue: '#00b8d4',
  green: '#37f5b6',
  amber: '#ffb74d',
  red: '#ff3366',
  violet: '#b388ff',
};

function readColors() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK;
  try {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };
    return {
      cyan: get('--accent-cyan', FALLBACK.cyan),
      blue: get('--accent-blue', FALLBACK.blue),
      green: get('--accent-emerald', FALLBACK.green),
      amber: get('--accent-amber', FALLBACK.amber),
      red: get('--accent-rose', FALLBACK.red),
      violet: get('--accent-violet', FALLBACK.violet),
    };
  } catch {
    return FALLBACK;
  }
}

export function useThemeColors() {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const mo = new MutationObserver(() => setColors(readColors()));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode', 'data-palette'],
    });
    return () => mo.disconnect();
  }, []);
  return colors;
}

export const THEME_FALLBACK = FALLBACK;
