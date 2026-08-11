import { selectToolSchemas } from '../../utils/agentTools.js';
import { buildContext, shouldCompact, estimateMessages, localSummary } from '../../session/contextManager.js';
import { rememberCompaction } from '../../utils/sessionMemory.js';

// 普通模式（无工具）上下文预算：超预算时中段本地摘要压缩，替代整段发送
const PLAIN_CONTEXT_BUDGET = 40_000;
const PLAIN_KEEP_RECENT = 15;

/**
 * AiElf 发送消息逻辑（从 AiElf.jsx 抽离）
 *
 * 负责：
 *  - 拼装用户消息（含引用上下文 / 拖拽资讯分析）
 *  - 路由 Agent Loop 模式 vs 普通模式
 *  - 调用 LLM 接口并落地 assistant 消息
 *  - 同步 session 历史（currentSessionId / agentHistory）
 *
 * 入参为 AiElf 内部的 state/setter 与派生值；返回 sendMessage 函数。
 */
export function useSendMessage({
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
  buildAgenticSystemPrompt,
  runElfAgentLoop,
}) {
  const sendMessage = async (text = inputText, itemData = null) => {
    if (!text.trim() && !itemData) return;

    const quotedContent = quotedContext?.fullContent || quotedContext?.content || '';
    let messageText = quotedContext
      ? `【引用上下文】\n${quotedContent}\n\n【用户问题】\n${text}`
      : text;

    if (itemData) {
      setIsLoading(true);
      const pageContent = await fetchPageContent(itemData.url);
      messageText = buildAnalysisPrompt(itemData, pageContent);
    }

    const newMessage = {
      role: 'user',
      content: text || `分析资讯：${itemData?.title || ''}`,
      timestamp: Date.now()
    };

    setAgentMessages(prev => ({
      ...prev,
      [activeAgentId]: [...(prev[activeAgentId] || []), newMessage]
    }));
    setInputText('');
    setQuotedContext(null);
    setIsLoading(true);

    try {
      if (!llmConfig.baseUrl || !llmConfig.selectedModel) {
        setAgentMessages(prev => ({
          ...prev,
          [activeAgentId]: [...(prev[activeAgentId] || []), {
            role: 'assistant',
            content: '请先在设置中配置大模型 API。',
            timestamp: Date.now()
          }]
        }));
        setIsLoading(false);
        return;
      }

      const systemPrompt = buildAgenticSystemPrompt;

      const currentMessages = agentMessages[activeAgentId] || [];

      // ===== Agent Loop 模式：当智能体配置了 tools 白名单时走工具调用循环 =====
      let toolSchemas = activeAgent?.tools?.length ? selectToolSchemas(activeAgent.tools) : null;
      // 联网搜索总开关：关闭时过滤掉 web_search，避免 LLM 调用消耗额度
      if (toolSchemas && llmConfig?.webSearchEnabled === false) {
        toolSchemas = toolSchemas.filter(s => s?.function?.name !== 'web_search');
        if (toolSchemas.length === 0) toolSchemas = null;
      }

      if (toolSchemas && toolSchemas.length > 0) {
        // 预先插入一条 placeholder assistant 消息，agent loop 会原地更新它
        const placeholderMsg = {
          role: 'assistant',
          content: '',
          toolCalls: [],
          loading: true,
          timestamp: Date.now()
        };
        setAgentMessages(prev => ({
          ...prev,
          [activeAgentId]: [...(prev[activeAgentId] || []), placeholderMsg]
        }));

        const baseConversation = [
          ...currentMessages.map(msg => ({ role: msg.role, content: msg.content })),
          { role: 'user', content: messageText }
        ];
        const finalAssistant = await runElfAgentLoop({
          activeAgentId,
          baseMessages: baseConversation,
          toolSchemas,
          systemPrompt,
          llmConfig,
        });

        // 用最终结果替换 placeholder，并保存到 session 历史
        setAgentMessages(prev => {
          const list = prev[activeAgentId] || [];
          const replaced = list.map((m, idx) => idx === list.length - 1 ? finalAssistant : m);
          const allMessages = { ...prev, [activeAgentId]: replaced };

          if (!currentSessionId) {
            const newSessionId = Date.now();
            setCurrentSessionId(newSessionId);
            const session = {
              id: newSessionId,
              title: newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : ''),
              timestamp: Date.now(),
              messages: replaced
            };
            setAgentHistory(history => {
              const sessions = Array.isArray(history[activeAgentId]) ? history[activeAgentId] : [];
              return { ...history, [activeAgentId]: [session, ...sessions].slice(0, 10) };
            });
          } else {
            setAgentHistory(history => {
              const sessions = Array.isArray(history[activeAgentId]) ? history[activeAgentId] : [];
              const updatedSessions = sessions.map(s =>
                s.id === currentSessionId
                  ? { ...s, messages: replaced, timestamp: Date.now(), title: newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : '') }
                  : s
              );
              return { ...history, [activeAgentId]: updatedSessions };
            });
          }
          return allMessages;
        });
      } else {
        // ===== 普通模式：无 tools，单次请求 =====
        // 上下文预算检查（对标 pi/compaction）：当前消息超预算时中段本地摘要压缩，
        // 替代全量发送导致上下文爆掉。本地摘要不额外调 LLM，失败自动回退。
        const plainHistory = currentMessages.slice(-40);
        let plainMessages;
        if (shouldCompact(plainHistory, PLAIN_CONTEXT_BUDGET)) {
          const packed = await buildContext(plainHistory, PLAIN_CONTEXT_BUDGET, {
            keepRecent: PLAIN_KEEP_RECENT,
            cutMin: 2,
            summaryText: localSummary(plainHistory.slice(1, Math.max(1, plainHistory.length - PLAIN_KEEP_RECENT))),
          });
          plainMessages = packed.compressed ? packed.messages : plainHistory.slice(-20);
          // 压缩是 lossy 的：沉淀为跨会话记忆（同会话去重）
          if (packed.compressed) {
            try { rememberCompaction(currentSessionId || activeAgentId, packed.summaryText || ''); } catch { /* silent */ }
          }
        } else {
          plainMessages = plainHistory.slice(-20);
        }
        if (estimateMessages(plainMessages) > PLAIN_CONTEXT_BUDGET) plainMessages = plainMessages.slice(-20);

        const response = await fetch('/api/ai-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            model: llmConfig.selectedModel,
            action: 'chat',
            content: messageText,
            systemPrompt,
            messages: plainMessages.map(msg => ({
              role: msg.role,
              content: msg.content
            }))
          })
        });

        const data = await response.json();
        if (data.error) {
          setAgentMessages(prev => ({
            ...prev,
            [activeAgentId]: [...(prev[activeAgentId] || []), {
              role: 'assistant',
              content: `分析失败: ${data.error}`,
              timestamp: Date.now()
            }]
          }));
        } else {
          setAgentMessages(prev => {
            const updatedMessages = [...(prev[activeAgentId] || []), {
              role: 'assistant',
              content: data.content || '暂无分析结果',
              timestamp: Date.now()
            }];

            const allMessages = {
              ...prev,
              [activeAgentId]: updatedMessages
            };

            // 保存对话历史到当前session
            if (!currentSessionId) {
              const newSessionId = Date.now();
              setCurrentSessionId(newSessionId);

              // 创建新session
              const session = {
                id: newSessionId,
                title: newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : ''),
                timestamp: Date.now(),
                messages: updatedMessages
              };
              setAgentHistory(history => {
                const sessions = Array.isArray(history[activeAgentId]) ? history[activeAgentId] : [];
                return {
                  ...history,
                  [activeAgentId]: [session, ...sessions].slice(0, 10)
                };
              });
            } else {
              // 更新现有session
              setAgentHistory(history => {
                const sessions = Array.isArray(history[activeAgentId]) ? history[activeAgentId] : [];
                const updatedSessions = sessions.map(s =>
                  s.id === currentSessionId
                    ? { ...s, messages: updatedMessages, timestamp: Date.now(), title: newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : '') }
                    : s
                );
                return {
                  ...history,
                  [activeAgentId]: updatedSessions
                };
              });
            }

            return allMessages;
          });
        }
      }
    } catch (e) {
      setAgentMessages(prev => ({
        ...prev,
        [activeAgentId]: [...(prev[activeAgentId] || []), {
          role: 'assistant',
          content: `分析失败: ${e.message}`,
          timestamp: Date.now()
        }]
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return sendMessage;
}
