/**
 * EntranceSplash - 进场动画 v4「万川归一 · The Confluence」
 *
 * 把品牌名「万般硅川」本身变成叙事——万千数据之流汇成一条光河，百川归一，
 * 破幕入境。四幕结构：
 *   A 起·一线   (0–0.95s)   漆黑中一条光脉自左向右划出第一道子午线
 *   B 流·万川   (0.95–2.4s) 光脉分形为数十条支流，形成奔涌的数据长河
 *   C 汇·归一   (2.4–3.4s)  百川改道螺旋汇入中心光核，品牌字逐字浮生
 *   D 入·入境   (3.4s–)     光核绽放，幕布以圆揭幕收拢，露出应用本体
 *
 * 深浅双主题分治（挂载时一次性读 <html data-mode>）：
 *   深色 · 深空：青/金/紫光河 + 品牌字白瓷 + 朱印
 *   浅色 · 宣纸：墨色/暗金墨流 + 墨字 + 朱印
 *
 * 丝滑原则（沿用）：CSS 动画只动 transform/opacity/clip-path；canvas 用
 * destination-out 拖尾；字体就绪才起跑；reduced-motion 卸载；
 * 遥测 rAF 直写 DOM；z-index 10000；点击/Esc 跳过；印章朱红固定。
 *
 * 生命周期：onReveal 开始离场时调用，onDone 完全离场后调用（App 卸载本组件）。
 */
import { useEffect, useRef, useState } from 'react';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;900&family=Orbitron:wght@500;700&family=Share+Tech+Mono&display=swap';

const REVEAL_AT = 3400;    // 起跑后：开始离场、内容升起
const DONE_AT = 4380;      // 起跑后：完全离场、卸载
const SKIP_FADE = 520;     // 跳过时离场过渡时长

// 四幕时间轴（与 entrance.css 中的 animation-delay 保持一致）
const A_END = 950;   // 一线完成
const B_END = 2400;  // 万川成形 → 开始归一
const CONVERGE_MS = 1000; // 归一耗时

const PHASES = [
  [0.00, '起笔 · ONE LINE'],
  [0.26, '万川 · MANY STREAMS'],
  [0.52, '奔流 · THE RIVER'],
  [0.76, '归一 · CONVERGE'],
  [0.95, '入境 · ENTER'],
];

// 光河配色（rgb 串）：深空 = 青/金/紫/白；宣纸 = 墨/暗金/灰墨
const RIVER_COLORS = {
  dark: ['95,232,255', '255,196,107', '143,123,255', '234,252,255'],
  light: ['52,56,62', '160,123,45', '108,112,118', '140,120,80'],
};

const CY_RAT = 0.46; // 河道 / 光核垂直位置（与 CSS --en-cy 一致）

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
  const pctRef = useRef(null);
  const fillRef = useRef(null);
  const labelRef = useRef(null);
  const phaseIdx = useRef(-1);
  const riverRef = useRef(null);
  const burstRef = useRef(false); // 离场爆发标志（光河 rAF 循环内读取）
  const cb = useRef({ onReveal, onDone });
  cb.current = { onReveal, onDone };
  // 深浅分治：一次性读取（splash 生命周期内的主题切换忽略）
  const lightMode = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-mode') === 'light';

  const paint = (p, finish) => {
    const v = finish ? 1 : Math.max(0, Math.min(1, p));
    const pct = Math.round(v * 100);
    if (pctRef.current) pctRef.current.textContent = `${String(pct).padStart(3, '0')}%`;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${v})`;
    let idx = 0;
    for (let i = 0; i < PHASES.length; i += 1) if (v >= PHASES[i][0]) idx = i;
    if (idx !== phaseIdx.current && labelRef.current) {
      phaseIdx.current = idx;
      labelRef.current.textContent = PHASES[idx][1];
    }
  };

  /* ---------- 预开场帧交接：移除 index.html 的内联 boot-splash ---------- */
  useEffect(() => {
    const boot = document.getElementById('boot-splash');
    if (!boot) return undefined;
    boot.classList.add('boot-splash--out');
    const timer = setTimeout(() => boot.remove(), 400);
    return () => boot.remove();
  }, []);

  /* ---------- 光河引擎：一线 → 万川 → 归一 → 入境（拖尾轨迹） ---------- */
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cv = riverRef.current;
    if (reduce || !cv) return undefined;
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const colors = RIVER_COLORS[lightMode ? 'light' : 'dark'];
    let w = window.innerWidth;
    let h = window.innerHeight;
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const cy = () => h * CY_RAT;
    const streams = [];
    let t0 = 0;
    let rafId = 0;

    // 流畅性修复①：辉光预渲染成贴图。此前每帧对 ~115 条流各建一次 createRadialGradient，
    // 是主线程卡顿的最大来源；drawImage 贴图让每帧成本降一个数量级。
    const glowSprites = colors.map(color => {
      const size = 64;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, `rgba(${color},1)`);
      grad.addColorStop(0.35, `rgba(${color},0.45)`);
      grad.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return { canvas: c, color };
    });
    const spriteFor = color => glowSprites.find(s => s.color === color) || glowSprites[0];

    const spawn = () => {
      const depth = 0.35 + Math.random() * 0.65; // 远近层次：近=快/亮/粗
      return {
        x: -12 - Math.random() * 70,
        baseY: cy() + (Math.random() - 0.5) * 2 * h * 0.15 * (0.4 + depth),
        amp: h * 0.012 * (0.5 + Math.random()) * (0.5 + depth),
        freq: 0.003 + Math.random() * 0.006,
        phase: Math.random() * Math.PI * 2,
        speed: 2.2 + Math.random() * 4.5 * depth + depth * 2,
        size: 0.6 + Math.random() * 1.7 * depth,
        color: colors[(Math.random() * colors.length) | 0],
        alpha: 0.22 + Math.random() * 0.55 * depth,
        drift: (Math.random() - 0.5) * 0.12,
      };
    };

    const riverPathY = (x) => cy()
      + Math.sin(x * 0.004 + 1.3) * h * 0.045
      + Math.sin(x * 0.013 + 0.6) * h * 0.018;

    const tick = (now) => {
      if (!t0) t0 = now;
      const t = now - t0;
      // 拖尾：不清屏，用 destination-out 轻擦上一层（画布保持透明）
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.085)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      const cx = w / 2;
      const cyy = cy();
      const burst = burstRef.current;

      // A 幕「起笔」：一条光脉划过 + 亮点笔头
      if (!burst && t < A_END) {
        const p = Math.min(1, t / A_END);
        const ease = 1 - Math.pow(1 - p, 2.2);
        const xEnd = w * 1.04 * ease;
        ctx.beginPath();
        for (let x = -4; x <= xEnd; x += 7) {
          const y = riverPathY(x);
          if (x <= -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${colors[0]},0.5)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const hy = riverPathY(xEnd);
        const g = ctx.createRadialGradient(xEnd, hy, 0, xEnd, hy, 26);
        g.addColorStop(0, `rgba(${colors[0]},0.85)`);
        g.addColorStop(1, `rgba(${colors[0]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(xEnd, hy, 26, 0, Math.PI * 2);
        ctx.fill();
      }

      // B 幕「万川」：支流按进度渐次汇入光河（流畅性修复②：115 → 64 条，肉眼无差、帧预算减半）
      if (!burst && t >= A_END && t < B_END) {
        const target = Math.floor(64 * Math.min(1, (t - A_END) / 900));
        while (streams.length < target) streams.push(spawn());
      }

      // C 幕「归一」收敛因子：0 → 1
      const conv = burst ? 0 : Math.max(0, Math.min(1, (t - B_END) / CONVERGE_MS));

      for (let i = streams.length - 1; i >= 0; i -= 1) {
        const s = streams[i];
        if (burst) {
          // D 幕「入境」：沿离心方向爆发消散
          const dx = s.x - cx;
          const dy = s.y - cyy;
          const d = Math.max(Math.hypot(dx, dy), 1);
          s.x += (dx / d) * 11;
          s.y += (dy / d) * 11;
          s.alpha *= 0.92;
        } else if (conv > 0) {
          // C 幕：改道螺旋汇入光核，越近越快，入核即重生（收敛完成则消亡）
          const dx = cx - s.x;
          const dy = cyy - s.y;
          const d = Math.max(Math.hypot(dx, dy), 1);
          const pull = 0.014 + 0.05 * conv;
          const swirl = 1.6 + 3.2 * conv;
          s.x += dx * pull * 0.2 + (-dy / d) * swirl;
          s.y += dy * pull * 0.2 + (dx / d) * swirl;
          s.alpha *= 1 - 0.02 * conv;
          if (d < 34 || s.alpha < 0.05) {
            if (conv < 1) streams[i] = spawn();
            else streams.splice(i, 1);
            continue;
          }
        } else {
          // B 幕：奔流（正弦流场 + 缓慢漂移）
          s.x += s.speed;
          s.phase += 0.02;
          s.y = s.baseY
            + Math.sin(s.x * s.freq + s.phase) * s.amp
            + Math.sin(s.x * 0.017 + s.phase * 1.7) * s.amp * 0.4;
          s.baseY += s.drift;
          if (s.x > w + 24) { streams[i] = spawn(); continue; }
        }
        if (s.alpha <= 0.02) { streams.splice(i, 1); continue; }
        // 绘制：辉光底（预渲染贴图）+ 亮点芯
        const glowR = s.size * 4;
        const sprite = spriteFor(s.color);
        ctx.globalAlpha = Math.min(1, s.alpha);
        ctx.drawImage(sprite.canvas, s.x - glowR, s.y - glowR, glowR * 2, glowR * 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(${s.color},${Math.min(1, s.alpha * 1.25)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [lightMode]);

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
      const tick = (now) => {
        if (dead.current) return;
        const t = Math.min(1, (now - t0) / REVEAL_AT);
        paint(1 - Math.pow(1 - t, 1.8));
        if (t < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timers.current = [
        // 封顶保险：rAF 在后台标签被节流，离场前强制推满 100%
        setTimeout(() => paint(0, true), REVEAL_AT),
        setTimeout(() => cb.current.onReveal?.(), REVEAL_AT),
        setTimeout(() => { burstRef.current = true; setLeaving(true); }, REVEAL_AT),
        setTimeout(() => {
          cb.current.onDone?.();
          setHidden(true);
        }, DONE_AT),
      ];
    };
    // 流畅性修复③：不再等 Google Fonts（网络抖动直接推迟起跑，字体换入还会闪跳）。
    // 字体注入保留但非阻塞——品牌字由 font-display 自动换入，最坏情况前几帧是系统字体。
    injectFont();
    begin();
    return () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const skip = () => {
    if (leaving) return;
    dead.current = true;
    cancelAnimationFrame(raf.current);
    paint(0, true);
    burstRef.current = true;
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
      {/* 光河画布：一线 → 万川 → 归一（离场爆发） */}
      <canvas ref={riverRef} className="entrance__river" aria-hidden="true" />

      <div className="entrance__stage">
        {/* 氛围层：双色辉光 + 暗角 */}
        <div className="entrance__glow entrance__glow--a" />
        <div className="entrance__glow entrance__glow--b" />
        <div className="entrance__vignette" />

        {/* 归一核心：光核 + 扩散环 + 品牌区（C 幕登场） */}
        <div className="entrance__center">
          <span className="entrance__core" />
          <span className="entrance__ring entrance__ring--1" />
          <span className="entrance__ring entrance__ring--2" />
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

        {/* 底部遥测条（唯一 HUD 元素） */}
        <div className="entrance__bar">
          <span className="entrance__bar-brand">SL-OS · CONFLUENCE</span>
          <span className="entrance__meter">
            <span ref={fillRef} className="entrance__meter-fill" />
          </span>
          <span ref={pctRef} className="entrance__pct">000%</span>
          <span ref={labelRef} className="entrance__bar-phase">起笔 · ONE LINE</span>
          <span className="entrance__hint">点击任意处 / ESC 跳过</span>
        </div>
      </div>

      {/* 入境闪光：幕布收拢瞬间的光核绽放 */}
      <span className="entrance__flash" />
    </div>
  );
}
