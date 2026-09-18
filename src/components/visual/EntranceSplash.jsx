/**
 * EntranceSplash - 进场动画 v5「星尘入川 · Stardust into River」
 *
 * 把品牌名「万般硅川」本身变成叙事——万般信息如星尘自天幕洒落，
 * 坠入地平线汇集成川，河光之上浮现品牌。四幕结构：
 *   A 星尘   (0–1.2s)     深空星雨渐密，闪烁坠落（远景星呼吸衬底）
 *   B 成川   (1.2–2.3s)   落点泛起涟漪，星光汇入河面，波光启动
 *   C 题名   (2.3–3.4s)   经线自天顶贯入河面，品牌逐字浮生于河光之上
 *   D 入境   (3.4s–)      星河加速、河光暴涨，圆幕收拢揭出应用
 *
 * 深浅双主题分治（挂载时一次性读 <html data-mode>）：
 *   深色 · 深空：青/金/紫星尘 + 发光暗河 + 渐变瓷字
 *   浅色 · 宣纸：金墨星尘 + 墨河 + 墨字
 *
 * 丝滑原则（沿用）：CSS 动画只动 transform/opacity/clip-path；canvas 用
 * destination-out 拖尾；辉光预渲染贴图；字体注入非阻塞；reduced-motion 卸载；
 * 遥测 rAF 直写 DOM；z-index 10000；点击/Esc 跳过；印章朱红固定。
 *
 * 生命周期：onReveal 开始离场时调用，onDone 完全离场后调用（App 卸载本组件）。
 */
import { useEffect, useRef, useState } from 'react';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@900&family=Orbitron:wght@500&family=Share+Tech+Mono&display=swap';

const REVEAL_AT = 3400;    // 起跑后：开始离场、内容升起
const DONE_AT = 4380;      // 起跑后：完全离场、卸载
const SKIP_FADE = 520;     // 跳过时离场过渡时长

// 四幕时间轴（与 entrance.css 中的 animation-delay 保持一致）
const A_END = 1200;   // 星雨满员
const B_END = 2300;   // 河成熟 → 品牌起（CSS enChar delay 2.3s 对齐）

const PHASES = [
  [0.00, '星尘 · STARDUST'],
  [0.28, '坠落 · FALLING'],
  [0.55, '成川 · THE RIVER'],
  [0.78, '题名 · THE NAME'],
  [0.95, '入境 · ENTER'],
];

// 星尘/河水配色（rgb 串）：深空 = 青/金/紫/白；宣纸 = 墨/暗金/灰墨/赭
const RIVER_COLORS = {
  dark: ['95,232,255', '255,196,107', '143,123,255', '234,252,255'],
  light: ['52,56,62', '160,123,45', '108,112,118', '140,120,80'],
};

const CY_RAT = 0.46;    // 品牌区垂直位置（与 CSS --en-cy 一致）
const RIVER_RAT = 0.72; // 河面位置（与 CSS --en-river 一致）
const STAR_TARGET = 140; // 星尘粒子数
const DROP_TARGET = 46;  // 河面倒影光条数

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

/** 远景星：生成 box-shadow 星点串（直写 DOM，不进 state） */
function genStarShadows(count, color, withHalo) {
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() * 100).toFixed(2);
    const y = (Math.random() * 66).toFixed(2); // 星层高度为天区（视口 72% 内）
    const spread = withHalo && Math.random() < 0.22 ? 1 : 0;
    parts.push(`${x}vw ${y}vh 0 ${spread}px ${color}`);
  }
  return parts.join(',');
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
  const starsARef = useRef(null);
  const starsBRef = useRef(null);
  const burstRef = useRef(false);   // 离场爆发标志（星河 rAF 循环内读取）
  const burstAtRef = useRef(0);     // 爆发起始时刻（离场淡出因子）
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

  /* ---------- 远景星层：一次性生成 box-shadow 星点（两层错相呼吸） ---------- */
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const starColor = lightMode ? 'rgba(84,92,104,0.55)' : 'rgba(214,238,250,0.8)';
    const brightColor = lightMode ? 'rgba(110,92,40,0.75)' : 'rgba(240,250,255,0.95)';
    if (starsARef.current) starsARef.current.style.boxShadow = genStarShadows(56, starColor, false);
    if (starsBRef.current) starsBRef.current.style.boxShadow = genStarShadows(30, brightColor, true);
  }, [lightMode]);

  /* ---------- 星尘入川引擎：星雨 → 涟漪汇河 → 波光倒影 → 入境 ---------- */
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
    // 深空渐变贴图（与 .entrance 背景同参）：河区铺不透明底用。
    // 透明 canvas 在部分 GPU 光栅路径下会被合成成灰白垃圾（灰白块 bug 的根因防御），
    // 河区每帧铺同色不透明底后，透明区域不再存在于画面下半部。
    let skyGrad = null;
    const rebuildSky = () => {
      skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      if (lightMode) {
        skyGrad.addColorStop(0, '#f9f5ec');
        skyGrad.addColorStop(0.46, '#efe7d6');
        skyGrad.addColorStop(1, '#e3d9c4');
      } else {
        skyGrad.addColorStop(0, '#05080f');
        skyGrad.addColorStop(0.46, '#0a1524');
        skyGrad.addColorStop(1, '#030509');
      }
    };
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildSky();
    };
    resize();

    const riverY = () => h * RIVER_RAT;
    const stars = [];     // 星尘粒子
    const ripples = [];   // 落点涟漪
    const drops = [];     // 河面倒影光条
    let t0 = 0;
    let rafId = 0;

    // 辉光预渲染贴图（性能关键：避免每帧建渐变）
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

    const spawnStar = (seedY) => {
      const depth = 0.3 + Math.random() * 0.7; // 远近层次：近=大/快/亮
      return {
        x: Math.random() * w,
        y: seedY ? Math.random() * h * 0.5 : -16 - Math.random() * h * 0.35,
        vy: (0.5 + depth * 1.45) * (h / 760),
        driftAmp: 6 + Math.random() * 16,
        driftFreq: 0.0011 + Math.random() * 0.0022,
        phase: Math.random() * Math.PI * 2,
        size: 0.6 + depth * 1.7,
        color: colors[(Math.random() * colors.length) | 0],
        alphaBase: 0.3 + depth * 0.6,
        twFreq: 0.0018 + Math.random() * 0.0035,
      };
    };
    // 首帧铺满河面（涟漪即刻可见，河不是等来的）
    for (let i = 0; i < DROP_TARGET; i += 1) {
      drops.push({
        x: Math.random() * w,
        y: riverY() + 8 + Math.random() * (h - riverY() - 22),
        len: 14 + Math.random() * 40,
        speed: (Math.random() - 0.5) * 0.5,
        color: colors[(Math.random() * colors.length) | 0],
        alpha: 0.025 + Math.random() * 0.055,
      });
    }

    const tick = (now) => {
      if (!t0) t0 = now;
      const t = now - t0;
      const burst = burstRef.current;
      const fadeOut = burst ? Math.max(0, 1 - (now - burstAtRef.current) / 650) : 1;
      const ry = riverY();

      // 拖尾：只擦天区（河区每帧全清重绘，避免半透明河体过饱和）
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.085)';
      ctx.fillRect(0, 0, w, ry);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, ry, w, h - ry);
      // 河区不透明底：复刻 .entrance 渐变的 ry 以下段（同渐变坐标 → 颜色无缝衔接）
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, ry, w, h - ry);

      const glow = burst ? 1.2 * fadeOut : 0.35 + 0.65 * Math.min(1, t / B_END);

      /* ----- 河体：深水渐变 + 河面亮线（压暗：河是"发光的暗水"不是色块） ----- */
      const water = ctx.createLinearGradient(0, ry, 0, h);
      water.addColorStop(0, `rgba(${colors[0]},${0.06 * Math.min(glow, 1.2) * fadeOut})`);
      water.addColorStop(0.5, `rgba(${colors[0]},${0.015 * fadeOut})`);
      water.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = water;
      ctx.fillRect(0, ry, w, h - ry);
      ctx.fillStyle = `rgba(${colors[0]},${0.28 * Math.min(glow, 1.3) * fadeOut})`;
      ctx.fillRect(0, ry - 0.5, w, 1.5);

      /* ----- 倒影光条：星光在河面的镜像，缓慢漂移 ----- */
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < drops.length; i += 1) {
        const d = drops[i];
        d.x += d.speed;
        if (d.x < -d.len) d.x = w + d.len;
        if (d.x > w + d.len) d.x = -d.len;
        const tw = 0.75 + 0.25 * Math.sin(t * 0.002 + i * 1.7);
        ctx.globalAlpha = d.alpha * tw * glow * fadeOut;
        ctx.drawImage(spriteFor(d.color).canvas, d.x - d.len / 2, d.y, d.len, 2.5);
      }
      ctx.globalAlpha = 1;

      /* ----- 波光：两层流动光带 + 光点，沿河面正弦起伏 ----- */
      for (let layer = 0; layer < 2; layer += 1) {
        const bandW = w * (0.42 - layer * 0.12);
        const bx = ((t * (0.05 + layer * 0.032)) % (w + bandW)) - bandW * 0.6;
        const by = ry + Math.sin(t * 0.0009 + layer * 2.4) * h * 0.012 + 5 + layer * 9;
        ctx.globalAlpha = (0.07 - layer * 0.025) * glow * fadeOut;
        ctx.drawImage(spriteFor(colors[0]).canvas, bx, by, bandW, 7 - layer * 2.5);
      }
      const glints = 10;
      for (let i = 0; i < glints; i += 1) {
        const gx = ((t * 0.06 + (i * w) / glints) % (w + 60)) - 30;
        const gy = ry + Math.sin(t * 0.0016 + i * 2.1) * h * 0.02 + 3;
        ctx.globalAlpha = (0.05 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.003 + i))) * glow * fadeOut;
        ctx.drawImage(spriteFor(colors[i % 2 === 0 ? 0 : 1]).canvas, gx, gy, 26, 5);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      /* ----- 涟漪：星尘落点，椭圆扩散 ----- */
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const r = ripples[i];
        r.r += r.grow;
        r.life -= 1;
        const p = 1 - r.life / r.maxLife;
        if (p >= 1) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(${r.color},${r.alpha0 * Math.pow(1 - p, 1.6) * fadeOut})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(r.x, ry + 1.5, r.r, r.r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      /* ----- 星尘：渐次铺满 → 持续坠落 → 落水重生 ----- */
      if (!burst && t < A_END) {
        const target = Math.floor(STAR_TARGET * Math.min(1, t / (A_END * 0.7)));
        while (stars.length < target) stars.push(spawnStar(true));
      }
      const burstBoost = burst ? 1 + Math.min(2.4, (now - burstAtRef.current) / 280) : 1;
      for (let i = stars.length - 1; i >= 0; i -= 1) {
        const s = stars[i];
        s.phase += 0.016;
        s.y += s.vy * burstBoost;
        s.x += Math.sin(s.y * s.driftFreq * 8 + s.phase) * (s.driftAmp * 0.012);
        const tw = 0.55 + 0.45 * Math.sin(s.phase * s.twFreq * 60 + s.phase);
        const alpha = s.alphaBase * tw * fadeOut;
        if (s.y >= ry) {
          // 落水：泛涟漪 + 亮斑，重生回天幕
          if (!burst && fadeOut > 0.35) {
            ripples.push({
              x: s.x, r: 2 + s.size * 1.5,
              grow: 0.28 + s.size * 0.16,
              life: 40, maxLife: 40,
              alpha0: 0.34 + s.alphaBase * 0.3,
              color: s.color,
            });
            ctx.globalAlpha = 0.5 * fadeOut;
            ctx.drawImage(spriteFor(s.color).canvas, s.x - 11, ry - 4, 22, 8);
            ctx.globalAlpha = 1;
          }
          if (!burst) stars[i] = spawnStar(false);
          else stars.splice(i, 1);
          continue;
        }
        if (alpha <= 0.02 && !burst) { stars[i] = spawnStar(false); continue; }
        const glowR = s.size * 3.2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(spriteFor(s.color).canvas, s.x - glowR, s.y - glowR, glowR * 2, glowR * 2);
        ctx.fillStyle = `rgba(${s.color},${Math.min(1, alpha * 1.3)})`;
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
        setTimeout(() => {
          burstRef.current = true;
          burstAtRef.current = performance.now();
          setLeaving(true);
        }, REVEAL_AT),
        setTimeout(() => {
          cb.current.onDone?.();
          setHidden(true);
        }, DONE_AT),
      ];
    };
    // 字体注入非阻塞——品牌字由 font-display 自动换入，最坏情况前几帧是系统字体。
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
    paint(0, true);
    burstRef.current = true;
    burstAtRef.current = performance.now();
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
      {/* 星尘 + 河画布：星雨 → 涟漪汇河 → 波光倒影（离场加速爆发） */}
      <canvas ref={riverRef} className="entrance__river" aria-hidden="true" />

      <div className="entrance__stage">
        {/* 深空氛围层：星云辉光 + 远景星 + 噪点颗粒 + 暗角 */}
        <div className="entrance__glow entrance__glow--a" />
        <div className="entrance__glow entrance__glow--b" />
        <div ref={starsARef} className="entrance__stars entrance__stars--a" />
        <div ref={starsBRef} className="entrance__stars entrance__stars--b" />
        <div className="entrance__noise" />
        <div className="entrance__vignette" />

        {/* 经线：天顶贯入河面的子午光（Meridian 意象，品牌后景） */}
        <span className="entrance__meridian" />

        {/* 品牌区（C 幕登场）：河光之上逐字浮生 */}
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

        {/* 底部遥测条（唯一 HUD 元素） */}
        <div className="entrance__bar">
          <span className="entrance__bar-brand">SL-OS · STARDUST RIVER</span>
          <span className="entrance__meter">
            <span ref={fillRef} className="entrance__meter-fill" />
          </span>
          <span ref={pctRef} className="entrance__pct">000%</span>
          <span ref={labelRef} className="entrance__bar-phase">星尘 · STARDUST</span>
          <span className="entrance__hint">点击任意处 / ESC 跳过</span>
        </div>
      </div>

      {/* 入境闪光：幕布收拢瞬间的河光绽放 */}
      <span className="entrance__flash" />
    </div>
  );
}
