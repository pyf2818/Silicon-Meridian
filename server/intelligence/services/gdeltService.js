// ============================================================================
// GDELT 交叉验证层（Batch3）：用全球新闻聚合数据集（GDELT 2.0 DOC API，免费无鉴权）
// 为聚类事件提供「独立域名覆盖数」的外部佐证信号。
// 硬边界：
//   - GDELT 结果只作为 verification 元数据挂在事件上（随 payload JSON 落库），
//     永不进入 news itemPool（本模块不 import newsService，结构上隔离）；
//   - 任何失败静默降级（该事件不挂 verification 字段），绝不阻塞采集/落库主链；
//   - 验证信号「再赚才保留」：下次同步若未能再次确认，旧验证随 payload 覆盖自然过期；
//   - 免费限速：串行节流 1.5s/请求 + LRU 缓存 6h + 单轮上限 12 次查询。
// 语言边界：GDELT 以英文内容为主，仅对拉丁语系查询的事件做验证（中文事件预期命中率≈0，
// 直接跳过以节省限速配额）。
// ============================================================================
const GDELT_DOC_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_MIN_QUERY_INTERVAL_MS = 1500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h：与两轮 autoSync 间隔（10min）相比足够长
const CACHE_MAX_ENTRIES = 200;
const DEFAULT_RUN_CAP = 12;
const QUERY_TIMESPAN = '3d'; // 与事件聚类窗口（72h）对齐
const QUERY_TIMEOUT_MS = 8000;

const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'the', 'to', 'with',
  'new', 'launch', 'release', 'update', 'ai', 'says', 'report', 'reportedly',
  '人工智能', '发布', '推出', '更新', '称', '报道',
]);

const cache = new Map(); // query(小写) -> { at, articles | null }
let lastQueryAt = 0;
let queue = Promise.resolve();
let minQueryIntervalMs = DEFAULT_MIN_QUERY_INTERVAL_MS;

/** 测试钩子：清空缓存/节流状态 */
export function __resetGdeltForTests(intervalMs = DEFAULT_MIN_QUERY_INTERVAL_MS) {
  cache.clear();
  queue = Promise.resolve();
  lastQueryAt = 0;
  minQueryIntervalMs = intervalMs;
}

function isMostlyLatin(text) {
  if (!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin / text.length >= 0.6;
}

/** 事件标题 → GDELT 查询串（去停用词后取前 3 个词，空格 = AND 语义） */
export function extractQuery(event) {
  const normalized = String(event?.title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalized.split(' ').filter(token => token.length > 1 && !QUERY_STOP_WORDS.has(token));
  if (!tokens.length) return '';
  return tokens.slice(0, 3).join(' ');
}

/** 独立域名数 → 验证等级；<2 个独立域名视为无外部佐证（不挂字段） */
export function toVerification(articles, checkedAt) {
  const domains = new Set(
    articles.map(a => String(a?.domain || '').toLowerCase()).filter(Boolean),
  );
  const distinct = domains.size;
  if (distinct < 2) return null;
  const level = distinct >= 5 ? 'strong' : 'partial';
  const samples = articles.slice(0, 3).map(a => ({
    title: a?.title || '',
    domain: a?.domain || '',
    url: a?.url || '',
  }));
  return {
    provider: 'gdelt',
    distinctDomains: distinct,
    level,
    checkedAt,
    timespan: QUERY_TIMESPAN,
    samples,
  };
}

function scheduleThrottled(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastQueryAt + minQueryIntervalMs - Date.now());
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastQueryAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

async function queryGdeltArticles(query) {
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.articles;

  const articles = await scheduleThrottled(async () => {
    const url = `${GDELT_DOC_ENDPOINT}?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=75&format=json&timespan=${QUERY_TIMESPAN}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'SiliconMeridian-NewsBot/0.1' },
      });
      if (!response.ok) return null; // 限流/故障：不缓存，下次同步重试
      // GDELT 出错时常返回纯文本错误信息而非 JSON —— 解析失败视为失败
      const payload = await response.json().catch(() => null);
      return Array.isArray(payload?.articles) ? payload.articles : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  if (Array.isArray(articles)) {
    cache.set(key, { at: Date.now(), articles });
    if (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }
  return articles;
}

/**
 * 批量验证事件：返回 Map<eventId, verification>。
 * - events 预期已按 intelligenceScore 降序（clusterIntelligenceEvents 的输出保证），
 *   只验证头部 cap 个候选；
 * - process.env.VITEST 下自动跳过（防止单测触发真实外网）；options.force 可豁免。
 */
export async function verifyEventsWithGdelt(events = [], options = {}) {
  if (!options.force && process.env.VITEST) return new Map();
  const cap = Math.max(1, Number(options.cap || DEFAULT_RUN_CAP));
  const checkedAt = new Date().toISOString();

  const candidates = [...events]
    .filter(event => event && !event.verification)
    .map(event => ({ event, query: extractQuery(event) }))
    .filter(({ query }) => query && isMostlyLatin(query))
    .slice(0, cap);

  const verifications = new Map();
  await Promise.all(candidates.map(async ({ event, query }) => {
    try {
      const articles = await queryGdeltArticles(query);
      if (!Array.isArray(articles)) return;
      const verification = toVerification(articles, checkedAt);
      if (verification) verifications.set(event.id, verification);
    } catch {
      // 单事件失败静默：验证是增益信号，不是主链依赖
    }
  }));
  return verifications;
}
