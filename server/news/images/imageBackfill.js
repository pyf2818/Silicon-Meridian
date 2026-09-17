/**
 * 配图回填器（解决「资讯卡片大多没有图」的问题）。
 *
 * 现状实测（2026-09-17）：可见 500 条里只有 17.8% 带图——因为图片只从 **RSS 内**
 * 提取（enclosure/description），而 ArXiv 全系、Amazon AI Blog、CNBC、Simon Willison 等
 * 大量源的 item 里根本没有图片字段。但它们的**文章页**几乎都有 og:image。
 *
 * 策略（对视野内条目做克制的回填）：
 *   1. 只处理「没有 imageUrl」的条目；单轮上限 RUN_CAP，条目间节流，单页 8s 超时；
 *   2. 抓文章 HTML → collectStructuredImageCandidates（og:image/twitter/link/JSON）
 *      → isGoodImageUrl 过滤广告头图/站点资源 → 取得分最高的一张；
 *   3. 失败 URL 进负缓存 6h（不反复锤同一个失败页面）；
 *   4. 全程 fire-and-forget：回填慢一拍没关系，绝不能阻塞资讯响应。
 *
 * 已知边界：需要登录/强反爬的站点抓不到（负缓存兜底）；这版不做 Scrapling 代理回退。
 */
import { collectStructuredImageCandidates, isGoodImageUrl, normalizeCandidateImageUrl, scoreImageUrl } from './imageProcessing.js';

export const BACKFILL_RUN_CAP = 24;
export const BACKFILL_TIMEOUT_MS = 8_000;
export const BACKFILL_THROTTLE_MS = 400;
export const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (compatible; SiliconStreamBot/1.0; +image-backfill)';

const negativeCache = new Map();   // url → failedAt
let running = false;

function failedRecently(url, now = Date.now()) {
  const at = negativeCache.get(url);
  if (!at) return false;
  if (now - at > NEGATIVE_TTL_MS) { negativeCache.delete(url); return false; }
  return true;
}

function pickBestImage(html, pageUrl) {
  const candidates = collectStructuredImageCandidates(html, pageUrl)
    .map(candidate => {
      const url = normalizeCandidateImageUrl(candidate.url, pageUrl);
      return { ...candidate, url, score: scoreImageUrl(url, candidate.context || '') };
    })
    .filter(candidate => candidate.url && isGoodImageUrl(candidate.url, candidate.context || ''));
  if (!candidates.length) return '';
  // og:image 优先：结构化来源权重 + 显式评分排序（source 字段标明 og/twitter/link/json）
  return candidates.sort((a, b) =>
    (b.source === 'og' ? 1 : 0) - (a.source === 'og' ? 1 : 0)
    || (b.score || 0) - (a.score || 0))[0]?.url || '';
}

async function fetchArticleHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKFILL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!response.ok) return '';
    const type = String(response.headers.get('content-type') || '');
    if (!/text\/html/i.test(type)) return '';
    const raw = await response.text();
    // og:image 几乎都在 <head>，截前 60KB 足够且省内存
    return raw.slice(0, 60_000);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 对无图条目做首图回填。
 * @param {Array} items 无 imageUrl 的条目（会被读取 url；结果不含条目对象）
 * @returns {Promise<{attempted: number, resolved: Map<string,string>}>} url → imageUrl
 */
export async function backfillItemImages(items, { now = Date.now() } = {}) {
  if (running) return { attempted: 0, resolved: new Map() };
  running = true;
  const resolved = new Map();
  let attempted = 0;
  try {
    const queue = (Array.isArray(items) ? items : [])
      .filter(item => item?.url && !failedRecently(item.url, now))
      .slice(0, BACKFILL_RUN_CAP);

    for (const item of queue) {
      attempted += 1;
      const html = await fetchArticleHtml(item.url);
      if (!html) { negativeCache.set(item.url, now); continue; }
      const imageUrl = pickBestImage(html, item.url);
      if (imageUrl) resolved.set(item.url, imageUrl);
      else negativeCache.set(item.url, now);
      await sleep(BACKFILL_THROTTLE_MS);
    }
    return { attempted, resolved };
  } finally {
    running = false;
  }
}

/** 测试/运维：清空负缓存与运行锁 */
export function resetImageBackfillForTests() {
  negativeCache.clear();
  running = false;
}
