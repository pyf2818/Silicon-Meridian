// 一次性脚本：把 hud-theme.css 里的硬编码霓虹色替换为主题 token 引用
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/hud-theme.css';
let css = readFileSync(FILE, 'utf8');
const before = css;

const cm = (colorVar, pct) => `color-mix(in srgb, var(${colorVar}) ${pct}%, transparent)`;

// rgba(r,g,b,P) → color-mix(in srgb, var(--hud-X) P*100%, transparent)
const RGBA_MAP = [
  [/rgba\(\s*0,\s*229,\s*255,\s*([\d.]+)\s*\)/g, '--hud-cyan'],
  [/rgba\(\s*55,\s*245,\s*182,\s*([\d.]+)\s*\)/g, '--hud-green'],
  [/rgba\(\s*255,\s*183,\s*77,\s*([\d.]+)\s*\)/g, '--hud-amber'],
  [/rgba\(\s*255,\s*51,\s*102,\s*([\d.]+)\s*\)/g, '--hud-red'],
  [/rgba\(\s*179,\s*136,\s*255,\s*([\d.]+)\s*\)/g, '--hud-violet'],
];
for (const [re, v] of RGBA_MAP) {
  css = css.replace(re, (_, p) => cm(v, Math.round(parseFloat(p) * 100)));
}

// 纯色 hex → var(--hud-X)
const HEX_MAP = [
  ['#00e5ff', 'var(--hud-cyan)'],
  ['#00b8d4', 'var(--hud-teal)'],
  ['#37f5b6', 'var(--hud-green)'],
  ['#ffb74d', 'var(--hud-amber)'],
  ['#ff3366', 'var(--hud-red)'],
  ['#b388ff', 'var(--hud-violet)'],
  ['#7c4dff', cm('--hud-violet', 78)],
  ['#ff9e40', cm('--hud-amber', 80)],
  ['#d8f2fc', 'var(--hud-text)'],
  ['#cfe8f5', 'var(--hud-text)'],
  ['#5b7a96', 'var(--hud-dim)'],
  ['#2c4058', 'var(--hud-faint)'],
  ['#031018', '#031018'], // 按钮深色文字：保持深色（accent 底上对比）
  ['#0b0e11', '#0b0e11'],
];
for (const [hex, rep] of HEX_MAP) {
  css = css.split(hex).join(rep);
}

writeFileSync(FILE, css, 'utf8');
const replaced = [...css.matchAll(/color-mix\(in srgb, var\(--hud-/g)].length;
console.log('replaced color-mix count:', replaced);
console.log('changed:', css !== before ? 'YES' : 'NO');
