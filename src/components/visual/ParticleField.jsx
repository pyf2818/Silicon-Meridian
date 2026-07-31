/**
 * ParticleField - 金箔粒子层
 *
 * Canvas 2D + requestAnimationFrame 渲染缓慢上浮的金箔粒子。
 * 挂在 NoiseLayer 之上（z-index: -1），pointer-events: none。
 * 深浅主题通过 CSS 变量 --particle-c1/c2 切换粒子颜色。
 *
 * 性能保障：
 * - DPR cap 2，粒子数按视口面积动态调整（30-50）
 * - document.hidden 时暂停 rAF
 * - prefers-reduced-motion 时组件返回 null（只保留静态背景）
 * - 鼠标 150px 范围内粒子轻微加速（体感，可选关闭）
 */
import { useEffect, useRef } from 'react';

function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readParticleCount() {
  const raw = parseInt(readCssVar('--particle-count', '40'), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 40;
  // 移动端粒子减半
  if (window.innerWidth < 768) return Math.max(15, Math.floor(raw / 2));
  return raw;
}

function readParticleColors() {
  return {
    c1: readCssVar('--particle-c1', 'rgba(201,169,97,.5)'),
    c2: readCssVar('--particle-c2', 'rgba(212,181,118,.42)'),
  };
}

function readParticleSizeRange() {
  const min = parseFloat(readCssVar('--particle-size-min', '0.5'));
  const max = parseFloat(readCssVar('--particle-size-max', '2'));
  return { min: Number.isFinite(min) ? min : 0.5, max: Number.isFinite(max) ? max : 2 };
}

export default function ParticleField({ enableMouseInfluence = true }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    // prefers-reduced-motion：不渲染粒子，只保留静态背景
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initParticles() {
      const count = readParticleCount();
      const { min, max } = readParticleSizeRange();
      const w = window.innerWidth;
      const h = window.innerHeight;
      particlesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: min + Math.random() * (max - min),
        vy: -(0.2 + Math.random() * 0.4),       // 上浮速度 -0.2 ~ -0.6
        vx: (Math.random() - 0.5) * 0.15,        // 轻微水平漂移
        phase: Math.random() * Math.PI * 2,      // 正弦相位
        phaseSpeed: 0.005 + Math.random() * 0.01,
        alpha: 0.3 + Math.random() * 0.4,
        colorIdx: Math.random() > 0.5 ? 0 : 1,
      }));
    }

    let colors = readParticleColors();

    function tick() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const mouse = mouseRef.current;
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // 正弦水平漂移
        p.phase += p.phaseSpeed;
        p.x += p.vx + Math.sin(p.phase) * 0.2;
        p.y += p.vy;

        // 鼠标 150px 范围内轻微加速
        if (enableMouseInfluence && mouse.x > -9000) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            const force = (1 - dist / 150) * 0.3;
            p.y -= force;
          }
        }

        // 出屏循环：顶部消失回到底部
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.colorIdx === 0 ? colors.c1 : colors.c2;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    }

    function onMouseMove(e) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }
    function onMouseLeave() {
      mouseRef.current = { x: -9999, y: -9999 };
    }
    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    resize();
    initParticles();
    rafRef.current = requestAnimationFrame(tick);

    if (enableMouseInfluence) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('mouseout', onMouseLeave, { passive: true });
    }
    window.addEventListener('resize', resize);
    window.addEventListener('resize', initParticles);
    document.addEventListener('visibilitychange', onVisibility);

    // 主题切换时重新读取粒子颜色（监听 html data-mode 属性变化）
    const observer = new MutationObserver(() => {
      colors = readParticleColors();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (enableMouseInfluence) {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseout', onMouseLeave);
      }
      window.removeEventListener('resize', resize);
      window.removeEventListener('resize', initParticles);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, [enableMouseInfluence]);

  return (
    <canvas
      ref={canvasRef}
      className="visual-particle-layer"
      aria-hidden="true"
    />
  );
}
