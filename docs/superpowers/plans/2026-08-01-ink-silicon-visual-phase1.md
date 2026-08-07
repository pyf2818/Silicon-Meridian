# 东方水墨硅川 · Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为全站新增水墨氛围视觉层（背景光晕 + SVG 噪点 + Canvas 金箔粒子）并升级全局卡片质感与滚动条，深浅双主题均成立。

**Architecture:** 在 `main.jsx` 根节点挂载三层 `position: fixed` 全屏视觉层（BackgroundLayer / NoiseLayer / ParticleField），均 `pointer-events: none`，z-index 分别 -3/-2/-1，位于 App 内容之下。CSS 新增水墨光晕变量与卡片玻璃态样式。ParticleField 用 `React.lazy` 异步加载，不阻塞首屏。

**Tech Stack:** React 19 + Canvas 2D API + CSS custom properties + SVG `feTurbulence`

**Spec:** `docs/superpowers/specs/2026-08-01-ink-silicon-visual-upgrade-design.md`

---

## 文件结构

| 文件 | 责任 | 操作 |
|---|---|---|
| `src/components/visual/BackgroundLayer.jsx` | 墨色渐变背景层（纯 CSS，多层 radial-gradient + 慢呼吸动画） | 新建 |
| `src/components/visual/NoiseLayer.jsx` | SVG 噪点纸张质感层（纯 CSS，feTurbulence data URI） | 新建 |
| `src/components/visual/ParticleField.jsx` | Canvas 金箔粒子层（rAF + DPR 适配 + 离屏暂停 + 鼠标轻度影响） | 新建 |
| `src/main.jsx` | 根节点挂载三层视觉层 | 修改 |
| `src/styles.css` | 主题变量扩展 + 全局卡片质感 + 滚动条美化 + 视觉层基础样式 | 修改 |

---

### Task 1: 扩展主题变量

**Files:**
- Modify: `src/styles.css:1-65`（暗主题 `:root` 块）
- Modify: `src/styles.css:66-119`（浅主题 `:root[data-mode="light"]` 块）

- [ ] **Step 1: 在暗主题 `:root` 块的 `--particle-c2` 行后新增水墨光晕变量**

在 `src/styles.css` 第 54 行 `--particle-c2: rgba(212,181,118,.42);` 之后，第 55 行（`--bg-glow-1` 或下一个变量）之前插入：

```css
  /* 水墨氛围光晕：BackgroundLayer 多层 radial-gradient 使用 */
  --ink-glow-1: rgba(201,169,97,.10);   /* 左上金色光晕 */
  --ink-glow-2: rgba(201,169,97,.07);   /* 右下金色光晕 */
  --ink-glow-3: rgba(60,55,75,.08);     /* 中下灰紫光晕 */
  --particle-count: 40;
  --particle-size-min: 0.5px;
  --particle-size-max: 2px;
```

- [ ] **Step 2: 在浅主题 `:root[data-mode="light"]` 块的 `--particle-c1` 行后新增对应变量**

找到浅主题块中的 `--particle-c1: rgba(154,123,63,.3);` 行（约第 97 行），在其后插入（如果浅主题没有 `--particle-c2`，则在 `--particle-c1` 后直接插入）：

```css
  --particle-c2: rgba(154,123,63,.22);
  /* 水墨氛围光晕（浅主题：降低饱和度，提高背景明度） */
  --ink-glow-1: rgba(154,123,63,.09);
  --ink-glow-2: rgba(154,123,63,.06);
  --ink-glow-3: rgba(120,110,90,.05);
  --particle-count: 36;
  --particle-size-min: 0.5px;
  --particle-size-max: 1.8px;
```

- [ ] **Step 3: 验证变量已生效**

Run: `npm run dev` 启动开发服务器
打开浏览器 DevTools → Elements → 在 `<html>` 元素的 Computed 面板搜索 `--ink-glow-1`，确认存在且值为 `rgba(201,169,97,.10)`
切换浅主题后再次确认 `--ink-glow-1` 变为 `rgba(154,123,63,.09)`

- [ ] **Step 4: 提交**

```bash
git add src/styles.css
git commit -m "feat(visual): add ink-glow and particle theme variables for dark/light themes"
```

---

### Task 2: 创建 BackgroundLayer 组件

**Files:**
- Create: `src/components/visual/BackgroundLayer.jsx`

- [ ] **Step 1: 创建组件文件**

创建 `src/components/visual/BackgroundLayer.jsx`：

```jsx
/**
 * BackgroundLayer - 水墨氛围背景层
 *
 * 纯 CSS 多层 radial-gradient 模拟墨色晕染 + 极慢呼吸动画。
 * 挂在根节点最底层（z-index: -3），pointer-events: none。
 * 深浅主题通过 CSS 变量自动切换。
 */
export default function BackgroundLayer() {
  return (
    <div className="visual-bg-layer" aria-hidden="true">
      <div className="visual-bg-glow visual-bg-glow-1" />
      <div className="visual-bg-glow visual-bg-glow-2" />
      <div className="visual-bg-glow visual-bg-glow-3" />
    </div>
  );
}
```

- [ ] **Step 2: 在 `src/styles.css` 末尾追加 BackgroundLayer 样式**

在 `src/styles.css` 文件末尾追加：

```css
/* ============ 水墨氛围视觉层 ============ */

/* BackgroundLayer：墨色渐变背景 */
.visual-bg-layer {
  position: fixed;
  inset: 0;
  z-index: -3;
  pointer-events: none;
  background: var(--bg-primary);
  overflow: hidden;
}
.visual-bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  animation: visual-bg-breathe 25s ease-in-out infinite;
}
.visual-bg-glow-1 {
  top: -15%;
  left: -10%;
  width: 55%;
  height: 55%;
  background: radial-gradient(circle, var(--ink-glow-1) 0%, transparent 70%);
}
.visual-bg-glow-2 {
  bottom: -20%;
  right: -10%;
  width: 50%;
  height: 50%;
  background: radial-gradient(circle, var(--ink-glow-2) 0%, transparent 70%);
  animation-delay: -8s;
}
.visual-bg-glow-3 {
  top: 40%;
  left: 30%;
  width: 45%;
  height: 45%;
  background: radial-gradient(circle, var(--ink-glow-3) 0%, transparent 70%);
  animation-delay: -16s;
}
@keyframes visual-bg-breathe {
  0%, 100% { opacity: .7; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .visual-bg-glow { animation: none; opacity: .85; }
}
```

- [ ] **Step 3: 验证背景层渲染**

Run: `npm run dev`
在 `main.jsx` 临时挂载 `<BackgroundLayer />`（下一 Task 会正式挂载），或直接在浏览器临时执行：
DevTools Console: `document.body.insertAdjacentHTML('afterbegin', '<div style="position:fixed;inset:0;z-index:-3;pointer-events:none;background:var(--bg-primary);overflow:hidden"><div style="position:absolute;top:-15%;left:-10%;width:55%;height:55%;border-radius:50%;filter:blur(60px);background:radial-gradient(circle,var(--ink-glow-1) 0%,transparent 70%)"></div></div>')`
预期：页面背景出现左上金色光晕，25s 周期缓慢呼吸

- [ ] **Step 4: 提交**

```bash
git add src/components/visual/BackgroundLayer.jsx src/styles.css
git commit -m "feat(visual): add BackgroundLayer with multi-layer ink glow and slow breathing animation"
```

---

### Task 3: 创建 NoiseLayer 组件

**Files:**
- Create: `src/components/visual/NoiseLayer.jsx`

- [ ] **Step 1: 创建组件文件**

创建 `src/components/visual/NoiseLayer.jsx`：

```jsx
/**
 * NoiseLayer - 宣纸噪点质感层
 *
 * 内联 SVG feTurbulence 生成噪点纹理，消除纯色背景的塑料感。
 * 挂在 BackgroundLayer 之上（z-index: -2），pointer-events: none。
 * opacity 极低（0.03/0.04），近乎不可见但增加纸张质感。
 */
export default function NoiseLayer() {
  // feTurbulence 生成 80x80 噪点单元，baseFrequency 越小颗粒越粗
  const noiseSvg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>
      <filter id='n'>
        <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
      </filter>
      <rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/>
    </svg>`;
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(noiseSvg)}")`;
  return (
    <div
      className="visual-noise-layer"
      aria-hidden="true"
      style={{ backgroundImage: dataUri }}
    />
  );
}
```

- [ ] **Step 2: 在 `src/styles.css` 末尾追加 NoiseLayer 样式**

在 BackgroundLayer 样式后追加：

```css
/* NoiseLayer：宣纸噪点质感 */
.visual-noise-layer {
  position: fixed;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  opacity: 0.03;
  background-repeat: repeat;
  background-size: 80px 80px;
  mix-blend-mode: overlay;
}
:root[data-mode="light"] .visual-noise-layer {
  opacity: 0.04;
  mix-blend-mode: multiply;
}
```

- [ ] **Step 3: 验证噪点层渲染**

DevTools Elements 面板确认 `.visual-noise-layer` 存在，背景图为 SVG data URI
关闭层（`display:none`）再开启，对比可见细微颗粒感差异（近乎不可见但消除塑料感）

- [ ] **Step 4: 提交**

```bash
git add src/components/visual/NoiseLayer.jsx src/styles.css
git commit -m "feat(visual): add NoiseLayer with SVG feTurbulence paper texture"
```

---

### Task 4: 创建 ParticleField 组件

**Files:**
- Create: `src/components/visual/ParticleField.jsx`

- [ ] **Step 1: 创建组件文件（含完整粒子系统逻辑）**

创建 `src/components/visual/ParticleField.jsx`：

```jsx
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
```

- [ ] **Step 2: 在 `src/styles.css` 末尾追加 ParticleField 样式**

在 NoiseLayer 样式后追加：

```css
/* ParticleField：金箔粒子画布 */
.visual-particle-layer {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  width: 100vw;
  height: 100vh;
}
```

- [ ] **Step 3: 验证粒子渲染**

在 `main.jsx` 临时挂载 `<ParticleField />`（下一 Task 正式挂载）
Run: `npm run dev`
预期：页面背景出现 30-50 个金色小点缓慢上浮，鼠标移动附近粒子轻微加速
DevTools Console 执行 `document.documentElement.setAttribute('data-mode', 'light')`，确认粒子颜色变浅
DevTools Console 执行 `document.dispatchEvent(new Event('visibilitychange'))` 后切到其他 tab，确认 rAF 暂停（Performance 面板无帧）

- [ ] **Step 4: 提交**

```bash
git add src/components/visual/ParticleField.jsx src/styles.css
git commit -m "feat(visual): add ParticleField canvas with golden ink particles, DPR cap, visibility pause, mouse influence"
```

---

### Task 5: 在 main.jsx 挂载三层视觉层

**Files:**
- Modify: `src/main.jsx:1-45`

- [ ] **Step 1: 添加 import 与懒加载**

修改 `src/main.jsx` 顶部 import 区域，在 `import './themes.css';` 后新增：

```jsx
import BackgroundLayer from './components/visual/BackgroundLayer.jsx';
import NoiseLayer from './components/visual/NoiseLayer.jsx';
import { lazy, Suspense } from 'react';
// ParticleField 懒加载：首屏先显示背景与噪点，粒子稍后出现，不阻塞首屏
const ParticleField = lazy(() => import('./components/visual/ParticleField.jsx'));
```

- [ ] **Step 2: 在 ErrorBoundary 内、App 之前挂载三层视觉层**

修改 `src/main.jsx` 的 `createRoot(...).render(...)` 部分，将：

```jsx
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

改为：

```jsx
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BackgroundLayer />
      <NoiseLayer />
      <Suspense fallback={null}>
        <ParticleField />
      </Suspense>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

- [ ] **Step 3: 验证全站视觉层生效**

Run: `npm run dev`
预期：
- 页面背景出现墨色光晕（左上、右下、中下三个金色径向晕，25s 周期缓慢呼吸）
- 背景有细微颗粒感（近乎不可见）
- 30-50 个金色粒子缓慢上浮，鼠标附近粒子轻微加速
- 切换深浅主题：光晕色、粒子色均正确变化
- 所有页面（资讯/AI对话/股市等）均继承背景层
- 资讯列表滚动流畅，无明显卡顿

- [ ] **Step 4: 提交**

```bash
git add src/main.jsx
git commit -m "feat(visual): mount three visual layers (background/noise/particles) at root"
```

---

### Task 6: 全局卡片质感升级

**Files:**
- Modify: `src/styles.css:31`（`--border-color` 暗主题）
- Modify: `src/styles.css:92`（`--border-color` 浅主题）
- Modify: `src/styles.css` 末尾（新增卡片玻璃态与 hover 样式）

- [ ] **Step 1: 提升暗主题 border-color 不透明度**

在 `src/styles.css` 第 31 行，将：

```css
  --border-color: rgba(201,169,97,.25);
```

改为：

```css
  --border-color: rgba(201,169,97,.32);
```

- [ ] **Step 2: 提升浅主题 border-color 不透明度**

在 `src/styles.css` 第 92 行，将：

```css
  --border-color: rgba(154,123,63,.30);
```

改为：

```css
  --border-color: rgba(154,123,63,.38);
```

- [ ] **Step 3: 在 `src/styles.css` 末尾追加卡片玻璃态与 hover 样式**

在文件末尾追加：

```css
/* ============ 全局卡片质感升级 ============ */

/* 卡片微玻璃态：--bg-card 已是 rgba，配合 backdrop-filter */
.card,
.news-card,
.workspace-panel,
.agent-panel,
.skills-panel,
.session-sidebar,
.stock-panel {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: border-color .2s, transform .2s, box-shadow .2s;
}

/* 卡片 hover：边框金色加深 + 上浮 + 阴影加深 */
.news-card:hover,
.workspace-panel:hover,
.skills-panel-section:hover {
  border-color: rgba(201,169,97,.5);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(201,169,97,.15);
}
:root[data-mode="light"] .news-card:hover,
:root[data-mode="light"] .workspace-panel:hover,
:root[data-mode="light"] .skills-panel-section:hover {
  border-color: rgba(154,123,63,.45);
  box-shadow: 0 8px 24px rgba(120,100,60,.15), 0 0 0 1px rgba(154,123,63,.12);
}

/* 低端设备降级：不支持 backdrop-filter 时移除玻璃态 */
@supports not ((backdrop-filter: blur(8px)) or (-webkit-backdrop-filter: blur(8px))) {
  .card,
  .news-card,
  .workspace-panel,
  .agent-panel,
  .skills-panel,
  .session-sidebar,
  .stock-panel {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

- [ ] **Step 4: 验证卡片质感**

Run: `npm run dev`
浏览资讯首页，确认：
- 卡片有微玻璃态模糊效果（背景内容透过卡片可见轻微模糊）
- hover 卡片时边框金色加深 + 上浮 2px + 阴影加深
- 切换浅主题，hover 效果同样成立（边框深金色）
- 滚动流畅无卡顿

- [ ] **Step 5: 提交**

```bash
git add src/styles.css
git commit -m "feat(visual): upgrade card texture with glass blur, border opacity, hover lift"
```

---

### Task 7: 滚动条美化

**Files:**
- Modify: `src/styles.css` 末尾

- [ ] **Step 1: 在 `src/styles.css` 末尾追加金色细滚动条样式**

在文件末尾追加：

```css
/* ============ 滚动条美化 ============ */

/* Webkit 浏览器（Chrome/Safari/Edge） */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(201,169,97,.35);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(201,169,97,.55);
  background-clip: padding-box;
}
:root[data-mode="light"] ::-webkit-scrollbar-thumb {
  background: rgba(154,123,63,.3);
  background-clip: padding-box;
}
:root[data-mode="light"] ::-webkit-scrollbar-thumb:hover {
  background: rgba(154,123,63,.5);
  background-clip: padding-box;
}

/* Firefox */
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(201,169,97,.35) transparent;
}
:root[data-mode="light"] * {
  scrollbar-color: rgba(154,123,63,.3) transparent;
}
```

- [ ] **Step 2: 验证滚动条**

Run: `npm run dev`
在资讯列表或任何长页面滚动，确认：
- 滚动条变为 8px 宽金色半透明细条
- hover 滚动条颜色加深
- 切换浅主题，滚动条变为深金色
- Firefox 下同样为细滚动条（如果可用）

- [ ] **Step 3: 提交**

```bash
git add src/styles.css
git commit -m "feat(visual): style scrollbars with golden thin theme for dark/light modes"
```

---

### Task 8: 最终验证与推送

- [ ] **Step 1: 全量功能验证**

Run: `npm run dev`
逐项验证：
1. 深主题：墨色背景 + 3 个金色光晕缓慢呼吸 + 30-50 金色粒子上浮 + 噪点质感
2. 浅主题：宣纸白底 + 淡金光晕 + 浅色粒子 + 噪点
3. 鼠标移动：附近粒子轻微加速
4. 切换浏览器 tab 再回来：粒子恢复（离屏暂停生效）
5. 资讯首页滚动 60fps 无卡顿
6. 卡片玻璃态 + hover 上浮 + 边框加深
7. 滚动条金色细条
8. 所有页面（资讯/AI对话/股市/GitHub/社区/画像/工作室）均继承背景层
9. DevTools Performance 录制 5s，无长时间任务阻塞

- [ ] **Step 2: 验证 prefers-reduced-motion**

DevTools → Rendering → 勾选 "Emulate CSS media feature prefers-reduced-motion"
预期：粒子消失（ParticleField 返回 null），光晕停止呼吸（animation: none），只剩静态背景

- [ ] **Step 3: 运行单元测试确保无回归**

Run: `node node_modules/vitest/vitest.mjs run`
预期：425 个测试全部通过（视觉层不涉及业务逻辑，不应有回归）

- [ ] **Step 4: 推送到 GitHub**

```bash
git push origin main
```

- [ ] **Step 5: 更新 todo 状态**

确认 Phase 1 全部完成，在后续会话中可启动 Phase 2（资讯首页深度优化）

---

## 自审记录

- **Spec 覆盖**：Task 1 覆盖主题变量；Task 2-4 覆盖三层视觉层；Task 5 覆盖挂载；Task 6 覆盖卡片质感；Task 7 覆盖滚动条；Task 8 覆盖性能与可访问性验收。Phase 2-4 未在本计划中（按 spec 分期，后续计划）。
- **Placeholder 扫描**：无 TBD/TODO，所有代码块完整。
- **类型一致性**：`ParticleField` props `enableMouseInfluence`、CSS 变量名 `--ink-glow-1/2/3`、`--particle-count` 等在各 Task 间一致。
