/**
 * toolRegistry.js - Agent 工具注册表
 *
 * 方案 C Phase 1：把 agentTools.js 的硬编码 switch-case 改造为运行时可注册的 Map 架构。
 *
 * 设计要点：
 * - 工具来源：builtin（内置）/ custom-http（自定义 HTTP）/ custom-script（自定义脚本）
 * - 每个工具包含 schema（OpenAI Function Calling 协议）+ executor（执行函数）+ meta（UI 元信息）
 * - executor 接收 (args, ctx) 返回 string 或抛异常；toolRegistry 自动加超时保护
 * - 自定义工具持久化到 localStorage，启动时合并到注册表
 * - 内置工具从 agentTools.js 迁移过来（保持兼容）
 *
 * 与 agentTools.js 的关系：
 * - toolRegistry 是新的注册表（支持运行时注册）
 * - agentTools.js 继续导出 AGENT_TOOL_SCHEMAS / selectToolSchemas / executeAgentTool，但内部改为委托给 toolRegistry
 * - 现有调用方无需修改
 *
 * 沙箱集成（方案 C Phase 5）：
 * - meta.requiresApproval=true 的工具在执行前会调用 sandbox.requestApproval
 * - 用户在 UI 卡片中决策 allow-once / allow-always / deny
 * - allow-always 后本会话内同工具免再问
 * - 用户也可在 Settings 中对任意工具的 requiresApproval 进行覆写（持久化到 localStorage）
 */

import { requestApproval, hasSessionGrant, isEgressAllowed } from './sandbox.js';
import { validateToolArgs } from './toolArgsValidator.js';

const TOOL_TIMEOUT_MS = 15_000;

// 只读结果缓存（P2-11）：相同 name+args 的只读调用在会话内复用结果，避免重复网络/IO。
// 仅缓存明确只读的工具；写类 / 命令类 / 自定义 HTTP 不入缓存（有副作用）。
const CACHEABLE_READS = new Set([
  'read_workspace_file', 'web_search', 'fetch_page',
  'get_stock_quote', 'get_stock_kline', 'search_news',
]);
const resultCache = new Map(); // key -> result string
const RESULT_CACHE_MAX = 300;
function makeCacheKey(name, args) {
  try { return `${name}::${JSON.stringify(args || {})}`; } catch { return `${name}::${String(args)}`; }
}

/* ============ 工具审批覆写（用户在 Settings 中配置） ============ */

const APPROVAL_OVERRIDE_KEY = 'sandboxToolApprovalOverride';

function loadApprovalOverride() {
  try {
    const raw = localStorage.getItem(APPROVAL_OVERRIDE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

const approvalOverride = loadApprovalOverride();
const overrideListeners = new Set();

export function getApprovalOverride() {
  return { ...approvalOverride };
}

export function setApprovalOverride(name, requiresApproval) {
  if (requiresApproval === null || requiresApproval === undefined) {
    delete approvalOverride[name];
  } else {
    approvalOverride[name] = Boolean(requiresApproval);
  }
  try { localStorage.setItem(APPROVAL_OVERRIDE_KEY, JSON.stringify(approvalOverride)); } catch { /* ignore */ }
  overrideListeners.forEach(fn => { try { fn({ ...approvalOverride }); } catch { /* ignore */ } });
  emitChange(); // 同步更新 meta.requiresApproval
}

export function subscribeApprovalOverride(fn) {
  overrideListeners.add(fn);
  return () => overrideListeners.delete(fn);
}

/** 解析工具最终的 requiresApproval（用户覆写优先于默认值） */
function resolveRequiresApproval(name, defaultValue) {
  if (Object.prototype.hasOwnProperty.call(approvalOverride, name)) {
    return Boolean(approvalOverride[name]);
  }
  return Boolean(defaultValue);
}

/**
 * @typedef {Object} ToolEntry
 * @property {Object} schema - OpenAI Function Calling schema
 * @property {string} source - builtin | custom-http | custom-script
 * @property {Function} executor - async (args, ctx) => string
 * @property {Object} meta - { label, icon, description, category, requiresApproval }
 * @property {boolean} enabled - 是否启用（自定义工具可禁用）
 */

const registry = new Map();
const listeners = new Set();

/** 派发 schema 数组（只包含 enabled 工具） */
function emitChange() {
  listeners.forEach(fn => { try { fn(getAllTools()); } catch { /* ignore */ } });
}

/** 注册一个工具 */
export function registerTool(name, entry) {
  if (!name || typeof name !== 'string') throw new Error('工具名必须为非空字符串');
  const meta = entry.meta || { label: name, iconKey: 'settings' };
  // 用户在 Settings 中的覆写优先于工具默认 requiresApproval
  meta.requiresApproval = resolveRequiresApproval(name, meta.requiresApproval);
  registry.set(name, {
    schema: entry.schema,
    source: entry.source || 'custom',
    executor: entry.executor,
    meta,
    enabled: entry.enabled !== false,
    config: entry.config || {},
  });
  emitChange();
}

/** 注销一个工具（仅自定义工具可注销） */
export function unregisterTool(name) {
  const entry = registry.get(name);
  if (!entry || entry.source === 'builtin') return false;
  registry.delete(name);
  emitChange();
  return true;
}

/** 启用/禁用工具 */
export function setToolEnabled(name, enabled) {
  const entry = registry.get(name);
  if (!entry || entry.source === 'builtin') return false;
  entry.enabled = !!enabled;
  emitChange();
  return true;
}

/** 获取单个工具 */
export function getTool(name) {
  return registry.get(name) || null;
}

/** 获取所有工具（含 disabled，便于 UI 展示） */
export function getAllTools() {
  return Array.from(registry.entries()).map(([name, entry]) => ({ name, ...entry }));
}

/** 获取启用的工具 schema 数组（OpenAI 协议） */
export function getEnabledSchemas() {
  const result = [];
  for (const [, entry] of registry) {
    if (entry.enabled) result.push(entry.schema);
  }
  return result;
}

/** 按名称筛选 schema 数组（agent.tools 白名单） */
export function selectSchemasByName(toolNames) {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return [];
  const result = [];
  for (const name of toolNames) {
    const entry = registry.get(name);
    if (entry && entry.enabled) result.push(entry.schema);
  }
  return result;
}

/** 获取工具 UI 元信息（label/icon/description） */
export function getToolMeta(name) {
  const entry = registry.get(name);
  return entry?.meta || { label: name, iconKey: 'settings', description: '' };
}

/**
 * 判定本次调用是否需要用户审批 —— 全系统唯一审批判定处（P0-1）。
 *
 * 三种权限模式（v6 真实现）：
 *  - manual  手动：所有工具逐次确认
 *  - semi    半自动（默认）：仅敏感工具的写操作需审批，只读自动放行
 *  - auto    全自动：不需要任何审批（用户明确授权全托管）
 * 兼容旧值：assist → manual，autonomous → semi，plan（已废弃）→ semi。
 *
 * 注意：手动模式下依然复用 sandbox 的 allow-always grant，
 * 所以用户点过"本会话始终允许"后不会被重复打扰。
 *
 * @param {ToolEntry} entry
 * @param {Object} ctx
 * @param {Object} args
 * @returns {{ required: boolean, reason: string }}
 */
export function resolveApprovalDecision(entry, ctx, args) {
  const name = entry?.schema?.function?.name || '';
  const label = entry?.meta?.label || name;
  const sensitive = Boolean(entry?.meta?.requiresApproval);

  // 细粒度风险分级（P0-3）：像 execute_command 这种"一个工具名下藏着几十个子命令"的入口，
  // 整体标 requiresApproval 会让 `ls` / `grep` 这类纯读操作也弹卡，用户很快就会点到麻木、
  // 于是对真正危险的 `rm` 也无脑放行——这是安全设计上的经典失败。
  // 因此允许工具提供 riskLevel(args) 判定"本次调用"的风险，只读调用降级免审批。
  let grade = 'write';
  if (sensitive && typeof entry?.meta?.riskLevel === 'function') {
    try { grade = entry.meta.riskLevel(args || {}) || 'write'; } catch { grade = 'write'; }
  }

  // 旧值归一（localStorage 里可能还存着 v5 的 assist/autonomous/plan）
  const raw = ctx?.approvalMode || 'semi';
  const mode = raw === 'assist' ? 'manual' : (raw === 'autonomous' || raw === 'plan') ? 'semi' : raw;

  // 全自动：用户明确授权全托管，不做任何审批
  if (mode === 'auto') {
    return { required: false, reason: '' };
  }
  // 手动：所有工具逐次确认
  if (mode === 'manual') {
    return { required: true, reason: `手动模式：智能体请求调用工具 "${name}"` };
  }
  // 半自动（默认）：仅敏感工具的写操作需审批
  if (sensitive && grade !== 'read') {
    return { required: true, reason: `敏感操作：${label}` };
  }
  return { required: false, reason: sensitive ? `只读调用，自动放行：${name}` : '' };
}

/**
 * 执行单个工具调用（带超时保护 + 沙箱审批闸门）
 * @param {string} name 工具名
 * @param {Object} args 工具参数
 * @param {Object} ctx 运行时上下文（rootHandle / llmConfig / sessionId / approvalMode / signal 等）
 * @returns {Promise<string>} 工具执行结果
 *
 * 沙箱流程：
 *   1. resolveApprovalDecision 判定需要审批且 ctx.sessionId 非空时进入闸门
 *   2. 若该会话已对该工具 allow-always，直接放行（不再阻塞）
 *   3. 否则调用 sandbox.requestApproval 暂停 Agent Loop，UI 弹出审批卡片
 *   4. 用户决策：
 *      - allow-once / allow-always → 继续执行
 *      - deny → 返回错误信息（不抛异常，让 Agent Loop 知道是被用户拒绝）
 *      - cancel（abort/切换会话） → 同 deny
 */
export async function executeTool(name, args, ctx) {
  const entry = registry.get(name);
  if (!entry) return `错误：未知工具 "${name}"`;
  if (!entry.enabled) return `错误：工具 "${name}" 已被禁用`;

  // ── 运行时参数校验（schema 从此不是装饰品）──
  // 先跑工具自定义的参数归一化（历史别名兼容，如 web_search 的 keyword→query），再按
  // JSON Schema 子集校验 + 温和矫正（string→number 等）。校验失败直接返回结构化错误，
  // 让调用方（agent loop）把它作为工具结果回灌给 LLM 自修，不进入审批/执行。
  let effectiveArgs = args;
  if (typeof entry.meta?.normalizeArgs === 'function') {
    try { effectiveArgs = entry.meta.normalizeArgs(effectiveArgs); } catch { /* 归一化失败用原参数 */ }
  }
  const parameters = entry?.schema?.function?.parameters;
  if (parameters && typeof parameters === 'object') {
    const verdict = validateToolArgs(parameters, effectiveArgs);
    if (!verdict.ok) {
      // 空参数 + 该工具声明了 required：大概率是「参数 JSON 被输出上限截断」——
      // toolCallMerge 的卫生降级把非法（截断）参数替换成了 {}。给模型可执行的自愈路径，
      // 而不是让它原样重试（长文件场景下重试必然再次截断，死循环）。
      const isBlank = !effectiveArgs || (typeof effectiveArgs === 'object' && Object.keys(effectiveArgs).length === 0);
      const hasRequired = Array.isArray(parameters.required) && parameters.required.length > 0;
      if (isBlank && hasRequired) {
        return `错误：工具 "${name}" 的参数没有收到（大概率是上次输出的参数 JSON 超过输出上限被截断，已安全降级为空）。请拆分操作后重试：把大文件分成 2~3 次写入（每次 content 控制在 800 字以内，先 write 前半、再用 edit_file 或再次 write 追加后半），或精简要写入的内容。`;
      }
      return `错误：工具 "${name}" 参数校验失败：${verdict.error}。请修正参数后重新调用。`;
    }
    effectiveArgs = verdict.args;
  }

  // 沙箱审批闸门（唯一入口）
  const approval = resolveApprovalDecision(entry, ctx, effectiveArgs);
  if (approval.required) {
    // 精灵侧策略（approvalPolicy='deny'）：精灵是浮动助理，没有审批卡片 UI，
    // 悬挂的审批 Promise 会永远等待。写类敏感操作直接拒绝并引导去工作站；
    // 只读敏感操作（riskLevel='read'，如 fetch_page）不受影响。
    if (ctx?.approvalPolicy === 'deny') {
      return `错误：精灵未授权此操作：工具 "${name}" 涉及写入或敏感动作。请到 AI 工作站执行该操作，或由用户在工作站中调整审批策略。`;
    }
    if (ctx?.sessionId) {
      const sessionId = ctx.sessionId;
      // 已 allow-always 授权过：sandbox.requestApproval 内部会立即 resolve('allow-always')，无需再走 UI
      try {
        const decision = await requestApproval({
          sessionId,
          toolName: name,
          args: effectiveArgs,
          summary: summarizeToolCall(name, effectiveArgs),
          agentName: ctx.agentName || '',
          agentId: ctx.agentId || '',
          reason: approval.reason,
          mode: ctx.approvalMode || 'autonomous',
        });
        // 此处 decision ∈ {'allow-once', 'allow-always'}，继续执行
        void decision;
      } catch (err) {
        // 用户拒绝 / 取消：返回友好错误信息（不抛异常，让 Agent Loop 把它当作工具结果回灌给 LLM）
        if (err?.code === 'USER_DENIED') {
          return `错误：用户拒绝授权工具 "${name}"，本次调用未执行。`;
        }
        if (err?.code === 'CANCELLED') {
          return `错误：审批被取消（会话切换或停止生成）："${name}" 未执行。`;
        }
        return `错误：审批失败 - ${err?.message || String(err)}`;
      }
    }
  }

  // 只读结果缓存命中：跳过重复执行（P2-11）。放在审批闸门之后，
  // 因此首次仍要走审批/allow-always，仅对"完全相同的后续只读调用"复用结果（assist 模式也不会重复弹卡）。
  if (CACHEABLE_READS.has(name)) {
    const hit = resultCache.get(makeCacheKey(name, effectiveArgs));
    if (hit !== undefined) return hit;
  }

  // per-tool 超时：meta.timeoutMs 优先，缺省用全局 TOOL_TIMEOUT_MS
  const timeoutMs = Number(entry.meta?.timeoutMs) > 0
    ? Number(entry.meta.timeoutMs)
    : TOOL_TIMEOUT_MS;

  // 每次调用的独立取消信号 = 父级 ctx.signal（用户停止）+ 本调用超时。
  // 此前超时只是 Promise.race 弃等：executor 在后台继续跑——对 spawn_subagent
  // 这类长任务（预算 15min）意味着超时后仍在烧 LLM token、占连接。现在到点即向
  // executor 广播 abort（executor 拿到的是合并信号），在途 fetch / 嵌套循环被真掐断。
  const callCtrl = new AbortController();
  const onParentAbort = () => callCtrl.abort();
  if (ctx?.signal) {
    if (ctx.signal.aborted) callCtrl.abort();
    else ctx.signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const executorCtx = { ...(ctx || {}), signal: callCtrl.signal };

  let timer = null;
  try {
    const result = await Promise.race([
      entry.executor(effectiveArgs || {}, executorCtx),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error(`工具执行超时（${Math.round(timeoutMs / 1000)}s）`);
          // 带名字的标记错误：executor 侧 fetch 会以此 reason 拒绝，不会与
          // 「用户主动停止」的 AbortError 混淆（后者仍原样穿透上抛）。
          timeoutErr.name = 'ToolTimeoutError';
          callCtrl.abort(timeoutErr); // 先掐断 executor 的在途工作，race 随即以超时落败
          reject(timeoutErr);
        }, timeoutMs);
      }),
    ]);
    // 只读成功结果写入缓存（错误结果不缓存，便于下次重试真正执行）
    if (CACHEABLE_READS.has(name) && !String(result).startsWith('错误：')) {
      const key = makeCacheKey(name, effectiveArgs);
      if (resultCache.size >= RESULT_CACHE_MAX) {
        const oldest = resultCache.keys().next().value;
        if (oldest !== undefined) resultCache.delete(oldest);
      }
      resultCache.set(key, result);
    }
    return result;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return `工具执行失败：${err?.message || String(err)}`;
  } finally {
    // 不清理会导致每次工具调用泄漏一个 timer，长会话下累积成内存与唤醒噪声
    if (timer) clearTimeout(timer);
    ctx?.signal?.removeEventListener?.('abort', onParentAbort);
  }
}

/** 工具调用摘要（用于审批卡片展示参数） */
function summarizeToolCall(name, args) {
  try {
    const a = args || {};
    if (name === 'read_workspace_file' || name === 'write_workspace_file') return a.path || '';
    if (name === 'search_news') return a.keyword || '';
    if (name === 'web_search') return a.query || a.keyword || '';
    if (name === 'fetch_page') return a.url || '';
    if (name === 'get_stock_quote' || name === 'get_stock_kline') return a.code || '';
    if (name === 'execute_command') return a.command || '';
    const keys = Object.keys(a);
    if (keys.length === 0) return '';
    return JSON.stringify(a).slice(0, 200);
  } catch { return ''; }
}

/** 订阅注册表变化（UI 监听） */
export function subscribeTools(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ============ 自定义工具持久化 ============ */

const CUSTOM_TOOLS_KEY = 'agentCustomTools';

/** 加载 localStorage 中的自定义工具到注册表 */
export function loadCustomTools() {
  try {
    const raw = localStorage.getItem(CUSTOM_TOOLS_KEY);
    if (!raw) return;
    const customTools = JSON.parse(raw);
    if (!Array.isArray(customTools)) return;
    customTools.forEach(tool => {
      if (!tool?.name || !tool?.config) return;
      registerCustomHttpTool(tool.name, tool.config, tool.meta, tool.enabled);
    });
  } catch { /* ignore */ }
}

/** 持久化自定义工具列表到 localStorage */
export function saveCustomTools() {
  try {
    const customTools = getAllTools()
      .filter(t => t.source === 'custom-http')
      .map(t => ({
        name: t.name,
        config: t.config,
        meta: t.meta,
        enabled: t.enabled,
      }));
    localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(customTools));
  } catch { /* ignore */ }
}

/**
 * 注册一个自定义 HTTP 工具
 * @param {string} name 工具名（用户起名，需合法标识符）
 * @param {Object} config { method, url, headers, bodyTemplate, jsonPath, maxBytes }
 * @param {Object} meta { label, icon, description }
 * @param {boolean} enabled
 */
export function registerCustomHttpTool(name, config, meta, enabled = true) {
  // 工具名合法性校验：仅允许小写字母/数字/下划线，且不以数字开头
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error('工具名必须以小写字母开头，只能包含小写字母/数字/下划线');
  }
  const parameters = buildHttpToolParameters(config);
  registerTool(name, {
    source: 'custom-http',
    schema: {
      type: 'function',
      function: {
        name,
        description: meta?.description || `自定义 HTTP 工具：${config?.method || 'GET'} ${config?.url || ''}`,
        parameters,
      },
    },
    meta: {
      label: meta?.label || name,
      iconKey: meta?.iconKey || 'wrench',
      description: meta?.description || '',
      category: 'custom',
      // 默认必须审批（P1-8 安全收紧）。自定义 HTTP 工具 = 任意 URL + 任意 header（常含 API Key）
      // + 参数由模型填写，是 SSRF 与凭据外泄的最短路径；不该比内置的 fetch_page 更宽松。
      // 用户若确认某个工具安全，可在 Settings 的审批覆写里单独放行（走 approvalOverride）。
      requiresApproval: true,
      timeoutMs: Number(config?.timeoutMs) > 0 ? Number(config.timeoutMs) : 20_000,
    },
    enabled,
    config,
    executor: createHttpExecutor(config),
  });
  saveCustomTools();
}

/** 删除自定义 HTTP 工具（内置工具不可删） */
export function deleteCustomTool(name) {
  const removed = unregisterTool(name);
  if (removed) saveCustomTools();
  return removed;
}

/** 更新自定义 HTTP 工具配置（重新生成 schema 与 executor） */
export function updateCustomHttpTool(name, config, meta) {
  const existing = registry.get(name);
  if (!existing || existing.source !== 'custom-http') return false;
  const parameters = buildHttpToolParameters(config);
  registry.set(name, {
    ...existing,
    schema: {
      type: 'function',
      function: {
        name,
        description: meta?.description || `自定义 HTTP 工具：${config?.method || 'GET'} ${config?.url || ''}`,
        parameters,
      },
    },
    meta: {
      label: meta?.label || existing.meta?.label || name,
      iconKey: meta?.iconKey || existing.meta?.iconKey || 'wrench',
      description: meta?.description || existing.meta?.description || '',
      category: 'custom',
      // 与 registerCustomHttpTool 保持一致：默认必须审批，例外走 Settings 覆写
      requiresApproval: resolveRequiresApproval(name, true),
      timeoutMs: Number(config?.timeoutMs) > 0 ? Number(config.timeoutMs) : 20_000,
    },
    config,
    executor: createHttpExecutor(config),
  });
  emitChange();
  saveCustomTools();
  return true;
}

/**
 * 试运行自定义 HTTP 工具（不写入注册表，直接执行配置好的 executor）
 * 用于编辑器中的"测试"按钮
 */
export async function testCustomHttpTool(config, args = {}) {
  const executor = createHttpExecutor(config);
  return await executor(args, {});
}

/** 根据配置构造 OpenAI schema 的 parameters */
function buildHttpToolParameters(config) {
  // 提取 URL 中 {{param}} 占位符作为 required 参数
  const urlParams = (config?.url || '').match(/\{\{(\w+)\}\}/g) || [];
  const urlParamNames = urlParams.map(p => p.slice(2, -2));
  const bodyParams = (config?.bodyTemplate || '').match(/\{\{(\w+)\}\}/g) || [];
  const bodyParamNames = bodyParams.map(p => p.slice(2, -2));

  const properties = {};
  const required = [];
  [...new Set([...urlParamNames, ...bodyParamNames])].forEach(name => {
    properties[name] = { type: 'string', description: `参数 ${name}` };
    required.push(name);
  });

  return { type: 'object', properties, required };
}

/** 占位符名转安全正则（避免用户参数名里的正则元字符破坏匹配） */
function placeholderRegex(key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\{\\{${escaped}\\}\\}`, 'g');
}

/** 构造 HTTP 执行器 */
function createHttpExecutor(config) {
  return async (args, ctx) => {
    // 替换 URL 占位符
    let url = config.url || '';
    Object.entries(args).forEach(([k, v]) => {
      url = url.replace(placeholderRegex(k), encodeURIComponent(String(v)));
    });

    // 出口白名单校验（P1-8）：自定义工具的 URL 模板由用户写、参数由模型填，
    // 不校验等于给模型开了一个任意出口。白名单为空时 isEgressAllowed 放行全部合法 http(s)。
    if (!isEgressAllowed(url)) {
      return `错误：目标地址被沙箱出口白名单拒绝或不是合法的 http(s) URL：${url.slice(0, 200)}`;
    }

    // 替换 body 占位符
    let bodyStr = config.bodyTemplate || '';
    if (bodyStr) {
      // JSON 模板要做转义：模板通常长这样 {"q":"{{query}}"}，
      // 若参数里含引号/换行/反斜杠，直接字符串拼接会把 JSON 撕坏（甚至被构造成注入额外字段）。
      // JSON.stringify 后去掉首尾引号 = 标准 JSON 字符串转义。
      const looksJson = /^\s*[{[]/.test(bodyStr);
      Object.entries(args).forEach(([k, v]) => {
        const raw = String(v);
        const safe = looksJson ? JSON.stringify(raw).slice(1, -1) : raw;
        bodyStr = bodyStr.replace(placeholderRegex(k), () => safe);
      });
      // 兜底自检：转义后仍不是合法 JSON 就直接报错，别把坏 body 发出去
      if (looksJson) {
        try { JSON.parse(bodyStr); } catch {
          return '错误：请求体模板在填入参数后不是合法 JSON，请检查 bodyTemplate 的占位符位置。';
        }
      }
    }

    const headers = { ...(config.headers || {}) };
    if (bodyStr && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    // 中断信号：优先跟随 Agent Loop 的 controller（用户点"停止"能真掐断），
    // 同时叠加自身超时；两者任一触发即取消。
    const timeoutMs = Number(config?.timeoutMs) > 0 ? Number(config.timeoutMs) : 20_000;
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (ctx?.signal) signals.push(ctx.signal);
    const signal = typeof AbortSignal.any === 'function' && signals.length > 1
      ? AbortSignal.any(signals)
      : signals[0];

    const res = await fetch(url, {
      method: config.method || 'GET',
      headers,
      body: bodyStr || undefined,
      signal,
    });

    if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;

    const contentType = res.headers.get('content-type') || '';
    let text;
    if (contentType.includes('application/json')) {
      const json = await res.json();
      // 支持 jsonPath 提取（简化版：a.b.c 路径）
      if (config.jsonPath) {
        text = JSON.stringify(extractJsonPath(json, config.jsonPath), null, 2);
      } else {
        text = JSON.stringify(json, null, 2);
      }
    } else {
      text = await res.text();
    }

    const maxBytes = config.maxBytes || 12000;
    if (text.length > maxBytes) {
      return text.slice(0, maxBytes) + `\n\n[响应过长，已截断，原长度 ${text.length} 字符]`;
    }
    return text || '(空响应)';
  };
}

/** 简化的 JSON 路径提取（a.b.c） */
function extractJsonPath(obj, path) {
  const parts = String(path).split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}
