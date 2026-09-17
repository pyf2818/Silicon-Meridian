/**
 * 发布时间解析与排序——**单一实现**，dev 端与 serverless 端共用。
 *
 * 为什么独立成文件而不是放 textProcessing.js：
 * textProcessing.js 顶部 import 了 config/constants.js（274 个源配置），
 * 而 `api/trending.js` 是自包含的 Serverless 函数，不该为一两个日期函数把整份源配置拖进包体。
 * （对比：api/news.js 本来就引了 constants.js，所以对它无额外成本。）
 *
 * 历史 BUG（本次修复的核心）：
 * 线上曾有**三份完全相同的 `normalizeDate`**（本文件前身分别在 textProcessing.js / api/news.js / api/trending.js），
 * 解析失败一律 `new Date()` 回退成**抓取时刻** —— 于是「源里没有日期字段」的条目会被伪装成"刚刚发布"：
 *   ① 按发布时间倒序排序时被**顶到榜首**；② 前端显示「刚刚」；③ 拿到 NEW 角标。
 * 实测样本（500 条）中 26 条（5.2%）如此：美团技术团队 ×10（其 feed 的 item 无 pubDate）、Paul Graham Essays ×16。
 *
 * 现在的约定：
 *   - **解析不出来就返回 null**，绝不伪造时间；
 *   - 调用方拿到 null 时用 `fetchedAt` 作为「入库时间」，并打 `publishedAtEstimated: true`；
 *   - 「没有发布时间」靠**标签**表达（前端显示「时间未知」、不打 NEW 角标），
 *     排序只在时间**明确错误**（将来）时降权 —— 不能让标签变成隐藏内容的手段。
 */

import { decodeEntities } from '../../utils/htmlEntities.js';

/**
 * 允许的「未来偏差」：超过这个量级就认为时间不可信。
 *
 * 定 2 小时的依据：源站与本机的时钟偏差是秒～分钟级，2 小时足够吸收；
 * 而实测抓到的异常是 **+5.7 小时**（InfoQ CN 的日期解析成未来）——必须判为不可信。
 */
export const FUTURE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * 解析发布时间。
 *
 * 与清洗逻辑的关系：旧实现内部调用了 `cleanText`（去标签 + 解码实体 + 折叠空白）。
 * 这里保留等价的最小清洗（不 import textProcessing.js，避免与其循环依赖，
 * 也避免把 274 个源配置拖进只想要日期函数的 Serverless 函数）。
 *
 * @param {*} value 原始时间串（RSS 的 pubDate / Atom 的 published / dc:date 等）
 * @returns {string|null} ISO 字符串；**解析失败返回 null**（不再回退当前时间）
 */
export function normalizeDate(value) {
  if (value == null) return null;
  const cleaned = decodeEntities(String(value))
    .replace(/<!\[CDATA\[|\]\]>/g, '')   // CDATA 包裹（RSS 里很常见）
    .replace(/<[^>]*>/g, ' ')            // 万一夹带标签
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const time = new Date(cleaned).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** 是否明显在将来（超出容差）——用于标记不可信的未来发布时间。 */
export function isFutureDate(isoString, { now = Date.now(), toleranceMs = FUTURE_TOLERANCE_MS } = {}) {
  if (!isoString) return false;
  const time = new Date(isoString).getTime();
  if (!Number.isFinite(time)) return false;
  return time - now > toleranceMs;
}

/** 该条目是否只能算「估计时间」：没有真实日期，或日期明显在将来。 */
export function isEstimatedPublishTime(publishedAt, { now = Date.now(), toleranceMs = FUTURE_TOLERANCE_MS } = {}) {
  if (!publishedAt) return true;
  return isFutureDate(publishedAt, { now, toleranceMs });
}

/** 时间戳是否「明确错误」（在将来）——比「缺失」更该被降权。 */
export function isUntrustworthyPublishTime(publishedAt, { now = Date.now(), toleranceMs = FUTURE_TOLERANCE_MS } = {}) {
  return Boolean(publishedAt) && isFutureDate(publishedAt, { now, toleranceMs });
}

/** 取用于排序/展示的时间：优先真实发布时间，否则退到入库时间。 */
export function effectivePublishTime(item) {
  const raw = item?.publishedAt || item?.fetchedAt || item?.createdAt || null;
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * 按「最近」排序（最新在前）。
 *
 * 设计取舍（第一版实现踩过的坑，别退回去）：
 * 最初写成「凡是 `publishedAtEstimated` 一律沉底」。实测立刻暴露问题——
 * 列表有条数上限（MAX_NEWS_ITEMS=500），沉底等于把**整个无日期来源挤出资讯流**
 * （美团技术团队、Paul Graham Essays 这类源会凭空消失）。丢内容比显示错时间更糟。
 *
 * 所以这里只做两件事：
 *   ① **明确错误**的时间（将来）→ 降权沉底；
 *   ② 其余一律用 `effectivePublishTime`（缺日期则用**入库时间**）参与排序 —— 保证内容留在流里。
 * 「没有发布时间」这件事由**标签**表达（前端显示「时间未知」、不打 NEW 角标），而不是靠排序隐藏。
 */
export function compareByRecency(a, b) {
  const au = isUntrustworthyPublishTime(a?.publishedAt) ? 1 : 0;
  const bu = isUntrustworthyPublishTime(b?.publishedAt) ? 1 : 0;
  if (au !== bu) return au - bu;              // 时间明确错误的沉底
  return effectivePublishTime(b) - effectivePublishTime(a);
}

/** 就地排序的便捷封装（返回新数组，不改原数组）。 */
export function sortByRecency(items) {
  return Array.isArray(items) ? [...items].sort(compareByRecency) : [];
}
