/**
 * B3 发布器草稿暂存（localStorage 纯逻辑，无副作用可单测）。
 *
 * 前科防御（persist 复活坑）：读取一律 normalize——类型不对的字段整段丢弃，
 * 只认得的白名单字段按类型收编，其余清空；写入前同样过一遍。
 */

export const COMPOSER_DRAFT_KEY = 'meridian.community.composerDraft.v1';

export const COMPOSER_TYPES = ['article', 'briefing', 'work', 'workflow'];
export const COMPOSER_CHANNELS = ['discussion', 'review', 'share', 'qa'];
export const COMPOSER_VISIBILITIES = ['public', 'followers', 'private'];
export const COMPOSER_COVER_KINDS = ['auto', 'url', 'extracted', 'uploaded'];

/** C3 任务 3：本站上传 URL 唯一合法形态（与服务端 UPLOAD_URL_PATTERN 同口径，前端先拦一道） */
export const UPLOAD_URL_PATTERN = /^\/api\/community\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MEDIA = 9;
const MAX_ATTACHMENTS = 10;
const MAX_BODY = 100000;
const MAX_SUMMARY = 120;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 24;
const MAX_TITLE = 180;

export function emptyDraft() {
  return {
    type: 'article',
    channel: 'discussion',
    title: '',
    summary: '',
    body: '',
    tags: [],
    cover: { kind: 'auto', url: '' },
    visibility: 'public',
    media: [],
    attachments: [],
    savedAt: 0,
  };
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(tag => (typeof tag === 'string' ? tag.trim().slice(0, MAX_TAG_LENGTH) : ''))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function safeCover(value) {
  if (!value || typeof value !== 'object') return { kind: 'auto', url: '' };
  const kind = COMPOSER_COVER_KINDS.includes(value.kind) ? value.kind : 'auto';
  return { kind, url: kind === 'auto' ? '' : safeText(value.url, 2048) };
}

/** 上传物记录清洗：只认本站上传 URL；media=image/video（≤9），attachments=file（≤10） */
function safeUploadItems(value, kinds, max) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const url = safeText(item.url, 200);
      if (!kinds.includes(item.kind) || !UPLOAD_URL_PATTERN.test(url)) return null;
      return {
        kind: item.kind,
        url,
        name: safeText(item.name, 180),
        mime: safeText(item.mime, 80),
        size: Number.isFinite(item.size) && item.size >= 0 ? Math.round(item.size) : 0,
      };
    })
    .filter(Boolean)
    .slice(0, max);
}

/** 任意来路（localStorage/AI/手滑）的数据 → 合法草稿；完全不是对象时回落空草稿 */
export function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return emptyDraft();
  return {
    type: COMPOSER_TYPES.includes(raw.type) ? raw.type : 'article',
    channel: COMPOSER_CHANNELS.includes(raw.channel) ? raw.channel : 'discussion',
    title: safeText(raw.title, MAX_TITLE),
    summary: safeText(raw.summary, MAX_SUMMARY),
    body: safeText(raw.body, MAX_BODY),
    tags: safeTags(raw.tags),
    cover: safeCover(raw.cover),
    visibility: COMPOSER_VISIBILITIES.includes(raw.visibility) ? raw.visibility : 'public',
    media: safeUploadItems(raw.media, ['image', 'video'], MAX_MEDIA),
    attachments: safeUploadItems(raw.attachments, ['file'], MAX_ATTACHMENTS),
    savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
  };
}

/** 草稿是否有值得保存的内容（空表单不写 localStorage、不挂 beforeunload） */
export function isDraftMeaningful(draft) {
  if (!draft) return false;
  return Boolean(
    String(draft.title || '').trim()
    || String(draft.body || '').trim()
    || (Array.isArray(draft.tags) && draft.tags.length)
    || (Array.isArray(draft.media) && draft.media.length)
    || (Array.isArray(draft.attachments) && draft.attachments.length),
  );
}

export function loadComposerDraft(storage = window.localStorage) {
  try {
    const rawText = storage.getItem(COMPOSER_DRAFT_KEY);
    if (!rawText) return null;
    return normalizeDraft(JSON.parse(rawText));
  } catch {
    return null;
  }
}

export function saveComposerDraft(draft, storage = window.localStorage) {
  try {
    if (!isDraftMeaningful(draft)) {
      storage.removeItem(COMPOSER_DRAFT_KEY);
      return false;
    }
    storage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify({ ...normalizeDraft(draft), savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearComposerDraft(storage = window.localStorage) {
  try { storage.removeItem(COMPOSER_DRAFT_KEY); } catch { /* 忽略 */ }
}
