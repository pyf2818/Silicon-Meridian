import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../store/index.js';
import { PALETTES } from '../../ThemePicker.jsx';
import { getCanvasPrefs, setCanvasPrefs, subscribeCanvasPrefs } from '../../utils/canvasPrefs.js';

/* 调色板取色辅助（与 ThemePicker 同源） */
function hexToHSL(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToHex(h, s, l) {
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = lN - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
function paletteSwatches(accent) {
  const h = hexToHSL(accent);
  return [
    accent,
    hslToHex((h.h + 30) % 360, Math.max(h.s - 15, 20), Math.min(h.l + 10, 85)),
    hslToHex((h.h + 180) % 360, Math.max(h.s - 20, 15), Math.min(h.l + 5, 80)),
    hslToHex((h.h + 240) % 360, Math.min(h.s + 5, 90), Math.max(h.l - 10, 15)),
  ];
}

const RADIUS = { small: '8px', medium: '12px', large: '16px' };
const DENSITY = { compact: '0.82', comfortable: '1', spacious: '1.12' };
const FONT = { small: '0.94', medium: '1', large: '1.08' };

export default function AppearanceTab() {
  const { t } = useTranslation();
  const themeMode = useUiStore((s) => s.themeMode);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const palette = useUiStore((s) => s.palette);
  const setPalette = useUiStore((s) => s.setPalette);
  const rootRef = useRef(null);

  const [density, setDensity] = useState(() => localStorage.getItem('scDensity') || 'comfortable');
  const [radius, setRadius] = useState(() => localStorage.getItem('scRadius') || 'medium');
  const [fontScale, setFontScale] = useState(() => localStorage.getItem('scFontScale') || 'medium');

  const applyVars = (d, r, f) => {
    const el = rootRef.current?.closest('.settings-console');
    if (!el) return;
    el.style.setProperty('--ui-radius', RADIUS[r] || '12px');
    el.style.setProperty('--ui-density', DENSITY[d] || '1');
    el.style.setProperty('--ui-font-scale', FONT[f] || '1');
  };
  useEffect(() => {
    applyVars(density, radius, fontScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, radius, fontScale]);

  const onDensity = (v) => { setDensity(v); localStorage.setItem('scDensity', v); applyVars(v, radius, fontScale); };
  const onRadius = (v) => { setRadius(v); localStorage.setItem('scRadius', v); applyVars(density, v, fontScale); };
  const onFont = (v) => { setFontScale(v); localStorage.setItem('scFontScale', v); applyVars(density, radius, v); };

  // 画布偏好（v18）：写入 localStorage 并广播给画布页
  const [prefs, setPrefs] = useState(getCanvasPrefs);
  useEffect(() => subscribeCanvasPrefs(setPrefs), []);
  const onPrefs = (patch) => setPrefs(setCanvasPrefs(patch));

  const modes = [
    { id: 'dark', icon: '🌙', label: t('settings.appearance.themeDark', '深色') },
    { id: 'light', icon: '☀', label: t('settings.appearance.themeLight', '浅色') },
    { id: 'system', icon: '🖥', label: t('settings.appearance.themeSystem', '跟随系统') },
  ];

  // v16 主题语义分组：暖调 light 模式配暖米白底，冷调配冷白底（表面自动随 palette 分流）
  const WARM_IDS = ['champagne', 'sakura', 'terracotta', 'amber', 'coral'];
  const warmPalettes = PALETTES.filter(p => WARM_IDS.includes(p.id));
  const coolPalettes = PALETTES.filter(p => !WARM_IDS.includes(p.id));

  const PaletteCard = ({ p }) => {
    const sw = useMemo(() => paletteSwatches(p.accent), [p.accent]);
    const active = palette === p.id;
    return (
      <button
        className={`sc-palette-card ${active ? 'active' : ''}`}
        style={{ '--palette-glow': p.accent }}
        onClick={() => setPalette(p.id)}
        aria-pressed={active}
      >
        <div className="sc-palette-preview" style={{ background: p.gradient }}>
          <div className="sc-palette-swatches" style={{ position: 'absolute', left: 10, bottom: 8 }}>
            {sw.map((c, i) => (
              <span key={i} className="sc-palette-dot" style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="sc-palette-name">{p.label}</div>
        <div className="sc-palette-desc">{p.desc}</div>
      </button>
    );
  };

  return (
    <div className="sc-tab" ref={rootRef}>
      <div className="sc-tab-head">
        <h2 className="sc-tab-title">{t('settings.appearance.title', '外观')}</h2>
        <p className="sc-tab-desc">{t('settings.appearance.desc', '定制显示模式、主题配色与排版密度，实时生效。')}</p>
      </div>

      <div className="sc-card">
        <div className="sc-card-title"><span className="sc-card-kicker" />{t('settings.appearance.modeTitle', '显示模式')}</div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.mode', '模式')}</div>
            <div className="sc-row-desc">{t('settings.appearance.modeDesc', '深色 / 浅色 / 跟随系统')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {modes.map((m) => (
                <button key={m.id} className={themeMode === m.id ? 'active' : ''} onClick={() => setThemeMode(m.id)}>
                  <span style={{ marginRight: 6 }}>{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="sc-card">
        <div className="sc-card-title"><span className="sc-card-kicker" />{t('settings.appearance.paletteTitle', '主题配色')}</div>
        <div className="sc-row-desc" style={{ padding: '0 0 6px' }}>{t('settings.appearance.warmGroup', '暖调配色（浅色模式 · 暖米白底）')}</div>
        <div className="sc-palette-grid">
          {warmPalettes.map((p) => <PaletteCard key={p.id} p={p} />)}
        </div>
        <div className="sc-row-desc" style={{ padding: '10px 0 6px' }}>{t('settings.appearance.coolGroup', '冷调 / 中性配色（浅色模式 · 冷白底）')}</div>
        <div className="sc-palette-grid">
          {coolPalettes.map((p) => <PaletteCard key={p.id} p={p} />)}
        </div>
      </div>

      <div className="sc-card">
        <div className="sc-card-title"><span className="sc-card-kicker" />{t('settings.appearance.layoutTitle', '排版偏好')}</div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.density', '界面密度')}</div>
            <div className="sc-row-desc">{t('settings.appearance.densityDesc', '紧凑 / 舒适 / 宽松')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[['compact', t('settings.appearance.compact', '紧凑')], ['comfortable', t('settings.appearance.comfortable', '舒适')], ['spacious', t('settings.appearance.spacious', '宽松')]].map(([v, l]) => (
                <button key={v} className={density === v ? 'active' : ''} onClick={() => onDensity(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.radius', '圆角')}</div>
            <div className="sc-row-desc">{t('settings.appearance.radiusDesc', '控件与卡片的圆角大小')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[['small', t('settings.appearance.small', '小')], ['medium', t('settings.appearance.medium', '中')], ['large', t('settings.appearance.large', '大')]].map(([v, l]) => (
                <button key={v} className={radius === v ? 'active' : ''} onClick={() => onRadius(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.font', '字号')}</div>
            <div className="sc-row-desc">{t('settings.appearance.fontDesc', '全局界面基础字号')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[['small', t('settings.appearance.small', '小')], ['medium', t('settings.appearance.medium', '中')], ['large', t('settings.appearance.large', '大')]].map(([v, l]) => (
                <button key={v} className={fontScale === v ? 'active' : ''} onClick={() => onFont(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* 画布与工作流（v18）：网格/动效/模拟速度，实时写入画布 */}
      <div className="sc-card">
        <div className="sc-card-title"><span className="sc-card-kicker" />{t('settings.appearance.canvasTitle', '无限画布')}</div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.canvasGrid', '画布网格')}</div>
            <div className="sc-row-desc">{t('settings.appearance.canvasGridDesc', '网格线 / 点阵 / 关闭，颜色跟随主题')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[['line', t('settings.appearance.gridLine', '网格线')], ['dot', t('settings.appearance.gridDot', '点阵')], ['off', t('settings.appearance.gridOff', '关闭')]].map(([v, l]) => (
                <button key={v} className={prefs.grid === v ? 'active' : ''} onClick={() => onPrefs({ grid: v })}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.canvasAnimate', '连线流动动画')}</div>
            <div className="sc-row-desc">{t('settings.appearance.canvasAnimateDesc', '模拟运行时连线上的流光与粒子（关闭可省电）')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[[true, t('settings.appearance.on', '开')], [false, t('settings.appearance.off', '关')]].map(([v, l]) => (
                <button key={String(v)} className={Boolean(prefs.animateEdges) === v ? 'active' : ''} onClick={() => onPrefs({ animateEdges: v })}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.canvasSpeed', '模拟运行速度')}</div>
            <div className="sc-row-desc">{t('settings.appearance.canvasSpeedDesc', '控制模拟运行时每个节点的停留时长')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[[0.6, t('settings.appearance.slow', '慢')], [1, t('settings.appearance.normal', '标准')], [1.8, t('settings.appearance.fast', '快')]].map(([v, l]) => (
                <button key={v} className={Number(prefs.speed) === v ? 'active' : ''} onClick={() => onPrefs({ speed: v })}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.appearance.canvasSnap', '节点吸附网格')}</div>
            <div className="sc-row-desc">{t('settings.appearance.canvasSnapDesc', '拖拽节点时自动对齐到 28px 网格')}</div>
          </div>
          <div className="sc-row-control">
            <div className="sc-segment">
              {[[true, t('settings.appearance.on', '开')], [false, t('settings.appearance.off', '关')]].map(([v, l]) => (
                <button key={String(v)} className={Boolean(prefs.snap) === v ? 'active' : ''} onClick={() => onPrefs({ snap: v })}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
