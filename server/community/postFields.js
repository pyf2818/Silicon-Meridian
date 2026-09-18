/**
 * 社区帖子字段唯一事实源（B1 社区改版）。
 *
 * PG（communityRepository.js）与内存（memoryCommunityRepository.js）双仓储共用：
 * - 频道/评论类型枚举与默认值
 * - 入库兜底 normalize（service 层负责校验报错，这里是最后一道防线）
 * - POST_CONTENT_FIELDS 供测试做「双仓储字段对齐」断言（防 algorithmVersion 式漂移前科）。
 */

export const CHANNELS = ['discussion', 'review', 'share', 'qa'];
export const DEFAULT_CHANNEL = 'discussion';
export const COVER_KINDS = ['auto', 'url', 'extracted', 'uploaded'];
export const COMMENT_KINDS = ['comment', 'praise', 'critique', 'question'];
export const DEFAULT_COMMENT_KIND = 'comment';

/** 帖子视图上的新增内容字段（与 POST_VIEW / postView 输出键一一对应） */
export const POST_CONTENT_FIELDS = ['channel', 'tags', 'cover', 'summary', 'media', 'attachments'];

/** C3 任务 3：本站上传物 URL 唯一合法形态（media/attachments/封面 uploaded 档只认这个前缀，阻断外链与注入） */
export const UPLOAD_URL_PATTERN = /^\/api\/community\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MEDIA_KINDS = ['image', 'video'];
export const MAX_MEDIA_ITEMS = 9;
export const MAX_ATTACHMENT_ITEMS = 10;

export function normalizeChannel(value) {
  const text = String(value ?? '').trim();
  return CHANNELS.includes(text) ? text : DEFAULT_CHANNEL;
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(tag => String(tag ?? '').trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 5);
}

/** 封面兜底：https 外链（url/extracted 档）或本站上传物（uploaded 档）；其余一律回落自动封面 */
export function normalizeCover(value) {
  if (!value || typeof value !== 'object') return { kind: 'auto' };
  const kind = String(value.kind || 'auto');
  const url = String(value.url || '').trim();
  if ((kind === 'url' || kind === 'extracted') && /^https:\/\//i.test(url)) {
    return { kind, url };
  }
  if (kind === 'uploaded' && UPLOAD_URL_PATTERN.test(url)) {
    return { kind: 'uploaded', url };
  }
  return { kind: 'auto' };
}

function safeUploadItem(value, { kinds, maxName = 120 } = {}) {
  if (!value || typeof value !== 'object') return null;
  const kind = String(value.kind || '');
  const url = String(value.url || '').trim();
  if (!kinds.includes(kind) || !UPLOAD_URL_PATTERN.test(url)) return null;
  return {
    kind,
    url,
    name: String(value.name || '').slice(0, maxName),
    mime: String(value.mime || '').slice(0, 80),
    size: Number.isFinite(value.size) && value.size >= 0 ? Math.round(value.size) : 0,
  };
}

/** 效果图/效果视频：只认本站上传 URL 的 image/video 项（最多 9） */
export function normalizeMedia(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => safeUploadItem(item, { kinds: MEDIA_KINDS }))
    .filter(Boolean)
    .slice(0, MAX_MEDIA_ITEMS);
}

/** 附件资料：只认本站上传 URL 的 file 项（最多 10，文件名可保留原文） */
export function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => safeUploadItem(item, { kinds: ['file'], maxName: 180 }))
    .filter(Boolean)
    .slice(0, MAX_ATTACHMENT_ITEMS);
}

export function normalizeSummary(value) {
  return String(value ?? '').slice(0, 120);
}

export function normalizeCommentKind(value) {
  const text = String(value ?? '').trim();
  return COMMENT_KINDS.includes(text) ? text : DEFAULT_COMMENT_KIND;
}

/** 剥 Markdown 取纯文本摘要（规则与前端 CommunityPage.stripMarkdown 保持一致，服务端为准入库） */
export function extractSummary(body, maxLength = 120) {
  const text = String(body || '')
    .replace(/```[\s\S]*?```/g, '［代码］')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|-]{1,3}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}
