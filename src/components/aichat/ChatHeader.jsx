// AiChatPanel 头部：logo + 标题 + 三按钮（折叠会话栏 / 角色设定 / 配置模型）
// 从 src/components/AiChatPanel.jsx 抽离，纯展示组件
import { ICONS } from '../../constants/appConstants.jsx';

export default function ChatHeader({
  variant,
  sessionCollapsed,
  setSessionCollapsed,
  agent,
  setShowPersonaDrawer,
  onOpenLlmConfig,
  onOpenGraph,
}) {
  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <div className="chat-logo" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 48 48" fill="none">
            {/* 外环：旋转 45° 的方框，几何科技感 */}
            <rect x="6" y="6" width="36" height="36" rx="3" stroke="var(--accent-cyan)" strokeWidth="1.4" opacity="0.35" transform="rotate(45 24 24)"/>
            {/* 中环：金色圆 */}
            <circle cx="24" cy="24" r="15" stroke="var(--accent-cyan)" strokeWidth="1.2" opacity="0.5"/>
            {/* 内部菱形核心：渐变填充 */}
            <path d="M24 13 L35 24 L24 35 L13 24 Z" fill="var(--accent-cyan)" opacity="0.18" stroke="var(--accent-cyan)" strokeWidth="1.4"/>
            {/* 中心四芒星：核心标识 */}
            <path d="M24 17 L26 24 L24 31 L22 24 Z" fill="var(--accent-cyan)" opacity="0.95"/>
            <path d="M17 24 L24 22 L31 24 L24 26 Z" fill="var(--accent-cyan)" opacity="0.7"/>
            {/* 四角节点：电路感 */}
            <circle cx="24" cy="6" r="1.4" fill="var(--accent-cyan)"/>
            <circle cx="42" cy="24" r="1.4" fill="var(--accent-cyan)"/>
            <circle cx="24" cy="42" r="1.4" fill="var(--accent-cyan)"/>
            <circle cx="6" cy="24" r="1.4" fill="var(--accent-cyan)"/>
          </svg>
        </div>
        <div className="chat-header-titles">
          <span className="chat-header-title">SiliconStream 智能体</span>
          <span className="chat-header-sub">对话 · 剖析 · 研判</span>
        </div>
      </div>
      <div className="chat-header-actions">
        {variant === 'main' && (
          <button className="chat-header-btn" onClick={() => setSessionCollapsed(v => !v)} title={sessionCollapsed ? '展开会话栏' : '收起会话栏'}>
            {ICONS.layers}
          </button>
        )}
        {onOpenGraph && (
          <button className="chat-header-btn" onClick={onOpenGraph} title="知识图谱">
            {ICONS.fork}
          </button>
        )}
        <button
          className="chat-header-btn chat-header-persona-btn"
          onClick={() => setShowPersonaDrawer(true)}
          title={`角色设定${agent ? `：${agent.name}` : ''}`}
          disabled={!agent}
        >
          {ICONS.user}
        </button>
        <button className="chat-header-btn" onClick={onOpenLlmConfig} title="配置模型">
          {ICONS.settings}
        </button>
      </div>
    </div>
  );
}
