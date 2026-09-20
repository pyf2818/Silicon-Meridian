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
import { stripBoilerplate } from '../news/utils/boilerplate.js';

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

/** 去掉标签、解码实体、折叠空白（单行文本——摘要用） */
export function htmlToText(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 块级感知版：把 </p>/</div>/<br>/</h1-6> 等块边界转成 \n\n **保留段落结构**。
 *
 * 为什么需要：旧实现把所有空白折叠成单空格，段落边界全部丢失 →
 * 前端 toParagraphs 只能按句号启发式瞎切，排版效果差。
 * 现在服务端把真实段落用 \n\n 送下来，前端按段渲染（段距/标题层级/图文对齐都有了）。
 */
export function htmlToBlocks(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|pre|blockquote|figure|figcaption|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 逐段做模板语/推广语剔除，再拼回段落文本（stripBoilerplate 是单段语义） */
export function cleanBlocks(text) {
  return String(text || '')
    .split('\n\n')
    .map(paragraph => stripBoilerplate(paragraph))
    .filter(Boolean)
    .join('\n\n');
}

/** 删除 class/id 命中噪声模式的块级元素（逐个标签类型处理，非贪婪） */
export function stripNoiseElements(html, { keepImages = false } = {}) {
  let out = String(html || '').replace(NOISE_ELEMENT_PATTERN, ' ');
  for (const tag of BLOCK_TAGS) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    out = out.replace(pattern, (whole, attrs, inner) =>
      NOISE_ATTR_PATTERN.test(attrs) ? ' ' : whole);
  }
  // v32：keepImages 时保留 <img>（结构化正文与配图抽取需要）；
  // 默认路径照旧剥掉（纯文本输出不受影响——img 本身无文本内容）
  const voidPattern = keepImages
    ? /<(script|style|iframe|svg|input|button|link|meta)\b[^>]*>/gi
    : NOISE_VOID_TAG_PATTERN;
  return out.replace(voidPattern, ' ');
}

/** 链接占比超过这个阈值、且文本足够长的块，判为「导航/相关阅读/分享」噪声 */
export const LINK_DENSITY_THRESHOLD = 0.6;
export const LINK_DENSITY_MIN_TEXT = 40;

/* ===== v32：结构化正文 HTML（保留标题/段落/列表/代码块/表格结构，供预览面板渲染） ===== */

/** 结构化输出允许保留的标签——白名单外的一律剥标签留内容 */
const ALLOWED_HTML_TAGS = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'pre', 'code', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's',
  'a', 'img', 'figure', 'figcaption', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'span', 'div', 'article', 'section', 'main',
]);

/** 允许保留的属性（on 事件、style、class、id、data 属性一律删除——预览渲染安全边界） */
const SAFE_ATTR_RE = /(href|src|alt|title|colspan|rowspan|loading)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function cleanSafeAttrs(tagName, attrs) {
  let out = '';
  let m;
  SAFE_ATTR_RE.lastIndex = 0;
  while ((m = SAFE_ATTR_RE.exec(attrs || ''))) {
    const name = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if ((name === 'href' || name === 'src') && /^\s*(javascript:|vbscript:|data:text)/i.test(value)) continue;
    if (name === 'href' && tagName === 'a') { out += ` href="${value.replace(/"/g, '&quot;')}"`; continue; }
    if (name === 'src' && tagName === 'img') { out += ` src="${value.replace(/"/g, '&quot;')}"`; continue; }
    if ((name === 'alt' || name === 'title') && value) { out += ` ${name}="${value.replace(/"/g, '&quot;')}"`; continue; }
    if (name === 'loading' && tagName === 'img') { out += ' loading="lazy"'; continue; }
    if ((name === 'colspan' || name === 'rowspan') && tagName !== 'img') { out += ` ${name}="${value}"`; continue; }
  }
  return out;
}

/**
 * 把容器 HTML 清洗为「排版安全」的文章 HTML：
 *  - 白名单外的标签剥掉（保留内部内容，如 font/div 包裹的段落文字）
 *  - 保留标题/段落/列表/表格/代码块/引用/图片的结构与层级
 *  - 只留安全属性（href、src、alt、title、colspan、rowspan），on 事件属性与 style 全删
 *  - 相对 URL 借助 baseUrl 绝对化（否则预览里图片/链接全是断的）
 *  - 不做任何空白折叠：<pre><code> 的缩进与换行原样保留
 */
export function sanitizeArticleHtml(html, baseUrl = '') {
  let out = String(html || '')
    .replace(NOISE_ELEMENT_PATTERN, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (whole, slash, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) return ' ';
    if (slash) return `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    if (tag === 'img') return `<img${cleanSafeAttrs('img', attrs)} loading="lazy">`;
    return `<${tag}${cleanSafeAttrs(tag, attrs)}>`;
  });
  // 空段落收敛（不动 pre 内部：这里只匹配标签结构）
  out = out.replace(/(?:\s*<(?:p|div|span)>\s*<\/(?:p|div|span)>\s*)+/gi, ' ');
  // 相对 URL 绝对化（图片断了最影响观感）
  const base = String(baseUrl || '');
  if (base) {
    out = out.replace(/(href|src)="([^"]+)"/g, (whole, attr, value) => {
      if (/^(https?:|mailto:|#)/i.test(value)) return whole;
      try { return `${attr}="${new URL(value, base).href}"`; } catch { return whole; }
    });
  }
  return out.trim();
}

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
 * @param {{baseUrl?: string}} [opts] baseUrl 用于结构化 HTML 的相对 URL 绝对化
 * @returns {{content: string, html: string, extraction: 'container'|'fallback', strategy: string, textLength: number}}
 *   content  = 纯文本（AI 分析用，结构丢失）
 *   html     = 结构化正文（v32：预览面板渲染用，保留标题/段落/列表/代码块/表格；已白名单消毒）
 */
export function extractMainContent(html, { baseUrl = '' } = {}) {
  // v32：keepImages——容器 HTML 里保留 <img>，供结构化正文与配图抽取；
  // img 无文本内容，纯文本 content 不受影响
  const cleaned = stripNoiseElements(html, { keepImages: true });

  // 按**语义优先级**选容器（<article> 比 <main> 精确），同优先级内取文本最长的那个。
  // 不用「全局最长」的原因：<main> 常把侧栏/相关阅读一起包进来，长度占优但精度更差。
  let best = { text: '', html: '', strategy: '' };
  for (const { re: source, strategy } of CONTAINER_PATTERNS) {
    const re = new RegExp(source.source, source.flags);
    let longest = '';
    let longestHtml = '';
    for (const match of cleaned.matchAll(re)) {
      // 链接密度过滤**只在候选容器内部**做：在全页阶段做有误删整个正文容器的风险
      const inner = stripLinkHeavyBlocks(match[1]);
      const text = htmlToBlocks(inner);
      if (text.length > longest.length) {
        longest = text;
        longestHtml = inner;
      }
    }
    if (longest.length >= MIN_CONTAINER_TEXT_LENGTH) {
      best = { text: longest, html: longestHtml, strategy };
      break;
    }
  }

  const useContainer = best.text.length >= MIN_CONTAINER_TEXT_LENGTH;
  const containerHtml = useContainer ? best.html : stripLinkHeavyBlocks(cleaned);
  const content = cleanBlocks((useContainer ? best.text : htmlToBlocks(stripLinkHeavyBlocks(cleaned))).slice(0, MAX_CONTENT_LENGTH * 2)).slice(0, MAX_CONTENT_LENGTH);

  return {
    content,
    // v32：结构化正文——容器选中时给容器 HTML；fallback 给全页清洗版（此时噪声难免，但结构至少保留）
    html: sanitizeArticleHtml(containerHtml, baseUrl),
    extraction: useContainer ? 'container' : 'fallback',
    strategy: useContainer ? best.strategy : 'whole-page',
    textLength: content.length,
  };
}
