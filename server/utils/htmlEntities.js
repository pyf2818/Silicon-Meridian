// HTML 实体解码 —— 服务端共享工具（零依赖，可被 news / http handlers 安全复用）
//
// 为什么单独一个文件：`server/news/utils/textProcessing.js` 顶部 import 了
// `config/constants.js`（271 个信息源的重量级配置）。`server/http/fetchPageHandler.js`
// 这类 serverless 入口只需要实体解码，不应为此拖入整份信息源配置。
//
// 踩坑记录（v26.9e）：旧实现只处理 amp/lt/gt/quot/#39 + 数字实体，
// 于是 &nbsp; &mdash; &hellip; &ldquo; &rsquo; 等**原样透传**，
// 最终在资讯卡片与全文预览里被用户直接看到。
// 注意 &nbsp; 映射为普通空格而非 \u00A0：便于后续 \s+ 折叠收敛多余空白。

const NAMED_ENTITIES = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '—', ndash: '–', minus: '−', horbar: '―',
  hellip: '…', mldr: '…', middot: '·', bull: '•', sdot: '⋅', permil: '‰', prime: '′', Prime: '″',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  sbquo: '\u201A', bdquo: '\u201E', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  times: '×', divide: '÷', plusmn: '±', deg: '°', micro: 'µ', para: '¶', sect: '§',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵',
  lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔',
  frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', infin: '∞', ne: '≠', le: '≤', ge: '≥',
  asymp: '≈', equiv: '≡', radic: '√', sum: '∑', prod: '∏', int: '∫', part: '∂',
  nabla: '∇', isin: '∈', notin: '∉', cap: '∩', cup: '∪', sub: '⊂', sup: '⊃',
  check: '✓', cross: '✗', star: '☆', starf: '★',
  dagger: '†', Dagger: '‡', oline: '‾', lowast: '∗',
  zwnj: '\u200C', zwj: '\u200D', lrm: '\u200E', rlm: '\u200F',
};

const ENTITY_RE = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]{1,31}));/gi;

// fromCodePoint 对越界码点会抛 RangeError —— 脏页面里出现 &#99999999; 不能把整条解析打断
function safeFromCodePoint(code) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  try { return String.fromCodePoint(code); } catch { return null; }
}

/**
 * 解码字符串中的 HTML 实体（具名 + 十进制 + 十六进制）。
 * 未知实体原样保留，避免误伤代码片段。
 * @param {*} value
 * @returns {string}
 */
export function decodeEntities(value) {
  const str = String(value);
  if (!str.includes('&')) return str; // 快路径：无实体时零成本
  return str
    .replace(/&amp;/g, '&') // 先解 &amp; 让 &amp;nbsp; 这类双重转义能被下一步继续解开
    .replace(ENTITY_RE, (match, hex, dec, name) => {
      if (hex !== undefined) return safeFromCodePoint(parseInt(hex, 16)) ?? match;
      if (dec !== undefined) return safeFromCodePoint(parseInt(dec, 10)) ?? match;
      // 具名实体：大小写敏感优先，再回退到全小写（&NBSP; 这类脏数据）
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
      const lower = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower)) return NAMED_ENTITIES[lower];
      return match;
    });
}

export { NAMED_ENTITIES };
