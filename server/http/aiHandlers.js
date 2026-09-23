import { allowPrivateAiNetwork, safeExternalFetch } from '../security/urlSafety.js';
import { readJsonBody, sendJsonResponse } from './httpUtils.js';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// v36.2 幽灵"0/O"排查工具：AI_SSE_TRACE=1 时把上游 SSE 原始帧落盘，
// 用户侧复现一次即可拿到网关转发的第一手证据（默认关闭，零开销）。
const SSE_TRACE = process.env.AI_SSE_TRACE === '1';
const SSE_TRACE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.workbuddy', 'sse-trace.log');
function traceSseFrame(payload) {
  if (!SSE_TRACE) return;
  try {
    appendFileSync(SSE_TRACE_FILE, `${new Date().toISOString()} ${String(payload).slice(0, 2000)}\n`);
  } catch { /* 追踪失败不影响主链路 */ }
}

const windows = new Map();
const ACTION_PROMPTS = {
  continue: content => `请继续以下文章的内容，保持相同的风格和语气：\n\n${content}`,
  rewrite: content => `请改写以下段落，使其更清晰、更专业，但保持原意不变：\n\n${content}`,
  expand: content => `请扩展以下内容，添加更多细节和论据，使其更丰富：\n\n${content}`,
  simplify: content => `请简化以下段落，使其更简洁易懂：\n\n${content}`,
  translate_zh: content => `请将以下内容翻译成中文。只输出翻译结果，不要添加解释：\n\n${content}`,
  translate_en: content => `请将以下内容翻译成英文：\n\n${content}`,
  title: content => `请为以下文章生成 5 个标题，每个标题不超过 30 字：\n\n${content}`,
  summary: content => `请为以下文章生成一段不超过 100 字的摘要：\n\n${content}`,
  'github-evaluator': content => `你是一位资深技术选型专家。请基于以下 GitHub 项目信息，实时分析并输出严格 JSON（不要 markdown 代码块，不要解释文字），字段如下：\n- scenario: 应用场景（1-2句，具体说明能解决什么问题）\n- audience: 适合谁（目标用户/团队）\n- difficulty: 落地难度（低/中/高 + 一句原因）\n- value: 价值判断（值得跟进的程度 + 一句理由）\n\n项目信息：\n${content}\n\n只输出 JSON，格式：{"scenario":"","audience":"","difficulty":"","value":""}`,
};

function clientKey(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function enforceRateLimit(req, isAgentLoop = false) {
  const now = Date.now();
  const key = clientKey(req);
  // agent loop 单轮会触发多次 LLM 调用，放宽到 5min/100 次
  const limit = isAgentLoop ? 100 : 30;
  const active = (windows.get(key) || []).filter(timestamp => now - timestamp < 5 * 60_000);
  if (active.length >= limit) throw Object.assign(new Error('AI 请求过于频繁，请稍后再试'), { code: 'RATE_LIMITED', status: 429 });
  active.push(now);
  windows.set(key, active);
  if (windows.size > 2000) for (const [entry, hits] of windows) if (!hits.some(timestamp => now - timestamp < 5 * 60_000)) windows.delete(entry);
}

function cleanText(value, max) { return String(value || '').slice(0, max); }

// 环境变量解析：正整数或回落默认值（Number('')=0、Number('abc')=NaN 均视为无效）
function parsePositiveIntEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// 系统提示词上限：工作站的 system prompt 组装了证据/素材/工具能力/会话状态等多个段，
// 此前 10_000 上限会静默截掉末尾的工具能力段（buildSystemPrompt 注入在末尾）——上下文越丰富
// 模型越容易先丢工具使用指引。提高到 60_000 并在真截断时向客户端下发告警。
export const SYSTEM_PROMPT_MAX = 60_000;

/** 计算网关层告警（systemPrompt 截断等），随响应/流式事件下发 */
function collectGatewayWarnings(body) {
  const warnings = [];
  if (String(body?.systemPrompt || '').length > SYSTEM_PROMPT_MAX) {
    warnings.push(`systemPrompt 超过 ${SYSTEM_PROMPT_MAX} 字符上限，已被网关截断（工具能力段可能丢失）`);
  }
  return warnings;
}

// 上游 429/5xx 自动重试：仅对幂等的非流式 generate 路径生效（流式已开 SSE 不能重试）
async function fetchWithRetry(url, options, { retries = 1, baseDelay = 1200 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await safeExternalFetch(url, options);
      if (resp.status !== 429 && resp.status < 500) return resp;
      // 429 或 5xx 才重试
      lastErr = Object.assign(new Error(`模型服务返回 ${resp.status}`), {
        code: resp.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_AI_ERROR',
        status: resp.status === 429 ? 429 : 502,
      });
      // 取出响应体后才能下一次请求
      await resp.text().catch(() => {});
      if (attempt < retries) {
        const retryAfter = Number(resp.headers?.get('retry-after')) || 0;
        const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : baseDelay * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return resp; // 重试后仍失败，返回响应让调用方处理
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') throw err; // 用户主动取消不重试
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('AI 网关请求失败');
}

function sendAiError(res, error) {
  const code = error?.code || (error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'AI_GATEWAY_ERROR');
  const status = error?.status || (error?.name === 'AbortError' ? 504 : 500);
  let message;
  if (error?.name === 'AbortError') message = '模型服务请求超时';
  else if (code === 'UPSTREAM_RATE_LIMITED') message = '模型服务繁忙（429），请稍候再试，或更换模型';
  else message = error?.message || 'AI 网关请求失败';
  return sendJsonResponse(res, status, { ok: false, error: message, errorCode: code });
}

function buildMessages(body) {
  const action = cleanText(body.action, 40);
  const content = cleanText(body.content, 50_000);
  const systemPrompt = cleanText(body.systemPrompt, SYSTEM_PROMPT_MAX);
  const result = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
  if (action === 'chat' && Array.isArray(body.messages)) {
    body.messages.slice(-30).forEach(message => {
      const role = message?.role;
      // chat 模式支持 user / assistant / tool 三种角色
      if (!role) return;
      if (role === 'tool') {
        // tool 消息：必须带 tool_call_id 和 content
        if (!message?.content) return;
        result.push({
          role: 'tool',
          tool_call_id: String(message.tool_call_id || '').slice(0, 200),
          content: cleanText(message.content, 20_000),
        });
        return;
      }
      if (role === 'assistant') {
        // assistant 消息可能带 tool_calls（由前一轮 LLM 决定调用工具）
        const msg = { role: 'assistant' };
        if (message.content) msg.content = cleanText(message.content, 20_000);
        if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
          msg.tool_calls = message.tool_calls.slice(0, 10).map(tc => ({
            id: String(tc.id || '').slice(0, 100),
            type: 'function',
            function: {
              name: String(tc?.function?.name || '').slice(0, 100),
              arguments: String(tc?.function?.arguments || '{}').slice(0, 20_000),
            },
          }));
        }
        if (msg.content || msg.tool_calls) result.push(msg);
        return;
      }
      // v36：user 消息上限 20k → 64k——附件文本注入（attachmentInjection 单文件 12k/合计 36k）需要余量
      if (role === 'user' && message?.content) result.push({ role: 'user', content: cleanText(message.content, 64_000) });
    });
    if (content) result.push({ role: 'user', content });
    return result;
  }
  const prompt = ACTION_PROMPTS[action]?.(content) || `请根据以下要求处理内容：\n要求：${action}\n内容：${content}`;
  result.push({ role: 'user', content: prompt });
  return result;
}

/* 流式聊天：向上游发 stream:true，解析 SSE delta 转发给前端。
   前端断开（停止）时通过 req.on('close') 中止上游请求。
   导出仅为可测性（__tests__ 直接调用，绕过 readJsonBody/限流）。 */
export async function handleAiStreamRequest(req, res, body) {
  const baseUrl = cleanText(body.baseUrl, 2000).replace(/\/+$/, '');
  const model = cleanText(body.model, 200);
  if (!baseUrl || !model) {
    return sendJsonResponse(res, 400, { ok: false, error: 'baseUrl 和 model 不能为空', errorCode: 'INVALID_AI_CONFIG' });
  }
  const apiUrl = /\/v[1-4]$/.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = cleanText(body.apiKey, 4000);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const requestedMaxTokens = Number(body.max_tokens);
  // v36：闸门 8000 → 16000——长任务（深度调研/万字文档）需要更长单轮输出；
  // 与前端 COMPLETION_MAX_TOKENS(16000) 同口径。
  const maxTokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0 && requestedMaxTokens <= 16000
    ? Math.floor(requestedMaxTokens)
    : 4000;
  const controller = new AbortController();
  // 建连超时：仅覆盖「建立连接 + 拿到响应头」这一段（下一段 try 的 finally 里即清除）。
  const connectTimeout = setTimeout(() => controller.abort(), 90_000);

  // 流式读取阶段的「静默看门狗」：上游连着但不再吐字节时中止，避免连接永久挂起。
  // 注意这是**静默**超时而非总时长超时——每收到一个 chunk 就续期，长回答不会被误杀。
  //
  // 2026-09-18 重构为三段式（实测 bug：设置页「测试连接」是 50 token 的 "Hello" 非流式
  // 小请求，秒回成功；而真实生成 = 长 systemPrompt + 全对话历史 + stream:true，推理模型
  // 思考/慢网关的首包普遍 >60s → 旧版 60s 看门狗把真实生成全部杀掉，报「上游 60 秒无响应」，
  // 形成「测试成功但生成必败」的割裂）：
  //   1) 首包看门狗 AI_STREAM_FIRST_TOKEN_MS（默认 180s）：覆盖「建连完成 → 首个上游字节」。
  //      注意 undici 默认 bodyTimeout=300s 是更底层的天花板，需要更久请同时评估该限制。
  //   2) 首包保活 AI_STREAM_KEEPALIVE_MS（默认 15s）：首包到达前，周期性向客户端写一行
  //      SSE 注释帧（`: ka`，协议内合法的无操作帧）。前端解析器会跳过注释，但「收到字节」
  //      足以续期客户端自己的静默看门狗（agentLoopCore 在 reader.read() 返回即续期）——
  //      推理模型长思考不再被客户端 90s 看门狗误杀。首包到达后必须停止保活：此后静默
  //      就是真卡死，保活反而会掩盖故障。
  //   3) 流中静默看门狗 AI_STREAM_STALL_MS（默认 90s，与前端 agentLoopCore 的 90s 对齐，
  //      修复「服务端 60s 比客户端 90s 先超时」导致客户端看门狗沦为死代码的问题）。
  const FIRST_TOKEN_MS = parsePositiveIntEnv('AI_STREAM_FIRST_TOKEN_MS', 180_000);
  const STALL_MS = parsePositiveIntEnv('AI_STREAM_STALL_MS', 90_000);
  const KEEPALIVE_MS = parsePositiveIntEnv('AI_STREAM_KEEPALIVE_MS', 15_000);
  let stalled = false;
  let stalledAfterMs = 0; // 触发时所在阶段的看门狗时长，用于生成准确的错误文案
  let stallTimer = null;
  const armStall = (ms) => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { stalled = true; stalledAfterMs = ms; controller.abort(); }, ms);
  };
  const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };

  // 前端断开（用户点「停止」/ 客户端静默看门狗中止）时终止上游请求，避免上游连接与
  // 本 handler 被永久占住，同时不再为空转的生成付 token。
  //
  // ⚠️ 必须监听 res 而不是 req（2026-09 实测取证，见 scripts/probe-req-close-semantics*.mjs）：
  // Node 16+ 起 IncomingMessage 的 'close' 会在**请求体读完**时立即发出——而本函数是在
  // `await readJsonBody(req)` 之后才被调用的，此时 'close' 早已发过，挂在 req 上等于**死代码**
  // （实测：挂监听后 1.5s 的流里 'close' 一次都不触发）。res 的 'close' 在响应流真正关闭时
  // 触发，配合 writableEnded 即可区分「正常写完」与「中途断开」。
  const onClientGone = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClientGone);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 网关层告警（如 systemPrompt 截断）：先行下发，客户端 console.warn 提示
  for (const warning of collectGatewayWarnings(body)) {
    res.write(`data: ${JSON.stringify({ ok: true, gatewayWarning: warning })}\n\n`);
  }

  // 首包保活（详见上方三段式说明）：从建连前就开跑（覆盖上游建连 + 模型思考整段静默期），
  // 收到第一个上游字节即停（读取循环内 stopKeepalive）。建连失败的提前 return 分支里显式
  // 停止；读取阶段的正常完成/异常/用户断开由末尾 finally 兜底清理，防止定时器泄漏。
  // ⚠️ 不能放进建连 try 的 finally——finally 在成功路径也会执行，会把首包等待期的保活停掉。
  let keepaliveTimer = null;
  if (KEEPALIVE_MS < FIRST_TOKEN_MS) {
    keepaliveTimer = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      try { res.write(': ka\n\n'); } catch { /* 客户端已断开，等 close 分支收尾 */ }
    }, KEEPALIVE_MS);
  }
  const stopKeepalive = () => { if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; } };

  let upstream;
  try {
    // 流式路径仅重试连接阶段（已开 SSE 不能重试整段对话）
    const streamBody = { model, messages: buildMessages(body), max_tokens: maxTokens, temperature: 0.7, stream: true };
    // 客户端要求 token 用量统计时，向上游请求 usage（OpenAI 兼容协议的 stream_options）；
    // 默认关闭：部分非 OpenAI 严格的兼容实现可能不认这个字段
    if (body.includeUsage === true) {
      streamBody.stream_options = { include_usage: true };
    }
    // agent 模式：透传 tools（与非流式路径对齐，限制 20 个 / schema 8KB），让流式也能触发工具调用
    if (Array.isArray(body.tools) && body.tools.length) {
      streamBody.tools = body.tools.slice(0, 20).map(t => {
        const fn = t?.function || {};
        return {
          type: 'function',
          function: {
            name: String(fn.name || '').slice(0, 100),
            description: String(fn.description || '').slice(0, 2000),
            parameters: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {} },
          },
        };
      });
      streamBody.tool_choice = (body.tool_choice === 'none' || body.tool_choice === 'auto') ? body.tool_choice : 'auto';
    }
    upstream = await fetchWithRetry(apiUrl, {
      allowPrivate: allowPrivateAiNetwork(), method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify(streamBody),
    }, { retries: 1, baseDelay: 1200 });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      const isRateLimited = upstream.status === 429;
      const errorCode = isRateLimited ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_AI_ERROR';
      const friendlyMsg = isRateLimited
        ? '模型服务繁忙（429），请稍候再试，或更换模型'
        : `模型服务返回 ${upstream.status}${errText ? ': ' + errText.slice(0, 200) : ''}`;
      stopKeepalive(); // 提前 return 的失败分支：保活到此为止（成功路径不在这停，首包等待期还需要它）
      res.write(`data: ${JSON.stringify({ ok: false, error: friendlyMsg, errorCode })}\n\n`);
      return res.end();
    }
  } catch (err) {
    stopKeepalive(); // 建连失败的提前 return：同上
    const isAbort = err?.name === 'AbortError';
    const isRateLimited = err?.code === 'UPSTREAM_RATE_LIMITED';
    const msg = isAbort
      ? '模型服务请求超时或已停止'
      : (isRateLimited ? '模型服务繁忙（429），请稍候再试，或更换模型' : (err?.message || 'AI 网关请求失败'));
    const errorCode = isAbort ? 'UPSTREAM_TIMEOUT' : (isRateLimited ? 'UPSTREAM_RATE_LIMITED' : 'AI_GATEWAY_ERROR');
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ ok: false, error: msg, errorCode })}\n\n`);
    return res.end();
  } finally {
    clearTimeout(connectTimeout);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let gotFirstChunk = false;
  armStall(FIRST_TOKEN_MS); // 进入读取循环即开始首包计时；有数据就切换到流中静默计时
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!gotFirstChunk) { gotFirstChunk = true; stopKeepalive(); } // 首包到达：停保活，此后静默=真卡死
      armStall(STALL_MS); // 收到数据即续期：只有「持续静默」才判定卡死
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') { res.write('data: [DONE]\n\n'); return res.end(); }
        try {
          const json = JSON.parse(payload);
          traceSseFrame(payload); // v36.2：env 门控原始帧追踪（排查幽灵字符）
          const choice = json.choices?.[0] || {};
          const delta = choice.delta || {};
          // v34：推理模型的思维链透传（DeepSeek-R1 / GLM 等在 delta.reasoning_content）
          // ——此前被丢弃，前端"思考过程"永远无内容
          if (delta.reasoning_content) {
            res.write(`data: ${JSON.stringify({ ok: true, reasoning: delta.reasoning_content })}\n\n`);
          }
          // 普通文本增量（既有行为，聊天路径依赖它）
          if (delta.content) {
            res.write(`data: ${JSON.stringify({ ok: true, delta: delta.content })}\n\n`);
          }
          // agent 模式：把 tool_calls 分片原样转发，前端按 index 合并还原（P1-6）
          if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
            res.write(`data: ${JSON.stringify({ ok: true, toolCallDelta: delta.tool_calls })}\n\n`);
          }
          // 转发结束原因（tool_calls / stop），前端据此判定是否进入工具执行分支
          if (choice.finish_reason) {
            res.write(`data: ${JSON.stringify({ ok: true, finish_reason: choice.finish_reason })}\n\n`);
          }
          // token 用量（include_usage 时上游在最后一个 chunk 报告），透传给前端累计
          if (json.usage && typeof json.usage === 'object') {
            res.write(`data: ${JSON.stringify({ ok: true, usage: json.usage })}\n\n`);
          }
        } catch { /* 跳过不完整的 JSON 行 */ }
      }
    }
    if (!res.writableEnded) res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    // 回写条件：客户端还连着，且属于「需要告知用户」的失败。
    // 静默看门狗触发的也是 AbortError，但必须告知（否则客户端会把它当成一次正常的短回答）。
    const clientGone = err?.name === 'AbortError' && !stalled;
    if (!clientGone && !res.writableEnded) {
      const msg = stalled
        ? (gotFirstChunk
          ? `上游 ${Math.round(stalledAfterMs / 1000)} 秒无响应，已中断本次生成`
          : `模型 ${Math.round(stalledAfterMs / 1000)} 秒未返回首包数据，已中断本次生成`)
        : (err?.message || '流式读取失败');
      const errorCode = stalled ? 'UPSTREAM_TIMEOUT' : 'AI_GATEWAY_ERROR';
      res.write(`data: ${JSON.stringify({ ok: false, error: msg, errorCode })}\n\n`);
    }
    res.end();
  } finally {
    clearStall();
    stopKeepalive();
    clearTimeout(connectTimeout);
    res.off('close', onClientGone);
  }
}

export async function handleAiGenerateRequest(req, res) {
  if (String(req.method).toUpperCase() !== 'POST') {
    return sendJsonResponse(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
  }
  let timeout;
  try {
    const body = await readJsonBody(req);
    // agent 模式：客户端传 tools 数组时，标识为 agent loop 调用，放宽限速
    const isAgentLoop = Array.isArray(body.tools) && body.tools.length > 0;
    enforceRateLimit(req, isAgentLoop);
    // 流式聊天走独立处理，返回 SSE
    if (body.stream === true) {
      return handleAiStreamRequest(req, res, body);
    }
    const baseUrl = cleanText(body.baseUrl, 2000).replace(/\/+$/, '');
    const model = cleanText(body.model, 200);
    if (!baseUrl || !model) throw Object.assign(new Error('baseUrl 和 model 不能为空'), { code: 'INVALID_AI_CONFIG', status: 400 });
    const apiUrl = /\/v[1-4]$/.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = cleanText(body.apiKey, 4000);
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const controller = new AbortController();
    // agent loop 可能多轮调用，给个更长超时
    timeout = setTimeout(() => controller.abort(), isAgentLoop ? 120_000 : 90_000);
    const requestedMaxTokens = Number(body.max_tokens);
    // v36：闸门 8000 → 16000（与 COMPLETION_MAX_TOKENS 同口径，长任务需要更长单轮输出）
    const maxTokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0 && requestedMaxTokens <= 16000
      ? Math.floor(requestedMaxTokens)
      : 4000;
    // 构造上游请求体：基础字段 + agent 模式下的 tools / tool_choice
    const upstreamBody = { model, messages: buildMessages(body), max_tokens: maxTokens, temperature: 0.7 };
    if (isAgentLoop) {
      // 透传 tools（限制最多 20 个，每个 schema 最大 8KB）
      upstreamBody.tools = body.tools.slice(0, 20).map(t => {
        const fn = t?.function || {};
        return {
          type: 'function',
          function: {
            name: String(fn.name || '').slice(0, 100),
            description: String(fn.description || '').slice(0, 2000),
            parameters: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {} },
          },
        };
      });
      // tool_choice: 客户端可指定 'auto' / 'none' / {type:'function',function:{name}}
      if (body.tool_choice === 'none' || body.tool_choice === 'auto') {
        upstreamBody.tool_choice = body.tool_choice;
      } else if (body.tool_choice && typeof body.tool_choice === 'object') {
        upstreamBody.tool_choice = { type: 'function', function: { name: String(body.tool_choice.function?.name || '').slice(0, 100) } };
      } else {
        upstreamBody.tool_choice = 'auto';
      }
    }
    const response = await fetchWithRetry(apiUrl, {
      allowPrivate: allowPrivateAiNetwork(), method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify(upstreamBody),
    }, { retries: 1, baseDelay: 1200 });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const isRateLimited = response.status === 429;
      throw Object.assign(new Error(`模型服务返回 ${response.status}`), {
        code: isRateLimited ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_AI_ERROR',
        status: isRateLimited ? 429 : 502,
      });
    }
    const data = await response.json();
    const choice = data.choices?.[0] || {};
    const message = choice.message || {};
    // agent 模式下返回 tool_calls 字段，供前端 agent loop 继续执行
    const result = { ok: true, content: message.content || '' };
    // token 用量透传（上游报告时），供前端成本核算
    if (data.usage && typeof data.usage === 'object') result.usage = data.usage;
    // 网关层告警（如 systemPrompt 截断）
    const warnings = collectGatewayWarnings(body);
    if (warnings.length) result.gatewayWarnings = warnings;
    if (isAgentLoop && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      result.tool_calls = message.tool_calls.map(tc => ({
        id: String(tc.id || '').slice(0, 100),
        type: 'function',
        function: {
          name: String(tc?.function?.name || '').slice(0, 100),
          arguments: String(tc?.function?.arguments || '{}'),
        },
      }));
      result.finish_reason = choice.finish_reason || 'tool_calls';
    } else {
      result.finish_reason = choice.finish_reason || 'stop';
    }
    return sendJsonResponse(res, 200, result);
  } catch (error) {
    return sendAiError(res, error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Phase 3 Task B1: 构建 ai-insights prompt（纯函数，便于测试）
 * 在原 prompt 基础上注入 personaSummary（习惯/性格/需求），用于个性化趋势分析。
 * @param {Array} items - top N 资讯
 * @param {Object|null} personaSummary - { habits: [], traits: [], needs: [] }
 */
export function buildAiInsightsPrompt(items, personaSummary) {
  const habits = Array.isArray(personaSummary?.habits) && personaSummary.habits.length
    ? personaSummary.habits.join('、')
    : '无';
  const traits = Array.isArray(personaSummary?.traits) && personaSummary.traits.length
    ? personaSummary.traits.join('、')
    : '无';
  const needs = Array.isArray(personaSummary?.needs) && personaSummary.needs.length
    ? personaSummary.needs.join('、')
    : '无';

  const itemsText = items.map((i, idx) => {
    const summaryLine = i.summary ? ` | 摘要: ${i.summary}` : '';
    const tagsLine = i.tags ? ` | 标签: ${i.tags}` : '';
    return `${idx + 1}. [id:${i.id || idx}] [${i.category || '未分类'}] ${i.title} - ${i.source || '未知'}${summaryLine}${tagsLine}`;
  }).join('\n');

  return `你是一个科技趋势分析师。请分析以下${items.length}条技术资讯，输出**简洁**的纯 JSON（不要 markdown 代码块）：

{"trends":["趋势 1","趋势 2","趋势 3"],"correlations":["关联 1","关联 2"],"signals":["信号 1","信号 2","信号 3"],"itemScores":[{"id":"资讯id","score":85,"label":"必读","reason":"一句话说明"}]}

【用户画像】
- 习惯：${habits}
- 性格：${traits}
- 需求：${needs}

资讯列表：
${itemsText}

要求：
- trends：基于当前资讯内容，提炼 3 条最显著的技术趋势
- correlations：发现不同领域/赛道之间的关联或共同主题
- signals：指出值得关注的早期信号或潜在变化
- itemScores：对每条资讯评估重要性，输出 {id, score, label, reason}
  · score: 0-100，综合考量时效性、影响力、与用户相关性
  · label: "必读"(score>=75) / "关注"(50-74) / "降噪"(<50)
  · reason: 一句话说明评分理由（不超过 30 字）
- 每条 trend/correlation/signal/reason **不超过 30 字**，简洁明了
- 只输出 JSON，不要其他文字`;
}

/**
 * Phase 3 Task B1: 处理 /api/ai-insights 请求
 * 从 plugin.js 内联实现迁出，新增 personaSummary 注入。
 * 复用 fetchWithRetry + enforceRateLimit，保留原有 JSON 修复逻辑。
 */
export async function handleAiInsightsRequest(req, res) {
  try {
    const body = await readJsonBody(req);
    const { baseUrl: rawBaseUrl = '', apiKey = '', model = '', items = [], personaSummary = null } = body;
    if (!rawBaseUrl || !model) {
      return sendJsonResponse(res, 400, { ok: false, error: 'baseUrl and model are required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendJsonResponse(res, 400, { ok: false, error: 'items required' });
    }
    enforceRateLimit(req);

    const cleanBaseUrl = String(rawBaseUrl).replace(/\/+$/, '');
    const apiUrl = /\/v[1-4]$/.test(cleanBaseUrl) ? `${cleanBaseUrl}/chat/completions` : `${cleanBaseUrl}/v1/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // 最多取 top 30 条
    const topItems = items.slice(0, 30);
    const prompt = buildAiInsightsPrompt(topItems, personaSummary);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetchWithRetry(apiUrl, {
        allowPrivate: allowPrivateAiNetwork(),
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2500,
          temperature: 0.5,
        }),
        signal: controller.signal,
      }, { retries: 1, baseDelay: 1200 });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const isRateLimited = response.status === 429;
        return sendJsonResponse(res, isRateLimited ? 429 : 502, {
          ok: false,
          error: `API responded ${response.status}: ${errText.slice(0, 200)}`,
          errorCode: isRateLimited ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_AI_ERROR',
        });
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      // Smart JSON parsing (migrated from plugin.js inline): handles markdown code blocks + truncation
      let cleaned = content.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const start = cleaned.indexOf('{');
      let end = cleaned.lastIndexOf('}');

      if (start === -1) {
        return sendJsonResponse(res, 200, { ok: false, error: 'AI 响应缺少 JSON 开始标记', raw: content.slice(0, 300) });
      }
      if (end === -1 || end <= start) {
        // 响应被截断，尝试补全闭合括号
        end = cleaned.length - 1;
        cleaned = cleaned + ']}]}'.repeat(3);
      }
      const jsonStr = cleaned.slice(start, end + 1);
      try {
        const insights = JSON.parse(jsonStr);
        return sendJsonResponse(res, 200, insights);
      } catch (parseErr) {
        return sendJsonResponse(res, 200, {
          ok: false,
          error: `AI 返回格式错误：${parseErr.message}`,
          raw: content.slice(0, 300),
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const code = error?.code || (error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'AI_GATEWAY_ERROR');
    const status = error?.status || (error?.name === 'AbortError' ? 504 : 500);
    let message;
    if (error?.name === 'AbortError') message = '模型服务请求超时';
    else if (code === 'RATE_LIMITED') message = error.message;
    else if (code === 'UPSTREAM_RATE_LIMITED') message = '模型服务繁忙（429），请稍候再试，或更换模型';
    else message = error?.message || 'AI 网关请求失败';
    return sendJsonResponse(res, status, { ok: false, error: message, errorCode: code });
  }
}

/**
 * Phase 3 Task B4: 不绑定 req/res 的 ai-insights 内部调用。
 * 供 snapshotService.preheatForUser 与 /api/profile/snapshots/analyze 复用。
 *
 * @param {Object} params
 * @param {Array}  params.items - top N 资讯
 * @param {Object|null} [params.personaSummary] - { habits, traits, needs }
 * @param {Array}  [params.relevantMemories] - [{content, memoryType, ...}]，会拼到 prompt 末尾作为「相关记忆」段
 * @param {Object} params.llmConfig - { baseUrl, apiKey, selectedModel }
 * @returns {Promise<Object>} LLM 返回的 insights 对象（{ trends, correlations, signals, itemScores }）
 */
export async function handleAiInsightsInternal({ items, personaSummary = null, relevantMemories = [], llmConfig }) {
  if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
    throw Object.assign(new Error('llmConfig missing baseUrl or selectedModel'), { code: 'INVALID_AI_CONFIG', status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('items required'), { code: 'INVALID_ITEMS', status: 400 });
  }

  const prompt = buildAiInsightsPrompt(items.slice(0, 30), personaSummary);
  // 追加相关记忆段（来自 agent_memories 全文检索）
  const mems = Array.isArray(relevantMemories) ? relevantMemories.filter(m => m && m.content).slice(0, 5) : [];
  const finalPrompt = mems.length
    ? `${prompt}\n\n【相关记忆】\n${mems.map((m, i) => `${i + 1}. [${m.memoryType || 'memory'}] ${String(m.content).slice(0, 200)}`).join('\n')}`
    : prompt;

  const cleanBaseUrl = String(llmConfig.baseUrl).replace(/\/+$/, '');
  const apiUrl = /\/v[1-4]$/.test(cleanBaseUrl) ? `${cleanBaseUrl}/chat/completions` : `${cleanBaseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (llmConfig.apiKey) headers.Authorization = `Bearer ${llmConfig.apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchWithRetry(apiUrl, {
      allowPrivate: allowPrivateAiNetwork(),
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llmConfig.selectedModel,
        messages: [{ role: 'user', content: finalPrompt }],
        max_tokens: 2500,
        temperature: 0.5,
      }),
      signal: controller.signal,
    }, { retries: 1, baseDelay: 1200 });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const isRateLimited = response.status === 429;
      throw Object.assign(new Error(`ai-insights failed: ${response.status} ${errText.slice(0, 200)}`), {
        code: isRateLimited ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_AI_ERROR',
        status: isRateLimited ? 429 : 502,
      });
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    let cleaned = String(content).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    let end = cleaned.lastIndexOf('}');
    if (start === -1) {
      throw Object.assign(new Error('AI 响应缺少 JSON 开始标记'), { code: 'AI_PARSE_ERROR' });
    }
    if (end === -1 || end <= start) {
      // 响应被截断，尝试补全闭合括号
      end = cleaned.length - 1;
      cleaned = cleaned + ']}]}'.repeat(3);
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  } finally {
    clearTimeout(timeout);
  }
}
