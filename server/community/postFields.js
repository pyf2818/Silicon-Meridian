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
export const COVER_KINDS = ['auto', 'url', 'extracted'];
export const COMMENT_KINDS = ['comment', 'praise', 'critique', 'question'];
export const DEFAULT_COMMENT_KIND = 'comment';

/** 帖子视图上的新增内容字段（与 POST_VIEW / postView 输出键一一对应） */
export const POST_CONTENT_FIELDS = ['channel', 'tags', 'cover', 'summary'];

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

/** 封面兜底：仅接受 https 外链；其余一律回落自动封面（零上传方案的最后一道闸） */
export function normalizeCover(value) {
  if (!value || typeof value !== 'object') return { kind: 'auto' };
  const kind = String(value.kind || 'auto');
  if ((kind === 'url' || kind === 'extracted') && /^https:\/\//i.test(String(value.url || '').trim())) {
    return { kind, url: String(value.url).trim() };
  }
  return { kind: 'auto' };
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
