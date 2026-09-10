// Formatting utilities extracted from App.jsx

export function formatTime(v) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}

export function formatRelative(v) {
  const diff = Date.now() - new Date(v).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return '刚刚';        // 新增"刚刚"档：5分钟内的资讯感知更强
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return formatTime(v);
}

// 是否为"刚到"的资讯（用于 NewsItem NEW 角标）
// 5 分钟内的资讯显示 NEW 标识，强化时效感知
export function isFreshNews(publishedAt, thresholdMs = 5 * 60 * 1000) {
  if (!publishedAt) return false;
  return (Date.now() - new Date(publishedAt).getTime()) < thresholdMs;
}

export function formatStars(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// 将 #rrggbb 转为 rgba(r,g,b,a)
export function hexToRgba(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(100, 116, 139, ${alpha})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 从源等级 color 派生 {primary, glow}，统一徽章配色（单一来源：服务端 SOURCE_GRADES）
export function getGradeColors(color) {
  return { primary: color || '#64748b', glow: hexToRgba(color || '#64748b', 0.28) };
}

// 判断文本是否为英文（纯 ASCII 字符，且不含中文）
// 统一 NewsItem / GithubRepoCard / requestTranslation 的语言检测
const ENGLISH_TEXT_RE = /^[a-zA-Z0-9\s\-.,!?"'():;&%$#@*+\[\]{}|\\\/<>`~+=]+$/;
const CHINESE_CHAR_RE = /[一-鿿]/;

export function isEnglishText(text = '') {
  return ENGLISH_TEXT_RE.test(text) && !CHINESE_CHAR_RE.test(text);
}

export function isChineseText(text = '') {
  return CHINESE_CHAR_RE.test(text);
}

// ===== HTML 实体解码（展示层兜底，v26.9e）=====
//
// 为什么前端也要有一份：服务端 `server/news/utils/textProcessing.js` 的 decodeEntities
// 已补全具名实体，但**修复只对之后新抓取的条目生效**——持久池里 7 天内的旧数据、
// 以及第三方（Jina 抓取 / AI 增强）路径都可能残留 `&nbsp;`。在渲染层兜底可立刻修复存量。
//
// 说明：这里刻意与服务端各持一份表，不复用——服务端那个文件顶部 import 了 271 个信息源的
// config/constants.js，前端 import 会把整包打进浏览器 bundle。表稳定、体量小，重复可接受。
// 仅在**纯文本字段**上使用（title/summary/insight…），React 渲染时会自动转义，不存在注入面；
// 不要用于已交给 dangerouslySetInnerHTML 的 HTML 串。
const HTML_ENTITIES = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '—', ndash: '–', minus: '−', horbar: '―',
  hellip: '…', mldr: '…', middot: '·', bull: '•', sdot: '⋅', permil: '‰', prime: '′', Prime: '″',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  sbquo: '\u201A', bdquo: '\u201E', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  times: '×', divide: '÷', plusmn: '±', deg: '°', micro: 'µ', para: '¶', sect: '§',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵',
  frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Omega: 'Ω',
  infin: '∞', ne: '≠', le: '≤', ge: '≥', asymp: '≈', equiv: '≡', radic: '√',
  sum: '∑', prod: '∏', int: '∫', part: '∂', nabla: '∇', isin: '∈', notin: '∉',
  check: '✓', cross: '✗', star: '☆', starf: '★',
  dagger: '†', Dagger: '‡', lowast: '∗', zwnj: '\u200C', zwj: '\u200D',
};

const HTML_ENTITY_RE = /&(?:#x([0-9a-f]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

function safeFromCodePoint(code) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  try { return String.fromCodePoint(code); } catch { return null; }
}

/**
 * 解码 HTML 实体（纯文本展示用）。不含实体时原样返回，零成本无副作用。
 * @param {*} value
 * @returns {string}
 */
export function decodeHtmlEntities(value) {
  if (value == null) return '';
  const str = String(value);
  if (!str.includes('&')) return str; // 快路径：绝大多数条目没有实体
  return str
    .replace(/&amp;/g, '&')
    .replace(HTML_ENTITY_RE, (match, hex, dec, name) => {
      if (hex !== undefined) return safeFromCodePoint(parseInt(hex, 16)) ?? match;
      if (dec !== undefined) return safeFromCodePoint(parseInt(dec, 10)) ?? match;
      if (Object.prototype.hasOwnProperty.call(HTML_ENTITIES, name)) return HTML_ENTITIES[name];
      const lower = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(HTML_ENTITIES, lower)) return HTML_ENTITIES[lower];
      return match;
    });
}
