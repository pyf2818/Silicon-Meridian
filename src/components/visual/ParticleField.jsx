/**
 * ParticleField - 主题驱动粒子画布
 *
 * Canvas 2D + requestAnimationFrame 渲染上浮的粒子。
 * 粒子形态 / 颜色 / 大小 / 速度 / 数量 全部从 :root[data-palette="xxx"] 的 CSS 变量读，
 * 因此 12 个配色主题 → 12 种不同粒子效果：
 *   蓝色（neon / cosmos / arctic / twilight） → 泡泡（半透明底 + 左上高光 + 细描边）
 *   champagne → 金箔星点
 *   sakura → 花瓣
 *   forest / bamboo → 叶片
 *   neon（非蓝其他） / aurora → 极光光波
 *   amber / coral → 光晕
 *   terracotta → 六角蜡封
 *  挂在 NoiseLayer 之上（z-index: -1），pointer-events: none。
 *
 * 性能保障：
 * - DPR cap 2，粒子数按视口面积动态调整
 * - document.hidden 时暂停 rAF
 * - prefers-reduced-motion 时组件返回 null（只保留静态背景）
 * - 鼠标 150px 范围内粒子轻微加速（体感，可选关闭）
 * - bubble / halo 等"重形态"在移动端自动降级（粒子数 × 0.6，高光层合并）
 */
import { useEffect, useRef } from 'react';

const VALID_SHAPES = new Set(['dot', 'bubble', 'leaf', 'petal', 'hex', 'stardust', 'aurora', 'halo']);

function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readParticleShape() {
  const raw = readCssVar('--particle-shape', 'dot').toLowerCase();
  return VALID_SHAPES.has(raw) ? raw : 'dot';
}

function readParticleCount() {
  const raw = parseInt(readCssVar('--particle-count', '40'), 10);
  let n = (Number.isFinite(raw) && raw > 0) ? raw : 40;
  if (window.innerWidth < 768) n = Math.max(12, Math.floor(n * 0.6));
  return n;
}

function readParticleColors() {
  return {
    c1: readCssVar('--particle-c1', 'rgba(201,169,97,.5)'),
    c2: readCssVar('--particle-c2', 'rgba(212,181,118,.42)'),
    bubbleHl: readCssVar('--particle-bubble-hl', 'rgba(255,255,255,.65)'),
    bubbleEdge: readCssVar('--particle-bubble-edge', 'rgba(255,255,255,.18)'),
  };
}

function readParticleSizeRange(shape) {
  let minName = '--particle-size-min';
  let maxName = '--particle-size-max';
  if (shape === 'bubble') { minName = '--particle-bubble-min'; maxName = '--particle-bubble-max'; }
  else if (shape === 'petal') { minName = '--particle-petal-min'; maxName = '--particle-petal-max'; }
  else if (shape === 'leaf') { minName = '--particle-leaf-min'; maxName = '--particle-leaf-max'; }
  else if (shape === 'hex') { minName = '--particle-hex-min'; maxName = '--particle-hex-max'; }
  else if (shape === 'halo') { minName = '--particle-halo-min'; maxName = '--particle-halo-max'; }
  else if (shape === 'aurora') { minName = '--particle-aurora-min'; maxName = '--particle-aurora-max'; }
  else if (shape === 'stardust') { minName = '--particle-stardust-min'; maxName = '--particle-stardust-max'; }
  const fallback = shape === 'bubble' ? { min: 3, max: 14 }
    : shape === 'petal' ? { min: 5, max: 11 }
    : shape === 'leaf' ? { min: 4, max: 9 }
    : shape === 'hex' ? { min: 3, max: 9 }
    : shape === 'halo' ? { min: 8, max: 22 }
    : shape === 'aurora' ? { min: 18, max: 48 }
    : shape === 'stardust' ? { min: 0.4, max: 1.6 }
    : { min: 0.5, max: 2.2 };
  const min = parseFloat(readCssVar(minName, String(fallback.min)));
  const max = parseFloat(readCssVar(maxName, String(fallback.max)));
  return {
    min: Number.isFinite(min) ? min : fallback.min,
    max: Number.isFinite(max) ? max : fallback.max,
  };
}

function readParticleSpeed() {
  const raw = parseFloat(readCssVar('--particle-speed-mul', '1'));
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export default function ParticleField({ enableMouseInfluence = true }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const configRef = useRef({
    shape: 'dot',
    colors: readParticleColors(),
    speedMul: 1,
  });

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const isMobile = window.innerWidth < 768;

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
      const cfg = configRef.current;
      const count = readParticleCount();
      const { min, max } = readParticleSizeRange(cfg.shape);
      cfg.speedMul = readParticleSpeed();
      const w = window.innerWidth;
      const h = window.innerHeight;
      particlesRef.current = Array.from({ length: count }, () => {
        const baseVy = -(0.15 + Math.random() * 0.45);
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: min + Math.random() * (max - min),
          // 按 shape 给一点差异化速度（泡泡略慢、星尘略快）
          vy: baseVy * (cfg.shape === 'bubble' ? 0.75 : cfg.shape === 'stardust' ? 1.4 : 1) * cfg.speedMul,
          vx: (Math.random() - 0.5) * 0.2,
          phase: Math.random() * Math.PI * 2,
          phaseSpeed: (cfg.shape === 'leaf' || cfg.shape === 'petal' ? 0.012 : 0.006) + Math.random() * 0.01,
          alpha: cfg.shape === 'halo' ? 0.12 + Math.random() * 0.22 : 0.35 + Math.random() * 0.4,
          colorIdx: Math.random() > 0.5 ? 0 : 1,
          // 额外 per-particle 属性：花瓣/叶片用的旋转方向、尺寸抖动等
          rotDir: Math.random() > 0.5 ? 1 : -1,
          rot: Math.random() * Math.PI * 2,
          wobble: 0.6 + Math.random() * 1.2,
          aspect: cfg.shape === 'petal' ? (0.55 + Math.random() * 0.35) : cfg.shape === 'leaf' ? (0.35 + Math.random() * 0.3) : 1,
        };
      });
    }

    function applyPalette() {
      const cfg = configRef.current;
      cfg.shape = readParticleShape();
      cfg.colors = readParticleColors();
      cfg.speedMul = readParticleSpeed();
      initParticles();
    }

    applyPalette();

    // ==================== 粒子绘制：按 shape 分发 ====================
    function drawDot(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    }

    function drawBubble(p) {
      const { bubbleHl, bubbleEdge, c1, c2 } = configRef.current.colors;
      const fill = p.colorIdx === 0 ? c1 : c2;
      const r = p.r;
      ctx.globalAlpha = p.alpha;
      // 1) 主体填充：径向渐变（中心稍透，边缘更薄）
      const g = ctx.createRadialGradient(p.x - r * 0.25, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
      g.addColorStop(0, bubbleEdge);
      g.addColorStop(0.45, fill);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      // 2) 细线描边（气泡边缘一圈）
      ctx.lineWidth = Math.max(0.5, r * 0.07);
      ctx.strokeStyle = bubbleEdge;
      ctx.stroke();
      // 3) 左上高光实心圆（移动端合并减少一步）
      if (!isMobile) {
        const hlR = Math.max(0.8, r * 0.28);
        ctx.beginPath();
        ctx.arc(p.x - r * 0.35, p.y - r * 0.42, hlR, 0, Math.PI * 2);
        ctx.fillStyle = bubbleHl;
        ctx.globalAlpha = Math.min(0.95, p.alpha + 0.35);
        ctx.fill();
      }
    }

    function drawLeaf(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const w = p.r * 2;
      const h = p.r * 2 / p.aspect;
      ctx.globalAlpha = p.alpha;
      const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // 叶脉（一道中线）
      if (!isMobile && p.r > 3.5) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = p.alpha * 0.6;
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 * 0.85);
        ctx.lineTo(0, h / 2 * 0.85);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawPetal(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const w = p.r * 2;
      const h = p.r * 2 / p.aspect;
      ctx.globalAlpha = p.alpha;
      const g = ctx.createRadialGradient(-w * 0.2, -h * 0.15, p.r * 0.15, 0, 0, Math.max(w, h) / 2);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      // 不对称花瓣：上尖下圆，一侧略凹
      ctx.moveTo(0, -h / 2);
      ctx.bezierCurveTo(w * 0.6, -h * 0.2, w * 0.45, h * 0.5, 0, h * 0.45);
      ctx.bezierCurveTo(-w * 0.45, h * 0.5, -w * 0.6, -h * 0.2, 0, -h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawHex(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.5);
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = Math.cos(a) * p.r;
        const py = Math.sin(a) * p.r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      if (!isMobile && p.r > 3) {
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = 'rgba(255,255,255,.25)';
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawStardust(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.3 + p.phase * 0.5);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = c;
      // 十字星：两条细矩形
      const len = p.r * 3.2;
      const thick = Math.max(0.5, p.r * 0.45);
      ctx.fillRect(-len / 2, -thick / 2, len, thick);
      ctx.fillRect(-thick / 2, -len / 2, thick, len);
      // 中心小圆加亮
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.globalAlpha = Math.min(1, p.alpha + 0.2);
      ctx.fill();
      ctx.restore();
    }

    function drawAurora(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.25);
      ctx.globalAlpha = p.alpha;
      const w = p.r * 3.2;
      const h = p.r * 0.8;
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, c);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawHalo(p) {
      const c = p.colorIdx === 0 ? configRef.current.colors.c1 : configRef.current.colors.c2;
      ctx.globalAlpha = p.alpha;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, c);
      g.addColorStop(0.55, c);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    const DRAW = {
      dot: drawDot,
      bubble: drawBubble,
      leaf: drawLeaf,
      petal: drawPetal,
      hex: drawHex,
      stardust: drawStardust,
      aurora: drawAurora,
      halo: drawHalo,
    };

    function tick() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const mouse = mouseRef.current;
      const particles = particlesRef.current;
      const shape = configRef.current.shape;
      const draw = DRAW[shape] || drawDot;
      const wobShape = shape === 'leaf' || shape === 'petal' || shape === 'hex';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.phase += p.phaseSpeed;
        p.x += p.vx + Math.sin(p.phase) * (wobShape ? p.wobble * 0.5 : 0.22);
        p.y += p.vy;
        if (wobShape) p.rot += 0.008 * p.rotDir + Math.sin(p.phase) * 0.004;

        if (enableMouseInfluence && mouse.x > -9000) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            const force = (1 - dist / 150) * (shape === 'bubble' ? 0.5 : 0.3);
            p.y -= force;
          }
        }

        if (p.y < -p.r - 6) {
          p.y = h + p.r + 6;
          p.x = Math.random() * w;
        }
        if (p.x < -p.r - 10) p.x = w + p.r + 10;
        if (p.x > w + p.r + 10) p.x = -p.r - 10;

        draw(p);
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    }

    function onMouseMove(e) { mouseRef.current = { x: e.clientX, y: e.clientY }; }
    function onMouseLeave() { mouseRef.current = { x: -9999, y: -9999 }; }
    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(rafRef.current);
      else rafRef.current = requestAnimationFrame(tick);
    }

    resize();
    rafRef.current = requestAnimationFrame(tick);

    if (enableMouseInfluence) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('mouseout', onMouseLeave, { passive: true });
    }
    window.addEventListener('resize', resize);
    window.addEventListener('resize', initParticles);
    document.addEventListener('visibilitychange', onVisibility);

    // 主题 / 深浅切换：同时监听 data-mode（深浅）和 data-palette（12 配色）
    const observer = new MutationObserver(() => {
      applyPalette();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode', 'data-palette'],
    });

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
