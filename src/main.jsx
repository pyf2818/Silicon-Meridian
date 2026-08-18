import React, { lazy, Suspense } from 'react';
import SafeBoundary from './components/SafeBoundary.jsx';
import { createRoot } from 'react-dom/client';
import './i18n/index.js'; // i18n 初始化（中英文双语支持，默认中文，可切换）
import App from './App.jsx';
import './styles.css';
import './themes.css';
import './hud-theme.css';
import './polish.css';
import './studio-theme.css';
import './states.css'; // B1 统一空/错/加载态设计系统（在 studio-theme 之后，可被其覆盖）
import './intelligence-briefing.css';
import './onboarding.css'; // B2 首跑引导向导样式
import BackgroundLayer from './components/visual/BackgroundLayer.jsx';
import NoiseLayer from './components/visual/NoiseLayer.jsx';
// ParticleField 懒加载：首屏先显示背景与噪点，粒子稍后出现，不阻塞首屏
const ParticleField = lazy(() => import('./components/visual/ParticleField.jsx'));

// 全局兜底错误边界：复用 SafeBoundary（B2）。局部模块（GlobeView / AiElf / StockPage
// 等懒加载 chunk）另有各自的 SafeBoundary 就近兜底；此处作为最后一道防线，避免任何
// 未被局部边界兜住的崩溃导致整页白屏，并以统一友好的「重新加载页面」卡片呈现。

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SafeBoundary name="应用">
      <BackgroundLayer />
      <NoiseLayer />
      <Suspense fallback={null}>
        <ParticleField />
      </Suspense>
      <App />
    </SafeBoundary>
  </React.StrictMode>
);
