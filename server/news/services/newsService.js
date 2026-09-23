import { DEFAULT_SOURCES, SOURCE_WEIGHTS, CROSS_VERIFY_THRESHOLD, MAX_NEWS_ITEMS, MAX_ITEMS_PER_SOURCE, PAGE_SIZE, MEDIA_CONFIG, BRIDGED_SOURCE_NAMES, BRIDGED_WEIGHT_FACTOR } from '../config/constants.js';
import { getSourceGradeInfo } from '../config/sourceGrades.js';
import { applyBlockedWords, normalizeUrl } from '../utils/textProcessing.js';
import { compareByRecency } from '../utils/dateUtils.js';
import { rankItems } from '../../ranking/ranker.js';
import { recordBlockedHits, recordCorroborations, recordTopHits } from '../../ranking/sourceStats.js';
import { ensureDailyEditorRun, applyEditorVerdicts } from '../../intelligence/editorService.js';
import { fetchSource } from './externalFetchers.js';
import { fetchApiSource } from './apiFetchers.js';
import {
  createSourceState, recordOutcome, pickDueSources, runWithConcurrency,
} from './sourceScheduler.js';
import {
  mediaStats, resetMediaStats, logMediaStats,
  resetGlobalImageUsage, resolveImageWithScrapling
} from '../images/imageResolver.js';
import { isGoodImageUrl, normalizeImageKey } from '../images/imageProcessing.js';
import { backfillItemImages } from '../images/imageBackfill.js';

// ============================================================================
// 架构（2026-08-18 重构）：
//   采集层 = sourceScheduler 分级轮询（S=15min/A=30min/B=1h/C=3h/D=6h，失败退避+降档）
//   存储层 = 进程内持久池 itemPool（Map，重启即失，7 天 TTL / 3000 条上限 / 每源 32 条）
//   读路径 = getNews 从池构建（永不等网络），newsCache 仅作「池版本」读缓存
//   冷启动 = 池空时首请求最多等 12s 让首轮抓取填池，之后请求全部秒回
//   落库   = 每轮抓取后自动触发 intelligence 事件聚类 upsert（PG / dev 内存库）
// ============================================================================

export const newsCache = { data: null, expiresAt: 0, staleAt: 0, key: '', lastWarmAt: 0 };

// 持久池：key = source|normalizedUrl|title，value = 已富化（等级/涉华标记）的 item
const itemPool = new Map();
// 源名 → 调度状态（failCount/degradeSteps/lastFetchedAt）
const poolStates = new Map();
// 池版本：每完成一轮抓取 +1，读缓存据此失效
let poolVersion = 0;
// 最近一轮抓取统计（供 /api/news 的 failedSources 字段）
let lastCycleStats = { ok: 0, failed: 0, at: 0 };

// 用户自定义源的独立小缓存（5min TTL，避免每个请求都打外网）
const customSourceCache = new Map();
const CUSTOM_SOURCE_TTL_MS = 5 * 60 * 1000;

const POOL_MAX_ITEMS = 3000;
const POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POOL_PER_SOURCE = 32;
const FETCH_TOTAL_BUDGET_MS = 12_000;
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
let lastAutoSyncAt = 0;

// 涉华关键词（中英混合匹配）—— 与前端保持一致，服务端预计算避免前端同步扫描
const CHINA_FOCUSED_KEYWORDS = ['China', '中国', '中企', '中国企业', '人民币', '华为', '腾讯', '阿里巴巴', '字节跳动', '对华', '涉华', '中美', '中欧', '一带一路', 'RCEP', '东盟'];
function computeIsChinaFocused(item) {
  const textToMatch = `${item.title || ''} ${item.summary || ''} ${Array.isArray(item.tags) ? item.tags.join(' ') : ''}`.toLowerCase();
  return CHINA_FOCUSED_KEYWORDS.some(kw => {
    if (/^[a-zA-Z\s]+$/.test(kw)) {
      return textToMatch.includes(kw.toLowerCase()) || textToMatch.includes(kw);
    }
    return textToMatch.includes(kw.toLowerCase());
  });
}

export function mergeDiverseItems(items, _sourceResults, maxItems, perSourceLimit) {
  const seen = new Set();
  const deduped = [];
  (Array.isArray(items) ? items : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const source = String(item.source || '未知来源').trim();
    const title = String(item.title || '').trim();
    // 无标题的脏条目无法被用户识别，也不能作为有效资讯进入推荐池。
    if (!title) return;
    const key = `${source}|${normalizeUrl(item.url)}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({ ...item, source, title });
  });

  const sourceCounts = new Map();
  const capped = [];
  deduped.forEach(item => {
    const count = sourceCounts.get(item.source) || 0;
    if (count >= perSourceLimit) return;
    sourceCounts.set(item.source, count + 1);
    capped.push(item);
  });

  return capped
    // 估计时间（无日期字段 / 未来时间）沉底：不让它挤掉有真实发布时间的条目
    .sort(compareByRecency)
    .slice(0, maxItems);
}

export function crossVerifyItems(items) {
  const urlMap = new Map();
  items.forEach(item => {
    const normalized = normalizeUrl(item.url);
    if (!normalized) return;
    if (!urlMap.has(normalized)) urlMap.set(normalized, []);
    urlMap.get(normalized).push(item);
  });

  return items.map(item => {
    const normalized = normalizeUrl(item.url);
    const sameUrlItems = urlMap.get(normalized) || [];
    // 交叉验证计算独立来源数；同一来源重复抓取/转载不能抬高可信度。
    const sourceCount = normalized
      ? new Set(sameUrlItems.map(entry => String(entry.source || '').trim()).filter(Boolean)).size
      : 0;

    // 计算交叉验证分数
    let crossVerifyScore = 0;
    if (sourceCount >= CROSS_VERIFY_THRESHOLD) crossVerifyScore = 3;
    else if (sourceCount >= 2) crossVerifyScore = 2;
    else if (sourceCount >= 1) crossVerifyScore = 1;

    // 获取源权重
    const sourceWeight = SOURCE_WEIGHTS[item.source] || 0.5;
    // 桥接通道折扣：内容等级（sourceWeight）不变，质量分按传输层可信度打折
    const effectiveWeight = item.bridged ? sourceWeight * BRIDGED_WEIGHT_FACTOR : sourceWeight;

    return {
      ...item,
      crossVerifyScore,
      independentSourceCount: sourceCount,
      sourceWeight,
      // 综合质量分数 = 交叉验证分数 * 有效源权重（桥接源乘 BRIDGED_WEIGHT_FACTOR） * 10
      qualityScore: Math.round((crossVerifyScore * effectiveWeight) * 10) / 10
    };
  });
}

/* ============ 持久池 ============ */

function poolKey(item) {
  return `${item.source}|${normalizeUrl(item.url)}|${(item.title || '').toLowerCase()}`;
}

/** 入池时富化：等级信息 + 桥接标记 + 涉华标记（一次性，读路径不再重复计算）。export 仅供测试 */
export function enrichItem(item) {
  const gradeInfo = getSourceGradeInfo(item.source);
  item.sourceGrade = gradeInfo.weight;
  item.sourceGradeLabel = gradeInfo.label;
  item.sourceGradeColor = gradeInfo.color;
  item.sourceGradeIcon = gradeInfo.icon;
  item.bridged = BRIDGED_SOURCE_NAMES.has(item.source);
  item.isChinaFocused = computeIsChinaFocused(item);
  return item;
}

function mergeIntoPool(rawItems) {
  const perSource = new Map();
  for (const raw of rawItems) {
    if (!raw || !raw.url) continue;
    const key = poolKey(raw);
    if (itemPool.has(key)) continue;
    const count = perSource.get(raw.source) || 0;
    if (count >= POOL_PER_SOURCE) continue;
    perSource.set(raw.source, count + 1);
    itemPool.set(key, enrichItem(raw));
  }
  evictPool();
}

function evictPool() {
  const now = Date.now();
  for (const [key, item] of itemPool) {
    const at = Date.parse(item.publishedAt) || 0;
    if (at && now - at > POOL_TTL_MS) itemPool.delete(key);
  }
  if (itemPool.size > POOL_MAX_ITEMS) {
    const sorted = [...itemPool.entries()]
      .sort((a, b) => (Date.parse(a[1].publishedAt) || 0) - (Date.parse(b[1].publishedAt) || 0));
    const excess = itemPool.size - POOL_MAX_ITEMS;
    for (let i = 0; i < excess; i++) itemPool.delete(sorted[i][0]);
  }
}

/* ============ 抓取周期（调度器驱动） ============ */

let cyclePromise = null;

/**
 * 执行一轮分级抓取：只抓「到期」的源（S 级优先出队），结果并入持久池。
 * 冷启动时所有源都视为到期，但按等级排序 + 并发池 16 出队，S 级最先完成入池。
 */
export async function runFetchCycle() {
  if (cyclePromise) return cyclePromise;
  cyclePromise = (async () => {
    const due = pickDueSources(DEFAULT_SOURCES, poolStates, Date.now());
    if (!due.length) return { fetched: 0, ok: 0, failed: 0, skipped: true };

    let ok = 0;
    let failed = 0;
    const results = await runWithConcurrency(due, async source => {
      // API 源走生产端结构化抓取，RSS 源走 feed 抓取；失败语义一致（抛错 → 调度退避）
      const result = source.type === 'api' ? await fetchApiSource(source) : await fetchSource(source);
      mergeIntoPool(result.items);
      return result;
    });
    results.forEach((result, index) => {
      const source = due[index];
      const isOk = result.status === 'fulfilled';
      poolStates.set(source.name, recordOutcome(poolStates.get(source.name) || createSourceState(), isOk));
      if (isOk) ok += 1; else failed += 1;
    });
    poolVersion += 1;
    lastCycleStats = { ok, failed, at: Date.now() };
    scheduleAutoSync();
    return { fetched: due.length, ok, failed, skipped: false };
  })().catch(err => {
    console.error('[runFetchCycle] error:', err?.message || err);
    return { fetched: 0, ok: 0, failed: 0, error: err?.message || String(err) };
  }).finally(() => { cyclePromise = null; });
  return cyclePromise;
}

/**
 * 智报事件自动落库：抓取周期完成后，把 intelligence 管线的聚类事件
 * upsert 到 intelligence_articles / intelligence_events（PG 或 dev 内存库）。
 * 每 10 分钟最多一次；动态 import 断开模块加载期依赖；失败静默（不阻塞采集）。
 */
function scheduleAutoSync() {
  const now = Date.now();
  if (now - lastAutoSyncAt < AUTO_SYNC_INTERVAL_MS) return;
  lastAutoSyncAt = now;
  import('../../intelligence/services/intelligenceService.js')
    .then(({ syncIntelligenceSnapshot }) => syncIntelligenceSnapshot({ take: 80 }))
    .then(result => {
      if (result?.ok) console.log('[autoSync] intelligence events upserted:', JSON.stringify(result.saved));
    })
    .catch(err => console.warn('[autoSync] skipped:', err?.message || err));
}

/* ============ 用户自定义源（独立小缓存） ============ */

async function fetchCustomSources(customSources) {
  if (!customSources.length) return { items: [], failed: 0 };
  const now = Date.now();
  const due = customSources.filter(s => {
    const cached = customSourceCache.get(s.url);
    return !cached || now - cached.fetchedAt > CUSTOM_SOURCE_TTL_MS;
  });
  if (due.length) {
    const results = await runWithConcurrency(due, source => fetchSource(source), 6);
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        customSourceCache.set(due[index].url, {
          items: result.value.items.map(enrichItem),
          fetchedAt: now,
        });
      }
    });
  }
  const items = [];
  let failed = 0;
  for (const source of customSources) {
    const cached = customSourceCache.get(source.url);
    if (cached) items.push(...cached.items);
    else failed += 1;
  }
  return { items, failed };
}

/* ============ 读路径 ============ */

export async function getNews(blocked, customSources, page = 0, pageSize = PAGE_SIZE, search = '', disabledSources = [], interests = [], options = {}) {
  const now = Date.now();

  const cacheKey = JSON.stringify({ blocked, customSources: customSources.map(s => s.url), disabledSources, interests });
  const cacheHit = newsCache.data && newsCache.key === cacheKey;
  // 读缓存必须同时满足：未过期 + 池版本一致（池更新后缓存立即重建，重建本身不碰网络）
  const cacheCurrent = cacheHit
    && newsCache.expiresAt > now
    && newsCache.data.poolVersion === poolVersion
    && !options?.forceRefresh;

  let fullItems;
  let failedSources;
  let blockedCount;
  let sourceCount;

  if (cacheCurrent) {
    fullItems = newsCache.data.items;
    failedSources = newsCache.data.failedSources;
    blockedCount = newsCache.data.blockedCount;
    sourceCount = newsCache.data.sourceCount;
  } else {
    // 冷启动：池空且无任何缓存 → 最多等 12s 让首轮抓取填池（后台继续，不阻塞进程）
    if (itemPool.size === 0 && !cacheHit) {
      console.log('[getNews] Cold start: waiting up to 12s for first fetch cycle...');
      const cycle = runFetchCycle();
      await Promise.race([
        cycle,
        new Promise(resolve => setTimeout(resolve, FETCH_TOTAL_BUDGET_MS)),
      ]);
    } else if (!cyclePromise) {
      // 池/缓存过期：后台静默补一轮（不阻塞当前响应，读路径从现有池构建）
      runFetchCycle().catch(err => console.error('[getNews] Background cycle failed:', err?.message));
    }

    const { items: customItems, failed: customFailed } = await fetchCustomSources(customSources);
    const poolItems = [...itemPool.values()].filter(item => !disabledSources.includes(item.source));

    const rawAll = [...poolItems, ...customItems];
    const cleaned = applyBlockedWords(rawAll, blocked)
      .sort(compareByRecency);
    blockedCount = rawAll.length - cleaned.length;

    // 去重 + 每源上限 + 全局上限（按时间取最新 MAX_NEWS_ITEMS 条），再交叉验证
    const deduped = mergeDiverseItems(cleaned, [], MAX_NEWS_ITEMS, MAX_ITEMS_PER_SOURCE);
    fullItems = crossVerifyItems(deduped);

    // 排序策略：质量分降序 → 源等级 → 发布时间倒序（与原版一致）
    fullItems.sort((a, b) => {
      const qualityDiff = (b.qualityScore || 0) - (a.qualityScore || 0);
      if (qualityDiff !== 0) return qualityDiff;
      const gradeDiff = (b.sourceGrade || 0) - (a.sourceGrade || 0);
      if (gradeDiff !== 0) return gradeDiff;
      return compareByRecency(a, b);
    });

    // 影子模式：MERIDIAN_RANKER_V2=1 时启用统一排序内核（ranker-v2.1）。
    // 默认关闭——先在影子报表里证明四象限优于旧排序，再谈切换默认值。
    if (process.env.MERIDIAN_RANKER_V2 === '1') {
      fullItems = rankItems(fullItems, { lane: 'public', now: Date.now() });
    }

    // 初始化统计
    resetMediaStats();
    resetGlobalImageUsage();
    mediaStats.totalItems = fullItems.length;

    // 配图回填（fire-and-forget）：对视野内无图条目抓文章页补 og:image，
    // 结果写回「当前缓存对象 + 持久池」——首次浏览后几分钟内逐步补齐，绝不阻塞响应。
    if (process.env.MERIDIAN_IMAGE_BACKFILL !== '0') {
      const missing = fullItems.filter(item => !item.imageUrl && item.url).slice(0, 24);
      if (missing.length) {
        backfillItemImages(missing).then(({ resolved }) => {
          if (!resolved.size) return;
          let applied = 0;
          for (const item of missing) {
            const imageUrl = resolved.get(item.url);
            if (!imageUrl || item.imageUrl) continue;
            item.imageUrl = imageUrl;                     // 当前缓存对象（引用共享，下个请求即生效）
            const pooled = itemPool.get(poolKey(item));
            if (pooled && !pooled.imageUrl) { pooled.imageUrl = imageUrl; applied += 1; }
          }
          if (applied) console.log(`[imageBackfill] 本轮回填 ${applied} 张首图`);
        }).catch(() => {});
      }
    }

    // P4 信源动态表现统计（只读累积，不影响本响应；sourceTrust 信号在样本 ≥10 后自动启用）
    recordTopHits(fullItems.map(item => item.source).filter(Boolean));
    {
      const visible = new Set(cleaned);
      recordBlockedHits(rawAll.filter(item => !visible.has(item)).map(item => item.source).filter(Boolean));
    }
    recordCorroborations(
      fullItems
        .filter(item => Number.isFinite(item.independentSourceCount) && item.independentSourceCount >= 2)
        .map(item => ({ source: item.source, count: item.independentSourceCount })),
    );

    // 去重RSS图片，防止同一图片在多个资讯中重复出现
    const rssImageUsage = new Map();
    fullItems.forEach(item => {
      if (item.imageUrl) {
        try {
          if (!isGoodImageUrl(item.imageUrl, `${item.title || ''} ${item.summary || ''}`)) {
            item.imageUrl = '';
            return;
          }
          const normalized = normalizeImageKey(item.imageUrl);
          const usageCount = rssImageUsage.get(normalized) || 0;
          if (usageCount >= 1) {
            item.imageUrl = '';
          } else {
            rssImageUsage.set(normalized, usageCount + 1);
          }
        } catch {
          // URL解析失败，保留原样
        }
      }
    });

    fullItems.forEach(item => {
      if (item.imageUrl) {
        mediaStats.itemsWithImage++;
        mediaStats.rssImageCount++;
      }
      if (item.videoUrl) {
        mediaStats.itemsWithVideo++;
      }
    });

    const itemsWithoutImage = fullItems.filter(item => !item.imageUrl && item.url);
    if (itemsWithoutImage.length > 0) {
      // 异步解析图片：fire-and-forget，结果写回同一份 fullItems 引用（缓存命中时可见）
      Promise.allSettled(itemsWithoutImage.slice(0, MEDIA_CONFIG.MAX_RESOLVE_ITEMS).map(async (item) => {
        try {
          const resolved = await resolveImageWithScrapling(item.url);
          return { id: item.id, imageUrl: resolved.imageUrl, videoUrl: resolved.videoUrl || item.videoUrl, images: resolved.images || [] };
        } catch { return null; }
      })).then(imageSettled => {
        imageSettled.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            const idx = fullItems.findIndex(i => i.id === result.value.id);
            if (idx >= 0) {
              if (result.value.imageUrl) fullItems[idx].imageUrl = result.value.imageUrl;
              if (result.value.videoUrl) fullItems[idx].videoUrl = result.value.videoUrl;
              if (result.value.images?.length) fullItems[idx].images = result.value.images;
            }
          }
        });
        mediaStats.lastUpdate = new Date().toISOString();
      }).catch(() => { /* 后台图片解析失败不影响主流程 */ });
    }

    // 最终图片去重 + 统计
    const finalImageUsage = new Map();
    fullItems.forEach(item => {
      if (!item.imageUrl) return;
      try {
        const normalized = normalizeImageKey(item.imageUrl);
        if (finalImageUsage.has(normalized)) {
          item.imageUrl = '';
          mediaStats.duplicateFilteredCount++;
          return;
        }
        finalImageUsage.set(normalized, item.id);
      } catch {
        item.imageUrl = '';
      }
    });

    mediaStats.itemsWithImage = 0;
    mediaStats.itemsWithVideo = 0;
    fullItems.forEach(item => {
      if (item.imageUrl) mediaStats.itemsWithImage++;
      if (item.videoUrl) mediaStats.itemsWithVideo++;
    });
    mediaStats.lastUpdate = new Date().toISOString();
    logMediaStats();

    failedSources = (lastCycleStats.failed || 0) + customFailed;
    sourceCount = (DEFAULT_SOURCES.length - disabledSources.length) + customSources.length;

    newsCache.data = { items: fullItems, failedSources, blockedCount, sourceCount, poolVersion };
    newsCache.expiresAt = now + 1000 * 60 * 5;
    newsCache.staleAt = now + 1000 * 60 * 10;
    newsCache.key = cacheKey;
  }

  // 兴趣过滤
  let filteredItems = fullItems;
  if (interests.length > 0) {
    filteredItems = fullItems.filter(item => {
      if (!item.category) return false;
      return interests.includes(item.category);
    });
  }

  if (search) {
    const q = search.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 1 && /[a-z]/.test(q) && /[一-鿿]/.test(q)) {
      const parts = q.match(/([a-z]+|[一-鿿]+)/g);
      if (parts && parts.length > 1) tokens.length = 0;
      if (parts && parts.length > 1) parts.forEach(p => tokens.push(p));
    }

    filteredItems = filteredItems.filter(item => {
      const txt = `${item.title} ${item.summary} ${item.source} ${(item.tags || []).join(' ')}`.toLowerCase();
      if (tokens.length > 1) {
        // 多词改 OR 命中：AND 子串匹配会让自然语言关键词（如"今日值得关注"）全军覆没；
        // 命中数排序（下方）保证完全命中的仍排最前。
        return tokens.some(t => txt.includes(t));
      }
      return txt.includes(q);
    });

    filteredItems.sort((a, b) => {
      const aTxt = `${a.title} ${a.summary}`.toLowerCase();
      const bTxt = `${b.title} ${b.summary}`.toLowerCase();
      if (tokens.length > 1) {
        const aScore = tokens.filter(t => aTxt.includes(t)).length;
        const bScore = tokens.filter(t => bTxt.includes(t)).length;
        if (aScore !== bScore) return bScore - aScore;
      }
      const aTitle = tokens.some(t => a.title.toLowerCase().includes(t)) ? 1 : 0;
      const bTitle = tokens.some(t => b.title.toLowerCase().includes(t)) ? 1 : 0;
      return bTitle - aTitle;
    });
  }

  const start = page * pageSize;
  const end = start + pageSize;
  const pagedItems = filteredItems.slice(start, end);

  // LLM 编辑层（2026-09-22）：fire-and-forget 惰性触发（每日 ≤1 次，未配置即关闭），
  // 已算出的批注同步合并进当前页（精选标记 + 一句话编辑点评）。读路径永不等待 LLM。
  // LLM 编辑层（fire-and-forget，读路径零等待）：userId 用于 env 未配置时回退到用户自己的模型
  ensureDailyEditorRun(filteredItems.slice(0, 30), { userId: options?.userId || null });
  applyEditorVerdicts(pagedItems);

  return {
    // 与 /api/intelligence/* 对齐：显式带 ok。此前该 payload 没有 ok 字段，
    // 调用方若按 data.ok 判定会静默全部落空（站内几百条资讯形同不存在）。
    ok: true,
    updatedAt: new Date().toISOString(),
    items: pagedItems,
    total: filteredItems.length,
    page,
    pageSize,
    hasMore: end < filteredItems.length,
    sourceCount,
    failedSources,
    blockedCount
  };
}

/**
 * 服务端预热：触发一轮分级抓取（只抓到期源，通常只有一小部分）。
 * fire-and-forget，错误不影响服务运行。
 */
export async function warmNewsCache(options = {}) {
  const now = Date.now();
  if (now - newsCache.lastWarmAt < 4 * 60 * 1000 && !options.forceRefresh) {
    return { skipped: true, reason: 'recently warmed' };
  }
  newsCache.lastWarmAt = now;
  const result = await runFetchCycle();
  return { skipped: false, ok: !result.error, ...result };
}

/**
 * 启动定时抓取：服务启动立即跑一轮（冷启动全量、按等级优先入池），
 * 之后每 intervalMs 触发一次 runFetchCycle（内部只抓到期源）。
 */
export function startNewsWarming(intervalMs = 5 * 60 * 1000) {
  let stopped = false;
  let timer = null;
  const tick = () => {
    if (stopped) return;
    runFetchCycle().catch(err => console.error('[news warming] error:', err?.message));
  };
  tick();
  timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/* 测试辅助：重置模块级状态（仅单测使用） */
export function __resetPoolForTests() {
  itemPool.clear();
  poolStates.clear();
  customSourceCache.clear();
  poolVersion = 0;
  lastCycleStats = { ok: 0, failed: 0, at: 0 };
  lastAutoSyncAt = 0;
  newsCache.data = null;
  newsCache.key = '';
  newsCache.expiresAt = 0;
  newsCache.staleAt = 0;
  newsCache.lastWarmAt = 0;
}
