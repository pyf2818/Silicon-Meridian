import React, { lazy, Suspense } from 'react';
import SafeBoundary from './components/SafeBoundary.jsx';
import { createRoot } from 'react-dom/client';
import './i18n/index.js'; // i18n 初始化（中英文双语支持，默认中文，可切换）
import App from './App.jsx';
import WindowControls from './components/WindowControls.jsx'; // Electron 桌面壳：自绘窗口控制按钮（浏览器环境渲染 null）
import CloseConfirmDialog from './components/CloseConfirmDialog.jsx'; // Electron 桌面壳：关闭确认对话框（浏览器环境渲染 null）
import './styles.css';
import './themes.css';
import './hud-theme.css';
import './polish.css';
import './studio-theme.css';
import './states.css'; // B1 统一空/错/加载态设计系统（在 studio-theme 之后，可被其覆盖）
import './intelligence-briefing.css';
import './onboarding.css'; // B2 首跑引导向导样式
import './entrance.css'; // 进场动画「水墨开卷」（在 motion.css 之前，复用其令牌）
import './motion.css'; // C1 统一微交互与动效令牌（最后引入，优先级最高）
import './settings.css'; // 墨仪·智控册页 设置设计系统（在 motion 之后，确保表层令牌覆盖）
import './globe-screen.css'; // v25 全球大屏（gs- 前缀独立作用域，始终深空场景）
import './community-theme.css'; // 社区改版 B2（广场频道壳，community- 前缀独立作用域）
import BackgroundLayer from './components/visual/BackgroundLayer.jsx';
import NoiseLayer from './components/visual/NoiseLayer.jsx';
import { initWorkspaceHandleWatch } from './utils/workspace.js';
// ParticleField 懒加载：首屏先显示背景与噪点，粒子稍后出现，不阻塞首屏
const ParticleField = lazy(() => import('./components/visual/ParticleField.jsx'));

// 启动即预恢复工作空间 rootHandle（权限仍 granted 的空间目录），并跟随空间切换。
// 让 agent 的读/写/改文件不依赖「工作空间面板是否被打开过」——刷新后直接进
// AI 工作站也不会报「未连接工作空间」。prompt 状态的权限仍由面板按钮接管。
initWorkspaceHandleWatch();

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
      <WindowControls />
      <CloseConfirmDialog />
      <App />
    </SafeBoundary>
  </React.StrictMode>
);
