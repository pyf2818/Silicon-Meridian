import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getRootHandle } from './utils/workspaceHandleStore.js';
import {
  buildElfSystemPrompt,
  buildElfDropPrompt,
  ELF_DEFAULT_AGENT,
} from './constants/aielfDefaults.js';
import { runElfAgentLoop as runElfAgentLoopImpl } from './components/aielf/runElfAgentLoop.js';
import { useSendMessage } from './components/aielf/useSendMessage.js';
import { useTrailBranches } from './hooks/useTrailBranches.js';
import Sidebar from './components/aielf/Sidebar.jsx';
import ChatHeader from './components/aielf/ChatHeader.jsx';
import MessageList from './components/aielf/MessageList.jsx';
import InputArea from './components/aielf/InputArea.jsx';

// AI精灵助手组件 - 全站轻量 AI 助理（方案 A：去 agent 化，单例）
// embedded=true 时以全屏工作站模式渲染（无悬浮按钮、强制展开、占满父容器）
export default function AiElf({ llmConfig, avatarImage, elfName, onExportToMaterials, onContinueInWorkbench, externalQuotedContext, intelligenceProfile, embedded = false }) {
  const [isOpen, setIsOpen] = useState(embedded);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedConcern, setExpandedConcern] = useState(null);

  // 精灵是单例：固定 agent 配置（不再来自 agents 生态）
  const activeAgent = ELF_DEFAULT_AGENT;
  const activeAgentId = activeAgent.id;

  // 按「会话类型」保存消息（历史保留，但键从 agentId 收敛为精灵单键）
  const [agentMessages, setAgentMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('ai-elf-agent-messages');
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      // 兼容旧的多 agent 存储：优先取 ai-elf；旧 analyst 数据迁移到 ai-elf
      if (parsed['ai-elf']) return { 'ai-elf': parsed['ai-elf'] };
      const migrated = parsed['analyst'] ? parsed['analyst'] : [];
      return { 'ai-elf': migrated };
    } catch {
      return {};
    }
  });

  // 历史会话（收敛为 ai-elf 单键）
  const [agentHistory, setAgentHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('ai-elf-agent-history');
      if (!saved) return {};
      const history = JSON.parse(saved);
      const sessions = Array.isArray(history['ai-elf'])
        ? history['ai-elf']
        : (Array.isArray(history['analyst']) ? history['analyst'] : []);
      return { 'ai-elf': sessions };
    } catch {
      return {};
    }
  });

  // 当前会话ID（用于追踪当前对话窗口）
  const [currentSessionId, setCurrentSessionId] = useState(null);

  // 引用上下文（用于多轮对话时引用之前的消息）
  const [quotedContext, setQuotedContext] = useState(null);

  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const messagesEndRef = useRef(null);
  const chatWindowRef = useRef(null);

  const AVATAR_SIZE = 56;

  // 当前精灵的消息（key 固定为 ai-elf 单键）
  const messages = agentMessages[activeAgentId] || [];

  // 历史会话分叉（对标 pi /tree + fork）：从一条历史消息开新分支
  const { forkSession } = useTrailBranches();

  // 从某个历史会话 fork 出一条新分支会话并置为当前
  const handleForkSession = useCallback((session, anchorMessageId = null) => {
    if (!session) return;
    const branchSessionId = Date.now();
    const { messages: branchTrail } = forkSession(session, { anchorMessageId });
    const newSession = {
      id: branchSessionId,
      title: (session.title || '会话') + ' · 分支',
      timestamp: Date.now(),
      messages: branchTrail,
    };
    setCurrentSessionId(branchSessionId);
    setAgentMessages(prev => ({ ...prev, [activeAgentId]: branchTrail }));
    setAgentHistory(prev => {
      const list = Array.isArray(prev[activeAgentId]) ? prev[activeAgentId] : [];
      return { ...prev, [activeAgentId]: [newSession, ...list].slice(0, 12) };
    });
  }, [activeAgentId, forkSession]);

  // 当前精灵的历史记录（多个对话窗口）
  const historySessions = agentHistory[activeAgentId] || [];

  const profile = intelligenceProfile || {};
  const activeAgentSessions = historySessions.length;

  // 精灵 system prompt：材料自识别 + 用户画像 + 工具能力（纯函数构造）
  const buildElfSystem = useMemo(
    () => buildElfSystemPrompt(profile),
    [activeAgentId, profile]
  );

  useEffect(() => {
    if (!externalQuotedContext) return;
    setQuotedContext({
      title: externalQuotedContext.title || '外部上下文',
      content: externalQuotedContext.content || ''
    });
    if (externalQuotedContext.suggestedPrompt) {
      setInputText(externalQuotedContext.suggestedPrompt);
    }
    setIsOpen(true);
  }, [externalQuotedContext?.id]);

  // 拖拽分析 Prompt：内容自识别（不再按 8 个 agent 模板）
  const buildAnalysisPrompt = (itemData, pageContent) =>
    buildElfDropPrompt(itemData, pageContent);

  // 初始化位置 - 右下角
  useEffect(() => {
    const updatePosition = () => {
      const margin = 20;
      setPosition({
        x: window.innerWidth - AVATAR_SIZE - margin,
        y: window.innerHeight - AVATAR_SIZE - margin
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, []);

  // 保存消息历史（带大小限制和错误处理）
  useEffect(() => {
    try {
      const MAX_MESSAGES_PER_AGENT = 50;
      const trimmed = {};
      Object.keys(agentMessages).forEach(key => {
        const msgs = agentMessages[key] || [];
        if (msgs.length > MAX_MESSAGES_PER_AGENT) {
          trimmed[key] = msgs.slice(-MAX_MESSAGES_PER_AGENT);
        } else {
          trimmed[key] = msgs;
        }
      });
      localStorage.setItem('ai-elf-agent-messages', JSON.stringify(trimmed));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded for ai-elf-agent-messages');
      }
    }
  }, [agentMessages]);

  // 保存历史会话（带大小限制和错误处理）
  // 切换Agent时自动加载最近的历史会话
  useEffect(() => {
    const sessions = agentHistory[activeAgentId] || [];
    const validSessions = Array.isArray(sessions) ? sessions : [];
    
    if (validSessions.length > 0) {
      // 加载最近的历史会话
      const recentSession = validSessions[0];
      setCurrentSessionId(recentSession.id);
      setAgentMessages(prev => ({
        ...prev,
        [activeAgentId]: recentSession.messages || []
      }));
    } else {
      // 没有历史会话，清空
      setCurrentSessionId(null);
      setAgentMessages(prev => ({
        ...prev,
        [activeAgentId]: []
      }));
    }
  }, [activeAgentId, agentHistory]);

  // 保存历史会话（带大小限制和错误处理）
  useEffect(() => {
    try {
      const MAX_HISTORY_PER_AGENT = 10;
      const trimmed = {};
      Object.keys(agentHistory).forEach(key => {
        const sessions = agentHistory[key] || [];
        const validSessions = Array.isArray(sessions) ? sessions : [];
        if (validSessions.length > MAX_HISTORY_PER_AGENT) {
          trimmed[key] = validSessions.slice(0, MAX_HISTORY_PER_AGENT);
        } else {
          trimmed[key] = validSessions;
        }
      });
      localStorage.setItem('ai-elf-agent-history', JSON.stringify(trimmed));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded for ai-elf-agent-history');
      }
    }
  }, [agentHistory]);

  // 滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 计算聊天窗口位置（跟随精灵）
  const getWindowPosition = () => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const chatWidth = showSidebar ? 720 : 520;
    const chatHeight = 560;

    let left = position.x - chatWidth + AVATAR_SIZE;
    let top = position.y - chatHeight;

    if (left < 10) left = 10;
    if (left + chatWidth > windowWidth - 10) left = windowWidth - chatWidth - 10;
    if (top < 10) top = position.y + AVATAR_SIZE + 10;
    if (top + chatHeight > windowHeight - 10) top = windowHeight - chatHeight - 10;

    return { left, top };
  };

  // 拖拽开始
  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.ai-elf-chat-window') || e.target.closest('.ai-elf-chat-input')) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
      moved: false, // 移动距离超过阈值才视为真正拖拽，避免误触发点击
    };
  }, [position]);

  // 拖拽移动
  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // 移动超过 5px 才标记为真拖拽，避免微小抖动被误判
    if (!dragRef.current.moved && Math.hypot(dx, dy) > 5) dragRef.current.moved = true;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - AVATAR_SIZE, dragRef.current.initialX + dx)),
      y: Math.max(0, Math.min(window.innerHeight - AVATAR_SIZE, dragRef.current.initialY + dy))
    });
  }, [isDragging]);

  // 拖拽结束
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 点击切换：仅在未真正拖拽时触发
  const handleAvatarClick = useCallback(() => {
    if (dragRef.current.moved) return; // 真拖拽过则不切换 isOpen
    setIsOpen(prev => !prev);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // 获取网页内容
  const fetchPageContent = async (url) => {
    try {
      const response = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.content;
    } catch {
      return null;
    }
  };

  // ===== Agent Loop：工具调用循环（已抽离至 components/aielf/runElfAgentLoop.js） =====
  // 流程：发请求 → 若返回 tool_calls 则执行工具并把结果回灌 → 重新请求，直到无 tool_calls 或达到最大轮数
  // 原地更新末尾的 placeholder assistant 消息（content + toolCalls + thinking）
  const runElfAgentLoop = useCallback(async ({ activeAgentId, baseMessages, toolSchemas, systemPrompt }) => {
    return runElfAgentLoopImpl({
      activeAgentId, baseMessages, toolSchemas, systemPrompt,
      llmConfig, setAgentMessages,
    });
  }, [llmConfig, llmConfig?.selectedModel, setAgentMessages]);

  // 发送消息给AI（已抽离至 components/aielf/useSendMessage.js）
  const sendMessage = useSendMessage({
    inputText,
    quotedContext,
    llmConfig,
    activeAgent,
    activeAgentId,
    agentMessages,
    currentSessionId,
    setIsLoading,
    setAgentMessages,
    setInputText,
    setQuotedContext,
    setCurrentSessionId,
    setAgentHistory,
    fetchPageContent,
    buildAnalysisPrompt,
    buildElfSystem,
    runElfAgentLoop,
  });

  // 拖拽处理
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const itemData = e.dataTransfer.getData('application/json');
    if (itemData) {
      try {
        const item = JSON.parse(itemData);
        if (!isOpen) setIsOpen(true);
        sendMessage('', item);
      } catch (err) {
        console.error('解析拖拽数据失败:', err);
      }
    }
  };

  // 导出对话到本地
  const exportConversation = () => {
    const content = messages.map(msg => {
      const role = msg.role === 'user' ? '用户' : (elfName || 'AI精灵');
      const time = new Date(msg.timestamp).toLocaleString();
      return `[${time}] ${role}:\n${msg.content}\n`;
    }).join('\n---\n\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${elfName || 'AI精灵'}对话_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildConversationMaterial = (mode = 'archive', sourceMessage = null) => {
    const selectedMessages = sourceMessage ? [sourceMessage] : messages;
    const firstUserMessage = messages.find(message => message.role === 'user');
    const latestAssistant = sourceMessage || [...messages].reverse().find(message => message.role === 'assistant');
    const titleBase = firstUserMessage?.content || latestAssistant?.content || `${elfName || 'AI精灵'}研究记录`;
    const quotedTitle = quotedContext?.title || '';
    const contextText = quotedContext?.fullContent || quotedContext?.content || '';
    const conversationText = selectedMessages.map(message => {
      const role = message.role === 'user' ? '用户' : (activeAgent?.name || elfName || 'AI精灵');
      const time = new Date(message.timestamp || Date.now()).toLocaleString('zh-CN');
      return `## ${role} / ${time}\n\n${message.content}`;
    }).join('\n\n---\n\n');

    const fullContent = [
      `# ${String(titleBase).slice(0, 80)}`,
      `- 来源：${elfName || 'AI精灵'} / ${activeAgent?.name || 'Agent'}`,
      `- 保存模式：${mode === 'workbench' ? '工作站继续研究' : '素材归档'}`,
      `- 保存时间：${new Date().toLocaleString('zh-CN')}`,
      quotedTitle ? `- 引用上下文：${quotedTitle}` : '',
      contextText ? `\n## 引用上下文\n\n${contextText}` : '',
      `\n## 对话分析\n\n${conversationText || '暂无对话内容'}`,
      `\n## 建议下一步\n\n- 在 AI 工作站中结合素材库继续追问\n- 补充原文、数据或反方证据\n- 将稳定结论沉淀为文章或研究清单`,
    ].filter(Boolean).join('\n');

    return {
      title: `AI研究：${String(titleBase).replace(/\s+/g, ' ').slice(0, 60)}`,
      content: latestAssistant?.content || conversationText || contextText || titleBase,
      fullContent,
      type: 'viewpoint',
      source: `${elfName || 'AI精灵'} / ${activeAgent?.name || 'Agent'}`,
      url: '',
      tags: ['AI精灵', 'AI工作站', '研究记录', activeAgent?.name].filter(Boolean),
      note: mode === 'workbench' ? '由 AI 精灵保存，可在 AI 工作站继续研究。' : '由 AI 精灵保存的分析素材。',
      metadata: {
        origin: 'ai-elf',
        agentId: activeAgentId,
        agentName: activeAgent?.name || '',
        sessionId: currentSessionId,
        quotedTitle,
        messageCount: messages.length,
        savedMode: mode,
      },
    };
  };

  const saveConversationToMaterials = (mode = 'archive', sourceMessage = null) => {
    const payload = buildConversationMaterial(mode, sourceMessage);
    if (mode === 'workbench') {
      onContinueInWorkbench && onContinueInWorkbench(payload);
      return;
    }
    if (!onExportToMaterials) return;
    onExportToMaterials(payload);
  };

  // 保存当前会话到历史
  // 加载历史会话
  const loadSession = (session) => {
    setCurrentSessionId(session.id);
    setAgentMessages(prev => ({
      ...prev,
      [activeAgentId]: session.messages
    }));
  };

  // 删除历史会话
  const deleteSession = (id, e) => {
    e.stopPropagation();
    setAgentHistory(prev => ({
      ...prev,
      [activeAgentId]: (prev[activeAgentId] || []).filter(s => s.id !== id)
    }));
  };

// 清空当前Agent对话
  const clearConversation = () => {
    const newSessionId = Date.now();
    const newSession = {
      id: newSessionId,
      title: '新对话',
      timestamp: Date.now(),
      messages: []
    };

    // 如果当前session有消息，保存当前session到历史记录
    if (messages.length > 0 && currentSessionId) {
      const session = {
        id: currentSessionId,
        title: messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? '...' : ''),
        timestamp: Date.now(),
        messages: messages
      };
      setAgentHistory(prev => {
        const sessions = Array.isArray(prev[activeAgentId]) ? prev[activeAgentId] : [];
        return {
          ...prev,
          [activeAgentId]: [newSession, session, ...sessions.filter(s => s.id !== currentSessionId)].slice(0, 10)
        };
      });
    } else {
      // 如果当前session没有消息，直接添加新的空session
      setAgentHistory(prev => {
        const sessions = Array.isArray(prev[activeAgentId]) ? prev[activeAgentId] : [];
        return {
          ...prev,
          [activeAgentId]: [newSession, ...sessions].slice(0, 10)
        };
      });
    }
    
    // 切换到新的session
    setCurrentSessionId(newSessionId);
    setAgentMessages(prev => ({
      ...prev,
      [activeAgentId]: []
    }));
  };

  // renderMarkdown / markdown helpers / tool-call card 已抽离至 components/aielf/
  const windowPos = getWindowPosition();

  return (
    <>
      {/* AI精灵悬浮按钮 */}
      <div
        className={`ai-elf-avatar ${isDragging ? 'dragging' : ''} ${isOpen ? 'active' : ''}`}
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 9999,
          cursor: isDragging ? 'grabbing' : 'grab',
          width: AVATAR_SIZE,
          height: AVATAR_SIZE
        }}
        onMouseDown={handleMouseDown}
        onClick={handleAvatarClick}
        title="AI精灵助手（点击打开 / 拖动移动）"
      >
        <img
          src={avatarImage || '/ai-elf-avatar.png'}
          alt="AI精灵"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            objectFit: 'cover',
            border: '2px solid rgba(167, 139, 250, 0.5)'
          }}
        />
        <div className="ai-elf-avatar-pulse" />
      </div>

      {/* AI精灵聊天窗口 */}
      {isOpen && (
        <div
          ref={chatWindowRef}
          className={`ai-elf-chat-window ${isDragOver ? 'drag-over' : ''}`}
          style={{
            position: 'fixed',
            left: windowPos.left,
            top: windowPos.top,
            width: showSidebar ? 720 : 520,
            maxWidth: 'calc(100vw - 40px)',
            height: 560,
            maxHeight: 'calc(100vh - 100px)',
            zIndex: 9998
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 左侧边栏 - 精灵信息 + 历史会话（去 agent 化：仅精灵单例 + 会话列表） */}
          {showSidebar && (
            <Sidebar
              avatarImage={avatarImage}
              activeAgent={activeAgent}
              activeAgentSessions={activeAgentSessions}
              profile={profile}
              agentHistory={agentHistory}
              setCurrentSessionId={setCurrentSessionId}
              setAgentMessages={setAgentMessages}
              setAgentHistory={setAgentHistory}
              onForkSession={handleForkSession}
            />
          )}

          {/* 右侧主区域 */}
          <div className="ai-elf-main">
            <ChatHeader
              showSidebar={showSidebar}
              setShowSidebar={setShowSidebar}
              activeAgent={activeAgent}
              avatarImage={avatarImage}
              elfName={elfName}
              clearConversation={clearConversation}
              exportConversation={exportConversation}
              onContinueInWorkbench={onContinueInWorkbench}
              onExportToMaterials={onExportToMaterials}
              saveConversationToMaterials={saveConversationToMaterials}
              setIsOpen={setIsOpen}
            />

            {/* 聊天内容区域 */}
            <div className="ai-elf-chat-body">
              <MessageList
                messages={messages}
                avatarImage={avatarImage}
                activeAgent={activeAgent}
                isLoading={isLoading}
                messagesEndRef={messagesEndRef}
                onContinueInWorkbench={onContinueInWorkbench}
                setQuotedContext={setQuotedContext}
                setInputText={setInputText}
                saveConversationToMaterials={saveConversationToMaterials}
                elfName={elfName}
              />
            </div>

            <InputArea
              quotedContext={quotedContext}
              setQuotedContext={setQuotedContext}
              inputText={inputText}
              setInputText={setInputText}
              sendMessage={sendMessage}
              activeAgent={activeAgent}
              isLoading={isLoading}
            />
          </div>
        </div>
      )}
    </>
  );
}
