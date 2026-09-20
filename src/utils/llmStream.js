/**
 * llmStream.js — /api/ai-generate 流式调用共享工具（v30 全模块流式化基建）
 *
 * 背景：此前只有 agent 内核（agentLoopCore.streamAgentResponse）走流式 SSE，
 * 其余 16 个 /api/ai-generate 消费方（股市诊断/早报、划词翻译、GitHub 分析、
 * 多智能体视角、工作流 LLM 节点…）全部是「await 完整 JSON」式空等。
 * 后端早已支持 stream:true（server/http/aiHandlers.handleAiStreamRequest：
 * 三段式看门狗 + 首包保活 + tool_calls 转发 + usage 透传），缺的只是前端消费。
 *
 * 协议（与后端对齐）：
 *   data: {"ok":true,"delta":"…"}      文本增量
 *   data: {"ok":true,"usage":{…}}      token 用量（includeUsage 时最后一帧）
 *   data: {"ok":true,"gatewayWarning"} 网关告警（console.warn）
 *   data: {"ok":false,"error","errorCode"} 失败帧
 *   data: [DONE]                        终止
 *   ": ka"                              SSE 注释帧（首包保活，解析器直接跳过）
 *
 * 纯工具、无 React 依赖，可单测（fetch 可注入）。
 */

/**
 * 流式调用 /api/ai-generate。
 * @param {object} opts
 * @param {object} opts.llmConfig - { baseUrl, apiKey, selectedModel }
 * @param {string} [opts.systemPrompt]
 * @param {string} [opts.userPrompt] - 单轮用户消息（与 messages 二选一）
 * @param {Array}  [opts.messages] - 多轮消息（chat 模式）
 * @param {(delta: string, full: string) => void} [opts.onDelta] - 每个增量回调（full 为累计全文）
 * @param {AbortSignal} [opts.signal] - 取消信号（真取消：断开即中止上游）
 * @param {boolean} [opts.includeUsage] - 请求 token 用量
 * @param {number} [opts.maxTokens]
 * @param {typeof fetch} [opts.fetchImpl] - 测试注入
 * @returns {Promise<{content: string, usage: object|null}>}
 */
export async function streamLlm({
  llmConfig,
  systemPrompt = '',
  userPrompt = '',
  messages = null,
  onDelta = null,
  signal = null,
  includeUsage = false,
  maxTokens = null,
  fetchImpl = fetch,
}) {
  if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
    throw new Error('请先配置大模型');
  }
  const body = {
    baseUrl: llmConfig.baseUrl,
    apiKey: llmConfig.apiKey,
    model: llmConfig.selectedModel,
    action: 'chat',
    stream: true,
    systemPrompt,
    includeUsage,
  };
  if (Array.isArray(messages) && messages.length) body.messages = messages;
  if (userPrompt) body.content = userPrompt;
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;

  const res = await fetchImpl('/api/ai-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal || undefined,
  });
  if (!res.ok) {
    // 非流式错误路径（4xx/5xx JSON）
    let message = `AI 网关返回 ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = typeof data.error === 'string' ? data.error : (data.error.message || message);
    } catch { /* 保留默认消息 */ }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let usage = null;
  const parseLine = (payload) => {
    if (payload === '[DONE]') return { done: true };
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return {}; // 跳过不完整/非法 JSON 行
    }
    if (json.ok === false) {
      throw new Error(json.error || 'AI 网关错误');
    }
    if (json.gatewayWarning) console.warn('[ai-generate 网关告警]', json.gatewayWarning);
    if (typeof json.delta === 'string' && json.delta) {
      content += json.delta;
      onDelta?.(json.delta, content);
    }
    if (json.usage && typeof json.usage === 'object') usage = json.usage;
    return {};
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue; // 跳过空行与 ": ka" 注释帧
        const { done: isDone } = parseLine(trimmed.slice(5).trim());
        if (isDone) return { content, usage };
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return { content, usage };
}
