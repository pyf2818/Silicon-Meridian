import { safeExternalFetch } from '../security/urlSafety.js';
import { routeError, sendJsonResponse } from './httpUtils.js';

/**
 * 从 Content-Type 和 HTML meta 标签检测字符编码
 * 支持 gbk/gb2312/gb18030/utf-8 等常见中文编码
 */
function detectCharset(contentType, buffer) {
  // 1. 从 Content-Type: text/html; charset=gbk 读取
  const ctMatch = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (ctMatch) return ctMatch[1].toLowerCase();
  // 2. 从 HTML meta 标签检测（前 4KB 内查找）
  const head = buffer.slice(0, 4096).toString('ascii');
  const metaMatch = /charset=["']?([\w-]+)/i.exec(head);
  if (metaMatch) return metaMatch[1].toLowerCase();
  // 3. 默认 utf-8
  return 'utf-8';
}

async function readLimitedText(response, maxBytes = 1_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw Object.assign(new Error('网页内容超过读取上限'), { code: 'PAGE_TOO_LARGE', status: 413 }); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  const contentType = String(response.headers.get('content-type') || '');
  const charset = detectCharset(contentType, buffer);
  try {
    const decoder = new TextDecoder(charset);
    return decoder.decode(buffer);
  } catch {
    // 不支持的编码，降级为 utf-8
    const fallback = new TextDecoder('utf-8');
    return fallback.decode(buffer);
  }
}

/**
 * 从 HTML 提取正文配图 URL：绝对化 + 过滤图标/头像/广告/二维码等噪声图。
 * 只在预览抽屉展示，最多返回 8 张；失败不阻断正文返回。
 */
const IMG_SRC_NOISE = /(logo|icon|sprite|avatar|emoji|favicon|spacer|\.svg)([?./]|$)/i;
// 二维码 / 推广关注 / 统计像素 / 分享按钮 / 广告横幅——影响观感的一律过滤
const IMG_SRC_ADS = /(qr[-_]?code|qrcode|[\b/.]qr[\b./_]|weixin|wechat|wxoffi|mp\.weixin|follow[-_]?us|subscribe|shangcheng|donate|reward|alipay|pay[-_]?code|advert|\/ads?\/|\/ads?[._-]|[._-]ads?[._-]|banner|sponsor|promo|promotion|coupon|tracking|pixel|beacon|analytics|share[-_]?icon|share[-_]?btn|gongzhonghao|公众号|二维码)/i;
const IMG_SRC_LAZY = /^(data-src|data-original|data-lazy-src|data-src2?|data-actualsrc)$/;

function extractImages(html, baseUrl) {
  const found = [];
  const seen = new Set();
  const tagRe = /<img\b[^>]*>/gi;
  const attrRe = /([a-zA-Z-]+)\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = tagRe.exec(html)) && found.length < 24) {
    const attrs = {};
    let attr;
    attrRe.lastIndex = 0;
    while ((attr = attrRe.exec(match[0]))) attrs[attr[1].toLowerCase()] = attr[2];
    const lazyKey = Object.keys(attrs).find(k => IMG_SRC_LAZY.test(k) && /^https?:\/\//.test(attrs[k]));
    const raw = attrs.src || lazyKey && attrs[lazyKey];
    if (!raw || /^data:/i.test(raw) || IMG_SRC_NOISE.test(raw) || IMG_SRC_ADS.test(raw)) continue;
    try {
      const abs = new URL(raw, baseUrl).href;
      if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
      seen.add(abs);
      // 明确声明为小尺寸（≤200px）的视为装饰图/图标跳过（二维码常为 150-260px，配合关键词双保险）
      const w = parseInt(attrs.width || '', 10);
      if (Number.isFinite(w) && w > 0 && w <= 200) continue;
      // class/alt 里的广告信号
      const cls = `${attrs.class || ''} ${attrs.alt || ''} ${attrs.id || ''}`;
      if (IMG_SRC_ADS.test(cls)) continue;
      found.push(abs);
    } catch { /* 非法 URL 跳过 */ }
  }
  return found.slice(0, 8);
}

export async function handleFetchPageRequest(req, res) {
  if (String(req.method).toUpperCase() !== 'GET') return sendJsonResponse(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
  let timeout;
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const target = requestUrl.searchParams.get('url');
    if (!target) throw Object.assign(new Error('url 不能为空'), { code: 'INVALID_URL', status: 400 });
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await safeExternalFetch(target, { headers: { 'User-Agent': 'SiliconMeridian/1.0' }, signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`网页服务返回 ${response.status}`), { code: 'UPSTREAM_PAGE_ERROR', status: 502 });
    const contentType = String(response.headers.get('content-type') || '');
    if (!/(text|html|xml|json)/i.test(contentType)) throw Object.assign(new Error('目标不是可读取的文本页面'), { code: 'UNSUPPORTED_PAGE_TYPE', status: 415 });
    const html = await readLimitedText(response);
    const content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15_000);
    const images = extractImages(html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''), target);
    return sendJsonResponse(res, 200, { ok: true, content, images });
  } catch (error) {
    if (error?.name === 'AbortError') return routeError(res, Object.assign(new Error('网页读取超时'), { code: 'UPSTREAM_TIMEOUT', status: 504 }));
    return routeError(res, error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
