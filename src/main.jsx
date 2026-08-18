import React, { lazy, Suspense } from 'react';
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
import BackgroundLayer from './components/visual/BackgroundLayer.jsx';
import NoiseLayer from './components/visual/NoiseLayer.jsx';
// ParticleField 懒加载：首屏先显示背景与噪点，粒子稍后出现，不阻塞首屏
const ParticleField = lazy(() => import('./components/visual/ParticleField.jsx'));

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('React ErrorBoundary:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: '#ff6b6b', fontFamily: 'monospace', background: '#0a0a0f', minHeight: '100vh' }}>
          <h2>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{this.state.error?.toString()}</pre>
          <details style={{ marginTop: 16 }}>
            <summary>Component Stack</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{this.state.errorInfo?.componentStack}</pre>
          </details>
          <p style={{ maxWidth: 720, color: '#cbd5e1', lineHeight: 1.6 }}>页面发生代码错误。重新加载不会删除素材、画像、推荐快照或智能体历史。</p>
          <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>重新加载页面</button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
