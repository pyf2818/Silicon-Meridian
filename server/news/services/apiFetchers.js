// ============================================================================
// 生产端 API 源（Batch2）：绕过 RSS 间接层，直接消费厂商官方结构化 API。
// 源定义约定：{ type: 'api', url: <API端点（展示元数据）>, api: { kind, ...params }, ... }
// 输出 item 结构与 parseFeed 对齐（id/title/summary/url/source/...），
// 入池（mergeIntoPool → enrichItem）与打分（crossVerifyItems）零感知。
// 安全边界：API 参数仅来自代码内源定义；用户自定义源永远走 RSS（fetchSource），无 API 注入面。
// 频控依据：GitHub 未认证 60 req/h（3 源 × C 档 3h 轮询 ≈ 1 req/h）；HF 公开读宽松；
//          arXiv 建议 ≥3s/req（C 档 3h ≫ 限速）。可选 GITHUB_TOKEN 环境变量提升配额。
// ============================================================================
import {
  cleanText, trimSummary, trimIntro, normalizeDate,
  detectCategory, detectTags, detectMode, hash,
} from '../utils/textProcessing.js';
import { parseFeed } from '../parsing/feedParser.js';

const API_UA = 'SiliconMeridian-NewsBot/0.1';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_API_ITEMS = 20;

async function fetchWithTimeout(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`API responded ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** 统一 item 归一化：字段语义与 parseFeed.normalizeItem 对齐，缺失 title/url 直接丢弃 */
function normalizeApiItem(source, index, { title, url, summary = '', publishedAt = '' }) {
  if (!title || !url) return null;
  const text = `${title} ${summary} ${source.name}`;
  const category = detectCategory(text, source.defaultCategory);
  return {
    id: hash(`${source.name}-${url}-${index}`),
    title: cleanText(title),
    summary: trimSummary(cleanText(summary)),
    bodyIntro: trimIntro(cleanText(summary)),
    url,
    source: source.name,
    sourceUrl: source.url,
    region: source.region,
    category,
    mode: detectMode(text, source.name),
    publishedAt: normalizeDate(publishedAt),
    tags: detectTags(text, category),
    imageUrl: '',
    videoUrl: '',
  };
}

// ---- GitHub Releases：仓库官方发布（含 release notes），draft 不外发 ----
async function fetchGithubReleases(source, timeoutMs) {
  const { repo, perPage = 10 } = source.api;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`${source.name}: invalid github repo "${repo}"`);
  }
  const headers = { 'User-Agent': API_UA, 'Accept': 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`,
    headers,
    timeoutMs,
  );
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error(`${source.name}: unexpected github payload`);
  const items = releases
    .filter((r) => r && r.draft !== true && r.html_url)
    .slice(0, MAX_API_ITEMS)
    .map((r, index) => normalizeApiItem(source, index, {
      title: r.name || r.tag_name || repo,
      url: r.html_url,
      summary: r.body || '',
      publishedAt: r.published_at || r.created_at || '',
    }));
  return { source: source.name, items };
}

// ---- Hugging Face Models：新模型速递（一手模型库，按 createdAt 倒序） ----
async function fetchHfModels(source, timeoutMs) {
  const { filter = '', limit = MAX_API_ITEMS } = source.api;
  const params = new URLSearchParams({ sort: 'createdAt', direction: '-1', limit: String(limit) });
  if (filter) params.set('filter', filter);
  const response = await fetchWithTimeout(
    `https://huggingface.co/api/models?${params}`,
    { 'User-Agent': API_UA },
    timeoutMs,
  );
  const models = await response.json();
  if (!Array.isArray(models)) throw new Error(`${source.name}: unexpected hf payload`);
  const items = models
    .filter((m) => m && m.modelId)
    .slice(0, MAX_API_ITEMS)
    .map((m, index) => normalizeApiItem(source, index, {
      title: m.modelId,
      url: `https://huggingface.co/${m.modelId}`,
      summary: [
        m.pipeline_tag,
        m.downloads != null ? `${m.downloads} downloads` : '',
        m.likes != null ? `${m.likes} likes` : '',
      ].filter(Boolean).join(' · '),
      publishedAt: m.createdAt || '',
    }));
  return { source: source.name, items };
}

// ---- arXiv API：参数化检索（Atom 输出，复用 parseFeed 归一化） ----
async function fetchArxivApi(source, timeoutMs) {
  const { search, maxResults = 15 } = source.api;
  if (!search) throw new Error(`${source.name}: missing arxiv search`);
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(search)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  const response = await fetchWithTimeout(url, { 'User-Agent': API_UA }, timeoutMs);
  const xml = await response.text();
  const items = parseFeed(xml, source).slice(0, MAX_API_ITEMS);
  return { source: source.name, items };
}

const API_KINDS = {
  'github-releases': fetchGithubReleases,
  'hf-models': fetchHfModels,
  'arxiv': fetchArxivApi,
};

/** API 源统一入口：与 fetchSource 同契约（{ source, items }），失败抛错 → 调度器退避 */
export async function fetchApiSource(source, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const kind = source?.api?.kind;
  const handler = API_KINDS[kind];
  if (!handler) throw new Error(`${source?.name || 'unknown'}: unsupported api kind "${kind}"`);
  console.log('[fetchApiSource] Fetching:', source.name, kind);
  try {
    const result = await handler(source, timeoutMs);
    console.log('[fetchApiSource] Success:', source.name, result.items.length, 'items');
    return result;
  } catch (err) {
    console.log('[fetchApiSource] Error:', source.name, err.name, err.message);
    throw err;
  }
}
