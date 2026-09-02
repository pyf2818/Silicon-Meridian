/**
 * agentTools.js - 智能体工具（向后兼容层）
 *
 * 方案 C Phase 1：原本的硬编码工具注册表已迁移到 toolRegistry.js。
 * 本文件继续导出 AGENT_TOOL_SCHEMAS / selectToolSchemas / executeAgentTool
 * 供现有调用方使用，内部委托给 toolRegistry。
 *
 * 同时负责注册 6 个内置工具到 toolRegistry（仅在首次 import 时执行）。
 * 自定义工具的注册、编辑、删除请直接使用 toolRegistry 的 API。
 */

import { readFile, writeFile, deleteFile } from './workspace.js';
import { indexFile, searchFiles, listRecentFiles } from './workspaceIndex.js';
import {
  registerTool, selectSchemasByName, executeTool, getToolMeta,
  loadCustomTools, getEnabledSchemas,
} from './toolRegistry.js';
import {
  setPlan, addTask, updateTask, setVariable, writeBlackboard,
  getVariable, readBlackboard, buildSessionContextText,
  setActiveSessionId,
} from './sessionStore.js';
import {
  validateWorkspacePath, isEgressAllowed, getEgressAllowlist,
  hasSessionGrant,
} from './sandbox.js';

/* ============ 内置工具实现 ============ */

/** 股票代码归一化：自动补全 market 前缀。
 * LLM 不必准确记忆 sh/sz/hk 前缀规则，传 "600519" / "600519.SH" / "sh600519" 都能识别。
 * - 6 位数字 + 6/9 开头 → sh 前缀（沪市）
 * - 6 位数字 + 0/3 开头 → sz 前缀（深市）
 * - 已带 sh/sz/hk 前缀或美股字母代码：原样返回
 */
function normalizeStockCode(raw) {
  const code = String(raw || '').trim().toLowerCase();
  if (!code) return '';
  if (/^(sh|sz|hk)/.test(code)) return code;
  if (/^[a-z]{1,6}$/.test(code)) return code.toUpperCase();
  if (/^\d{6}\.(sh|sz)$/.test(code)) return code.replace('.', '');
  if (/^\d{6}$/.test(code)) {
    const first = code.charAt(0);
    if (first === '6' || first === '9') return 'sh' + code;
    if (first === '0' || first === '3') return 'sz' + code;
  }
  if (/^\d{5}$/.test(code)) return 'hk' + code;
  return code;
}

async function toolReadWorkspaceFile(args, ctx) {
  if (!ctx?.rootHandle) {
    return '错误：用户未连接工作空间。请提示用户在左侧"工作空间"tab 选择文件夹后再试。';
  }
  const path = String(args?.path || '').trim();
  const check = validateWorkspacePath(path);
  if (!check.ok) return `错误：${check.error}`;
  const text = await readFile(ctx.rootHandle, check.segments);
  const max = 12000;
  if (text.length > max) {
    return text.slice(0, max) + `\n\n[文件过长，已截断，原长度 ${text.length} 字符]`;
  }
  return text || '(文件为空)';
}

async function toolWriteWorkspaceFile(args, ctx) {
  if (!ctx?.rootHandle) {
    return '错误：用户未连接工作空间。请提示用户在左侧"工作空间"tab 选择文件夹后再试。';
  }
  const path = String(args?.path || '').trim();
  const content = String(args?.content ?? '');
  const check = validateWorkspacePath(path);
  if (!check.ok) return `错误：${check.error}`;
  const segments = check.segments;
  await writeFile(ctx.rootHandle, segments.slice(0, -1), segments[segments.length - 1], content);
  // 写入即索引：agent 写入工作空间的文件自动进入知识索引，供后续对话召回（知识库闭环）
  try { await indexFile(path, segments[segments.length - 1], content); } catch { /* 索引失败不影响写入 */ }
  return `已写入文件：${path}（${content.length} 字符）`;
}

/* 复制工作空间内文件：读取源 → 写入目标（目标已存在则覆盖） */
async function toolCopyWorkspaceFile(args, ctx) {
  if (!ctx?.rootHandle) {
    return '错误：用户未连接工作空间。请提示用户在左侧"工作空间"tab 选择文件夹后再试。';
  }
  const src = String(args?.source || '').trim();
  const dst = String(args?.destination || '').trim();
  if (!src || !dst) return '错误：source 与 destination 参数均不能为空';
  const srcCheck = validateWorkspacePath(src);
  if (!srcCheck.ok) return `错误：源路径 ${srcCheck.error}`;
  const dstCheck = validateWorkspacePath(dst);
  if (!dstCheck.ok) return `错误：目标路径 ${dstCheck?.error || dstCheck.error}`;
  const text = await readFile(ctx.rootHandle, srcCheck.segments);
  const dstSegments = dstCheck.segments;
  await writeFile(ctx.rootHandle, dstSegments.slice(0, -1), dstSegments[dstSegments.length - 1], text);
  return `已复制文件：${src} → ${dst}（${text.length} 字符）`;
}

/* 移动工作空间内文件：复制源到目标后删除源（等价于 mv） */
async function toolMoveWorkspaceFile(args, ctx) {
  if (!ctx?.rootHandle) {
    return '错误：用户未连接工作空间。请提示用户在左侧"工作空间" tab 选择文件夹后再试。';
  }
  const src = String(args?.source || '').trim();
  const dst = String(args?.destination || '').trim();
  if (!src || !dst) return '错误：source 与 destination 参数均不能为空';
  const srcCheck = validateWorkspacePath(src);
  if (!srcCheck.ok) return `错误：源路径 ${srcCheck.error}`;
  const dstCheck = validateWorkspacePath(dst);
  if (!dstCheck.ok) return `错误：目标路径 ${dstCheck.error}`;
  const text = await readFile(ctx.rootHandle, srcCheck.segments);
  const dstSegments = dstCheck.segments;
  await writeFile(ctx.rootHandle, dstSegments.slice(0, -1), dstSegments[dstSegments.length - 1], text);
  await deleteFile(ctx.rootHandle, srcCheck.segments);
  return `已移动文件：${src} → ${dst}（${text.length} 字符）`;
}

/**
 * 编辑已有文件：支持两种模式
 * 1. 精准替换：提供 old_string + new_string，在文件中找到 old_string 替换为 new_string
 * 2. 全量重写：只提供 content，覆盖整个文件（与 write_workspace_file 等价，但语义更明确）
 *
 * 优先使用精准替换模式，避免重写整个文件（减少 token 消耗和意外修改）
 */
async function toolEditFile(args, ctx) {
  if (!ctx?.rootHandle) {
    return '错误：用户未连接工作空间。请提示用户在左侧"工作空间"tab 选择文件夹后再试。';
  }
  const path = String(args?.path || '').trim();
  if (!path) return '错误：path 参数不能为空';
  const check = validateWorkspacePath(path);
  if (!check.ok) return `错误：${check.error}`;
  const segments = check.segments;

  // 先读取现有内容
  let original;
  try {
    original = await readFile(ctx.rootHandle, segments.slice(0, -1).concat([segments[segments.length - 1]]));
  } catch {
    return `错误：文件不存在或无法读取：${path}`;
  }

  const oldStr = String(args?.old_string ?? '');
  const newStr = String(args?.new_string ?? '');
  const fullContent = args?.content;

  if (oldStr) {
    // 精准替换模式
    if (!original.includes(oldStr)) {
      // 提供上下文帮助 LLM 定位
      const preview = original.slice(0, 500);
      return `错误：在文件中未找到 old_string。请确认 old_string 与文件内容完全一致（含空白符）。\n\n文件开头预览：\n${preview}`;
    }
    const occurrences = original.split(oldStr).length - 1;
    if (occurrences > 1 && !args?.replace_all) {
      return `错误：old_string 在文件中出现 ${occurrences} 次。请提供更长的上下文使其唯一匹配，或设置 replace_all=true 替换全部。`;
    }
    const updated = args?.replace_all
      ? original.split(oldStr).join(newStr)
      : original.replace(oldStr, newStr);
    await writeFile(ctx.rootHandle, segments.slice(0, -1), segments[segments.length - 1], updated);
    try { await indexFile(path, segments[segments.length - 1], updated); } catch { /* 索引失败不影响编辑 */ }
    const changeSummary = oldStr.length === newStr.length
      ? `${occurrences} 处替换`
      : `${oldStr.length} → ${newStr.length} 字符`;
    return `已编辑文件：${path}（${changeSummary}，文件总长 ${updated.length} 字符）`;
  }

  if (fullContent !== undefined) {
    // 全量重写模式
    const content = String(fullContent);
    await writeFile(ctx.rootHandle, segments.slice(0, -1), segments[segments.length - 1], content);
    try { await indexFile(path, segments[segments.length - 1], content); } catch { /* 索引失败不影响重写 */ }
    const delta = content.length - original.length;
    return `已重写文件：${path}（原 ${original.length} 字符 → 新 ${content.length} 字符，${delta >= 0 ? '+' : ''}${delta}）`;
  }

  return '错误：必须提供 old_string+new_string（精准替换）或 content（全量重写）之一';
}

async function toolSearchNews(args, ctx) {
  const keyword = String(args?.keyword || '').trim();
  if (!keyword) return '错误：keyword 参数不能为空';
  const pageSize = Math.max(1, Math.min(Number(args?.pageSize) || 8, 20));

  // 防御 cold-cache：newsService 首次会并发抓 265 个 RSS 源（沙盒网络受限下可能 30s 都抓不完），
  // 给首次 fetch 加 10s 预算，超时立即降级到 /api/intelligence/events（事件聚类已缓存，无 RSS 冷启动）。
  const withTimeout = (url, opts = {}, ms = 10000) =>
    Promise.race([
      fetch(url, opts),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`请求超时（${ms / 1000}s）`)), ms)),
    ]);

  let items = [];
  let newsTimedOut = false;
  try {
    const res = await withTimeout(`/api/news?search=${encodeURIComponent(keyword)}&pageSize=${pageSize}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.ok) items = Array.isArray(data.items) ? data.items : [];
    }
  } catch (err) {
    if (/超时/.test(String(err?.message || ''))) newsTimedOut = true;
  }

  // 主路径（/api/news）结果为空或超时：降级到 intelligence 事件接口（已有聚类缓存，不依赖 RSS 冷启动）
  if (items.length === 0) {
    try {
      const intRes = await withTimeout(
        `/api/intelligence/events?take=80&storage=auto&q=${encodeURIComponent(keyword)}`,
        {},
        10000,
      );
      if (intRes.ok) {
        const intData = await intRes.json();
        if (intData?.ok && Array.isArray(intData.events)) {
          const kw = keyword.toLowerCase();
          // intelligence 返回的事件字段是 {id, title, summary, source, url, sources[], entities[], category, ...}
          // 客户端按关键词命中过滤（title/summary/entities），并按 intelligenceScore 排序取 pageSize
          const matched = intData.events
            .filter(ev => {
              if (kw.length === 0) return true;
              const text = `${ev.title || ''} ${ev.summary || ''} ${(ev.entities || []).join(' ')}`.toLowerCase();
              return text.includes(kw);
            })
            .sort((a, b) => (b.intelligenceScore || 0) - (a.intelligenceScore || 0))
            .slice(0, pageSize)
            .map(ev => ({
              id: ev.id,
              title: ev.title,
              summary: ev.summary,
              source: (ev.sources || [])[0] || ev.source || '情报事件',
              url: ev.url,
              publishedAt: ev.lastSeenAt || ev.publishedAt,
              category: ev.category,
              categoryLabel: ev.categoryLabel,
            }));
          items = matched;
        }
      }
    } catch {
      // 静默：后续 fallback 兜底
    }
  }

  // 缓存未命中或结果为空时，尝试增大 pageSize 重新搜索（仅当 news 未超时时）
  if (items.length === 0 && !newsTimedOut) {
    try {
      const retryRes = await withTimeout(`/api/news?search=${encodeURIComponent(keyword)}&pageSize=40`, {}, 10000);
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        if (retryData?.ok) {
          const allItems = Array.isArray(retryData.items) ? retryData.items : [];
          // 客户端关键词匹配 fallback
          const kw = keyword.toLowerCase();
          items = allItems.filter(item =>
            (item.title || '').toLowerCase().includes(kw) ||
            (item.summary || '').toLowerCase().includes(kw)
          ).slice(0, pageSize);
        }
      }
    } catch { /* ignore */ }
  }
  if (items.length === 0) {
    // 最后 fallback：尝试联网搜索
    // 注意：与「联网搜索（web_search）」工具不同，此处不携带用户在设置中配置的
    // 豆包/Tavily Key（仅当 Key 已配置到服务端环境变量时才可能成功）。
    let webData = null;
    try {
      const webRes = await fetch('/api/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: keyword, max_results: 6 }),
      });
      if (webRes.ok) webData = await webRes.json();
    } catch {
      // 网络异常：走下方引导文案
    }
    if (webData?.ok && Array.isArray(webData.results) && webData.results.length > 0) {
      const lines = webData.results.map((item, i) =>
        `${i + 1}. ${item.title || '(无标题)'}\n   链接：${item.url || ''}\n   摘要：${String(item.snippet || '').slice(0, 200)}`
      );
      return `资讯库中未找到 "${keyword}"，已通过联网搜索补充 ${webData.results.length} 条结果：\n\n${lines.join('\n\n')}`;
    }

    // 联网兜底失败：给出友好引导，提示改用「联网搜索（web_search）」工具。
    // 该工具会携带用户配置的 Key，配置后即可正常联网查询。
    const webSearchEnabled = ctx?.webSearchEnabled !== false && ctx?.llmConfig?.webSearchEnabled !== false;
    const hasKey = Boolean(String(ctx?.doubaoSearchKey || ctx?.llmConfig?.doubaoSearchKey || '').trim())
      || Boolean(String(ctx?.tavilyKey || ctx?.llmConfig?.tavilyKey || '').trim());
    let hint;
    if (!webSearchEnabled) {
      hint = '同时「设置 → 大模型配置」中的「联网搜索总开关」当前为关闭状态，请先开启后再让它联网查询。';
    } else if (hasKey) {
      hint = '如需联网补充，请调用「联网搜索（web_search）」工具，用关键词 "' + keyword + '" 联网查询。';
    } else {
      hint = '如需联网补充，请调用「联网搜索（web_search）」工具（需先在「设置 → 大模型配置」填入豆包搜索 API Key：火山引擎订阅「豆包搜索 Custom 版」，国内访问稳定，每月免费 500 次）。';
    }
    return `本地资讯库中未找到与 "${keyword}" 相关的资讯，联网兜底暂不可用。${hint}`;
  }
  const lines = items.map((item, i) =>
    `${i + 1}. ${item.title}\n   来源：${item.source || '未知'} | ${item.publishedAt ? new Date(item.publishedAt).toLocaleString('zh-CN') : '时间未知'}\n   摘要：${String(item.summary || '').slice(0, 200)}`
  );
  return `找到 ${items.length} 条相关资讯：\n\n${lines.join('\n\n')}`;
}

/**
 * read_intelligence_focus - 按主题拉取聚焦情报证据（事件级，含多源交叉验证与置信度）。
 * 与 search_news（关键词找单条资讯）互补：这里返回的是聚类后的事件 + 引用 ID，
 * agent 可直接以 [资讯:ID] 引用（ID 会登记进 ctx.focusCitations 供终答引用校验放行）。
 */
async function toolReadIntelligenceFocus(args, ctx) {
  const topic = String(args?.topic || '').trim();
  if (!topic) return '错误：topic 参数不能为空（想深入的主题，如某公司/模型/领域）';
  const take = Math.max(4, Math.min(Number(args?.take) || 10, 24));

  const params = new URLSearchParams({ take: String(take * 2), q: topic, storage: 'auto' });
  if (args?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date))) params.set('date', String(args.date));
  if (args?.category) params.set('category', String(args.category).trim().slice(0, 32));

  try {
    const res = await fetch(`/api/intelligence/events?${params.toString()}`);
    if (!res.ok) return `错误：情报接口返回 ${res.status}`;
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.events) || data.events.length === 0) {
      return `未找到与 "${topic}" 相关的情报事件。可尝试换一个关键词，或改用 search_news / web_search 工具补充。`;
    }

    const events = data.events.slice(0, take);
    // 登记引用 ID：runAgentLoop 终答引用校验会把这些 ID 加入合法引用集
    if (Array.isArray(ctx?.focusCitations)) {
      events.forEach(ev => { if (ev?.id) ctx.focusCitations.push(String(ev.id)); });
    }

    const lines = events.map(ev => {
      const src = (ev.sources || []).length ? ev.sources.join('、') : (ev.source || '情报事件');
      const summary = String(ev.summary || '').replace(/\s+/g, ' ').slice(0, 400);
      return `[资讯:${ev.id}] ${ev.title}\n  来源：${src}（${ev.independentSourceCount || 1} 个独立源，置信度 ${ev.confidence || 0}%）\n  摘要：${summary || '无'}`;
    });
    return `聚焦主题 "${topic}" 的 ${events.length} 条情报事件（可直接以 [资讯:ID] 格式引用）：\n\n${lines.join('\n\n')}`;
  } catch (err) {
    return `错误：聚焦情报拉取失败 - ${err?.message || err}`;
  }
}

/**
 * list_knowledge - 检索工作空间知识库（agent 写入/用户导出的文件索引）。
 * 有 keyword 时按相关性检索；无 keyword 时列出最近沉淀的条目。
 */
async function toolListKnowledge(args) {
  const keyword = String(args?.keyword || '').trim();
  const limit = Math.max(1, Math.min(Number(args?.limit) || 10, 30));
  try {
    let results;
    if (keyword) {
      results = await searchFiles(keyword, limit);
    } else {
      results = await listRecentFiles(limit);
    }
    if (!results.length) {
      return keyword
        ? `知识库中没有与 "${keyword}" 相关的沉淀。可先分析并用 save_knowledge 沉淀，或用 read_intelligence_focus 拉取情报。`
        : '知识库当前为空。可在分析产出结论后用 save_knowledge 沉淀，沉淀会同时写入素材库与工作空间 knowledge/ 目录。';
    }
    const lines = results.map((f, i) =>
      `${i + 1}. ${f.name}\n   路径：${f.path || f.name}`
    );
    return `知识库${keyword ? `中与 "${keyword}" 相关` : '最近'}的 ${results.length} 条沉淀：\n\n${lines.join('\n')}\n\n用 read_workspace_file 工具读取具体文件内容。`;
  } catch (err) {
    return `错误：知识库检索失败 - ${err?.message || err}`;
  }
}

async function toolFetchPage(args, ctx) {
  const url = String(args?.url || '').trim();
  if (!url) return '错误：url 参数不能为空';
  if (!/^https?:\/\//.test(url)) return '错误：url 必须以 http:// 或 https:// 开头';
  // 沙箱网络出口白名单
  if (!isEgressAllowed(url)) {
    const list = getEgressAllowlist();
    return `错误：URL "${url}" 的域名不在出口白名单中。当前白名单：${list.length ? list.join(', ') : '(空)'}`;
  }
  const res = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`);
  if (!res.ok) return `错误：抓取接口返回 ${res.status}`;
  const data = await res.json();
  if (!data?.ok) return `错误：${data?.error || '网页抓取失败'}`;
  const text = String(data.content || '');
  const max = 12000;
  if (text.length > max) {
    return text.slice(0, max) + `\n\n[正文过长，已截断，原长度 ${text.length} 字符]`;
  }
  return text || '(网页正文为空)';
}

/**
 * 创建/更新技能：让 AI 在对话中主动沉淀经验为 skill
 * - source 默认 'work'（工作沉淀），用户主动调用时可指定 'user'
 * - builtin 拒绝写入（后端兜底校验）
 * - 写入后通过 ctx.onSkillCreated 回调通知前端刷新 skillsHook（与右侧边栏面板同步）
 */
async function toolCreateSkill(args, ctx) {
  const title = String(args?.title || '').trim();
  if (!title) return '错误：title 不能为空（请给技能起一个简短的名字）';
  const body = String(args?.body || '').trim();
  if (!body) return '错误：body 不能为空（请提供 Prompt 模板或技能说明）';

  // id 由标题生成 kebab-case + 短随机后缀（避免冲突）
  const baseId = title.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'work-skill';
  const id = `${baseId}-${Math.random().toString(36).slice(2, 6)}`;

  // 触发词：可选，逗号分隔字符串或数组
  const triggersRaw = args?.triggers;
  const triggers = Array.isArray(triggersRaw)
    ? triggersRaw.map(s => String(s).trim()).filter(Boolean)
    : String(triggersRaw || '').split(',').map(s => s.trim()).filter(Boolean);

  // 依赖工具：可选
  const toolsRaw = args?.tools;
  const tools = Array.isArray(toolsRaw)
    ? toolsRaw.map(s => String(s).trim()).filter(Boolean)
    : String(toolsRaw || '').split(',').map(s => s.trim()).filter(Boolean);

  // source：默认 work，用户可在 args 显式指定 user
  const source = (args?.source === 'user') ? 'user' : 'work';

  const skill = {
    id,
    title: title.slice(0, 60),
    description: String(args?.description || '').slice(0, 200) || `工作技能：${title.slice(0, 30)}`,
    category: String(args?.category || 'work').slice(0, 32),
    triggers,
    tools,
    tags: [],
    version: '0.1.0',
    author: source === 'user' ? '用户创建' : '工作沉淀',
    body,
    source,
  };

  try {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skill),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return `错误：${data?.error || `http ${res.status}`}`;
    }
    // 通知前端刷新 skillsHook 缓存（与右侧边栏面板同步）
    if (typeof ctx?.onSkillCreated === 'function') {
      try { ctx.onSkillCreated(data.skill); } catch { /* noop */ }
    }
    return `已${source === 'user' ? '创建用户技能' : '沉淀工作技能'}：${skill.title}\nID：${skill.id}\n触发词：${triggers.length ? triggers.join(', ') : '(无)'}\n依赖工具：${tools.length ? tools.join(', ') : '(无)'}\n\n可在右侧边栏「技能」tab 查看与编辑。`;
  } catch (err) {
    return `错误：${err?.message || '创建失败'}`;
  }
}

/**
 * 联网搜索：豆包搜索（火山引擎，国内首选） > Tavily > DuckDuckGo
 * 返回结构化文本：标题、链接、摘要，便于 LLM 后续引用
 */
/**
 * save_knowledge - 让 Agent 主动把本次分析的结构化产出沉淀为知识库条目（素材）。
 * 与 create_skill（沉淀方法论）互补：这里沉淀的是「结论/资料/可复用判断」，
 * 而不是「工作流程」。
 *
 * 落库走 ctx.onSaveKnowledge(payload) 回调（与 create_skill 的 onSkillCreated 同型），
 * 前端把它转成素材（addManualMaterial / toggleMaterial）。无回调时提示用户手动保存。
 */
async function toolSaveKnowledge(args, ctx) {
  const title = String(args?.title || '').trim();
  if (!title) return '错误：title 不能为空（请给这条知识起一个简短标题）';
  const content = String(args?.content || '').trim();
  if (!content) return '错误：content 不能为空（请提供知识/结论的正文）';

  const tags = Array.isArray(args?.tags) ? args.tags.map(String).slice(0, 10) : [];

  const payload = {
    title: title.slice(0, 80),
    content,
    summary: String(args?.summary || '').slice(0, 300) || content.slice(0, 200),
    source: 'AI 智能体沉淀',
    category: String(args?.category || 'ai-knowledge').slice(0, 32),
    type: String(args?.type || 'knowledge').slice(0, 24),
    tags,
    url: String(args?.url || ''),
    insight: content.slice(0, 300),
    spaceId: args?.spaceId || null,
    metadata: {
      origin: 'ai-agent',
      agentId: ctx?.agentId || '',
      agentName: ctx?.agentName || '',
      reason: 'agent 知识沉淀',
    },
  };

  // 双落点之一：工作空间文件（用户定义的本地文件数据库——写入即成为知识库）
  // knowledge/YYYY-MM-DD-<标题>.md + 自动进知识索引（后续对话可召回）
  let workspaceSaved = null;
  if (ctx?.rootHandle) {
    try {
      const d = new Date();
      const ymd = d.toISOString().slice(0, 10);
      const slug = title.toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'knowledge';
      const fileName = `${ymd}-${slug}.md`;
      const markdown = [
        `# ${title}`,
        '',
        `> 沉淀于 ${d.toLocaleString('zh-CN')} · 来源：AI 工作站对话${ctx?.agentName ? ` · ${ctx.agentName}` : ''}`,
        tags.length ? `> 标签：${tags.join('、')}` : '',
        args?.url ? `> 来源链接：${args.url}` : '',
        '',
        content,
      ].filter(line => line !== null).join('\n');
      workspaceSaved = await writeFile(ctx.rootHandle, ['knowledge'], fileName, markdown);
      try { await indexFile(workspaceSaved, fileName, markdown); } catch { /* 索引失败不影响落盘 */ }
    } catch {
      // 工作空间写入失败（未授权/只读）：不影响素材库沉淀
      workspaceSaved = null;
    }
  }

  // 双落点之二：素材库（toggleMaterial，供素材面板/交接使用）
  let materialSaved = false;
  if (typeof ctx?.onSaveKnowledge === 'function') {
    try {
      ctx.onSaveKnowledge(payload);
      materialSaved = true;
    } catch (err) {
      return `错误：知识沉淀失败 - ${err?.message || String(err)}`;
    }
  }

  const parts = [];
  if (materialSaved) parts.push('素材库条目');
  if (workspaceSaved) parts.push(`工作空间文件 ${workspaceSaved}（已入知识索引，后续对话可自动召回）`);
  if (parts.length) {
    return `已沉淀：${title}（${content.length} 字符）→ ${parts.join('；')}。`;
  }
  return '知识内容已准备好（当前环境无法自动保存）：\n- 标题：' + title + '\n- 正文：' + content.slice(0, 120) + (content.length > 120 ? '…' : '');
}

async function toolWebSearch(args, ctx) {
  const query = String(args?.query || args?.keyword || '').trim();
  if (!query) return '错误：query 参数不能为空';
  // 联网搜索总开关兜底：即使 LLM 通过其他途径触发了 web_search（如 execute_command 的 search 子命令），
  // 在开关关闭时也直接拒绝，确保不会消耗任何额度
  if (ctx?.webSearchEnabled === false || ctx?.llmConfig?.webSearchEnabled === false) {
    return '联网搜索已被用户在设置中关闭。如需联网信息，请提示用户前往设置 → 大模型 → 联网搜索总开关开启。';
  }
  const maxResults = Math.max(1, Math.min(Number(args?.max_results) || 6, 20));
  // 从 ctx 取 API Key（用户在设置面板配置），未配置则后端使用环境变量
  const tavilyKey = ctx?.tavilyKey || ctx?.llmConfig?.tavilyKey || '';
  const doubaoKey = ctx?.doubaoSearchKey || ctx?.llmConfig?.doubaoSearchKey || '';
  const headers = { 'Content-Type': 'application/json' };
  if (tavilyKey) headers['X-Tavily-Key'] = tavilyKey;
  if (doubaoKey) headers['X-Doubao-Search-Key'] = doubaoKey;
  const res = await fetch('/api/web-search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, max_results: maxResults }),
  });
  if (!res.ok) return `错误：搜索接口返回 ${res.status}`;
  const data = await res.json();
  if (!data?.ok) {
    const errMsg = typeof data?.error === 'string' ? data.error : (data?.error?.message || '搜索失败');
    return `错误：${errMsg}`;
  }
  const items = Array.isArray(data.results) ? data.results : [];
  if (items.length === 0) return `未找到与 "${query}" 相关的网页`;
  const providerLabelMap = {
    doubao: '豆包搜索',
    tavily: 'Tavily',
    duckduckgo: 'DuckDuckGo',
    'free-hn': 'Hacker News',
    'free-bing': '必应',
    'free-se': 'Stack Exchange',
  };
  const providerLabel = providerLabelMap[data.provider] || '联网搜索';
  const lines = items.map((item, i) => {
    const title = item.title || '(无标题)';
    const url = item.url || '';
    const snippet = String(item.snippet || '').slice(0, 280);
    const score = Number.isFinite(Number(item.score)) ? `（相关性 ${Math.round(Number(item.score) * 100)}%）` : '';
    return `${i + 1}. ${title}${score}\n   链接：${url}\n   摘要：${snippet}`;
  });
  return `已通过 ${providerLabel} 联网搜索 "${query}"，找到 ${items.length} 条结果：\n\n${lines.join('\n\n')}`;
}

async function toolGetStockQuote(args, ctx) {
  const rawCode = String(args?.code || '').trim();
  if (!rawCode) return '错误：code 参数不能为空';
  const code = normalizeStockCode(rawCode);
  const res = await fetch(`/api/stock/realtime?code=${encodeURIComponent(code)}`);
  if (!res.ok) return `错误：行情接口返回 ${res.status}`;
  const data = await res.json();
  if (!data?.ok) return `错误：${data?.error || '行情查询失败'}`;
  const q = data.realtime || {};
  const lines = [
    `股票：${q.name || '-'} (${q.code || code})`,
    `现价：${q.price ?? '-'}  涨跌：${q.change ?? '-'} (${q.changePct ?? '-'}%)`,
    `昨收：${q.prevClose ?? '-'}  今开：${q.open ?? '-'}`,
    `最高：${q.high ?? '-'}  最低：${q.low ?? '-'}`,
    `成交量：${q.volume ?? '-'}  成交额：${q.amount ?? '-'}`,
  ];
  if (Array.isArray(q.bids) && q.bids.length) {
    lines.push(`五档买盘：${q.bids.slice(0, 5).map(b => `${b.price}/${b.volume}`).join('  ')}`);
  }
  if (Array.isArray(q.asks) && q.asks.length) {
    lines.push(`五档卖盘：${q.asks.slice(0, 5).map(a => `${a.price}/${a.volume}`).join('  ')}`);
  }
  return lines.join('\n');
}

async function toolGetStockKline(args, ctx) {
  const rawCode = String(args?.code || '').trim();
  if (!rawCode) return '错误：code 参数不能为空';
  const code = normalizeStockCode(rawCode);
  const period = ['101', '102', '103'].includes(args?.period) ? args.period : '101';
  const count = Math.max(1, Math.min(Number(args?.count) || 30, 120));
  const res = await fetch(`/api/stock/kline?code=${encodeURIComponent(code)}&period=${period}&count=${count}`);
  if (!res.ok) return `错误：K 线接口返回 ${res.status}`;
  const data = await res.json();
  if (!data?.ok) return `错误：${data?.error || 'K 线查询失败'}`;
  const klines = Array.isArray(data?.klineData?.klines) ? data.klineData.klines : [];
  if (klines.length === 0) return '未获取到 K 线数据';
  const lines = klines.slice(-count).map(k =>
    `${k.date}  开 ${k.open}  高 ${k.high}  低 ${k.low}  收 ${k.close}  量 ${k.volume || 0}`
  );
  return `最近 ${lines.length} 根 K 线：\n${lines.join('\n')}`;
}

/* ============ 会话状态管理工具（方案 C Phase 3） ============ */

/** 设置执行计划 */
function toolSetPlan(args, ctx) {
  const sessionId = ctx?.sessionId;
  if (!sessionId) return '错误：未关联会话，无法设置执行计划';
  const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
  if (tasks.length === 0) return '错误：tasks 必须为非空数组';
  // 校验任务结构并简化字段
  const sanitized = tasks.map((t, i) => ({
    id: t.id || `t${i + 1}`,
    title: String(t.title || `任务 ${i + 1}`).slice(0, 100),
    status: 'pending',
    deps: Array.isArray(t.deps) ? t.deps : [],
    note: t.note ? String(t.note).slice(0, 200) : '',
    toolName: t.toolName ? String(t.toolName) : '',
  }));
  setPlan(sessionId, sanitized);
  return `已设置执行计划（${sanitized.length} 个任务）：\n${sanitized.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}`;
}

/** 添加单个任务 */
function toolAddTask(args, ctx) {
  const sessionId = ctx?.sessionId;
  if (!sessionId) return '错误：未关联会话';
  const title = String(args?.title || '').trim();
  if (!title) return '错误：title 不能为空';
  const id = addTask(sessionId, {
    title,
    deps: Array.isArray(args?.deps) ? args.deps : [],
    note: args?.note ? String(args.note).slice(0, 200) : '',
    toolName: args?.toolName ? String(args.toolName) : '',
  });
  return `已添加任务：${title}（id=${id}）`;
}

/** 更新任务状态 */
function toolUpdateTask(args, ctx) {
  const sessionId = ctx?.sessionId;
  if (!sessionId) return '错误：未关联会话';
  const taskId = String(args?.taskId || '').trim();
  if (!taskId) return '错误：taskId 不能为空';
  const validStatus = ['pending', 'running', 'done', 'failed', 'skipped'];
  const status = validStatus.includes(args?.status) ? args.status : null;
  if (!status) return `错误：status 必须是 ${validStatus.join('/')} 之一`;
  const ok = updateTask(sessionId, taskId, {
    status,
    result: args?.result ? String(args.result).slice(0, 500) : '',
    note: args?.note ? String(args.note).slice(0, 200) : undefined,
  });
  return ok ? `已更新任务 ${taskId} → ${status}` : `错误：未找到任务 ${taskId}`;
}

/** 设置变量（持久化到会话） */
function toolSetVariable(args, ctx) {
  const sessionId = ctx?.sessionId;
  if (!sessionId) return '错误：未关联会话';
  const key = String(args?.key || '').trim();
  if (!key) return '错误：key 不能为空';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return '错误：key 必须是合法标识符（字母/数字/下划线，不能以数字开头）';
  // value 支持任意类型（string/number/boolean/array/object）
  setVariable(sessionId, key, args?.value);
  const valStr = typeof args?.value === 'string' ? args.value : JSON.stringify(args?.value);
  return `已设置变量 ${key} = ${String(valStr).slice(0, 100)}`;
}

/** 写黑板（工具产出共享给后续工具） */
function toolWriteBlackboard(args, ctx) {
  const sessionId = ctx?.sessionId;
  if (!sessionId) return '错误：未关联会话';
  const key = String(args?.key || '').trim();
  if (!key) return '错误：key 不能为空';
  writeBlackboard(sessionId, key, args?.value);
  return `已写入黑板 ${key}`;
}

/* ============ 命令执行能力（方案 C Phase 4） ============ */

/**
 * execute_command - 统一的命令入口（类似 Claude Code 的 bash 工具）
 *
 * 浏览器环境无法直接执行 shell，这里通过解析命令字符串路由到现有工具能力，
 * 既提供了 shell 风格的统一入口，又避免了真正的进程执行风险。
 *
 * 支持的子命令：
 *   news <keyword>            搜索资讯
 *   search <query>            联网搜索（Tavily/DuckDuckGo）
 *   fetch <url>               抓取网页正文
 *   stock <code>              查询股票行情
 *   kline <code> [period] [count]  获取 K 线
 *   read <path>               读取工作空间文件
 *   write <path> <content>    写入工作空间文件
 *   plan                      查看当前执行计划
 *   plan.add <title>           追加任务
 *   plan.set <taskId> <status> 更新任务状态
 *   var <key> [value]         查看 / 设置变量
 *   bb <key> [value]          读取 / 写入黑板
 *   tools                     列出可用工具
 *   help                      显示帮助
 *
 * 参数可用引号包裹（支持 "..." / '...'），未识别命令会进入 help。
 */
async function toolExecuteCommand(args, ctx) {
  const raw = String(args?.command || '').trim();
  if (!raw) return '错误：command 不能为空。输入 `help` 查看可用命令。';

  // 简易 shell 风格 tokenizer：支持单/双引号包裹参数
  const tokens = tokenizeCommand(raw);
  const sub = (tokens[0] || '').toLowerCase();
  const rest = tokens.slice(1);

  switch (sub) {
    case 'news': {
      const keyword = rest.join(' ').trim();
      if (!keyword) return '用法：news <keyword>';
      return await toolSearchNews({ keyword, pageSize: 8 }, ctx);
    }
    case 'fetch': {
      const url = rest[0] || '';
      if (!url) return '用法：fetch <url>';
      return await toolFetchPage({ url }, ctx);
    }
    case 'search':
    case 'web': {
      const query = rest.join(' ').trim();
      if (!query) return '用法：search <query>';
      return await toolWebSearch({ query, max_results: 6 }, ctx);
    }
    case 'stock': {
      const code = rest[0] || '';
      if (!code) return '用法：stock <code>';
      return await toolGetStockQuote({ code }, ctx);
    }
    case 'kline': {
      const code = rest[0] || '';
      if (!code) return '用法：kline <code> [period=101] [count=30]';
      const period = rest[1] || '101';
      const count = rest[2] ? Number(rest[2]) : 30;
      return await toolGetStockKline({ code, period, count }, ctx);
    }
    case 'read': {
      const path = rest[0] || '';
      if (!path) return '用法：read <path>';
      return await toolReadWorkspaceFile({ path }, ctx);
    }
    case 'write': {
      const path = rest[0] || '';
      if (!path) return '用法：write <path> <content>';
      // 支持多 token 内容（已去引号）
      const content = rest.slice(1).join(' ');
      if (!content) return '用法：write <path> <content>';
      return await toolWriteWorkspaceFile({ path, content }, ctx);
    }
    case 'plan':
    case 'plan.add':
    case 'plan.set': {
      const sessionId = ctx?.sessionId;
      if (!sessionId) return '错误：未关联会话';
      // 确保会话状态已激活（不会覆盖现有数据）
      try { setActiveSessionId(sessionId); } catch { /* ignore */ }

      // 兼容两种语法：plan add / plan.add
      let action = '';
      let actionArgs = rest;
      if (sub === 'plan.add') { action = 'add'; }
      else if (sub === 'plan.set') { action = 'set'; }
      else if (rest[0] === 'add' || rest[0] === 'set') {
        action = rest[0];
        actionArgs = rest.slice(1);
      }

      // 没有子命令：显示当前计划
      if (!action) {
        return buildPlanText(sessionId);
      }
      if (action === 'add') {
        const title = actionArgs.join(' ').trim();
        if (!title) return '用法：plan.add <title> 或 plan add <title>';
        return toolAddTask({ title }, ctx);
      }
      if (action === 'set') {
        const taskId = actionArgs[0] || '';
        const status = actionArgs[1] || '';
        if (!taskId || !status) return '用法：plan.set <taskId> <status> 或 plan set <taskId> <status>';
        return toolUpdateTask({ taskId, status }, ctx);
      }
      return '用法：plan | plan.add <title> | plan.set <taskId> <status>';
    }
    case 'var': {
      const sessionId = ctx?.sessionId;
      if (!sessionId) return '错误：未关联会话';
      const key = rest[0] || '';
      if (!key) return '用法：var <key> [value]';
      // 只读
      if (rest.length === 1) {
        const val = getVariablesSync(sessionId, key);
        const valStr = typeof val === 'string' ? val : JSON.stringify(val);
        return `${key} = ${String(valStr).slice(0, 200)}`;
      }
      // 写入：value 可以是字符串或 JSON
      const rawVal = rest.slice(1).join(' ');
      let parsed;
      try { parsed = JSON.parse(rawVal); } catch { parsed = rawVal; }
      return toolSetVariable({ key, value: parsed }, ctx);
    }
    case 'bb': {
      const sessionId = ctx?.sessionId;
      if (!sessionId) return '错误：未关联会话';
      const key = rest[0] || '';
      if (!key) return '用法：bb <key> [value]';
      if (rest.length === 1) {
        const val = getBlackboardValue(sessionId, key);
        const valStr = typeof val === 'string' ? val : JSON.stringify(val);
        return `${key} = ${String(valStr).slice(0, 200)}`;
      }
      const rawVal = rest.slice(1).join(' ');
      let parsed;
      try { parsed = JSON.parse(rawVal); } catch { parsed = rawVal; }
      return toolWriteBlackboard({ key, value: parsed }, ctx);
    }
    case 'tools': {
      return listAvailableTools(ctx);
    }
    /* ====== 沙箱子命令（方案 C Phase 5）====== */
    case 'ls':
    case 'dir': {
      const path = rest[0] || '.';
      return await sandboxLs(ctx, path);
    }
    case 'tree': {
      const path = rest[0] || '.';
      const depth = rest[1] ? Math.max(1, Math.min(Number(rest[1]) || 3, 4)) : 3;
      return await sandboxTree(ctx, path, depth);
    }
    case 'glob': {
      const pattern = rest[0] || '';
      if (!pattern) return '用法：glob <pattern> [path]\n示例：glob *.md  glob **/*.txt';
      const searchPath = rest[1] || '.';
      return await sandboxGlob(ctx, pattern, searchPath);
    }
    case 'grep': {
      const pattern = rest[0] || '';
      if (!pattern) return '用法：grep <pattern> [path]\n示例：grep "TODO"  grep "fixme" notes/';
      const searchPath = rest[1] || '.';
      return await sandboxGrep(ctx, pattern, searchPath);
    }
    case 'touch': {
      const path = rest[0] || '';
      if (!path) return '用法：touch <path>';
      return await sandboxTouch(ctx, path);
    }
    case 'mkdir': {
      const path = rest[0] || '';
      if (!path) return '用法：mkdir <path>';
      return await sandboxMkdir(ctx, path);
    }
    case 'rm':
    case 'del': {
      const path = rest[0] || '';
      if (!path) return '用法：rm <path>';
      return await sandboxRm(ctx, path);
    }
    case 'pwd': {
      return '工作空间根目录（沙箱内无 cwd 概念，所有路径都是相对根目录的）';
    }
    case 'sandbox':
    case 'sb': {
      // 沙箱状态查看
      const list = getEgressAllowlist();
      return [
        '沙箱状态：',
        `- 工作空间根：${ctx?.rootHandle?.name || '(未连接)'}`,
        `- 网络出口白名单：${list.length ? list.join(', ') : '(空 = 放行全部)'}`,
        `- 当前会话授权工具：${listSessionGrantsText(ctx?.sessionId)}`,
        '',
        '可用子命令：ls / tree / glob / grep / touch / mkdir / rm / pwd / sandbox',
      ].join('\n');
    }
    case 'help':
    case '?':
      return EXEC_HELP_TEXT;
    default:
      return `未知命令：${sub}\n\n${EXEC_HELP_TEXT}`;
  }
}

/* ============ execute_command 风险分级（P0-3） ============ */

/**
 * 只读 / 幂等子命令：不产生副作用，也不打开任意网络出口 → 免审批。
 * 注意 news/search 虽然走网络，但目标是本站自己的检索 API，URL 不由模型控制。
 */
const EXEC_READONLY_SUBS = new Set([
  'news', 'search', 'web', 'stock', 'kline', 'read',
  'ls', 'dir', 'tree', 'glob', 'grep', 'pwd',
  'tools', 'sandbox', 'sb', 'help', '?',
]);

/**
 * 写 / 高危子命令：改动工作空间，或由模型完全控制目标 URL（fetch 是任意出口）→ 必须审批。
 * 关键点：execute_command 内部是直接调 toolWriteWorkspaceFile / toolFetchPage 这些函数，
 * 绕过了 toolRegistry 的审批闸门；若不在这里补上分级，等于开了一个审批旁路。
 */
const EXEC_WRITE_SUBS = new Set([
  'write', 'touch', 'mkdir', 'rm', 'del', 'fetch',
  'plan.add', 'plan.set',
]);

/**
 * 判定一条 execute_command 命令的风险等级。
 * @param {string} command 原始命令串
 * @returns {'read'|'write'}
 */
export function gradeCommandRisk(command) {
  const tokens = tokenizeCommand(String(command || '').trim());
  const sub = (tokens[0] || '').toLowerCase();
  const rest = tokens.slice(1);
  if (!sub) return 'read'; // 空命令只会回用法提示
  if (EXEC_WRITE_SUBS.has(sub)) return 'write';
  // plan / var / bb 是读写同名，靠参数形态区分
  if (sub === 'plan') return (rest[0] === 'add' || rest[0] === 'set') ? 'write' : 'read';
  if (sub === 'var' || sub === 'bb') return rest.length > 1 ? 'write' : 'read';
  if (EXEC_READONLY_SUBS.has(sub)) return 'read';
  // 未知子命令只会返回 help 文本，无副作用
  return 'read';
}

/** 极简 tokenizer：支持单/双引号包裹参数 */
function tokenizeCommand(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

const EXEC_HELP_TEXT = `execute_command 支持的子命令：

【资讯 / 网络】
  news <keyword>              搜索资讯库
  search <query>              联网搜索（Tavily 优先，自动 fallback DuckDuckGo）
  fetch <url>                 抓取网页正文（受沙箱出口白名单约束）

【股票】
  stock <code>               查询股票实时行情（600519/sh600519/000001）
  kline <code> [period] [n]   获取 K 线（period: 101日/102周/103月）

【工作空间文件（沙箱）】
  read <path>                 读取工作空间文件
  write <path> <content>     写入工作空间文件
  ls [path]                   列出目录内容（默认根目录）
  tree [path] [depth=3]      显示目录树（深度 1-4）
  glob <pattern> [path]      通配符匹配文件（如 *.md / **/*.txt）
  grep <pattern> [path]       在文件内容中搜索文本
  touch <path>                创建空文件（或更新时间戳）
  mkdir <path>                创建目录
  rm <path>                   删除文件（沙箱内限定工作空间根）
  pwd                         显示当前工作根目录

【会话状态】
  plan                        查看当前执行计划
  plan.add <title>            追加任务到计划
  plan.set <taskId> <status>  更新任务状态（pending/running/done/failed/skipped）
  var <key> [value]           查看/设置变量（value 可为 JSON）
  bb <key> [value]            读取/写入黑板

【沙箱 / 工具】
  sandbox                     查看沙箱状态（出口白名单 / 会话授权）
  tools                       列出可用工具
  help                        显示此帮助

参数可用单/双引号包裹，例如：write notes.md "今天的关键发现"`;

function buildPlanText(sessionId) {
  // sessionStore 已通过 setActiveSessionId 触发 ensureSession
  const text = buildSessionContextText(sessionId);
  return text || '（当前会话暂无执行计划）';
}

function getVariablesSync(sessionId, key) {
  return getVariable(sessionId, key);
}

function getBlackboardValue(sessionId, key) {
  return readBlackboard(sessionId, key);
}

function listAvailableTools(ctx) {
  const names = Array.isArray(ctx?.agentTools) ? ctx.agentTools : [];
  if (names.length === 0) return '当前未配置工具白名单';
  const lines = names.map(name => {
    const meta = getToolMeta(name);
    return `  ${name}  - ${meta.label || ''} ${meta.description ? '：' + meta.description : ''}`;
  });
  return `当前 agent 可用工具（${names.length} 个）：\n${lines.join('\n')}`;
}

/* ============ 沙箱子命令实现（方案 C Phase 5） ============
 * 全部限定在工作空间根目录内，路径校验统一走 sandbox.validateWorkspacePath。
 * 不真正执行 shell，而是通过 File System Access API 完成等价操作。
 */

/** 列出会话内已 allow-always 的工具 */
function listSessionGrantsText(sessionId) {
  if (!sessionId) return '(无会话)';
  const allTools = getEnabledSchemas().map(s => s.function.name);
  const granted = allTools.filter(n => hasSessionGrant(sessionId, n));
  return granted.length ? granted.join(', ') : '(无)';
}

/** 解析相对路径，返回 { ok, error, dir, name }，dir 用于 getDirectoryHandle */
async function resolveSandboxPath(ctx, rawPath, { create = false } = {}) {
  if (!ctx?.rootHandle) {
    return { ok: false, error: '错误：用户未连接工作空间。请在左侧"工作空间"tab 选择文件夹后再试。' };
  }
  const path = String(rawPath || '').trim() || '.';
  const check = validateWorkspacePath(path === '.' ? '' : path);
  // '.' 或空：根目录
  if (path === '.') {
    return { ok: true, dir: ctx.rootHandle, name: '', segments: [], isRoot: true };
  }
  if (!check.ok) return { ok: false, error: `错误：${check.error}` };
  const segments = check.segments;
  let dir = ctx.rootHandle;
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i], { create });
  }
  return {
    ok: true,
    dir,
    name: segments[segments.length - 1],
    segments,
    isRoot: false,
  };
}

/** ls [path]：列出目录内容 */
async function sandboxLs(ctx, rawPath) {
  const resolved = await resolveSandboxPath(ctx, rawPath);
  if (!resolved.ok) return resolved.error;
  const targetDir = resolved.isRoot ? ctx.rootHandle
    : await resolved.dir.getDirectoryHandle(resolved.name).catch(() => null);
  if (!targetDir) return `错误：目录 "${rawPath}" 不存在`;
  const entries = [];
  for await (const entry of targetDir.values()) {
    entries.push({
      name: entry.name,
      kind: entry.kind,
      isDir: entry.kind === 'directory',
    });
  }
  if (entries.length === 0) return `(目录 "${rawPath}" 为空)`;
  // 目录在前，文件在后
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const lines = entries.map(e => {
    const icon = e.isDir ? '📁' : '📄';
    const suffix = e.isDir ? '/' : '';
    return `  ${icon}  ${e.name}${suffix}`;
  });
  return `${rawPath === '.' ? '工作空间根目录' : rawPath}（${entries.length} 项）：\n${lines.join('\n')}`;
}

/** tree [path] [depth]：显示目录树 */
async function sandboxTree(ctx, rawPath, maxDepth) {
  const resolved = await resolveSandboxPath(ctx, rawPath);
  if (!resolved.ok) return resolved.error;
  const rootDir = resolved.isRoot ? ctx.rootHandle
    : await resolved.dir.getDirectoryHandle(resolved.name).catch(() => null);
  if (!rootDir) return `错误：目录 "${rawPath}" 不存在`;
  const lines = [resolved.isRoot ? '📂 (root)' : `📂 ${resolved.name}/`];
  async function walk(dir, prefix, depth) {
    if (depth > maxDepth) return;
    const entries = [];
    for await (const entry of dir.values()) entries.push(entry);
    entries.sort((a, b) => {
      if ((a.kind === 'directory') !== (b.kind === 'directory')) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const last = i === entries.length - 1;
      const branch = last ? '└── ' : '├── ';
      const icon = entry.kind === 'directory' ? '📁' : '📄';
      lines.push(`${prefix}${branch}${icon} ${entry.name}${entry.kind === 'directory' ? '/' : ''}`);
      if (entry.kind === 'directory') {
        await walk(entry, prefix + (last ? '    ' : '│   '), depth + 1);
      }
    }
  }
  await walk(rootDir, '', 1);
  // 限制输出长度
  const max = 12000;
  const text = lines.join('\n');
  if (text.length > max) return text.slice(0, max) + `\n\n[输出过长，已截断，原长度 ${text.length} 字符]`;
  return text;
}

/** glob <pattern> [path]：通配符匹配 */
async function sandboxGlob(ctx, pattern, rawPath) {
  const resolved = await resolveSandboxPath(ctx, rawPath);
  if (!resolved.ok) return resolved.error;
  const rootDir = resolved.isRoot ? ctx.rootHandle
    : await resolved.dir.getDirectoryHandle(resolved.name).catch(() => null);
  if (!rootDir) return `错误：目录 "${rawPath}" 不存在`;
  // 把 shell glob 转成正则：* -> [^/]*, ** -> .*
  const regexStr = String(pattern || '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^${regexStr}$`);
  const matches = [];
  async function walk(dir, prefix, depth) {
    if (depth > 4) return;
    for await (const entry of dir.values()) {
      const p = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'file' && regex.test(entry.name)) {
        matches.push(p);
      }
      if (entry.kind === 'directory') {
        // 也匹配目录名
        if (regex.test(entry.name)) matches.push(p + '/');
        await walk(entry, p, depth + 1);
      }
    }
  }
  await walk(rootDir, resolved.isRoot ? '' : resolved.name, 0);
  if (matches.length === 0) return `(没有匹配 ${pattern} 的文件)`;
  matches.sort();
  return `匹配 ${pattern}：${matches.length} 项\n${matches.slice(0, 100).map((m, i) => `${i + 1}. ${m}`).join('\n')}${matches.length > 100 ? `\n... 共 ${matches.length} 项，仅显示前 100 项` : ''}`;
}

/** grep <pattern> [path]：在文件内容中搜索 */
async function sandboxGrep(ctx, pattern, rawPath) {
  if (!pattern) return '错误：pattern 不能为空';
  const resolved = await resolveSandboxPath(ctx, rawPath);
  if (!resolved.ok) return resolved.error;
  const rootDir = resolved.isRoot ? ctx.rootHandle
    : await resolved.dir.getDirectoryHandle(resolved.name).catch(() => null);
  if (!rootDir) return `错误：目录 "${rawPath}" 不存在`;
  const regex = new RegExp(pattern, 'i');
  const matches = [];
  const MAX_FILE_SIZE = 100_000;
  const MAX_MATCHES = 50;
  async function walk(dir, prefix, depth) {
    if (depth > 4 || matches.length >= MAX_MATCHES) return;
    for await (const entry of dir.values()) {
      if (matches.length >= MAX_MATCHES) break;
      const p = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        // 跳过二进制文件（简单判断：扩展名）
        const lower = entry.name.toLowerCase();
        if (/\.(png|jpg|jpeg|gif|webp|ico|bmp|pdf|zip|tar|gz|rar|7z|exe|dll|so|bin)$/i.test(lower)) continue;
        try {
          const fileHandle = await entry.getFileHandle();
          const file = await fileHandle.getFile();
          if (file.size > MAX_FILE_SIZE) continue;
          const text = await file.text();
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push({ file: p, line: i + 1, text: lines[i].slice(0, 200) });
              if (matches.length >= MAX_MATCHES) break;
            }
          }
        } catch { /* skip file */ }
      } else {
        await walk(entry, p, depth + 1);
      }
    }
  }
  await walk(rootDir, resolved.isRoot ? '' : resolved.name, 0);
  if (matches.length === 0) return `(没有匹配 "${pattern}" 的内容)`;
  const lines = matches.map((m, i) =>
    `${i + 1}. ${m.file}:${m.line}  ${m.text.trim().slice(0, 120)}`
  );
  return `匹配 "${pattern}"：${matches.length} 处（最多显示 ${MAX_MATCHES} 处）\n${lines.join('\n')}`;
}

/** touch <path>：创建空文件或更新时间戳 */
async function sandboxTouch(ctx, rawPath) {
  if (!ctx?.rootHandle) return '错误：用户未连接工作空间';
  const check = validateWorkspacePath(rawPath);
  if (!check.ok) return `错误：${check.error}`;
  const segments = check.segments;
  // 读取已有内容（若存在），然后回写（保持内容不变，相当于更新时间戳）
  let existingContent = '';
  try {
    existingContent = await readFile(ctx.rootHandle, segments);
  } catch {
    // 文件不存在：创建空文件
  }
  await writeFile(ctx.rootHandle, segments.slice(0, -1), segments[segments.length - 1], existingContent);
  return `已创建/更新文件：${rawPath}`;
}

/** mkdir <path>：创建目录 */
async function sandboxMkdir(ctx, rawPath) {
  if (!ctx?.rootHandle) return '错误：用户未连接工作空间';
  const check = validateWorkspacePath(rawPath);
  if (!check.ok) return `错误：${check.error}`;
  let dir = ctx.rootHandle;
  for (const seg of check.segments) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  return `已创建目录：${rawPath}`;
}

/** rm <path>：删除文件（沙箱限定，仅工作空间内） */
async function sandboxRm(ctx, rawPath) {
  if (!ctx?.rootHandle) return '错误：用户未连接工作空间';
  const check = validateWorkspacePath(rawPath);
  if (!check.ok) return `错误：${check.error}`;
  if (check.segments.length === 0) {
    return '错误：不能删除工作空间根目录';
  }
  const segments = check.segments;
  let dir = ctx.rootHandle;
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i]);
  }
  const name = segments[segments.length - 1];
  // 只允许删文件，不允许删目录（安全限制）
  let entry = null;
  try {
    entry = await dir.getFileHandle(name);
  } catch {
    return `错误：文件 "${rawPath}" 不存在或为目录（沙箱不允许删除目录）`;
  }
  await dir.removeEntry(name);
  return `已删除文件：${rawPath}`;
}

/* ============ MCP 能力（审计 B6）：列出已配置的 MCP 服务器 ============ */
async function toolListMcpTools(args, ctx) {
  let res;
  try {
    res = await fetch('/api/agent/mcp/servers');
  } catch {
    return '错误：MCP 服务器列表获取失败（网络异常）';
  }
  if (!res.ok) return `错误：MCP 服务器列表获取失败 (${res.status})`;
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!data?.ok) return `错误：${data?.error?.message || 'MCP 服务器列表获取失败'}`;
  if (!Array.isArray(data.servers) || data.servers.length === 0) {
    return '当前未配置任何 MCP 服务器。配置方式：在项目根目录创建 mcp.config.json，或在 ~/.workbuddy/mcp.json 中按 {"mcpServers": {"<名称>": {"command": "...", "args": [...]}}} 格式填写；远程服务器用 {"url": "https://..."}。配置完成后刷新页面即可生效。';
  }
  const lines = data.servers.map(s => {
    const transport = s.transport === 'stdio' ? '本地进程' : '远程 HTTP';
    return `- ${s.name}（${transport}${s.description ? '：' + s.description : ''}）`;
  });
  return `已配置的 MCP 服务器：\n${lines.join('\n')}\n\n用 mcp_call 调用具体工具。`;
}

/* ============ MCP 能力（审计 B6）：调用 MCP 服务器上的工具 ============ */
async function toolMcpCall(args, ctx) {
  const server = String(args?.server || '').trim();
  const tool = String(args?.tool || '').trim();
  if (!server) return '错误：server 参数不能为空（MCP 服务器名）';
  if (!tool) return '错误：tool 参数不能为空（MCP 工具名）';
  let res;
  try {
    res = await fetch('/api/agent/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server, tool, args: args?.args || {} }),
    });
  } catch {
    return '错误：MCP 调用失败（网络异常）';
  }
  if (!res.ok) return `错误：MCP 调用失败 (${res.status})`;
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!data?.ok) return `错误：${data?.error?.message || data?.error || 'MCP 工具执行失败'}`;
  return data.result || '(MCP 工具无返回内容)';
}

/* ============ 内置工具 schema + 注册 ============ */

const BUILTIN_TOOL_DEFS = [
  {
    name: 'read_workspace_file',
    schema: {
      type: 'function',
      function: {
        name: 'read_workspace_file',
        description: '读取本地工作空间中已存在的文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对于工作空间根目录的文件路径' }
          },
          required: ['path']
        }
      }
    },
    meta: { label: '读取文件', iconKey: 'document', description: '读取本地工作空间中已存在的文件内容', category: 'workspace' },
    executor: toolReadWorkspaceFile,
  },
  {
    name: 'write_workspace_file',
    schema: {
      type: 'function',
      function: {
        name: 'write_workspace_file',
        description: '将内容写入工作空间的文件（覆盖或新建）',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对于工作空间根目录的文件路径' },
            content: { type: 'string', description: '要写入的完整文件内容' }
          },
          required: ['path', 'content']
        }
      }
    },
    meta: { label: '写入文件', iconKey: 'pencil', description: '将内容写入工作空间的文件', category: 'workspace', requiresApproval: true },
    executor: toolWriteWorkspaceFile,
  },
  {
    name: 'edit_file',
    schema: {
      type: 'function',
      function: {
        name: 'edit_file',
        description: '编辑工作空间中的已有文件。优先使用精准替换模式（old_string→new_string），避免重写整个文件。当 old_string 在文件中出现多次时，需提供更长上下文使其唯一匹配，或设置 replace_all=true。也可只提供 content 做全量重写（与 write_workspace_file 等价）。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对于工作空间根目录的文件路径' },
            old_string: { type: 'string', description: '要被替换的原文（必须与文件内容完全一致，含空白符）。留空则走全量重写模式' },
            new_string: { type: 'string', description: '替换后的新文本' },
            content: { type: 'string', description: '全量重写模式：覆盖整个文件的新内容（仅当不提供 old_string 时使用）' },
            replace_all: { type: 'boolean', description: '当 old_string 出现多次时，true=全部替换，false(默认)=报错要求唯一匹配' },
          },
          required: ['path'],
        },
      },
    },
    meta: { label: '编辑文件', iconKey: 'pencil', description: '精准修改已有文件（局部替换或全量重写）', category: 'workspace', requiresApproval: true },
    executor: toolEditFile,
  },
  {
    name: 'copy_workspace_file',
    schema: {
      type: 'function',
      function: {
        name: 'copy_workspace_file',
        description: '复制工作空间内的文件（源 → 目标，目标已存在则覆盖）。不删除源文件。',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '源文件相对于工作空间根目录的路径' },
            destination: { type: 'string', description: '目标文件相对于工作空间根目录的路径' }
          },
          required: ['source', 'destination']
        }
      }
    },
    meta: { label: '复制文件', iconKey: 'copy', description: '复制工作空间内的文件', category: 'workspace', requiresApproval: true },
    executor: toolCopyWorkspaceFile,
  },
  {
    name: 'move_workspace_file',
    schema: {
      type: 'function',
      function: {
        name: 'move_workspace_file',
        description: '移动/重命名工作空间内的文件（源 → 目标，完成后删除源文件）。等价于 mv。',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '源文件相对于工作空间根目录的路径' },
            destination: { type: 'string', description: '目标文件相对于工作空间根目录的路径' }
          },
          required: ['source', 'destination']
        }
      }
    },
    meta: { label: '移动文件', iconKey: 'folder', description: '移动/重命名工作空间内的文件', category: 'workspace', requiresApproval: true },
    executor: toolMoveWorkspaceFile,
  },
  {
    name: 'search_news',
    schema: {
      type: 'function',
      function: {
        name: 'search_news',
        description: '搜索资讯库（支持关键词全文检索，返回标题/摘要/来源）',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '搜索关键词' },
            pageSize: { type: 'number', description: '返回条数（默认 8，最多 20）' }
          },
          required: ['keyword']
        }
      }
    },
    meta: { label: '检索资讯', iconKey: 'search', description: '搜索资讯库', category: 'news' },
    executor: toolSearchNews,
  },
  {
    name: 'read_intelligence_focus',
    schema: {
      type: 'function',
      function: {
        name: 'read_intelligence_focus',
        description: '【情报聚焦】按主题拉取聚焦的情报事件（多源聚类 + 交叉验证 + 置信度），返回条目可直接以 [资讯:ID] 格式引用。当需要深入分析某个主题（某公司、某模型、某领域）而当前证据不够时调用。与 search_news（关键词找单条资讯）互补',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: '聚焦主题（如 "OpenAI"、"推理模型"、"AI 芯片出口管制"）' },
            take: { type: 'number', description: '返回事件数（默认 10，最多 24）' },
            date: { type: 'string', description: '限定日期 YYYY-MM-DD（可选，默认不限）' },
            category: { type: 'string', description: '限定类别（可选，如 ai-models/industry/paper）' },
          },
          required: ['topic'],
        },
      },
    },
    meta: { label: '情报聚焦', iconKey: 'target', description: '按主题拉取聚焦情报事件（可引用）', category: 'news' },
    executor: toolReadIntelligenceFocus,
  },
  {
    name: 'list_knowledge',
    schema: {
      type: 'function',
      function: {
        name: 'list_knowledge',
        description: '【知识库检索】检索工作空间知识库（对话沉淀的知识、导出的素材、agent 写入的文件均已自动索引）。有 keyword 按相关性检索，无 keyword 列出最近沉淀。找到后用 read_workspace_file 读取全文',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '检索关键词（可选；为空时列出最近沉淀）' },
            limit: { type: 'number', description: '返回条数（默认 10，最多 30）' },
          },
        },
      },
    },
    meta: { label: '知识库检索', iconKey: 'bookmark', description: '检索工作空间知识库沉淀', category: 'knowledge' },
    executor: toolListKnowledge,
  },
  {
    name: 'fetch_page',
    schema: {
      type: 'function',
      function: {
        name: 'fetch_page',
        description: '抓取指定 URL 的网页正文（SSRF 保护）',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要抓取的网页 URL' }
          },
          required: ['url']
        }
      }
    },
    // 抓取任意站点：慢站/大页很常见，15s 全局超时会误杀，单独放宽到 30s。
    // riskLevel='read'：fetch_page 本质是只读操作（SSRF 保护的网关抓取，且已入 CACHEABLE_READS 缓存），
    // 自主模式下不再每次弹审批卡；协助模式仍逐次确认。
    meta: { label: '抓取网页', iconKey: 'globe', description: '抓取指定 URL 的网页正文', category: 'web', requiresApproval: true, riskLevel: () => 'read', timeoutMs: 30_000 },
    executor: toolFetchPage,
  },
  {
    name: 'create_skill',
    schema: {
      type: 'function',
      function: {
        name: 'create_skill',
        description: '【工作技能沉淀】将本次工作的方法论、过程、经验教训沉淀为可复用的 Skill。不是保存输出结果，而是记录"怎么做的"——适用场景、工作流程、关键决策点、工具使用经验。下次遇到同类型任务时可直接复用。调用时机：完成一个有工具调用和结构化输出的任务后，系统会自动触发；你也可以在发现可复用模式时主动调用。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '技能标题（概括这个技能能做什么，60字以内）' },
            body: { type: 'string', description: '技能全文（Markdown）。必须包含：适用场景、工作流程与方法论（分步）、关键决策点与陷阱、工具使用经验、输出模板。重点写过程和方法，不要重复输出结果。' },
            description: { type: 'string', description: '一句话说明技能用途（可选）' },
            triggers: {
              type: 'array',
              items: { type: 'string' },
              description: '触发词列表（用户说出这些关键词时自动推荐此技能）',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: '本技能依赖的工具名列表',
            },
            source: { type: 'string', enum: ['work', 'user'], description: '技能来源：work（默认，Agent 工作沉淀）/ user（用户主动创建）' },
            category: { type: 'string', description: '技能分类（research/writing/analysis/risk 等）' },
          },
          required: ['title', 'body'],
        },
      },
    },
    meta: {
      label: '沉淀技能', iconKey: 'bookmark', description: '将工作方法论沉淀为可复用技能', category: 'skills',
      // 安全收紧：create_skill 把 LLM 生成的提示词内容写到服务器文件系统（skills/ 目录），
      // 之后还会经 applySkill 重新注入 prompt——这是持久化的注入通道，必须过用户审批。
      requiresApproval: true,
    },
    executor: toolCreateSkill,
  },
  {
    name: 'save_knowledge',
    schema: {
      type: 'function',
      function: {
        name: 'save_knowledge',
        description: '【知识沉淀】把本次分析的结构化产出（结论、判断、可复用的资料片段）沉淀为知识库素材条目。区别于 create_skill（沉淀工作方法论），这里是沉淀知识结论。当你的分析产出了有保存价值的结论时主动调用',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '知识条目标题（80字以内）' },
            content: { type: 'string', description: '知识正文（结论、判断、事实梳理，Markdown）' },
            summary: { type: 'string', description: '摘要（可选）' },
            category: { type: 'string', description: '分类（可选，如 research/writing/analysis/risk）' },
            type: { type: 'string', description: '素材类型（可选，默认 knowledge）' },
            tags: { type: 'array', items: { type: 'string' }, description: '标签列表（可选）' },
            url: { type: 'string', description: '来源链接（可选）' },
          },
          required: ['title', 'content'],
        },
      },
    },
    meta: { label: '沉淀知识', iconKey: 'bookmarkFill', description: '把分析结论沉淀为知识库素材条目', category: 'knowledge', requiresApproval: true },
    executor: toolSaveKnowledge,
  },
  {
    name: 'web_search',
    schema: {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索（实时获取互联网最新信息）。未配置任何 API Key 时自动走零成本通道：DuckDuckGo（短超时试探）+ Hacker News + 必应 + Stack Exchange，无需注册即可用；若已配置豆包搜索（火山引擎，国内首选）或 Tavily，则优先使用。适用于查询超出训练数据时间范围、最新资讯、最新版本信息、编程问答等场景',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词（建议精炼，去掉"请问""你知道吗"等口语化词）' },
            max_results: { type: 'number', description: '返回结果数（默认 6，最多 20）' }
          },
          required: ['query']
        }
      }
    },
    // 三级 fallback（豆包 → Tavily → DuckDuckGo）串行重试，需要比默认 15s 更宽的窗口。
    // normalizeArgs：历史调用习惯兼容（search_news 用 keyword），在运行时参数校验前归一化，
    // 否则 schema 的 required:['query'] 会把 keyword 别名拦在校验层。
    meta: {
      label: '联网搜索', iconKey: 'megaphone', description: '联网搜索互联网最新信息（豆包搜索 / Tavily / DuckDuckGo）', category: 'web', timeoutMs: 25_000,
      normalizeArgs: (args) => {
        const a = { ...(args || {}) };
        if (a.query === undefined && a.keyword !== undefined) a.query = a.keyword;
        return a;
      },
    },
    executor: toolWebSearch,
  },
  {
    name: 'get_stock_quote',
    schema: {
      type: 'function',
      function: {
        name: 'get_stock_quote',
        description: '获取股票实时行情（价格、涨跌、五档盘口）',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '股票代码（6 位数字会自动补全 sh/sz 前缀；如 600519 → sh600519）' }
          },
          required: ['code']
        }
      }
    },
    meta: { label: '股票行情', iconKey: 'trendingUp', description: '获取股票实时行情', category: 'stock' },
    executor: toolGetStockQuote,
  },
  {
    name: 'get_stock_kline',
    schema: {
      type: 'function',
      function: {
        name: 'get_stock_kline',
        description: '获取股票 K 线数据（日/周/月线）',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '股票代码（6 位数字会自动补全 sh/sz 前缀）' },
            period: { type: 'string', enum: ['101', '102', '103'], description: '101=日线 102=周线 103=月线' },
            count: { type: 'number', description: '返回根数（默认 30，最多 120）' }
          },
          required: ['code']
        }
      }
    },
    meta: { label: 'K 线数据', iconKey: 'chart', description: '获取股票 K 线数据', category: 'stock', timeoutMs: 20_000 },
    executor: toolGetStockKline,
  },
  /* ====== 会话状态管理工具（Phase 3） ====== */
  {
    name: 'set_plan',
    schema: {
      type: 'function',
      function: {
        name: 'set_plan',
        description: '为当前任务设置执行计划（一个有序任务列表，每个任务可声明依赖）。计划会在会话中持久化，便于跨轮次接力推理',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              description: '任务列表',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '任务 id（可省略，默认 t1/t2/...）' },
                  title: { type: 'string', description: '任务标题（简短描述）' },
                  deps: { type: 'array', items: { type: 'string' }, description: '依赖的任务 id 列表' },
                  note: { type: 'string', description: '备注' },
                  toolName: { type: 'string', description: '关联的工具名' },
                },
                required: ['title'],
              },
            },
          },
          required: ['tasks'],
        },
      },
    },
    meta: { label: '设置计划', iconKey: 'list', description: '为当前任务设置执行计划', category: 'session' },
    executor: toolSetPlan,
  },
  {
    name: 'add_task',
    schema: {
      type: 'function',
      function: {
        name: 'add_task',
        description: '在当前执行计划末尾追加一个任务',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题' },
            deps: { type: 'array', items: { type: 'string' }, description: '依赖的任务 id' },
            note: { type: 'string', description: '备注' },
            toolName: { type: 'string', description: '关联的工具名' },
          },
          required: ['title'],
        },
      },
    },
    meta: { label: '追加任务', iconKey: 'plus', description: '追加一个任务到执行计划', category: 'session' },
    executor: toolAddTask,
  },
  {
    name: 'update_task',
    schema: {
      type: 'function',
      function: {
        name: 'update_task',
        description: '更新任务状态（pending/running/done/failed/skipped），可附加结果摘要',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: '任务 id' },
            status: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'skipped'], description: '新状态' },
            result: { type: 'string', description: '任务结果摘要（可省略）' },
            note: { type: 'string', description: '备注更新' },
          },
          required: ['taskId', 'status'],
        },
      },
    },
    meta: { label: '更新任务', iconKey: 'refresh', description: '更新任务状态', category: 'session' },
    executor: toolUpdateTask,
  },
  {
    name: 'set_variable',
    schema: {
      type: 'function',
      function: {
        name: 'set_variable',
        description: '在当前会话中设置一个变量（持久化到会话），可在后续工具调用与 LLM 推理中作为上下文使用',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '变量名（合法标识符）' },
            value: { description: '变量值（任意类型：string/number/boolean/array/object）' },
          },
          required: ['key'],
        },
      },
    },
    meta: { label: '设置变量', iconKey: 'tag', description: '设置会话变量', category: 'session' },
    executor: toolSetVariable,
  },
  {
    name: 'write_blackboard',
    schema: {
      type: 'function',
      function: {
        name: 'write_blackboard',
        description: '向当前会话的黑板写入一个键值（黑板用于工具间的产出共享，后续工具可读取）',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '黑板键' },
            value: { description: '值（任意类型）' },
          },
          required: ['key'],
        },
      },
    },
    meta: { label: '写黑板', iconKey: 'note', description: '写入会话黑板', category: 'session' },
    executor: toolWriteBlackboard,
  },
  /* ====== 命令执行能力（方案 C Phase 4） ====== */
  {
    name: 'execute_command',
    schema: {
      type: 'function',
      function: {
        name: 'execute_command',
        description: '统一命令入口：通过子命令调用搜索资讯、抓取网页、查询股票、读写工作空间文件、管理执行计划/变量/黑板等。类似于 Claude Code 的 bash 工具，但浏览器环境下路由到现有工具能力。输入 `help` 查看完整子命令列表',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: '命令字符串，如 `news OpenAI`、`stock 600519`、`write notes.md "今日关键发现"`、`plan`、`tools`、`help`',
            },
          },
          required: ['command'],
        },
      },
    },
    meta: {
      label: '执行命令',
      iconKey: 'terminal',
      description: '统一命令入口（shell 风格）',
      category: 'shell',
      requiresApproval: true,
      // 子命令级风险分级：ls/grep/tree 等只读命令自动放行，write/rm/fetch 等必须审批
      riskLevel: (args) => gradeCommandRisk(args?.command),
      timeoutMs: 30_000, // 内部可能串接 fetch + 文件遍历，给足预算
    },
    executor: toolExecuteCommand,
  },
  /* ====== MCP 能力（审计 B6） ====== */
  {
    name: 'list_mcp_tools',
    schema: {
      type: 'function',
      function: {
        name: 'list_mcp_tools',
        description: '列出当前已配置的 MCP（Model Context Protocol）服务器。调用外部 MCP 工具前先执行本工具确认有哪些服务器可用',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    meta: {
      label: 'MCP 服务器列表',
      iconKey: 'plug',
      description: '列出已配置的 MCP 服务器',
      category: 'mcp',
    },
    executor: toolListMcpTools,
  },
  {
    name: 'mcp_call',
    schema: {
      type: 'function',
      function: {
        name: 'mcp_call',
        description: '调用已配置 MCP 服务器上的外部工具（Model Context Protocol）。先执行 list_mcp_tools 查看可用服务器，再按需调用。示例：{"server": "github", "tool": "search_repositories", "args": {"query": "ai"}}',
        parameters: {
          type: 'object',
          properties: {
            server: { type: 'string', description: 'MCP 服务器名称（来自 list_mcp_tools）' },
            tool: { type: 'string', description: 'MCP 工具名称（服务器对外暴露的工具）' },
            args: { type: 'object', description: '传给 MCP 工具的参数对象' },
          },
          required: ['server', 'tool'],
        },
      },
    },
    meta: {
      label: 'MCP 工具调用',
      iconKey: 'plug',
      description: '调用 MCP 服务器上的工具',
      category: 'mcp',
      requiresApproval: true,
      timeoutMs: 30_000, // 外部 MCP 工具可能较慢（网络 / 本地进程）
    },
    executor: toolMcpCall,
  },
];

// 注册内置工具 + 加载自定义工具（仅执行一次）
let _initialized = false;
function ensureRegistered() {
  if (_initialized) return;
  _initialized = true;
  BUILTIN_TOOL_DEFS.forEach(def => {
    registerTool(def.name, {
      source: 'builtin',
      schema: def.schema,
      meta: def.meta,
      enabled: true,
      executor: def.executor,
    });
  });
  loadCustomTools();
}
ensureRegistered();

/* ============ 向后兼容导出 ============ */

/** 兼容导出：从注册表派生 schema 数组（仅含 enabled 工具） */
export const AGENT_TOOL_SCHEMAS = getEnabledSchemas();

/** 兼容导出：按 agent.tools 白名单筛选 schema */
export function selectToolSchemas(toolNames) {
  return selectSchemasByName(toolNames);
}

/** 兼容导出：执行工具（内部委托给 toolRegistry.executeTool） */
export async function executeAgentTool(name, args, ctx) {
  return await executeTool(name, args, ctx);
}

/** 兼容导出：获取工具 UI 元信息（label/icon/description） */
export function getToolMetaByName(name) {
  return getToolMeta(name);
}
