// AiElf 左侧边栏 - 精灵信息 + 个人画像 + 历史会话（去 agent 化：仅精灵单例）
// 从 src/AiElf.jsx 抽离，纯展示组件

export default function Sidebar({
  avatarImage,
  activeAgent,
  activeAgentSessions,
  profile,
  agentHistory,
  setCurrentSessionId,
  setAgentMessages,
  setAgentHistory,
  onForkSession,
}) {
  // 历史会话：单键（ai-elf）
  const sessions = (agentHistory && agentHistory['ai-elf']) || [];

  const content = activeAgent?.id === 'ai-elf'
    ? '全站 AI 助理：快速问答 / 拖拽分析资讯·股票·代码·GitHub·任意知识'
    : (activeAgent?.description || '');

  // 精灵信息标签：能力不是职业
  const tags = ['快速问答', '拖拽分析', '联网搜索'];

  return (
    <div className="ai-elf-sidebar">
      {/* 精灵信息卡片 */}
      <div className="ai-elf-sidebar-agent-info">
        <img
          src={avatarImage || '/ai-elf-avatar.png'}
          alt={activeAgent?.name || 'AI精灵'}
          className="ai-elf-sidebar-avatar"
        />
        <div className="ai-elf-sidebar-agent-name">{activeAgent?.name || 'AI精灵'}</div>
        <div className="ai-elf-sidebar-agent-desc">{content}</div>
        <div className="ai-elf-sidebar-agent-tags">
          {tags.map(tag => (
            <span key={tag} className="ai-elf-sidebar-tag">{tag}</span>
          ))}
        </div>
        <div className="ai-elf-os-metrics">
          <div><strong>{activeAgentSessions}</strong><span>会话</span></div>
          <div><strong>{profile?.tracked?.length || 0}</strong><span>记忆</span></div>
          <div><strong>1</strong><span>助理</span></div>
        </div>
      </div>

      <div className="ai-elf-memory-panel">
        <div className="ai-elf-memory-title">个人画像</div>
        <div className="ai-elf-memory-line"><span>模式</span><strong>{profile.depth || '探索校准'}</strong></div>
        <div className="ai-elf-memory-line"><span>目标</span><strong>{profile.outputGoal || '阅读判断'}</strong></div>
        <div className="ai-elf-memory-tags">
          {(profile.focusLabels || []).slice(0, 3).map(label => <span key={label}>{label}</span>)}
          {!(profile.focusLabels || []).length && <span>待设置关注</span>}
        </div>
      </div>

      <div className="ai-elf-sidebar-header">
        <span>历史会话</span>
      </div>
      <div className="ai-elf-sidebar-content">
        {(!sessions || sessions.length === 0) ? (
          <div className="ai-elf-agent-history-empty">暂无历史记录</div>
        ) : (
          sessions.map(session => {
            const lastMessage = session.messages?.[session.messages.length - 1];
            const messageCount = session.messages?.length || 0;
            const lastMessagePreview = lastMessage?.content?.slice(0, 60) || '';

            return (
              <div
                key={session.id}
                className="ai-elf-agent-history-item"
                onClick={() => {
                  setCurrentSessionId(session.id);
                  setAgentMessages(prev => ({
                    ...prev,
                    'ai-elf': session.messages || []
                  }));
                }}
              >
                <div className="ai-elf-agent-history-item-title">{session.title || '会话'}</div>
                {lastMessagePreview && (
                  <div className="ai-elf-agent-history-item-preview">{lastMessagePreview}...</div>
                )}
                <div className="ai-elf-agent-history-item-meta">
                  <span>{new Date(session.timestamp || Date.now()).toLocaleDateString('zh-CN')}</span>
                  <span>{messageCount} 条消息</span>
                </div>
                {typeof onForkSession === 'function' && (
                  <button
                    className="ai-elf-agent-history-item-branch"
                    title="从当前消息处新建分支继续"
                    onClick={(e) => {
                      e.stopPropagation();
                      onForkSession(session);
                    }}
                  >
                    分支‖
                  </button>
                )}
                <button
                  className="ai-elf-agent-history-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAgentHistory(prev => ({
                      ...prev,
                      'ai-elf': (prev['ai-elf'] || []).filter(s => s.id !== session.id)
                    }));
                  }}
                >
                  删除
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}