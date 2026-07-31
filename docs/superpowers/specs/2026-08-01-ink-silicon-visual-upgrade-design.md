# 东方水墨硅川 · 全前端体感升级设计

- 日期：2026-08-01
- 范围：全部页面深度改造（分 4 期）
- 风格：东方水墨硅川 · 纯抽象氛围
- 技术方案：Canvas 粒子 + CSS 渐变背景 + SVG 噪点

## 1. 背景与目标

"万般硅川"是资讯智能平台，当前视觉偏功能化，缺乏质感与艺术感。本次升级在不破坏资讯可读性的前提下，为全站增加水墨氛围层与体感动效，让产品更有"硅川"的东方意象。

核心目标：
- 全站统一的水墨氛围背景（粒子 + 光晕 + 噪点）
- 卡片质感升级（更实的边框、玻璃态、hover 微动）
- 深浅两套主题均成立
- 性能可控，不影响资讯滚动与首屏加载

非目标：
- 不引入具象水墨元素（山水画、毛笔字、竖排诗句）
- 不改变现有信息架构与交互逻辑
- 不替换现有香槟金主色，只增补水墨氛围色
- 不做花哨动效（粒子缓慢、光晕极慢呼吸、噪点近乎不可见）

## 2. 设计决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 视觉调性 | 东方水墨硅川 | 呼应产品命名，有记忆点 |
| 具象程度 | 纯抽象氛围 | 资讯平台为主，水墨是氛围而非主角 |
| 技术方案 | Canvas 粒子 + CSS 背景 + SVG 噪点 | 平衡质感与性能，深浅可切换，离屏可暂停 |
| 主题 | 深浅双主题 | 用户明确要求，两套都要成立 |
| 强度 | 克制 | 用户要求"不要太花里胡哨" |

## 3. 架构

新增三层 `position: fixed` 全屏视觉层，挂在 `main.jsx` 根节点最底层，所有页面自动继承：

```
<Root>
  <BackgroundLayer />   z-index: -3  墨色渐变背景（纯 CSS）
  <NoiseLayer />        z-index: -2  SVG 噪点纸张质感（纯 CSS）
  <ParticleField />     z-index: -1  Canvas 金箔粒子
  <App />               z-index: 0+  现有内容
</Root>
```

三层均 `pointer-events: none`，不拦截任何交互。现有 `App` 内容层保持原有 z-index 体系，视觉层在其之下。

## 4. 组件设计

### 4.1 BackgroundLayer

- 路径：`src/components/visual/BackgroundLayer.jsx`
- 实现：纯 CSS，多层 `radial-gradient` 模拟墨色晕染
- 暗主题：
  - 底色 `#0B0E11`（现有 `--bg-primary`）
  - 2 个金色径向光晕：左上 `--ink-glow-1`、右下 `--ink-glow-2`
  - 1 个深灰紫晕：中下 `--ink-glow-3`
- 浅主题：
  - 底色 `#F7F5F0`（现有 `--bg-primary`）
  - 淡金光晕 + 微暖灰晕
- 动效：光晕加 `@keyframes` 极慢呼吸（25s 周期，`opacity 0.7↔1`），几乎察觉不到但保持"活"
- 无 JS 依赖，读 CSS 变量切换主题

### 4.2 NoiseLayer

- 路径：`src/components/visual/NoiseLayer.jsx`
- 实现：内联 SVG `feTurbulence` 生成噪点纹理
- `opacity: 0.03`（暗主题）/ `0.04`（浅主题）
- 消除纯色背景的"塑料感"，增加宣纸质感
- 内联 SVG data URI，无网络请求，无 JS

### 4.3 ParticleField

- 路径：`src/components/visual/ParticleField.jsx`
- 实现：Canvas 2D + `requestAnimationFrame`
- 粒子参数：
  - 数量：30-50（读 `--particle-count`，按视口面积动态调整，移动端减半）
  - 颜色：`--particle-c1` / `--particle-c2`（已预留）
  - 半径：0.5-2px（读 `--particle-size-min/max`）
  - 透明度：`globalAlpha 0.3-0.7`
  - 运动：缓慢上浮（`vy: -0.2 ~ -0.6 px/frame`）+ 正弦水平漂移
  - 循环：出屏顶部回到底部
- 鼠标交互：鼠标 150px 范围内粒子轻微加速（体感，不花哨，可通过 prop 关闭）
- 性能保障：
  - DPR 适配，`devicePixelRatio` cap 2
  - `document.hidden` 时暂停 rAF
  - `prefers-reduced-motion: reduce` 时关闭粒子，只保留静态背景
  - `pointer-events: none`

## 5. 主题变量扩展

在 `src/styles.css` 的 `:root` 与 `:root[data-mode="light"]` 各新增：

```css
/* 暗主题 */
--ink-glow-1: rgba(201,169,97,.10);   /* 左上金光 */
--ink-glow-2: rgba(201,169,97,.07);   /* 右下金光 */
--ink-glow-3: rgba(60,55,75,.08);     /* 中下灰紫 */
--particle-count: 40;
--particle-size-min: 0.5px;
--particle-size-max: 2px;

/* 浅主题 */
--ink-glow-1: rgba(154,123,63,.09);
--ink-glow-2: rgba(154,123,63,.06);
--ink-glow-3: rgba(120,110,90,.05);
--particle-count: 36;
--particle-size-min: 0.5px;
--particle-size-max: 1.8px;
```

`--particle-c1/c2` 已存在，浅主题需降低饱和度（已有定义）。

## 6. 全局卡片质感升级

呼应"线条更重、边框更突出"的偏好，在 `src/styles.css` 全局调整：

- `--border-color` 不透明度提升一档（暗主题 `.25→.32`，浅主题 `.30→.38`）
- `--panel-border` 保持 `2px solid`，但视觉更实
- 卡片加微玻璃态：`backdrop-filter: blur(8px)`（`--bg-card` 已是 rgba，配合即可）
- 卡片 hover：边框金色加深（`--border-active`）+ `transform: translateY(-2px)` + `box-shadow` 加深
- 滚动条美化：金色细滚动条（`::-webkit-scrollbar` width 8px，thumb 金色半透明）
- 内容区保持高对比度可读性，水墨只做背景不抢内容

## 7. 分期改造计划

### Phase 1：全局视觉层 + 主题变量 + 卡片质感

- 新增 `src/components/visual/` 目录及三个组件
- `main.jsx` 根节点挂载三层视觉层
- `styles.css` 新增主题变量 + 全局卡片质感 + 滚动条
- 验收：所有页面背景有墨色光晕 + 金箔粒子 + 卡片更有质感，深浅主题均成立

### Phase 2：资讯首页深度优化

- 资讯卡片：进入视口淡入动画（`IntersectionObserver`）、hover 水墨晕染边框
- 顶栏：滚动时毛玻璃化（`backdrop-filter`）、底部金色渐变线
- 右栏面板：背景半透明 + 玻璃态
- 验收：资讯首页滚动有呼吸感，卡片有进入动效

### Phase 3：AI 对话页深度优化

- 消息气泡：用户气泡墨色微光底、AI 气泡金色微光底，差异化
- 任务卡：已有动画，加水墨边框（`border-image` 渐变）
- 三栏背景：左中右栏微差异化墨色浓度
- 验收：对话页三栏层次清晰，气泡有质感

### Phase 4：其余页面专属优化

- 股市页：K线图区背景墨色化、涨跌色与水墨调和（保持红涨绿跌，降低饱和度）
- GitHub 页：卡片同资讯卡风格
- 社区页：帖子卡片同资讯卡
- 画像页：仪表盘卡片玻璃态
- 工作室页：编辑器背景墨色
- 验收：全站视觉统一，无页面违和

## 8. 性能与可访问性

- 粒子数 30-50，单次 rAF 开销 < 1ms
- 离屏 tab 暂停 rAF，不可见时不耗电
- `prefers-reduced-motion` 关粒子，保留静态背景
- 移动端粒子减半，DPR cap 2
- 视觉层 `pointer-events: none`，不影响交互
- 噪点与背景纯 CSS/SVG，无 JS 开销，同步挂载首屏即可见
- ParticleField 为 Canvas JS 组件，用 `React.lazy` 异步加载，首屏先显示背景与噪点，粒子稍后出现（体感无碍，不阻塞首屏）

## 9. 验收标准

- 深浅主题切换后，背景、粒子、卡片质感均正确
- 资讯列表滚动 60fps，无卡顿
- 离屏 tab 不耗 CPU
- 开启 `prefers-reduced-motion` 后粒子消失，背景静态
- 全站无页面视觉违和

## 10. 风险与回滚

- 风险：玻璃态 `backdrop-filter` 在低端设备可能卡顿 → 降级为半透明纯色
- 风险：粒子在长页面滚动时性能下降 → 已有离屏暂停 + 数量控制
- 回滚：三层视觉层挂在 `main.jsx`，注释掉即可移除全部氛围效果，不影响功能
