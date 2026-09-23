// AiElf 消息列表 + 任务面板 + 空状态 + 全局 loading 指示器
// 从 src/AiElf.jsx 抽离，纯展示组件

import { ActivityStream } from '../aichat/ToolCards.jsx';
import { renderMarkdown } from './markdown.js';

export default function MessageList({
  messages,
  avatarImage,
  activeAgent,
  isLoading,
  messagesEndRef,
  onContinueInWorkbench,
  setQuotedContext,
  setInputText,
  saveConversationToMaterials,
  elfName,
}) {
  return (
    <>
      {/* 空状态 */}
      {messages.length === 0 && (
        <div className="ai-elf-chat-empty">
          <img
            src={activeAgent?.avatar || avatarImage || '/ai-elf-avatar.png'}
            alt={activeAgent?.name}
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              objectFit: 'cover',
              marginBottom: 12
            }}
          />
          <p>{activeAgent?.name || 'AI精灵'}待命中</p>
          <p>{activeAgent?.description || '拖拽资讯卡片到此处'}</p>
          <p>我会结合你的关注、反馈和今日情报一起判断</p>
        </div>
      )}

      {messages.map((msg, index) => (
        <div key={index} className={`ai-elf-message ${msg.role}`}>
          <div className="ai-elf-message-avatar">
            {msg.role === 'user' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            ) : (
              <img
                src={activeAgent?.avatar || avatarImage || '/ai-elf-avatar.png'}
                alt="AI"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  objectFit: 'cover'
                }}
              />
            )}
          </div>
          <div className="ai-elf-message-content">
            {/* v35：Codex 式过程流（与工作站共用 ActivityStream）——完成后折叠摘要 */}
            <ActivityStream
              thinking={msg.loading && !msg.reasoning ? msg.thinking : ''}
              thinkingKind={msg.thinkingKind || ''}
              toolCalls={msg.toolCalls}
              loading={Boolean(msg.loading)}
            />
            {msg.content && (
              <div
                className="ai-elf-message-text"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
              />
            )}
            {msg.loading && !msg.toolCalls?.length && (
              <div className="ai-elf-message-loading">
                <span /><span /><span />
              </div>
            )}
            {msg.role === 'assistant' && !msg.loading && (
              <div className="ai-elf-message-actions">
                <button
                  className="ai-elf-action-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(msg.content).then(() => {
                      const btn = document.querySelector(`[data-copy-index="${index}"]`);
                      if (btn) btn.textContent = '已复制';
                      setTimeout(() => { if (btn) btn.textContent = '复制'; }, 2000);
                    });
                  }}
                  data-copy-index={index}
                  title="复制内容"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  复制
                </button>
                <button
                  className="ai-elf-action-btn"
                  onClick={() => {
                    setQuotedContext({
                      messageIndex: index,
                      content: msg.content.slice(0, 120) + (msg.content.length > 120 ? '...' : ''),
                      fullContent: msg.content
                    });
                    setInputText('');
                    document.querySelector('.ai-elf-chat-input')?.focus();
                  }}
                  title="引用此分析继续深入探讨"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                  继续深入
                </button>
                {onContinueInWorkbench && (
                  <button
                    className="ai-elf-action-btn"
                    onClick={() => saveConversationToMaterials('workbench', msg)}
                    title="存入工作站继续研究"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                      <path d="M4 4h16v16H4z" />
                      <path d="M8 9h8M8 13h5M15 16l3 3" />
                    </svg>
                    存入工作站
                  </button>
                )}
                </div>
            )}
            <div className="ai-elf-message-time">
              {new Date(msg.timestamp).toLocaleTimeString()}
              {msg.role === 'assistant' && msg.usage?.total_tokens != null && (
                <span className="ai-elf-msg-tokens" title="本次回复 token 用量"> · {msg.usage.total_tokens} tokens</span>
              )}
            </div>
          </div>
        </div>
      ))}
      {/* 全局 loading 指示器：仅当 messages 中没有正在 loading 的 placeholder 时显示
          （agent loop 模式下 placeholder 自带 loading 状态，避免双重指示器） */}
      {isLoading && !messages.some(m => m.loading) && (
        <div className="ai-elf-message assistant">
          <div className="ai-elf-message-avatar">
            <img
              src={activeAgent?.avatar || avatarImage || '/ai-elf-avatar.png'}
              alt="AI"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                objectFit: 'cover'
              }}
            />
          </div>
          <div className="ai-elf-message-content">
            <div className="ai-elf-message-loading">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </>
  );
}
