import { routeError, sendJsonResponse, readJsonBody } from './httpUtils.js';
import { assertSafeExternalUrl } from '../security/urlSafety.js';

/**
 * Web Search Handler - 联网搜索接口
 *
 * 优先级：豆包搜索（火山引擎） > Tavily > DuckDuckGo > 免费源兜底（HN Algolia + Bing RSS）
 *
 * - 豆包搜索：国内首选，每月 500 次免费，订阅地址 https://console.volcengine.com/search-infinity/web-search
 * - Tavily：海外 AI 搜索服务，每月 1000 次免费（tavily.com）
 * - DuckDuckGo：免费但国内通常不可达
 * - HN Algolia + Bing RSS：免订阅免费兜底（国内可达），无需任何 API Key
 *
 * API Key 来源：
 *   豆包：环境变量 DOUBAO_SEARCH_API_KEY 或请求头 X-Doubao-Search-Key
 *   Tavily：环境变量 TAVILY_API_KEY 或请求头 X-Tavily-Key
 *
 * 统一返回格式：
 *   { ok: true, provider: 'doubao'|'tavily'|'duckduckgo'|'free', results: [{title, url, snippet, score?}], meta: {query, count, latencyMs} }
 */

const DOUBAO_SEARCH_ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search';
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DUCKDUCKGO_ENDPOINT = 'https://lite.duckduckgo.com/lite/';
const HN_ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search';
const BING_RSS_ENDPOINT = 'https://www.bing.com/search';
const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 12_000;

function resolveDoubaoKey(req) {
  const fromHeader = req.headers['x-doubao-search-key'];
  if (fromHeader && typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }
  const fromEnv = process.env.DOUBAO_SEARCH_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return '';
}

function resolveTavilyKey(req) {
  const fromHeader = req.headers['x-tavily-key'];
  if (fromHeader && typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }
  const fromEnv = process.env.TAVILY_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return '';
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * 豆包搜索（火山引擎）- 国内首选
 * 文档：https://www.volcengine.com/docs/87772/2272953
 * 订阅：https://console.volcengine.com/search-infinity/web-search
 *
 * 响应结构：
 *   {
 *     ResponseMetadata: { RequestId, Error?: { Code, CodeN, Message } },
 *     Result: { ResultCount, WebResults: [{ Title, Url, Snippet, Summary, RankScore, PublishTime, SiteName }] } | null
 *   }
 * 注意：HTTP 200 也可能携带业务错误（如 invalid_api_key），必须检查 ResponseMetadata.Error
 */
async function callDoubaoSearch(query, maxResults, apiKey) {
  const body = JSON.stringify({
    Query: query,
    SearchType: 'web',
    Count: Math.min(maxResults, 20),
    Filter: {
      NeedContent: false, // 不强制要求正文（仅 Snippet 也可）
      NeedUrl: true,      // 必须有原文链接
    },
  });
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DOUBAO_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`豆包搜索 HTTP ${response.status}：${text.slice(0, 200)}`), {
        code: 'DOUBAO_UPSTREAM_ERROR', status: 502,
      });
    }
    const data = await response.json();
    // 业务错误（HTTP 200 但 ResponseMetadata.Error 存在）
    const errMeta = data?.ResponseMetadata?.Error;
    if (errMeta && (errMeta.Code || errMeta.CodeN)) {
      const errCode = errMeta.Code || `code=${errMeta.CodeN}`;
      const errMsg = errMeta.Message || errCode;
      // invalid_api_key / 余额不足等用户配置错误 → 401/403，不重试
      const isAuthError = errCode === 'invalid_api_key' || errCode === 'no_permission';
      const isQuotaError = errCode === 'exceed_free_limit' || errCode === 'quota_exceeded';
      throw Object.assign(new Error(`豆包搜索${isAuthError ? '：API Key 无效' : isQuotaError ? '：免费额度已用尽' : '业务错误：' + errMsg}`), {
        code: isAuthError ? 'DOUBAO_INVALID_KEY' : (isQuotaError ? 'DOUBAO_QUOTA_EXCEEDED' : 'DOUBAO_BIZ_ERROR'),
        status: isAuthError ? 401 : (isQuotaError ? 429 : 502),
      });
    }
    // 提取结果：Result.WebResults
    const webResults = Array.isArray(data?.Result?.WebResults) ? data.Result.WebResults : [];
    const items = webResults.slice(0, maxResults).map(it => ({
      title: String(it.Title || '').trim(),
      url: String(it.Url || '').trim(),
      snippet: String(it.Summary || it.Snippet || '').trim(), // Summary 更适合 LLM，Snippet 仅用于展示
      score: Number.isFinite(Number(it.RankScore)) ? Number(it.RankScore) : undefined,
    })).filter(r => r.title || r.url || r.snippet);
    return { provider: 'doubao', results: items };
  } finally {
    clear();
  }
}

async function callTavily(query, maxResults, apiKey) {
  const body = JSON.stringify({
    api_key: apiKey,
    query,
    max_results: maxResults,
    search_depth: 'basic',
    include_answer: false,
    include_raw_content: false,
  });
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body,
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Tavily 返回 ${response.status}：${text.slice(0, 200)}`), {
        code: 'TAVILY_UPSTREAM_ERROR', status: 502,
      });
    }
    const data = await response.json();
    const results = Array.isArray(data?.results)
      ? data.results.slice(0, maxResults).map(r => ({
          title: String(r.title || '').trim(),
          url: String(r.url || '').trim(),
          snippet: String(r.content || '').trim(),
          score: Number.isFinite(Number(r.score)) ? Number(r.score) : undefined,
        })).filter(r => r.title || r.url || r.snippet)
      : [];
    return { provider: 'tavily', results };
  } finally {
    clear();
  }
}

/**
 * 解析 DuckDuckGo lite HTML 页面，提取搜索结果
 * lite 页面结构：<a class="result-link" href="//duckduckgo.com/l/?uddg=ENCODED_URL">标题</a>
 * 然后 <td class="result-snippet">摘要文本</td>
 */
function parseDuckDuckGoHtml(html) {
  const results = [];
  // 提取每个 result block：从 result-link 到下一个 result-link 之间的内容
  const linkRegex = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  const links = [];
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({ url: match[1], title: match[2] });
  }

  const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const snippets = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1]);
  }

  const count = Math.max(links.length, snippets.length);
  for (let i = 0; i < count; i++) {
    const link = links[i];
    const snippet = snippets[i] || '';
    if (!link) continue;
    // DuckDuckGo lite 链接形如 //duckduckgo.com/l/?uddg=ENCODED&rut=...&?ia=web
    let url = link.url || '';
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try { url = decodeURIComponent(uddgMatch[1]); } catch { /* 保留原值 */ }
    } else if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    const title = stripHtml(link.title || '').trim();
    const snippetText = stripHtml(snippet).trim();
    if (!title && !url && !snippetText) continue;
    results.push({ title, url, snippet: snippetText });
  }
  return results;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function callDuckDuckGo(query, maxResults) {
  await assertSafeExternalUrl(DUCKDUCKGO_ENDPOINT);
  const url = `${DUCKDUCKGO_ENDPOINT}?q=${encodeURIComponent(query)}&kl=cn-zh`;
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`DuckDuckGo 返回 ${response.status}`), {
        code: 'DDG_UPSTREAM_ERROR', status: 502,
      });
    }
    const html = await response.text();
    const results = parseDuckDuckGoHtml(html).slice(0, maxResults);
    return { provider: 'duckduckgo', results };
  } finally {
    clear();
  }
}

/**
 * HN Algolia 搜索（免费免订阅，国内可达）
 * Hacker News 全站搜索 API，返回技术类资讯的标题/链接/摘要（story_text）。
 * 文档：https://hn.algolia.com/api
 */
async function callHackerNews(query, maxResults) {
  await assertSafeExternalUrl(HN_ALGOLIA_ENDPOINT);
  const url = `${HN_ALGOLIA_ENDPOINT}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${maxResults}`;
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Hacker News 返回 ${response.status}`), {
        code: 'HN_UPSTREAM_ERROR', status: 502,
      });
    }
    const data = await response.json();
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const results = hits
      .map((h) => ({
        title: String(h.title || '(无标题)').trim(),
        url: String(h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '')),
        snippet: String(h.story_text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280),
      }))
      .filter((r) => r.title && r.url)
      .slice(0, maxResults);
    return { provider: 'free-hn', results };
  } finally {
    clear();
  }
}

/**
 * Bing RSS 搜索（免费免订阅，国内可达）
 * Bing 的 format=rss 输出可直接作为 RSS 解析，返回标题/链接/摘要。
 */
async function callBingRss(query, maxResults) {
  await assertSafeExternalUrl(BING_RSS_ENDPOINT);
  const url = `${BING_RSS_ENDPOINT}?q=${encodeURIComponent(query)}&format=rss&count=${maxResults}`;
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
      signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Bing 返回 ${response.status}`), {
        code: 'BING_UPSTREAM_ERROR', status: 502,
      });
    }
    const xml = await response.text();
    // 解析 RSS <item> 块：提取 <title>、<link>、<description>
    const results = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const desc = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
      const clean = (s) => String(s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
      const titleText = clean(title);
      const linkText = clean(link);
      const snippetText = clean(desc);
      if (!titleText) continue;
      results.push({ title: titleText, url: linkText, snippet: snippetText.slice(0, 280) });
    }
    return { provider: 'free-bing', results: results.slice(0, maxResults) };
  } finally {
    clear();
  }
}

/**
 * 免费源兜底：HN Algolia + Bing RSS 并行查询，任一有结果即返回。
 * 完全免订阅、免配置，作为 DuckDuckGo 之后、503 之前的最后保障。
 * @returns {Promise<{provider: string, results: Array} | null>} 全部失败返回 null
 */
async function callFreeFallback(query, maxResults) {
  const settled = await Promise.allSettled([
    callHackerNews(query, maxResults),
    callBingRss(query, maxResults),
  ]);
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value && Array.isArray(r.value.results) && r.value.results.length > 0) {
      return r.value;
    }
  }
  // 两个都失败：记录具体原因，便于排查（不抛出，交给上层走 503 文案）
  const reasons = settled.map((r) => r.status === 'rejected' ? r.reason?.message || String(r.reason) : '空结果');
  console.warn('[webSearch] 免费源兜底全部失败：', reasons.join(' | '));
  return null;
}

export async function handleWebSearchRequest(req, res) {
  const started = Date.now();
  // 支持 GET（query 参数）和 POST（JSON body）
  let query = '';
  let maxResults = DEFAULT_MAX_RESULTS;

  try {
    if (String(req.method).toUpperCase() === 'POST') {
      const body = await readJsonBody(req);
      query = String(body?.query || body?.q || '').trim();
      if (body?.max_results) {
        maxResults = Math.max(1, Math.min(Number(body.max_results) || DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT));
      }
    } else if (String(req.method).toUpperCase() === 'GET') {
      const requestUrl = new URL(req.url, 'http://localhost');
      query = String(requestUrl.searchParams.get('query') || requestUrl.searchParams.get('q') || '').trim();
      const mr = requestUrl.searchParams.get('max_results');
      if (mr) maxResults = Math.max(1, Math.min(Number(mr) || DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT));
    } else {
      return sendJsonResponse(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
    }

    if (!query) {
      return sendJsonResponse(res, 400, { ok: false, error: { code: 'EMPTY_QUERY', message: '搜索关键词不能为空' } });
    }
    if (query.length > 500) {
      return sendJsonResponse(res, 400, { ok: false, error: { code: 'QUERY_TOO_LONG', message: '搜索关键词过长（>500 字符）' } });
    }

    // 优先尝试豆包搜索（国内用户首选）
    const doubaoKey = resolveDoubaoKey(req);
    if (doubaoKey) {
      try {
        const { provider, results } = await callDoubaoSearch(query, maxResults, doubaoKey);
        // 豆包调用成功就返回（即使 0 结果，也优于降级到国内不通的 DDG）
        return sendJsonResponse(res, 200, {
          ok: true,
          provider,
          results,
          meta: { query, count: results.length, latencyMs: Date.now() - started },
        });
      } catch (err) {
        // 仅在 API Key 无效 / 配额用尽时记录 warn（用户配置问题）
        // 其他错误（网络/超时/5xx）也降级，但记录 error
        const isUserConfigError = err.code === 'DOUBAO_INVALID_KEY' || err.code === 'DOUBAO_QUOTA_EXCEEDED';
        if (isUserConfigError) {
          console.warn('[webSearch] 豆包搜索配置错误，降级到 Tavily/DuckDuckGo：', err.message);
        } else {
          console.warn('[webSearch] 豆包搜索调用失败，降级：', err.message, err.code);
        }
      }
    }

    // 次选 Tavily
    const tavilyKey = resolveTavilyKey(req);
    if (tavilyKey) {
      try {
        const { provider, results } = await callTavily(query, maxResults, tavilyKey);
        if (results.length > 0) {
          return sendJsonResponse(res, 200, {
            ok: true,
            provider,
            results,
            meta: { query, count: results.length, latencyMs: Date.now() - started },
          });
        }
        // Tavily 返回空结果，继续 fallback 到 DDG
      } catch (err) {
        // Tavily 失败（401/429/5xx）→ fallback 到 DDG，记录但不直接返回错误
        console.warn('[webSearch] Tavily 调用失败，降级到 DuckDuckGo：', err.message);
      }
    }

    // 兜底 1：DuckDuckGo（国内通常无法访问）
    try {
      const ddgResult = await callDuckDuckGo(query, maxResults);
      return sendJsonResponse(res, 200, {
        ok: true,
        provider: ddgResult.provider,
        results: ddgResult.results,
        meta: { query, count: ddgResult.results.length, latencyMs: Date.now() - started, tavilyConfigured: Boolean(tavilyKey), doubaoConfigured: Boolean(doubaoKey) },
      });
    } catch (ddgErr) {
      // DDG 不可达：继续尝试免费源兜底
      console.warn('[webSearch] DuckDuckGo 不可达，尝试免费源兜底：', ddgErr.message);
    }

    // 兜底 2：免费源（HN Algolia + Bing RSS，免订阅免配置，国内可达）
    try {
      const freeResult = await callFreeFallback(query, maxResults);
      if (freeResult && freeResult.results.length > 0) {
        return sendJsonResponse(res, 200, {
          ok: true,
          provider: freeResult.provider,
          results: freeResult.results,
          meta: { query, count: freeResult.results.length, latencyMs: Date.now() - started, freeFallback: true, tavilyConfigured: Boolean(tavilyKey), doubaoConfigured: Boolean(doubaoKey) },
        });
      }
    } catch (freeErr) {
      // 免费源兜底异常：记录后走最终 503 文案
      console.warn('[webSearch] 免费源兜底异常：', freeErr.message);
    }

    // 全部源均不可达：返回友好错误，引导用户配置 Key
    const hint = doubaoKey || tavilyKey
      ? '所有联网搜索源均不可用（豆包/Tavily 调用失败，DuckDuckGo 与免费源均不可达）'
      : '联网搜索暂不可用（未配置 API Key，且免订阅免费源不可达）。请前往「设置 → 大模型配置」填写豆包搜索 API Key（推荐，国内稳定），或稍后再试';
    return sendJsonResponse(res, 503, {
      ok: false,
      error: {
        code: 'WEB_SEARCH_UNAVAILABLE',
        message: hint,
        cause: 'DuckDuckGo 与免费源均不可达',
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return routeError(res, Object.assign(new Error('搜索请求超时'), { code: 'UPSTREAM_TIMEOUT', status: 504 }));
    }
    console.error('[webSearch] 全链路失败:', error?.message, error?.code);
    return routeError(res, error);
  }
}

// 导出免费兜底函数供单元测试 / 独立测试使用
export { callFreeFallback, callHackerNews, callBingRss };
