/**
 * contextManager.js - 会话上下文压缩与组装（对标 pi 的 compaction / estimateTokens）
 *
 * pi 的核心之一：用 token 估算感知上下文占用，超过预算就把早期消息压缩为摘要，
 * 而不是硬截断（slice(-N)）。本模块是纯逻辑（无 React / 无 fetch），可直接单测。
 *
 * 能力：
 * - estimateTokens：按字符数估算 token（中文按 ~1 token/1.5 字，保守起见 /3）
 * - buildContext：给定消息序列 + token 预算，返回「尽量保留近期 + 压缩较旧」的上下文
 * - compactMessages：把中段消息压成一段摘要消息（摘要由调用方提供，失败时用本地头部摘要降级）
 *
 * 设计原则（与 pi 对齐）：
 * - message 形态统一为 { role, content }（与现有 agent loop 的 conversation 一致）
 * - tool 消息有 tool_call_id，压缩时可安全丢弃（对无工具的历史不重要）
 * - 永不吞消息标志字段（role 保留）
 */

/** 字符 -> token 估算（保守，向 LLM 侧靠拢，宁可多算） */
export function estimateTokens(message) {
  const content = String(message?.content ?? '');
  // 空白不计
  const trimmed = content.replace(/\s/g, '');
  if (!trimmed) return 0;
  // 中文/日文/韩文（宽字符）约 1 token / 1.5 字符；英文更密集，统一保守按 /3
  const cjk = (trimmed.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g) || []).length;
  const other = trimmed.length - cjk;
  return Math.ceil(cjk / 1.5) + Math.ceil(other / 3.5);
}

/** 估算一段消息列表的总 token（可传入数组或.options）。 */
export function estimateMessages(messages) {
  return (messages || []).reduce((sum, m) => sum + estimateTokens(m), 0);
}

/**
 * 判定是否应压缩：预估 token 超过预算。
 * @param {Array}  messages
 * @param {number} budget  - 可用 token 预算
 * @param {Object} [opts]
 * @param {number} [opts.minTrigger] - 至少超过这么多才触发（避免微小波动）
 */
export function shouldCompact(messages, budget, { minTrigger = 0 } = {}) {
  const tokens = estimateMessages(messages);
  const threshold = budget + minTrigger;
  return tokens > budget && tokens > threshold;
}

/**
 * 在消息序列中找「可压缩窗口」：从第一条非 user 消息起，到倒数第 K 条为止，
 * 返回 {@code {cutStart, cutEnd, cutRegion, retainedWithoutCut}} 供压缩。
 *
 * 设计（贴近 pi 的 findCutPoint）：
 * - 永不压缩首条 user 消息（它是 context 的根）
 * - 默认保留最近 keepRecent 条消息不动（多数场景是围绕最近几轮的助手 + 工具）
 * - 压缩段是一个连续区间，可折叠成一条 summary 消息
 */
export function findCutRegion(messages, { keepRecent = 4, cutMin = 2 } = {}) {
  if (!Array.isArray(messages)) return null;
  const total = messages.length;
  // 需要「首条 + 可压中段 + 最近 keepRecent」才有得压
  // 保守判定：cutEnd - cutStart >= cutMin 且 cutStart >= 1 就够
  let cutStart = 1; // 跳过第一条（通常为 user，可能带工具开关）
  // 若首条是 tool 也跳过，避免把锚点压缩掉
  while (cutStart < total && messages[cutStart].role === 'tool') cutStart += 1;

  let cutEnd = total - keepRecent;
  if (cutEnd <= cutStart) return null;
  if (cutEnd - cutStart < cutMin) return null;

  const cut = messages.slice(cutStart, cutEnd);
  if (cut.length === 0) return null;
  return { cutStart, cutEnd, cutRegion: cut };
}

/**
 * 组装发给 LLM 的上下文：
 * - 未超预算：原样返回
 * - 超预算：定位 cutRegion，用一个 summary 消息替换，并补一条「该摘要覆盖了 N 条消息」的延续
 *   （摘要文本由调用方提供；若空则用本地摘要降级）
 *
 * @param {Array}  messages
 * @param {number} budget
 * @param {Object} [opts]
 * @param {Function} [opts.generateSummary] - (region) => Promise<string>，可为空
 * @param {number} [opts.keepRecent]
 * @param {number} [opts.cutMin]
 * @returns {{messages: Array, compressed: boolean, region: object|null, tokens: number}}
 */
export async function buildContext(messages, budget, opts = {}) {
  const { keepRecent = 4, cutMin = 2, generateSummary } = opts;
  const tokens = estimateMessages(messages);

  if (!shouldCompact(messages, budget)) {
    return { messages, budget, tokens, compressed: false, region: null };
  }

  const region = findCutRegion(messages, { keepRecent, cutMin });
  if (!region) {
    // 压不了（消息过短）但确实超预算：直接把预算是小果实退回，不强行砍
    return { messages, tokens, budget, compressed: false, region: null };
  }

  // 摘要：优先外部（LLM），否则本地降级
  let summaryText = '';
  if (typeof opts.summaryText === 'string' && opts.summaryText) {
    summaryText = opts.summaryText;
  } else if (typeof generateSummary === 'function') {
    try {
      const s = await generateSummary(region.region);
      if (s && typeof s === 'string') summaryText = s;
    } catch { summaryText = ''; }
  }
  if (!summaryText) summaryText = localSummary(region.region);

  const before = messages.slice(0, region.cutStart);
  const after = messages.slice(region.cutEnd);
  // 压缩消息：标注它是对哪些消息的摘要
  const compressed = [
    {
      role: 'system',
      content: `摘要（${summaryText}）。此为对早前 ${region.cutRegion.length} 条对话的压缩记忆，按需引用；后续以最新对话为准。`,
    },
  ];
  const nextMessages = [...before, ...compressed, ...after];
  return {
    messages: nextMessages,
    tokens: estimateMessages(nextMessages),
    budget,
    compressed: true,
    region: { cutStart: region.cutStart, cutEnd: region.cutEnd, region: region.cutRegion.length },
    summaryText,
    originalTokens: tokens,
  };
}

/** 本地降级摘要：取每条消息前若干关键行，拼成一段。 */
export function localSummary(region) {
  if (!region?.length) return '';
  const lines = region
    .map((m, i) => {
      const plain = String(m.content ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!plain) return null;
      const roleTag = m.role === 'user' ? '用户' : m.role === 'tool' ? '工具' : '助手';
      return `${i + 1}. [${roleTag}] ${plain.slice(0, 60)}${plain.length > 60 ? '…' : ''}`;
    })
    .filter(Boolean)
    .slice(0, 12);
  return lines.join('\n');
}