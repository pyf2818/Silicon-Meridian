/**
 * editorService.js - LLM 编辑层精选（2026-09-22，方案 A：性价比优先）
 *
 * 定位：补上纯算法排序「不懂内容语义」的短板——LLM 当编辑，对 rankTop 条目做
 * 语义级判断（今日真热点 / 值得读 / 噪音），产出全站共享的轻量批注。
 *
 * 成本设计（核心约束）：
 *   - 每天 ≤1 次成功调用（Asia/Shanghai 日 key），失败退避 30 分钟，进程重启重算
 *     —— 无 PG 依赖，进程内缓存即可，月成本在便宜模型下 < ¥1
 *   - 一次产出全站共享（编辑判断是内容语义，与用户无关；个性化由既有 persona 链路负责）
 *   - 输入 Top 30（标题+来源+摘要前 120 字，≈6k tokens），输出 ≤1.2k tokens
 *   - 惰性触发（读路径发现当日缺失 → fire-and-forget），零新 API、零 cron 守护
 *
 * 降级语义：EDITOR_LLM_CONFIG 未配置 / 配置坏 / LLM 失败 → 编辑层静默关闭，
 * getNews 照常返回纯算法排序结果，主链路零影响。
 *
 * 安全：LLM 输出按输入 id 白名单过滤（幻觉 id 不生效），note 硬截断 80 字，
 * 前端以 React 文本节点渲染（无 HTML 注入面）。
 */
import { requestChatCompletion } from '../agent/llmClient.js';
import { createProfileRepository } from '../profile/profileRepository.js';

const EDITOR_TOP_N = 30;
const MAX_PICKS = 8;
const NOTE_MAX_CHARS = 80;
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
// 无可用配置时的探测短退避：避免资讯页每次翻页都点查 user_profiles
const DISABLED_RETRY_MS = 60 * 1000;

/** 进程内缓存：date → { result, computedAt }；running 防重入；lastErrorAt 驱动退避 */
const editorState = {
  date: '',
  picks: new Set(),
  noise: new Set(),
  notes: new Map(),
  computedAt: 0,
  running: false,
  lastErrorAt: 0,
  lastError: '',
  configSource: '',
  disabledUntil: 0,
};

/** 配置坏只报一次，避免每个请求刷屏。 */
let configErrorLogged = false;

function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

export function getEditorLlmConfig() {
  const raw = process.env.EDITOR_LLM_CONFIG;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.baseUrl && parsed?.selectedModel) {
      configErrorLogged = false;
      return parsed;
    }
  } catch { /* fallthrough */ }
  if (!configErrorLogged) {
    console.error('[editorService] EDITOR_LLM_CONFIG 配置无效（需 JSON：baseUrl/apiKey/selectedModel），将回退到当前用户配置');
    configErrorLogged = true;
  }
  return null;
}

/**
 * 解析编辑层 LLM 配置（async，仅在 fire-and-forget 链内调用，读路径零阻塞）：
 *   1. EDITOR_LLM_CONFIG env —— 管理员钉死全站编辑模型（最高优先）
 *   2. 当前登录用户在设置页配的模型（user_profiles.llm_config）—— 自部署场景零 env
 * 只取 baseUrl/apiKey/selectedModel 三字段，用户配置里的 tavilyKey 等无关密钥不进编辑层。
 * 返回 null 表示无可用配置（本次编辑层停用，60s 后允许重新探测）。
 */
export async function resolveEditorLlmConfig(userId) {
  const envConfig = getEditorLlmConfig();
  if (envConfig) return { config: envConfig, source: 'env' };
  if (userId) {
    try {
      const stored = await createProfileRepository().getLlmConfig(userId);
      if (stored?.baseUrl && stored?.selectedModel) {
        return {
          config: {
            baseUrl: String(stored.baseUrl),
            apiKey: stored.apiKey ? String(stored.apiKey) : '',
            selectedModel: String(stored.selectedModel),
          },
          source: `user:${String(userId).slice(0, 64)}`,
        };
      }
    } catch (err) {
      console.warn('[editorService] 读取用户 LLM 配置失败（本次编辑层停用）:', String(err?.message || err).slice(0, 120));
    }
  }
  return null;
}

export function getEditorState() {
  return {
    enabled: !!getEditorLlmConfig(),
    configSource: editorState.configSource,
    date: editorState.date,
    running: editorState.running,
    computedAt: editorState.computedAt || null,
    picks: editorState.picks.size,
    noise: editorState.noise.size,
    notes: editorState.notes.size,
    lastError: editorState.lastError,
  };
}

/** 构建编辑 prompt（纯函数，单测友好）。 */
export function buildEditorPrompt(topItems) {
  const list = (topItems || [])
    .map(item => `${item.id} | ${String(item.source || '').slice(0, 24)} | ${String(item.title || '').slice(0, 80)} | ${String(item.summary || '').slice(0, 120)}`)
    .join('\n');
  return {
    system: [
      '你是一位严谨的科技资讯编辑。给你一份按算法排序的候选资讯清单（id | 来源 | 标题 | 摘要）。',
      '你的任务：① 挑出今日真正重要、有信息价值的资讯（picks，最多 8 条 id）；② 标出营销软文、标题党、无实质内容的噪音（noise，id 列表）；③ 给最重要的几条写一句话编辑点评（notes，≤10 条，每条不超过 40 字，说清「为什么重要/影响什么」）。',
      '判断标准：信息增量、影响面、时效性、来源交叉度。宁缺毋滥，没有够格的可以少挑。',
      '只输出严格 JSON，不要任何解释或代码块标记：{"picks":["id"],"noise":["id"],"notes":[{"id":"id","note":"点评"}]}',
    ].join('\n'),
    user: `候选清单（共 ${(topItems || []).length} 条）：\n${list}\n\nJSON：`,
  };
}

/** 解析 LLM 输出（纯函数）：容忍代码块包裹 + 幻觉 id 白名单过滤 + note 截断。 */
export function parseEditorResponse(text, validIds) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const valid = new Set(validIds);
  const jsonText = (() => {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    return fenced ? fenced[1] : text;
  })();
  let parsed;
  try {
    parsed = JSON.parse(jsonText.trim());
  } catch {
    // 宽容截断的 JSON：定位第一个 { 到最后一个 } 再试一次
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { parsed = JSON.parse(jsonText.slice(start, end + 1)); } catch { return null; }
  }
  const inList = list => Array.isArray(list) ? list.filter(id => valid.has(String(id))) : [];
  const notes = new Map();
  if (Array.isArray(parsed?.notes)) {
    for (const entry of parsed.notes) {
      const id = String(entry?.id ?? '');
      if (!valid.has(id)) continue;
      const note = String(entry?.note ?? '').trim().slice(0, NOTE_MAX_CHARS);
      if (note && !notes.has(id)) notes.set(id, note);
    }
  }
  const picks = inList(parsed?.picks).slice(0, MAX_PICKS);
  return {
    picks: new Set(picks),
    noise: new Set(inList(parsed?.noise)),
    notes,
    noteForPick: id => notes.get(id) || '',
    pickCount: picks.length,
  };
}

/**
 * 惰性触发：当日未算且不在退避期 → fire-and-forget 跑一次编辑。
 * 由 getNews 读路径调用，绝不 await（读路径永不等 LLM）。
 * userId（可选）：env 未配置时，用该用户在设置页配的模型跑编辑层。
 * 注意：配置解析是 async，挪进了 fire-and-forget 链——无配置时静默停用
 * （只置 disabledUntil 短退避，不进 30min 失败退避，用户配好模型后 ≤60s 生效）。
 */
export function ensureDailyEditorRun(topItems, { userId = null } = {}) {
  const date = todayKey();
  const now = Date.now();
  if (editorState.date === date && editorState.computedAt) return { triggered: false, reason: 'already-computed' };
  if (editorState.running) return { triggered: false, reason: 'running' };
  if (now - editorState.lastErrorAt < FAILURE_BACKOFF_MS) return { triggered: false, reason: 'backoff' };
  if (now < editorState.disabledUntil) return { triggered: false, reason: 'disabled' };
  const candidates = (Array.isArray(topItems) ? topItems : []).filter(i => i?.id && i?.title);
  if (candidates.length < 5) return { triggered: false, reason: 'too-few-items' };

  editorState.running = true;
  // fire-and-forget：serverless 环境下可能被冻结，靠失败退避 + 下次请求重试最终一致
  Promise.resolve()
    .then(async () => {
      const resolved = await resolveEditorLlmConfig(userId);
      if (!resolved?.config) {
        editorState.configSource = '';
        editorState.disabledUntil = Date.now() + DISABLED_RETRY_MS;
        return;
      }
      const { config, source } = resolved;
      editorState.configSource = source;
      const prompt = buildEditorPrompt(candidates.slice(0, EDITOR_TOP_N));
      const data = await requestChatCompletion(config, {
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 1200,
        temperature: 0.2,
      }, { timeoutMs: 60_000 });
      const text = data?.choices?.[0]?.message?.content || '';
      const result = parseEditorResponse(text, candidates.slice(0, EDITOR_TOP_N).map(i => i.id));
      if (!result) throw new Error('编辑层输出无法解析为有效 JSON');
      editorState.date = date;
      editorState.picks = result.picks;
      editorState.noise = result.noise;
      editorState.notes = result.notes;
      editorState.computedAt = Date.now();
      editorState.lastError = '';
      console.log(`[editorService] ${date} 编辑完成（${source}）：精选 ${result.picks.size} / 噪音 ${result.noise.size} / 点评 ${result.notes.size}`);
    })
    .catch(err => {
      editorState.lastErrorAt = Date.now();
      editorState.lastError = String(err?.message || err).slice(0, 200);
      console.error('[editorService] 编辑失败（30 分钟后可重试）:', editorState.lastError);
    })
    .finally(() => {
      editorState.running = false;
    });
  return { triggered: true, date };
}

/** 把编辑批注合并进当前页条目（同步、无 LLM、无 IO，直接写条目引用——与图片解析同模式）。 */
export function applyEditorVerdicts(items) {
  if (!editorState.computedAt || !Array.isArray(items)) return items;
  for (const item of items) {
    if (!item?.id) continue;
    if (editorState.picks.has(item.id)) {
      item.editorPick = true;
      const note = editorState.notes.get(item.id);
      if (note) item.editorNote = note;
    } else if (editorState.notes.has(item.id)) {
      item.editorNote = editorState.notes.get(item.id);
    }
    if (editorState.noise.has(item.id)) item.editorNoise = true;
  }
  return items;
}

/** 仅测试用：清空进程内编辑状态（editorState 是模块级单例，用例间需隔离）。 */
export function resetEditorStateForTests() {
  editorState.date = '';
  editorState.picks = new Set();
  editorState.noise = new Set();
  editorState.notes = new Map();
  editorState.computedAt = 0;
  editorState.running = false;
  editorState.lastErrorAt = 0;
  editorState.lastError = '';
  editorState.configSource = '';
  editorState.disabledUntil = 0;
}
