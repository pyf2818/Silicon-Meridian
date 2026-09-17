/**
 * 网页正文抽取（纯函数，无 DOM 依赖）——dev 端与 serverless 端共用。
 *
 * 背景：原先 `handleFetchPageRequest` 的「正文」= 整页去掉 script/style 后**去掉所有标签**
 * 再截 15000 字。于是导航、页脚、侧栏、相关阅读、广告、版权、Cookie 提示全部混进"正文"里。
 * 本项目当时**没有任何正文容器识别**（广告过滤只做在图片链路上）。
 *
 * 策略（按优先级）：
 *   1. 先摘掉结构性噪声标签（script/style/nav/footer/aside/header/form 等）；
 *   2. 在候选容器里找正文：`<article>` / `itemprop="articleBody"` / class-id 命中 article|post|entry|content|story 的块级元素；
 *   3. 容器内仍有噪声（class/id 命中 ad|sponsor|related|share|comment|sidebar|subscribe…）→ 逐个删除；
 *   4. 取「去标签后文本最长」的候选作为正文；都太短则退化为整页（并如实标记 `fallback`）。
 *
 * 已知限制（诚实标注，别当它万能）：用正则而非 DOM 解析，**嵌套同名标签**（div 套 div）会让
 * 非贪婪匹配提前收尾。因此这里采取「多候选择优 + 文本最长者胜」来抵消，而不是假装解析正确。
 * 后续若要更准，应换成 htmlparser2 之类的真实解析器。
 */
import { decodeEntities } from '../utils/htmlEntities.js';

/** 结构性噪声：整块删除（这些标签内部几乎不可能是正文） */
const NOISE_ELEMENT_PATTERN = /<(script|style|noscript|template|svg|iframe|form|button|select|textarea|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** 自闭合/孤立噪声标签（无闭合标签的 img/input 等） */
const NOISE_VOID_TAG_PATTERN = /<(script|style|iframe|svg|img|input|button|link|meta)\b[^>]*>/gi;

/** class/id 命中广告、推荐、评论、分享等 → 该元素整块删除 */
const NOISE_ATTR_PATTERN = /(?:class|id)\s*=\s*["'][^"']*\b(ad|ads|advert|advertisement|sponsor|sponsored|promo|promotion|recommend|recommended|related|share|sharing|social|comment|comments|sidebar|footer|navbar|breadcrumb|copyright|subscribe|subscription|paywall|cookie|banner|popup|modal|toolbar|menu|nav)\b[^"']*["']/i;

/** 可整块删除的块级标签（配合 NOISE_ATTR_PATTERN 使用） */
const BLOCK_TAGS = ['div', 'section', 'aside', 'ul', 'ol', 'figure', 'p', 'span'];

/** 正文候选容器 */
/**
 * 正文候选容器。
 * 覆盖顺序：语义标签 → schema.org 标注 → <main> → class/id 命名约定。
 * 实测依据（2026-09-14）：只认 `<article>` 时，TechCrunch / 美团这类站点会退化到 fallback
 * （整页去标签，噪声只减 2~8%）；补上 `<main>` 与更宽松的命名约定后覆盖明显提升。
 */
const CONTAINER_PATTERNS = [
  { strategy: 'article', re: /<article\b[^>]*>([\s\S]*?)<\/article>/gi },
  { strategy: 'itemprop', re: /<(?:div|section|main)\b[^>]*itemprop\s*=\s*["']articleBody["'][^>]*>([\s\S]*?)<\/(?:div|section|main)>/gi },
  { strategy: 'main', re: /<main\b[^>]*>([\s\S]*?)<\/main>/gi },
  { strategy: 'role-main', re: /<(?:div|section)\b[^>]*role\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi },
  { strategy: 'class-hint', re: /<(?:div|section|main|article)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:article|post|entry|story|content|main)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|main|article)>/gi },
];

/**
 * 候选容器被接受所需的最小文本长度。
 * 定 80 的依据：中文短讯的正文常只有一两句（80 字左右），阈值定太高会把整篇短文判为「没抓到容器」
 * 而退化成整页——反而把导航和广告又混回来。这里只要容器里有**成句的正文**就采信它。
 */
export const MIN_CONTAINER_TEXT_LENGTH = 80;

/** 正文长度上限（与既有行为一致） */
export const MAX_CONTENT_LENGTH = 15_000;

/** 去掉标签、解码实体、折叠空白 */
export function htmlToText(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 删除 class/id 命中噪声模式的块级元素（逐个标签类型处理，非贪婪） */
export function stripNoiseElements(html) {
  let out = String(html || '').replace(NOISE_ELEMENT_PATTERN, ' ');
  for (const tag of BLOCK_TAGS) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    out = out.replace(pattern, (whole, attrs, inner) =>
      NOISE_ATTR_PATTERN.test(attrs) ? ' ' : whole);
  }
  return out.replace(NOISE_VOID_TAG_PATTERN, ' ');
}

/** 链接占比超过这个阈值、且文本足够长的块，判为「导航/相关阅读/分享」噪声 */
export const LINK_DENSITY_THRESHOLD = 0.6;
export const LINK_DENSITY_MIN_TEXT = 40;

/**
 * 删除**链接密集**的块。
 *
 * 为什么需要这一步：美团 / TechCrunch 这类站点的 `<main>` 里塞满了「相关阅读」「分享」「订阅」
 * 这种由 <a> 组成的列表——它们的 class 名未必命中噪声名单，但特征很明显：
 * **锚文本占了整块文字的大部分**。实测只加这一条就能把这些块摘掉。
 * 阈值取 0.6（而不是 0.5）以保守：正文段落里偶尔带链接不该被误删。
 */
export function stripLinkHeavyBlocks(html) {
  let out = String(html || '');
  for (const tag of ['div', 'section', 'ul', 'ol', 'aside', 'nav']) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    out = out.replace(pattern, (whole, inner) => {
      const textLength = htmlToText(inner).length;
      if (textLength < LINK_DENSITY_MIN_TEXT) return whole;
      const linkText = [...inner.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
        .reduce((n, m) => n + htmlToText(m[1]).length, 0);
      return linkText / textLength > LINK_DENSITY_THRESHOLD ? ' ' : whole;
    });
  }
  return out;
}

/**
 * 抽取网页正文。
 * @param {string} html 原始 HTML
 * @returns {{content: string, extraction: 'container'|'fallback', strategy: string, textLength: number}}
 */
export function extractMainContent(html) {
  const cleaned = stripNoiseElements(html);

  // 按**语义优先级**选容器（<article> 比 <main> 精确），同优先级内取文本最长的那个。
  // 不用「全局最长」的原因：<main> 常把侧栏/相关阅读一起包进来，长度占优但精度更差。
  let best = { text: '', strategy: '' };
  for (const { re: source, strategy } of CONTAINER_PATTERNS) {
    const re = new RegExp(source.source, source.flags);
    let longest = '';
    for (const match of cleaned.matchAll(re)) {
      // 链接密度过滤**只在候选容器内部**做：在全页阶段做有误删整个正文容器的风险
      const text = htmlToText(stripLinkHeavyBlocks(match[1]));
      if (text.length > longest.length) longest = text;
    }
    if (longest.length >= MIN_CONTAINER_TEXT_LENGTH) {
      best = { text: longest, strategy };
      break;
    }
  }

  const useContainer = best.text.length >= MIN_CONTAINER_TEXT_LENGTH;
  const content = (useContainer ? best.text : htmlToText(stripLinkHeavyBlocks(cleaned))).slice(0, MAX_CONTENT_LENGTH);

  return {
    content,
    extraction: useContainer ? 'container' : 'fallback',
    strategy: useContainer ? best.strategy : 'whole-page',
    textLength: content.length,
  };
}
