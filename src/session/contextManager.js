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
 * 返回 {@code {cutStart, cutEnd, cutRegion}} 供压缩。
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
      // ⚠️ 字段是 cutRegion（不是 region）——历史上误写成 region.region，
      // 导致摘要器恒收到 undefined：「LLM 真压缩」从未压缩到任何对话，
      // 且本地降级摘要恒为空（压缩段被替换成一句空的「摘要（）」）。
      const s = await generateSummary(region.cutRegion);
      if (s && typeof s === 'string') summaryText = s;
    } catch { summaryText = ''; }
  }
  if (!summaryText) summaryText = localSummary(region.cutRegion);

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

/**
 * 打包参数的统一默认值。
 * 各调用方可以按产品形态覆写，但**实现只有 packConversation 这一份**。
 */
export const PACK_DEFAULTS = {
  budget: 48_000,
  keepRecent: 4,
  cutMin: 2,
  fallbackLimit: 20,
};

/**
 * 统一的「上下文打包」入口：判定是否超预算 → 压缩中段 → 尾部条数兜底截断。
 * 一次调用直接给出可下发给 LLM 的消息数组。
 *
 * 为什么需要它（2026-09 重构）：此前 agent 工具循环 / 工作站普通流式 / 精灵普通流式
 * 三处各写了一份近乎相同的逻辑，导致四项口径全部漂移——
 *   预算 48000 / 40000 / 40000，保留条数 25 / 15 / 15，兜底条数 30 / 20 / 20，
 *   以及「摘要由谁生成」（LLM / 本地 / 本地）。
 * 更隐蔽的是后两处用 `localSummary(history.slice(1, len - keepRecent))` 手算摘要窗口，
 * 而 findCutRegion 的窗口会跳过开头的 tool 消息 —— 两者可能不是同一段，
 * 于是「摘要覆盖的内容」与「实际被压掉的内容」对不上。此处统一改用 findCutRegion 的结果，
 * 保证摘要窗口 === 压缩窗口。
 *
 * @param {Array} messages 完整对话消息（{role, content}）
 * @param {Object} [opts]
 * @param {number} [opts.budget] token 预算，超过则压缩
 * @param {number} [opts.keepRecent] 压缩时保留的最近消息数
 * @param {number} [opts.cutMin] 可压缩窗口的最小长度（太短不值得压）
 * @param {number} [opts.fallbackLimit] 尾部条数兜底上限（<=0 表示不限）
 * @param {'llm'|'local'} [opts.summaryStrategy] 'llm' 优先 LLM 摘要、失败降级本地；
 *        'local' 只做本地摘要（省一次 LLM 调用，适合轻量路径）
 * @param {(region:Array)=>Promise<string>} [opts.generateSummary] 'llm' 策略下的摘要器
 * @returns {Promise<{messages:Array, compressed:boolean, summaryText:string,
 *                    tokens:number, originalTokens:number, truncated:boolean}>}
 */
export async function packConversation(messages, opts = {}) {
  const {
    budget, keepRecent, cutMin, fallbackLimit, summaryStrategy, generateSummary,
  } = { ...PACK_DEFAULTS, ...opts };

  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], compressed: false, summaryText: '', tokens: 0, originalTokens: 0, truncated: false };
  }

  const originalTokens = estimateMessages(messages);
  const tail = (arr) => (fallbackLimit > 0 ? arr.slice(-fallbackLimit) : arr);

  // 未超预算：仍按条数上限收拢尾部（防止消息条数无界增长），不做摘要
  if (!shouldCompact(messages, budget)) {
    const out = tail(messages);
    return {
      messages: out,
      compressed: false,
      summaryText: '',
      tokens: estimateMessages(out),
      originalTokens,
      truncated: out.length < messages.length,
    };
  }

  // 超预算：摘要窗口与压缩窗口取自同一处（findCutRegion），消除口径错位
  const region = findCutRegion(messages, { keepRecent, cutMin });
  const preferLocal = summaryStrategy === 'local';
  const explicitSummary = preferLocal && region ? localSummary(region.cutRegion) : '';

  const packed = await buildContext(messages, budget, {
    keepRecent,
    cutMin,
    // 显式给出摘要文本时 buildContext 会跳过 generateSummary（省一次 LLM 调用）
    summaryText: explicitSummary || undefined,
    generateSummary: preferLocal ? undefined : generateSummary,
  });

  let out = packed.compressed ? packed.messages : tail(messages);
  // 终极兜底：压缩后仍超预算（或窗口压不动）时按条数收拢，绝不越界
  if (estimateMessages(out) > budget) out = tail(out);

  return {
    messages: out,
    compressed: !!packed.compressed,
    summaryText: packed.summaryText || '',
    tokens: estimateMessages(out),
    originalTokens,
    truncated: out.length < messages.length,
  };
}

/**
 * 构造 LLM 压缩摘要的提示词（纯函数，供 llmSummarizer 消费，便于单测）。
 * 与 localSummary 的"截断清单"不同，这里要求 LLM 输出**有信息密度的结构化摘要**：
 * 保留任务目标、已确认的关键事实/数据、已做过的动作与结论、未完成的缺口。
 */
export function buildCompactionPrompt(region) {
  const dialogue = (region || [])
    .map((m, i) => {
      const plain = String(m.content ?? '').trim();
      if (!plain) return '';
      const roleTag = m.role === 'user' ? '[用户]' : m.role === 'tool' ? '[工具输出]' : '[助手]';
      return `${i + 1} ${roleTag}\n${plain.slice(0, 1200)}${plain.length > 1200 ? '\n…(截断)' : ''}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return {
    system: [
      '你是对话上下文压缩器。你的任务是把一段早前的 agent 工作对话压缩成高密度摘要，供后续对话接力使用。',
      '摘要必须保留：① 用户的任务目标与约束；② 已确认的关键事实、数据、ID（含 [资讯:ID]/[素材:ID] 引用锚点）；③ 已执行的动作及其结论；④ 重要的中间判断；⑤ 尚未完成的缺口。',
      '用中文输出，使用紧凑的分点列表（不超过 15 点，每点不超过 60 字）。只输出摘要本身，不要任何开场白或解释。',
    ].join('\n'),
    user: `请压缩以下早前对话（共 ${region?.length || 0} 条消息）：\n\n${dialogue}\n\n摘要：`,
  };
}

/* ============ 模型窗口感知的预算解析（2026-09-22） ============ */
// 此前 48k/40k 是硬编码经验值，隐含假设模型窗口 ≥ 64k；换小窗口模型（如 32k 的
// qwen-max、16k 的 gpt-3.5）时会真溢出（上游 400/broken）。这里按模型名解析窗口、
// 推导安全预算；识别不了就回退调用方默认值——**未知模型行为与旧版完全一致**，
// 表只会在「确定比默认小」时收紧预算，永远不会放大。

/** 常见模型家族的上下文窗口（tokens）。保守优先：不确定的取家族最小主流值——
 *  预算算小了只是早一点压缩摘要（lossy 但可用），算大了是真的请求失败。 */
const MODEL_CONTEXT_WINDOWS = [
  // 名字里自带窗口的厂商（moonshot-v1-8k/32k/128k、qwen-*-128k 等）优先走正则，不进本表
  [/^claude/i, 200_000],
  [/^(gpt-4o|gpt-4\.1|gpt-4-turbo|o[134]|chatgpt)/i, 128_000],
  [/^gpt-3\.5/i, 16_000],
  [/^gemini/i, 128_000],
  [/^deepseek/i, 64_000],
  [/^qwen/i, 32_000],
  [/^(glm|chatglm)/i, 128_000],
  [/^(moonshot|kimi)/i, 128_000],
  [/^doubao/i, 128_000],
  [/^grok/i, 128_000],
  [/^(llama|meta-llama)/i, 32_000],
  [/^(mistral|minimax)/i, 128_000],
];

/** 从模型名直接解析显式窗口（如 moonshot-v1-128k → 128000）；解析不了返回 null。 */
function parseExplicitWindow(modelId) {
  const m = /-(\d{1,3})k\b/i.exec(String(modelId || ''));
  if (!m) return null;
  const k = Number(m[1]);
  return k >= 4 && k <= 2048 ? k * 1000 : null;
}

export function detectModelContextWindow(modelId) {
  const explicit = parseExplicitWindow(modelId);
  if (explicit) return explicit;
  for (const [pattern, window] of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(String(modelId || ''))) return window;
  }
  return null;
}

/** 输出预留：COMPLETION_MAX_TOKENS（见 constants/agentLoop.js）+ system prompt/工具 schema 粗估 */
const BUDGET_OUTPUT_HEADROOM = 8_000;
const BUDGET_OVERHEAD = 4_000;
/** 预算下限：低于这个值对话已经没法进行，宁可接受小窗口模型的体验受限 */
const BUDGET_FLOOR = 2_000;
/** tokenizer 估算误差 + 各 provider 计数差异的安全系数 */
const BUDGET_SAFETY = 0.85;

/**
 * 按模型解析上下文 token 预算。
 * 规则：budget = clamp(floor(window × 0.85) − 输出预留, 下限, fallback)。
 * - 窗口 ≥ 默认值（claude/gpt-4o/gemini…）：结果 === fallback，行为与旧版一致
 * - 小窗口模型（qwen-max 32k、gpt-3.5 16k…）：预算收紧到不炸
 * - 未知模型：直接返回 fallback（识别不了宁可不动）
 * @param {string} [modelId] llmConfig.selectedModel
 * @param {number} fallback 调用方默认预算（48k/40k）
 */
export function resolveContextBudget(modelId, fallback) {
  const window = detectModelContextWindow(modelId);
  if (!window || !Number.isFinite(fallback) || fallback <= 0) return fallback;
  const usable = Math.floor(window * BUDGET_SAFETY) - BUDGET_OUTPUT_HEADROOM - BUDGET_OVERHEAD;
  return Math.min(fallback, Math.max(BUDGET_FLOOR, usable));
}