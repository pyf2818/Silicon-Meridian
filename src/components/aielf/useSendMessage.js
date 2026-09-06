import { selectToolSchemas } from '../../utils/agentTools.js';
import { buildContext, shouldCompact, estimateMessages, localSummary } from '../../session/contextManager.js';
import { saveDropSnapshot } from '../../utils/articleFetcher.js';

// 普通模式（无工具）上下文预算：超预算时中段本地摘要压缩，替代整段发送
const PLAIN_CONTEXT_BUDGET = 40_000;
const PLAIN_KEEP_RECENT = 15;

/**
 * AI 精灵发送消息逻辑（v14 简化：单线程会话，无多会话历史）
 *
 * 负责：
 *  - 拼装用户消息（含引用上下文 / 拖拽资讯分析）
 *  - 路由：有工具白名单 → 工具调用循环；否则单次请求（超预算本地压缩）
 *  - 以扁平消息数组落地 assistant 回复（持久化由 AiElf 统一处理）
 */
export function useSendMessage({
  inputText,
  quotedContext,
  llmConfig,
  agentTools,        // 精灵工具白名单（ELF_DEFAULT_AGENT.tools）
  systemPrompt,
  messages,
  setMessages,
  setIsLoading,
  setInputText,
  setQuotedContext,
  fetchPageContent,
  buildAnalysisPrompt,
  runElfAgentLoop,
}) {
  const appendMessage = (msg) => setMessages(prev => [...prev, msg]);

  const sendMessage = async (text = inputText, itemData = null) => {
    if (!text.trim() && !itemData) return;

    const quotedContent = quotedContext?.fullContent || quotedContext?.content || '';
    let messageText = quotedContext
      ? `【引用上下文】\n${quotedContent}\n\n【用户问题】\n${text}`
      : text;

    if (itemData) {
      setIsLoading(true);
      const pageContent = await fetchPageContent(itemData.url);
      // 拖拽快照持久化：抓到全文就存下来，之后资讯池刷新/换会话都能稳定引用
      if (itemData.url) {
        saveDropSnapshot(itemData.url, {
          title: itemData.title || '',
          summary: itemData.summary || '',
          source: itemData.source || '',
          url: itemData.url,
          content: itemData.summary || '',
          fullContent: pageContent || itemData.fullContent || itemData.summary || '',
        });
      }
      messageText = buildAnalysisPrompt(itemData, pageContent);
    }

    appendMessage({
      role: 'user',
      content: text || `分析资讯：${itemData?.title || ''}`,
      timestamp: Date.now(),
    });
    setInputText('');
    setQuotedContext(null);
    setIsLoading(true);

    try {
      if (!llmConfig.baseUrl || !llmConfig.selectedModel) {
        appendMessage({ role: 'assistant', content: '请先在设置中配置大模型 API。', timestamp: Date.now() });
        setIsLoading(false);
        return;
      }

      // 工具白名单：有则走工具调用循环；联网总开关关闭时过滤 web_search
      let toolSchemas = agentTools?.length ? selectToolSchemas(agentTools) : null;
      if (toolSchemas && llmConfig?.webSearchEnabled === false) {
        toolSchemas = toolSchemas.filter(s => s?.function?.name !== 'web_search');
        if (toolSchemas.length === 0) toolSchemas = null;
      }

      if (toolSchemas && toolSchemas.length > 0) {
        // placeholder assistant：agent loop 原地更新它
        appendMessage({ role: 'assistant', content: '', toolCalls: [], loading: true, timestamp: Date.now() });
        const finalAssistant = await runElfAgentLoop({
          baseMessages: [
            ...messages.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: messageText },
          ],
          toolSchemas,
          systemPrompt,
          llmConfig,
        });
        setMessages(prev => prev.map((m, idx) => (idx === prev.length - 1 ? finalAssistant : m)));
        return;
      }

      // ===== 普通模式：无工具，单次请求（超预算时中段本地摘要压缩） =====
      const plainHistory = messages.slice(-40);
      let plainMessages;
      if (shouldCompact(plainHistory, PLAIN_CONTEXT_BUDGET)) {
        const packed = await buildContext(plainHistory, PLAIN_CONTEXT_BUDGET, {
          keepRecent: PLAIN_KEEP_RECENT,
          cutMin: 2,
          summaryText: localSummary(plainHistory.slice(1, Math.max(1, plainHistory.length - PLAIN_KEEP_RECENT))),
        });
        plainMessages = packed.compressed ? packed.messages : plainHistory.slice(-20);
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
          messages: plainMessages.map(msg => ({ role: msg.role, content: msg.content })),
        }),
      });

      const data = await response.json();
      appendMessage({
        role: 'assistant',
        content: data.error ? `分析失败: ${data.error}` : (data.content || '暂无分析结果'),
        timestamp: Date.now(),
      });
    } catch (e) {
      appendMessage({ role: 'assistant', content: `分析失败: ${e.message}`, timestamp: Date.now() });
    } finally {
      setIsLoading(false);
    }
  };

  return sendMessage;
}
