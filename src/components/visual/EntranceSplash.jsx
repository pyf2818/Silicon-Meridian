/**
 * EntranceSplash - 进场动画 v6「墨川 · Ink Meridian」
 *
 * 一滴墨落在宣纸上，晕开、泛形，墨迹聚合成「万般硅川」，印章落定后
 * 墨色漫过纸面（浅色主题则为纸面渐白）揭出应用。三幕压缩在 2.6s 内：
 *   A 落墨   0–0.35s    浓墨触纸 + 飞溅
 *   B 泛形   0.35–1.10s 墨云晕开，字在墨中孕育
 *   C 定形   1.10–2.00s 墨字析出、印章/副标落定
 *   D 转场   2.00–2.60s 墨幕吞没 / 纸面渐白
 *
 * 与 v5 的本质区别：不再有 canvas 与粒子系统——墨的形态由 SVG
 * feTurbulence + feDisplacementMap 造型，动画只动 transform/opacity/filter，
 * 全部由 CSS 时间轴驱动；JS 仅负责字体注入、进度墨线与离场调度。
 *
 * 主题分治：挂载时一次性读 <html data-mode>；
 *   app 深色 → 转场为墨幕吞没（墨色接近应用底色，无缝）
 *   app 浅色 → 转场为纸面渐白（.entrance--light）
 * 生命周期：onReveal 开始离场时调用，onDone 完全离场后调用（App 卸载本组件）。
 */
import { useEffect, useRef, useState } from 'react';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@900&family=Orbitron:wght@500&family=Share+Tech+Mono&display=swap';

const REVEAL_AT = 2000;   // 起跑后：定形完成，开始转场
const DONE_AT = 2620;     // 起跑后：完全离场、卸载
const SKIP_FADE = 420;    // 跳过时的转场时长

function injectFont() {
  return new Promise((resolve) => {
    if (document.getElementById('entrance-font')) { resolve(); return; }
    const link = document.createElement('link');
    link.id = 'entrance-font';
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    link.media = 'print';
    link.onload = () => { link.media = 'all'; resolve(); };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

export default function EntranceSplash({ onReveal, onDone }) {
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [run, setRun] = useState(false);
  const timers = useRef([]);
  const raf = useRef(0);
  const started = useRef(false);
  const dead = useRef(false);
  const fillRef = useRef(null);
  const cb = useRef({ onReveal, onDone });
  cb.current = { onReveal, onDone };
  // 深浅分治：一次性读取（splash 生命周期内的主题切换忽略）
  const lightMode = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-mode') === 'light';

  /* ---------- 预开场帧交接：移除 index.html 的内联 boot-splash ---------- */
  useEffect(() => {
    const boot = document.getElementById('boot-splash');
    if (!boot) return undefined;
    boot.classList.add('boot-splash--out');
    const timer = setTimeout(() => boot.remove(), 400);
    return () => boot.remove();
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      cb.current.onReveal?.();
      cb.current.onDone?.();
      setHidden(true);
      return;
    }
    const begin = () => {
      if (started.current || dead.current) return;
      started.current = true;
      setRun(true);
      const t0 = performance.now();
      // 进度墨线：rAF 直写 DOM，不进 state（避免每帧重渲染）
      const tick = (now) => {
        if (dead.current) return;
        const t = Math.min(1, (now - t0) / REVEAL_AT);
        if (fillRef.current) fillRef.current.style.transform = `scaleX(${t})`;
        if (t < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timers.current = [
        // 封顶保险：rAF 在后台标签被节流，离场前强制推满进度
        setTimeout(() => { if (fillRef.current) fillRef.current.style.transform = 'scaleX(1)'; }, REVEAL_AT),
        setTimeout(() => cb.current.onReveal?.(), REVEAL_AT),
        setTimeout(() => setLeaving(true), REVEAL_AT),
        setTimeout(() => {
          cb.current.onDone?.();
          setHidden(true);
        }, DONE_AT),
      ];
    };
    // 字体注入非阻塞——墨字由 font-display 自动换入，最坏情况前几帧是系统衬线。
    injectFont();
    begin();
    return () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
      // ⚠️ StrictMode 双挂载（mount→cleanup→remount）会先清光第一次的 timers，
      // 必须重置起跑 guard，否则第二次 begin() 被拦 → splash 永不自动离场。
      started.current = false;
    };
  }, []);

  const skip = () => {
    if (leaving) return;
    dead.current = true;
    cancelAnimationFrame(raf.current);
    if (fillRef.current) fillRef.current.style.transform = 'scaleX(1)';
    timers.current.forEach(clearTimeout);
    cb.current.onReveal?.();
    setLeaving(true);
    timers.current = [
      setTimeout(() => {
        cb.current.onDone?.();
        setHidden(true);
      }, SKIP_FADE),
    ];
  };

  if (hidden) return null;

  return (
    <div
      className={`entrance${lightMode ? ' entrance--light' : ''}${run ? ' is-run' : ''}${leaving ? ' entrance--leaving' : ''}`}
      onClick={skip}
      role="presentation"
      aria-hidden="true"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') skip(); }}
    >
      {/* 墨的造型滤镜：湍流噪声 + 位移，营造宣纸吸墨的不规则边缘 */}
      <svg className="entrance__defs" aria-hidden="true" focusable="false">
        <defs>
          <filter id="enInkA" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="4" seed="11" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="120" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
          <filter id="enInkB" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="5" seed="29" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="85" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <filter id="enInkC" x="-55%" y="-55%" width="210%" height="210%">
            <feTurbulence type="fractalNoise" baseFrequency="0.0045" numOctaves="3" seed="5" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="170" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id="enInkCore" x="-35%" y="-35%" width="170%" height="170%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="41" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="27" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
          {/* 字边飞白：中低频位移，保留笔画骨架只啃边缘 */}
          <filter id="enInkEdge" x="-22%" y="-32%" width="144%" height="164%">
            <feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="3" seed="17" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="9.5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* 墨层：远雾 → 次层 → 主晕 → 浓墨核 → 飞溅 */}
      <div className="entrance__ink">
        <span className="entrance__blob entrance__blob--c" />
        <span className="entrance__blob entrance__blob--b" />
        <span className="entrance__blob entrance__blob--a" />
        <span className="entrance__core" />
        <span className="entrance__drop entrance__drop--1" />
        <span className="entrance__drop entrance__drop--2" />
        <span className="entrance__drop entrance__drop--3" />
        <span className="entrance__drop entrance__drop--4" />
      </div>

      {/* 纸纹与暗角：盖在墨上，让墨吃到纸的肌理 */}
      <div className="entrance__paper" />
      <div className="entrance__vignette" />

      <div className="entrance__center">
        <div className="entrance__brand" aria-label="万般硅川">
          {['万', '般', '硅', '川'].map((ch, i) => (
            <span key={i} className="entrance__brand-char" style={{ '--idx': i }}>{ch}</span>
          ))}
        </div>
        <div className="entrance__rule">
          <span className="entrance__line" />
          <span className="entrance__seal">印</span>
          <span className="entrance__line" />
        </div>
        <div className="entrance__sub">SILICON MERIDIAN</div>
        <div className="entrance__sub-cn">万般硅川 · 智能情报中枢</div>
      </div>

      {/* 底部：一条游走的墨线作进度 + 跳过提示 */}
      <div className="entrance__foot">
        <span className="entrance__meter">
          <span ref={fillRef} className="entrance__meter-fill" />
        </span>
        <span className="entrance__hint">点击任意处 / ESC 跳过</span>
      </div>

      {/* 转场墨幕（深色主题）：墨色漫过纸面 */}
      <span className="entrance__drown" />
    </div>
  );
}
