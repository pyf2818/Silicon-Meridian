import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  buildElfSystemPrompt,
  buildElfDropPrompt,
  ELF_DEFAULT_AGENT,
} from './constants/aielfDefaults.js';
import { runElfAgentLoop as runElfAgentLoopImpl } from './components/aielf/runElfAgentLoop.js';
import { useSendMessage } from './components/aielf/useSendMessage.js';
import MessageList from './components/aielf/MessageList.jsx';
import InputArea from './components/aielf/InputArea.jsx';
import { ICONS } from './constants/appConstants.jsx';
import { showToast } from './utils/toast.js';
import { useElfStore } from './store/elfStore.js';
import { fetchArticleContent, getDropSnapshotContent, saveDropSnapshot } from './utils/articleFetcher.js';

const MESSAGES_KEY = 'ai-elf-agent-messages';
const MAX_MESSAGES = 60;

function loadMessages() {
  try {
    const saved = localStorage.getItem(MESSAGES_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    // v14 简化后为单线程序列；兼容旧多会话对象 { 'ai-elf': [...] }
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed['ai-elf'])) return parsed['ai-elf'];
    if (Array.isArray(parsed['analyst'])) return parsed['analyst'];
    return [];
  } catch {
    return [];
  }
}

/**
 * AI 精灵（v14 极简化）—— 全站问答小助手
 *
 * 只做两件基础事：
 * ① 问答：产品使用操作、资料问题（保留工具白名单内的检索/校验，无多步编排）
 * ② 拖拽资讯卡片 → 即时分析
 * 分析结论可一键沉淀：存入素材库 / 交回 AI 工作站继续研究。
 *
 * v14 简化：移除多会话历史/分支 fork/侧栏会话列表/对话导出——
 * 单线程序话（本地持久化，超 60 条自动截断），界面只剩对话框本身。
 */
export default function AiElf({
  llmConfig,
  avatarImage,
  elfName,
  onExportToMaterials,
  onContinueInWorkbench,
  externalQuotedContext,
  intelligenceProfile,
  embedded = false,
}) {
  const [isOpen, setIsOpen] = useState(embedded);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [messages, setMessages] = useState(loadMessages);
  const [quotedContext, setQuotedContext] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const elfChatHistory = useElfStore(s => s.elfChatHistory);
  const setElfChatHistory = useElfStore(s => s.setElfChatHistory);

  const activeAgent = ELF_DEFAULT_AGENT;
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0, moved: false });
  const messagesEndRef = useRef(null);
  const AVATAR_SIZE = 56;

  // 精灵 system prompt：产品使用指南 + 用户画像 + 工具能力（纯函数构造）
  const systemPrompt = useMemo(() => buildElfSystemPrompt(intelligenceProfile || {}), [intelligenceProfile]);

  useEffect(() => {
    if (!externalQuotedContext) return;
    setQuotedContext({
      title: externalQuotedContext.title || '外部上下文',
      content: externalQuotedContext.content || '',
      fullContent: externalQuotedContext.fullContent || externalQuotedContext.content || '',
    });
    if (externalQuotedContext.suggestedPrompt) setInputText(externalQuotedContext.suggestedPrompt);
    setIsOpen(true);
  }, [externalQuotedContext?.id]);

  // 初始化位置 - 右下角
  useEffect(() => {
    const updatePosition = () => {
      const margin = 20;
      setPosition({
        x: window.innerWidth - AVATAR_SIZE - margin,
        y: window.innerHeight - AVATAR_SIZE - margin,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, []);

  // 消息持久化（超上限自动截断最旧的）
  useEffect(() => {
    try {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch { /* 配额满忽略 */ }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 悬浮球拖动 + 点击开合
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      initialX: position.x, initialY: position.y, moved: false,
    };
  }, [position]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && Math.hypot(dx, dy) > 5) dragRef.current.moved = true;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - AVATAR_SIZE, dragRef.current.initialX + dx)),
      y: Math.max(0, Math.min(window.innerHeight - AVATAR_SIZE, dragRef.current.initialY + dy)),
    });
  }, [isDragging]);

  const handleAvatarClick = useCallback(() => {
    if (dragRef.current.moved) return;
    setIsOpen(prev => !prev);
  }, []);

  useEffect(() => {
    if (!isDragging) return undefined;
    const onMove = (e) => handleMouseMove(e);
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, handleMouseMove]);

  // 获取网页内容（拖拽链接卡片时补全原文）
  // 三层稳定连接：内存缓存（fetchArticleContent）→ 历史拖拽快照 → null
  const fetchPageContent = async (url) => {
    const content = await fetchArticleContent(url);
    if (content) return content;
    return getDropSnapshotContent(url);
  };

  const runElfAgentLoop = useCallback(async ({ baseMessages, toolSchemas, systemPrompt: sp }) => {
    return runElfAgentLoopImpl({
      activeAgentId: activeAgent.id, baseMessages, toolSchemas, systemPrompt: sp,
      llmConfig, setAgentMessages: setMessages,
    });
  }, [llmConfig, llmConfig?.selectedModel, activeAgent.id]);

  const sendMessage = useSendMessage({
    inputText,
    quotedContext,
    llmConfig,
    agentTools: activeAgent.tools,
    systemPrompt,
    messages,
    setMessages,
    setIsLoading,
    setInputText,
    setQuotedContext,
    fetchPageContent,
    buildAnalysisPrompt: buildElfDropPrompt,
    runElfAgentLoop,
  });

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const itemData = e.dataTransfer.getData('application/json');
    if (!itemData) return;
    try {
      const item = JSON.parse(itemData);
      // 落盘初始快照：即使本次全文抓取失败，快照也保证这条资讯有稳定引用
      if (item?.url) {
        saveDropSnapshot(item.url, {
          title: item.title || '',
          summary: item.summary || '',
          source: item.source || '',
          url: item.url,
          content: item.summary || '',
          fullContent: item.fullContent || item.summary || '',
        });
      }
      if (!isOpen) setIsOpen(true);
      sendMessage('', item);
    } catch (err) {
      console.error('解析拖拽数据失败:', err);
    }
  };

  /* ---- 聊天记录：保存当前对话 / 恢复 / 删除 ---- */
  const saveChatSession = () => {
    const meaningful = messages.filter(m => m.content || m.toolCalls?.length);
    if (!meaningful.length) { showToast('当前没有可保存的对话'); return; }
    const firstUser = meaningful.find(m => m.role === 'user');
    const session = {
      id: `elf-chat-${Date.now().toString(36)}`,
      title: String(firstUser?.content || meaningful[0]?.content || '精灵对话').replace(/\s+/g, ' ').slice(0, 40),
      savedAt: new Date().toISOString(),
      messages: meaningful.slice(-60),
    };
    setElfChatHistory(prev => [session, ...prev.filter(s => s.id !== session.id)].slice(0, 30));
    showToast('已保存到聊天记录');
  };

  const restoreChatSession = (session) => {
    if (messages.length && !window.confirm('恢复该记录会覆盖当前对话，继续？')) return;
    setMessages(Array.isArray(session.messages) ? session.messages : []);
    setShowHistory(false);
    showToast('已恢复聊天记录');
  };

  const deleteChatSession = (id) => {
    setElfChatHistory(prev => prev.filter(s => s.id !== id));
  };

  // 分析结论沉淀：存素材库 / 交回工作站（基础交接能力，保留）
  const buildConversationMaterial = (mode = 'archive', sourceMessage = null) => {
    const latestAssistant = sourceMessage || [...messages].reverse().find(m => m.role === 'assistant');
    const firstUserMessage = messages.find(m => m.role === 'user');
    const titleBase = firstUserMessage?.content || latestAssistant?.content || `${elfName || 'AI精灵'}分析`;
    const conversationText = (sourceMessage ? [sourceMessage] : messages).map(m => {
      const role = m.role === 'user' ? '用户' : (elfName || 'AI精灵');
      return `## ${role} / ${new Date(m.timestamp || Date.now()).toLocaleString('zh-CN')}\n\n${m.content}`;
    }).join('\n\n---\n\n');
    const fullContent = [
      `# ${String(titleBase).slice(0, 80)}`,
      `- 来源：${elfName || 'AI精灵'}`,
      `- 保存时间：${new Date().toLocaleString('zh-CN')}`,
      `\n## 对话分析\n\n${conversationText || '暂无对话内容'}`,
    ].join('\n');
    return {
      title: `AI分析：${String(titleBase).replace(/\s+/g, ' ').slice(0, 60)}`,
      content: latestAssistant?.content || conversationText || titleBase,
      fullContent,
      type: 'viewpoint',
      source: elfName || 'AI精灵',
      url: '',
      tags: ['AI精灵', 'AI工作站'],
      note: mode === 'workbench' ? '由 AI 精灵保存，可在 AI 工作站继续研究。' : '由 AI 精灵保存的分析素材。',
      metadata: { origin: 'ai-elf', messageCount: messages.length, savedMode: mode },
    };
  };

  const saveConversation = (mode) => {
    const payload = buildConversationMaterial(mode);
    if (mode === 'workbench') onContinueInWorkbench?.(payload);
    else onExportToMaterials?.(payload);
  };

  const clearConversation = () => {
    if (!messages.length || window.confirm('清空当前对话？')) setMessages([]);
  };

  // 计算聊天窗口位置（跟随精灵）
  const getWindowPosition = () => {
    const chatWidth = 520;
    const chatHeight = 560;
    let left = position.x - chatWidth + AVATAR_SIZE;
    let top = position.y - chatHeight;
    if (left < 10) left = 10;
    if (left + chatWidth > window.innerWidth - 10) left = window.innerWidth - chatWidth - 10;
    if (top < 10) top = position.y + AVATAR_SIZE + 10;
    if (top + chatHeight > window.innerHeight - 10) top = window.innerHeight - chatHeight - 10;
    return { left, top };
  };

  if (embedded) {
    return (
      <div className="ai-elf-chat-window" style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div className="ai-elf-main">
          <MessageList
            messages={messages}
            avatarImage={avatarImage}
            activeAgent={activeAgent}
            isLoading={isLoading}
            messagesEndRef={messagesEndRef}
            onContinueInWorkbench={onContinueInWorkbench}
            setQuotedContext={setQuotedContext}
            setInputText={setInputText}
            saveConversationToMaterials={saveConversation}
            elfName={elfName}
          />
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
    );
  }

  const windowPos = getWindowPosition();

  return (
    <>
      {/* 悬浮球 */}
      <div
        className={`ai-elf-avatar ${isDragging ? 'dragging' : ''} ${isOpen ? 'active' : ''}`}
        style={{
          position: 'fixed', left: position.x, top: position.y,
          zIndex: 9999, cursor: isDragging ? 'grabbing' : 'grab',
          width: AVATAR_SIZE, height: AVATAR_SIZE,
        }}
        onMouseDown={handleMouseDown}
        onClick={handleAvatarClick}
        title="AI 精灵（点击打开 / 拖动移动）"
      >
        <img
          src={avatarImage || '/ai-elf-avatar.png'}
          alt="AI精灵"
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(167, 139, 250, 0.5)' }}
        />
        <div className="ai-elf-avatar-pulse" />
      </div>

      {/* 聊天窗口（单栏：头部 + 消息流 + 输入框） */}
      {isOpen && (
        <div
          className={`ai-elf-chat-window ${isDragOver ? 'drag-over' : ''}`}
          style={{
            position: 'fixed', left: windowPos.left, top: windowPos.top,
            width: 520, maxWidth: 'calc(100vw - 40px)',
            height: 560, maxHeight: 'calc(100vh - 100px)', zIndex: 9998,
          }}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <header className="ai-elf-header">
            <img className="ai-elf-header-avatar" src={avatarImage || '/ai-elf-avatar.png'} alt="" />
            <div className="ai-elf-header-info">
              <b>{elfName || 'AI 精灵'}</b>
              <small>问答 · 拖卡片分析</small>
            </div>
            <span className="ai-elf-header-space" style={{ flex: 1 }} />
            <button type="button" className={`ai-elf-btn ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory(v => !v)} title="聊天记录">{ICONS.clock || '◔'}</button>
            <button type="button" className="ai-elf-btn" onClick={clearConversation} title="清空对话，开始新话题">{ICONS.refresh || '⟲'}</button>
            <button type="button" className="ai-elf-btn" onClick={() => saveConversation('workbench')} title="保存到 AI 工作站继续研究">{ICONS.cpu || '⇱'}</button>
            <button type="button" className="ai-elf-btn" onClick={() => saveConversation('archive')} title="保存到素材库">{ICONS.bookmark || '★'}</button>
            <button type="button" className="ai-elf-btn" onClick={() => setIsOpen(false)} title="收起">{ICONS.x || '×'}</button>
          </header>

          {showHistory && (
            <div className="ai-elf-history">
              <div className="ai-elf-history-head">
                <span>聊天记录（{elfChatHistory.length}）</span>
                <button type="button" onClick={saveChatSession}>＋ 保存当前对话</button>
              </div>
              <div className="ai-elf-history-list custom-scrollbar">
                {elfChatHistory.length === 0 && <p className="ai-elf-history-empty">还没有保存过对话。聊完后点「保存当前对话」，记录会留在本地。</p>}
                {elfChatHistory.map(session => (
                  <div key={session.id} className="ai-elf-history-item">
                    <button type="button" className="ai-elf-history-main" onClick={() => restoreChatSession(session)} title="点击恢复该对话">
                      <b>{session.title}</b>
                      <small>{new Date(session.savedAt).toLocaleString('zh-CN')} · {session.messages?.length || 0} 条</small>
                    </button>
                    <button type="button" className="ai-elf-history-del" onClick={() => deleteChatSession(session.id)} title="删除">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
              saveConversationToMaterials={saveConversation}
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
      )}
    </>
  );
}
