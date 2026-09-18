/**
 * B2 社区视觉身份纯逻辑（无 React、无 HTTP）：
 * - 封面零上传方案：按帖子 id 哈希从 5 组品牌渐变里取色（同帖恒定、跨帖分散）
 * - 头像体系：昵称哈希 → 8 色盘（有 avatar_url 时组件直接用图）
 * 语义/图表色规范：这里的中饱和色值仅用于封面装饰与头像底色，状态语义一律走 --status-*。
 */

const COVER_PALETTES = [
  { from: '#22d3ee', to: '#3b82f6' }, // 青→蓝（品牌主轴）
  { from: '#a78bfa', to: '#f472b6' }, // 紫→粉
  { from: '#fbbf24', to: '#fb923c' }, // 琥珀→橙
  { from: '#2dd4bf', to: '#34d399' }, // 青→翠
  { from: '#38bdf8', to: '#818cf8' }, // 天→靛
];

export const AVATAR_COLORS = [
  '#0891b2', '#6d5ae6', '#ec4899', '#d97706', '#0d9488', '#4f46e5', '#dc2626', '#059669',
];

/** 频道中文名（存储值为纯文本枚举，与 server/community/postFields.js CHANNELS 对齐） */
export const CHANNEL_LABELS = { discussion: '讨论', review: '测评', share: '分享', qa: '问答' };

function stableHash(text) {
  const value = String(text || '');
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 1000003;
  }
  return hash;
}

export function pickCoverPalette(id) {
  return COVER_PALETTES[stableHash(id) % COVER_PALETTES.length];
}

export function coverBackground(id) {
  const { from, to } = pickCoverPalette(id);
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

/** 自动封面大字：取标题前 4 个字符；空标题回落品牌字「川」 */
export function coverWord(title) {
  const text = String(title || '').trim();
  return text ? text.slice(0, 4) : '川';
}

export function avatarColor(name) {
  return AVATAR_COLORS[stableHash(String(name || '').trim() || '川') % AVATAR_COLORS.length];
}

/** 剥 Markdown 取纯文本（与 server/community/postFields.js extractSummary 规则一致；服务端 summary 已入库，这里仅兜底旧数据） */
export function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '［代码］')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|-]{1,3}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
