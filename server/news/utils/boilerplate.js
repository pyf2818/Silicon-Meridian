/**
 * 摘要/正文里的模板语与推广语剔除（**单一实现**，dev 端与 serverless 端共用）。
 *
 * 背景：RSS 的 description / content:encoded 里普遍夹带站点模板与推广尾巴，
 * 比如「……正文…… 点击阅读原文」「关注公众号 xxx」「The post … appeared first on …」。
 * 这些内容会原样进入资讯卡片预览，把真正有价值的那句话挤出去（摘要还只截 160 字）。
 * 此前全项目**没有任何文本层剔除逻辑**（广告过滤只存在于图片链路）。
 *
 * 设计原则：**宁可漏删，不可误伤**。
 * 这类规则最容易犯的错是把正文里的词当模板删掉（例如标题里就带「点击」），
 * 所以这里只做两件保守的事：
 *   ① **尾部推广块整段切掉** —— 只有标记出现在文本后半段（>50%）时才动手；
 *   ② **去掉孤立的广告标注记号**（【广告】/【推广】/Sponsored: 等）。
 * 绝不做「全文出现某词就删该词」这种激进替换。
 *
 * 清洗后长度不足 `MIN_USABLE_LENGTH` 的，视为「没有可用摘要」，由调用方回落到占位文案——
 * 这比把一条广告当摘要展示给用户要诚实得多。
 */

/** 清洗后短于这个长度就认为没有可用摘要（中文字符信息密度高，30 字以下基本是模板） */
export const MIN_USABLE_LENGTH = 30;

/**
 * **强指纹**模板语：无歧义（WordPress/Medium 等站点机器生成的固定句式），命中即从该处切到结尾，
 * 不受位置限制。与下面「弱信号」的区别：这类句式出现在正文里的概率极低。
 */
export const STRONG_BOILERPLATE_PATTERNS = [
  /The post .{0,120}? appeared first on .{0,80}/i,
  /Originally published at .{0,80}/i,
  /This (article|story) (was )?originally (published|appeared) (on|at) .{0,80}/i,
  /(版权声明|免责声明)\s*[:：]/,
  /(转载请注明|未经授权[^。！？]{0,6}转载)/,
];

/** 弱信号推广语。命中位置必须在文本后半段（>50%）才切——这些词正文里也可能出现。 */
export const TAIL_BOILERPLATE_PATTERNS = [
  // —— 中文站点最常见的 CTA / 版权尾巴 ——
  /点击[^。！？|]{0,6}(阅读原文|查看全文|阅读全文|查看原文)/,
  /(阅读原文|查看全文|阅读全文|继续阅读)\s*[。！？|]?$/m,
  /(关注|订阅)(我们|公众号|公号|官方账号)/,
  /(扫码|长按识别|长按二维码|扫描二维码)/,
  /(更多精彩|更多内容|更多资讯)[^。！？]{0,8}(关注|查看|扫码)?/,
  /(本文(为|系)[^。！？]{0,10}(原创|授权))/,
  /(商务合作|投稿|广告合作|加入我们)/,
  /(原文链接|原文地址)[:：]/,
  // —— 英文站点模板 ——
  /(Read more|Continue reading|Read the full (story|article))/i,
  /(Subscribe|Sign up) (to|for) [^.]{0,40}/i,
];

/** 孤立广告记号：只删记号本身，不动周围文字 */
export const AD_MARKER_PATTERN = /(【\s*(广告|推广|赞助|AD)\s*】|\[\s*(广告|推广|赞助|AD)\s*\]|Sponsored content|Advertisement\s*[:：]?|Sponsored\s*[:：])/gi;

/**
 * 「整段就是一句推广语」——必须单独处理：
 * 这类文本本身很短（< 50% 阈值算不出来），只会被尾部规则漏掉。
 */
export const FULL_BOILERPLATE_PATTERN = /^(点击|请|欢迎)?\s*(阅读原文|查看全文|阅读全文|查看原文|继续阅读|关注我们|关注公众号|扫码关注|更多精彩内容|Read more|Continue reading|Read the full (story|article))[。！？.!·|]*$/i;

/**
 * 尾部切除后可能留下的**分隔符**垃圾。
 * 注意：绝不含「。！？，,.;:」这类句读——正文的句号是合法内容，
 * 第一版把它一起剥掉，导致「未命中规则的文本」也被改动（测试立刻抓到）。
 */
const TRAILING_JUNK = /[\s|·\-—–>»…⋯]+$/;

/** 连续重复的分隔符（切除后常见） */
const REPEATED_SEPARATORS = /([|·\-—–])\s*\1+/g;

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * 剔除模板语 / 推广语。
 * @param {string} input 已经过去标签的纯文本
 * @returns {string} 清洗后的文本；
 *   只有在**确实切掉了东西**且剩余不足 MIN_USABLE_LENGTH 时才返回 ''（视为无可用摘要）。
 *   什么都没命中时原样返回——包括「OpenAI 发布 GPT-5」这种合法短摘要，绝不因为短就丢弃。
 */
export function stripBoilerplate(input) {
  const raw = normalizeWhitespace(input ?? '');
  if (!raw) return '';

  let text = raw;
  let removed = false;

  // ⓪ 整段就是一句推广语 → 直接判为无可用摘要
  if (FULL_BOILERPLATE_PATTERN.test(text)) return '';

  // ① 尾部推广块
  //   强指纹：无歧义，命中即切（不受位置限制）
  //   弱信号：只在标记落在后半段时切（避免把开头就带这些词的正文整段砍掉）
  let cutAt = -1;
  const considerCut = (match, index, allowAnywhere) => {
    if (index < 0) return;
    if (!allowAnywhere && index <= text.length * 0.5) return;
    if (cutAt === -1 || index < cutAt) cutAt = index;
  };

  for (const pattern of [...STRONG_BOILERPLATE_PATTERNS, ...TAIL_BOILERPLATE_PATTERNS]) {
    const allowAnywhere = STRONG_BOILERPLATE_PATTERNS.includes(pattern);
    const re = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of text.matchAll(re)) considerCut(match, match.index ?? -1, allowAnywhere);
  }

  if (cutAt > 0) {
    text = text.slice(0, cutAt);
    removed = true;
  } else if (cutAt === 0) {
    return '';   // 整段就是模板语
  }

  // ② 孤立广告记号
  if (AD_MARKER_PATTERN.test(text)) {
    AD_MARKER_PATTERN.lastIndex = 0;   // test() 是带 /g 的有状态正则，必须复位
    text = text.replace(AD_MARKER_PATTERN, ' ');
    removed = true;
  }
  AD_MARKER_PATTERN.lastIndex = 0;

  // ③ 残留整理：重复分隔符、尾部垃圾、空白
  text = text.replace(REPEATED_SEPARATORS, '$1');
  text = normalizeWhitespace(text);
  text = text.replace(TRAILING_JUNK, '').trim();

  if (removed && text.length < MIN_USABLE_LENGTH) return '';
  return text;
}
