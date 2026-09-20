/**
 * articleFetcher - 资讯原文抓取（客户端统一入口）
 *
 * 为什么独立成 util：资讯预览抽屉（NewsPreviewPanel）与 AI 精灵拖拽分析
 * （AiElf）都需要「URL → 完整正文」。统一走 /api/fetch-page，并做两层加固：
 *  1. 内存缓存：同一 URL 反复预览/分析不重复抓取（资讯刷新不影响已抓内容）
 *  2. 失败自动重试一次：瞬时抖动/超时不再直接失败
 */

const CACHE_LIMIT = 40;
const memoryCache = new Map(); // url → { text, images, html }

export function getCachedPageContent(url) {
  if (!url) return null;
  return memoryCache.get(url)?.text || null;
}

export function cachePageContent(url, content) {
  if (!url || !content) return;
  cachePageDetail(url, {
    text: content,
    images: memoryCache.get(url)?.images || [],
    html: memoryCache.get(url)?.html || '',
  });
}

function cachePageDetail(url, detail) {
  if (!url || !detail?.text) return;
  if (memoryCache.size >= CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
  memoryCache.set(url, detail);
}

/**
 * 抓取正文全文 + 配图列表 + 结构化 HTML（NewsPreviewPanel 用）
 * v32：html 为服务端白名单消毒后的正文 HTML（保留标题/段落/列表/代码块/表格结构），
 *      预览面板优先渲染它；text 仍为纯文本（AI 分析/精灵链路用，形状不变）。
 * @returns {Promise<{text:string|null, images:string[], html:string}>}
 */
export async function fetchArticleDetail(url) {
  if (!url) return { text: null, images: [], html: '' };
  const cached = memoryCache.get(url);
  if (cached) return { text: cached.text, images: cached.images || [], html: cached.html || '' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const text = String(data?.content || '');
      const html = String(data?.html || '');
      const images = Array.isArray(data?.images) ? data.images.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)) : [];
      // 内容过短多为反爬拦截页：不缓存，再试一次；仍短则视为失败
      if (text.length > 80) {
        cachePageDetail(url, { text, images, html });
        return { text, images, html };
      }
      if (attempt === 1) return { text: null, images: [], html: '' };
    } catch {
      if (attempt === 1) return { text: null, images: [], html: '' };
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  }
  return { text: null, images: [], html: '' };
}

/**
 * 抓取正文全文（兼容旧调用：AI 精灵拖拽分析等只需要文本）
 * @returns {Promise<string|null>} 成功返回正文；失败（重试后仍失败）返回 null
 */
export async function fetchArticleContent(url) {
  const { text } = await fetchArticleDetail(url);
  return text;
}

/** localStorage 持久缓存（跨刷新稳定）：精灵拖拽快照用 */
const SNAP_KEY = 'ai-elf-drop-snapshots';
const SNAP_LIMIT = 40;

export function loadDropSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAP_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/** 保存拖拽资讯快照（含抓到的全文），后续再分析同一条资讯不再依赖资讯池 */
export function saveDropSnapshot(url, snapshot) {
  if (!url || !snapshot) return;
  try {
    const all = loadDropSnapshots();
    all[url] = { ...snapshot, savedAt: Date.now() };
    const entries = Object.entries(all).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, SNAP_LIMIT);
    localStorage.setItem(SNAP_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* 隐私模式忽略 */ }
}

/** 取回拖拽快照的全文（优先内存缓存 → localStorage 快照） */
export function getDropSnapshotContent(url) {
  if (!url) return null;
  const snap = loadDropSnapshots()[url];
  return snap?.fullContent || snap?.content || null;
}
