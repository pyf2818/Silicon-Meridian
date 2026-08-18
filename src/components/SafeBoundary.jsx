import React, { Component } from 'react';

/**
 * SafeBoundary —— 局部错误边界（B2 错误边界友好降级）
 *
 * 用途：包裹一个可能崩溃的局部模块（懒加载 chunk 加载失败 / 渲染期异常），
 * 让单个模块出错时只在该模块区域内显示友好兜底卡片，而不是一路冒泡到
 * 全局 ErrorBoundary 导致整页白屏。
 *
 * 设计原则（与 B1 states.css 同源）：
 * - 错误 = 可操作（Actionable Error）：必须告诉用户"怎么办"。
 * - 复用 .app-state / .app-state--error 体系，随 12 套调色板统一迁移。
 * - chunk 加载失败（网络/版本更新）→ 主推「重新加载页面」（最可靠）。
 * - 运行期渲染异常（transient）→ 提供「再试一次」（重置 boundary 重挂载）。
 *
 * 注意：本组件为 class（React ErrorBoundary API 仅 class 可用），
 * 纯展示、零外部依赖，可在任意层级复用。
 */
function DefaultAlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

function isChunkLoadError(error) {
  const msg = (error && (error.message || String(error))) || '';
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|error loading dynamically imported module/i.test(msg);
}

class SafeBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const tag = this.props.name || 'module';
    // 仅记录，不阻断 UI；真实项目可在此接 Sentry 等上报
    console.error(`[SafeBoundary:${tag}]`, error, errorInfo);
  }

  handleReload = () => {
    try {
      window.location.reload();
    } catch {
      /* no-op */
    }
  };

  handleRetry = () => {
    // 重置 boundary：React 会重新挂载其下子树，transient 渲染错误可恢复
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const name = this.props.name || '该模块';
      const chunkErr = isChunkLoadError(this.state.error);
      const icon = this.props.icon || <DefaultAlertIcon />;

      return (
        <div className="app-state app-state--error" role="alert" aria-live="assertive">
          <div className="app-state__glyph">{icon}</div>
          <h3 className="app-state__title">{name}暂未就绪</h3>
          <p className="app-state__desc">
            {chunkErr ? (
              <>
                资源加载中断，可能是网络波动或刚完成了版本更新。
                <strong>重新加载即可恢复</strong>，你的素材、画像与历史都不会丢失。
              </>
            ) : (
              <>
                {name}在运行过程中出现了异常。你可以重试一次，或重新加载页面恢复。
              </>
            )}
          </p>
          <div className="app-state__actions">
            <button type="button" className="app-btn app-btn--primary" onClick={this.handleReload}>
              {chunkErr ? '重新加载页面' : '重新加载页面'}
            </button>
            {!chunkErr && (
              <button type="button" className="app-btn app-btn--ghost" onClick={this.handleRetry}>
                再试一次
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default SafeBoundary;
