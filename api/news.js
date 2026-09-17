import { DEFAULT_SOURCES, SOURCE_WEIGHTS, CROSS_VERIFY_THRESHOLD, CATEGORIES, CATEGORY_RULES, TAG_RULES } from '../server/news/config/constants.js';
import { getSourceGradeInfo } from '../server/news/config/sourceGrades.js';
import { fetchApiSource } from '../server/news/services/apiFetchers.js';
// 日期解析/排序的唯一实现（原先这里有一份和 dev 端完全相同的 normalizeDate 副本，
// 且解析失败会回退成「抓取时刻」= 伪造发布时间，见 dateUtils.js 的说明）
import { compareByRecency, isEstimatedPublishTime, normalizeDate } from '../server/news/utils/dateUtils.js';
import { stripBoilerplate } from '../server/news/utils/boilerplate.js';

let cache = { data: null, expiresAt: 0 };
const SERVERLESS_CONCURRENCY = 12;

async function runWithConcurrency(items, worker, concurrency = SERVERLESS_CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await worker(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}
// ========== Jina AI Reader（绕过反爬虫）==========
async function jinaFetch(url, timeoutMs = 8000) {
  try {
    const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(jinaUrl, {
      headers: { 'User-Agent': 'GlobalTechRadar/0.1' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const text = await response.text();
    return text.trim().slice(0, 500);
  } catch {
    return null;
  }
}

// 多源交叉验证
function crossVerifyItems(items) {
  const urlMap = new Map();
  items.forEach(item => {
    const normalized = String(item.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!normalized) return;
    if (!urlMap.has(normalized)) urlMap.set(normalized, []);
    urlMap.get(normalized).push(item);
  });

  return items.map(item => {
    const normalized = String(item.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const sameUrlItems = urlMap.get(normalized) || [];
    const sourceCount = normalized ? new Set(sameUrlItems.map(entry => String(entry.source || '').trim()).filter(Boolean)).size : 0;
    let crossVerifyScore = sourceCount >= CROSS_VERIFY_THRESHOLD ? 3 : sourceCount >= 2 ? 2 : sourceCount >= 1 ? 1 : 0;
    const sourceWeight = SOURCE_WEIGHTS[item.source] || 0.5;
    return {
      ...item,
      crossVerifyScore,
      sourceWeight,
      qualityScore: Math.round((crossVerifyScore * sourceWeight) * 10) / 10
    };
  });
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(source.url, {
      headers: { 'User-Agent': 'GlobalTechRadar/0.1 (+https://vercel)' },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`${source.name} responded ${response.status}`);

    const xml = await response.text();
    const items = parseFeed(xml, source, new Date().toISOString()).slice(0, 20);
    
    // 尝试用 Jina AI Reader 增强摘要
    if (items.length > 0) {
      await Promise.allSettled(items.slice(0, 3).map(async (item) => {
        if (!item.summary || item.summary.length < 100) {
          const enhanced = await jinaFetch(item.url, 5000);
          if (enhanced) {
            item.summary = enhanced.length > 160 ? `${enhanced.slice(0, 160)}...` : enhanced;
          }
        }
      }));
    }
    
    return { source: source.name, items };
  } catch (e) {
    return { source: source.name, items: [], error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeed(xml, source, fetchedAt) {
  const itemPattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks = [...xml.matchAll(itemPattern)].map(m => m[2]);
  return blocks
    .map((block, index) => normalizeItem(block, source, index, fetchedAt))
    .filter(item => item.title && item.url);
}

function normalizeItem(block, source, index, fetchedAt) {
  const title = cleanText(pick(block, ['title']));
  const rawSummary = cleanText(pick(block, ['description', 'summary']));
  const bodyIntro = trimIntro(cleanText(pick(block, ['content:encoded', 'content'])));
  const summary = trimSummary(rawSummary || bodyIntro);
  const url = cleanText(pick(block, ['link'])) || pickAtomLink(block);
  // 解析失败 → null，绝不用「抓取时刻」冒充发布时间
  const publishedAt = normalizeDate(pick(block, ['pubDate', 'published', 'updated', 'dc:date']));
  const publishedAtEstimated = isEstimatedPublishTime(publishedAt);
  const text = `${title} ${summary} ${bodyIntro} ${source.name}`;
  const category = detectCategory(text, source.defaultCategory);
  const tags = detectTags(text, category);

  return {
    id: hash(`${source.name}-${url}-${index}`),
    title,
    summary,
    bodyIntro,
    url,
    source: source.name,
    sourceUrl: source.url,
    region: source.region,
    category,
    mode: detectMode(text, source.name),
    publishedAt,
    publishedAtEstimated,
    fetchedAt,
    tags
  };
}

function pick(block, tags) {
  for (const tag of tags) {
    const pattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'i');
    const match = block.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function pickAtomLink(block) {
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return href ? decodeEntities(href) : '';
}

function cleanText(value) {
  return decodeEntities(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimSummary(value) {
  // 与 dev 端同规则：先去站点模板/推广尾巴再截断（serverless 与 dev 的摘要口径必须一致）
  const cleaned = stripBoilerplate(value);
  if (!cleaned) return '暂无摘要，请前往原文查看完整内容。';
  return cleaned.length > 160 ? `${cleaned.slice(0, 160).trim()}...` : cleaned;
}

function trimIntro(value) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 220 ? `${compact.slice(0, 220).trim()}...` : compact;
}

function detectCategory(text, fallback) {
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? fallback;
}

function detectTags(text, category) {
  const tags = TAG_RULES.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  const categoryLabel = CATEGORIES.find(item => item.id === category)?.label;
  return [...new Set([...tags, categoryLabel].filter(Boolean))].slice(0, 4);
}

function detectMode(text, sourceName) {
  if (/\b(how to|tutorial|guide|developer|api|release|open source|github|技术|教程|开源|implementation)\b/i.test(text)) return 'technical';
  if (/\b(analysis|review|why|inside|research|study|report|解读|研究|报告|deep dive)\b/i.test(text) || /MIT|ArXiv|Nature/i.test(sourceName)) return 'deep';
  return 'flash';
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hash(value) {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result << 5) - result + value.charCodeAt(i);
    result |= 0;
  }
  return Math.abs(result).toString(36);
}

function applyBlockedWords(items, blocked) {
  if (!blocked.length) return items;
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item !== 'object') return false;
    const tags = Array.isArray(item.tags) ? item.tags.join(' ') : String(item.tags || '');
    const searchable = `${item.title || ''} ${item.summary || ''} ${item.source || ''} ${tags}`.toLowerCase();
    return blocked.every(word => !searchable.includes(word));
  });
}

/**
 * 分页响应整形——**缓存命中与实时采集两条路径共用同一份**。
 *
 * 历史 BUG：两条路径各自算 pagination，缓存命中分支只覆盖 items/total/page/pageSize/blockedCount
 * 而没重算 hasMore，于是 `...cache.data` 里写入时钉死的 `hasMore: false` 直接透出 →
 * 只要命中缓存，第 2 页就告诉前端「没有更多了」，后台逐批拉取（App.jsx 的 while(hasMore)）随即中断。
 * 另一处：blockedCount 曾用「分页切片后」的长度相减，导致它随翻页递增、且把搜索/兴趣筛选也算成「屏蔽词过滤」。
 *
 * 约定（与 dev 端 server/news/services/newsService.js 对齐）：
 *   total        = 过滤后、分页前的总条数
 *   hasMore      = 本页之后还有剩余
 *   blockedCount = 仅被屏蔽词过滤掉的条数（在分页/搜索/兴趣筛选之前算好）
 */
function buildListResponse({ items, page, pageSize, blockedCount, extra = {} }) {
  const list = Array.isArray(items) ? items : [];
  const start = page * pageSize;
  const pageItems = list.slice(start, start + pageSize);
  return {
    ...extra,
    items: pageItems,
    total: list.length,
    page,
    pageSize,
    hasMore: start + pageItems.length < list.length,
    blockedCount,
  };
}

export default async function handler(req, res) {
  const now = Date.now();
  const blocked = (req.query.blocked || '')
    .split(',')
    .map(word => word.trim().toLowerCase())
    .filter(Boolean);

  const disabledSources = (req.query.disabledSources || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const rawPage = req.query.page ?? '0';
  const rawPageSize = req.query.pageSize ?? '40';
  if (!/^\d+$/.test(String(rawPage)) || !/^\d+$/.test(String(rawPageSize))) {
    return res.status(400).json({ ok: false, error: 'page and pageSize must be non-negative integers' });
  }
  const page = Math.min(Number(rawPage), 10000);
  const pageSize = Math.min(Math.max(Number(rawPageSize), 1), 500);
  const search = String(req.query.search || '').trim().toLowerCase();
  const interests = String(req.query.interests || '').split(',').map(s => s.trim()).filter(Boolean);

  // Serverless 没有常驻调度器，官方结构化 API 源必须在请求路径直接采集。
  const filteredSources = DEFAULT_SOURCES.filter(s => !disabledSources.includes(s.name));

  if (!blocked.length && !disabledSources.length && cache.data && cache.expiresAt > now) {
    let filtered = applyBlockedWords(cache.data.items, blocked);
    if (interests.length) filtered = filtered.filter(item => interests.includes(item.category));
    if (search) filtered = filtered.filter(item => `${item.title} ${item.summary} ${item.source}`.toLowerCase().includes(search));
    res.setHeader('Content-Type', 'application/json');
    // 缓存只存全量列表与元信息；分页/搜索/兴趣筛选与 hasMore 每次现算（绝不透出缓存里的分页字段）
    return res.end(JSON.stringify({
      updatedAt: cache.data.updatedAt,
      failedSources: cache.data.failedSources,
      sourceCount: cache.data.sourceCount,
      ...buildListResponse({ items: filtered, page, pageSize, blockedCount: cache.data.blockedCount }),
    }));
  }

  const settled = await runWithConcurrency(filteredSources, source =>
    source.type === 'api' ? fetchApiSource(source) : fetchSource(source)
  );
  const sourceResults = settled
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
  const items = sourceResults.flatMap(result => result.items);
  // fetchSource 将网络/解析错误转换为 fulfilled { error }，不能只统计 rejected。
  const failedSources = settled.filter(result =>
    result.status === 'rejected' || result.value?.error
  ).length;

  const cleaned = applyBlockedWords(items, blocked)
    // 时间倒序：估计时间（无日期字段 / 未来时间）一律沉底，不再冒充"最新"
    .sort(compareByRecency);
  // 屏蔽词过滤量：必须在分页/搜索/兴趣筛选之前算，否则会随 page 递增而虚高
  const blockedCount = items.length - cleaned.length;

  // 多源交叉验证 + 质量评分
  const verified = crossVerifyItems(cleaned);
  verified.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  // 为每个 item 注入源等级信息（与 dev 端 newsService.js 保持一致）
  verified.forEach(item => {
    const gradeInfo = getSourceGradeInfo(item.source);
    item.sourceGrade = gradeInfo.weight;
    item.sourceGradeLabel = gradeInfo.label;
    item.sourceGradeColor = gradeInfo.color;
    item.sourceGradeIcon = gradeInfo.icon;
  });

  // 缓存保存完整、已验证的列表；搜索/兴趣/分页只作用于本次响应。
  const cacheItems = verified;
  let filtered = cacheItems;
  if (interests.length) filtered = filtered.filter(item => interests.includes(item.category));
  if (search) filtered = filtered.filter(item => `${item.title} ${item.summary} ${item.source}`.toLowerCase().includes(search));
  const payload = buildListResponse({
    items: filtered,
    page,
    pageSize,
    blockedCount,
    extra: {
      updatedAt: new Date().toISOString(),
      sourceCount: filteredSources.length,
      failedSources,
    },
  });

  if (!blocked.length && !disabledSources.length) {
    // 只缓存全量列表 + 元信息，不缓存分页字段（否则命中分支会把过期分页值透出去）
    cache = {
      data: {
        items: cacheItems,
        updatedAt: payload.updatedAt,
        sourceCount: payload.sourceCount,
        failedSources,
        blockedCount,
      },
      expiresAt: now + 1000 * 60 * 5,
    };
  }

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}
