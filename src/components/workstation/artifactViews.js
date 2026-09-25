/**
 * artifactViews.js - 结果区纯视图逻辑（无 React / 无 HTTP，单测覆盖）
 *
 * 对齐 WorkBuddy 结果区的三个视图语义：产物列表按类型过滤、按日期分组、尺寸可读化。
 */

import { ARTIFACT_KIND_META } from '../../session/artifactRegistry.js';

/** 结果区类型过滤 pills（全部 + 六类） */
export const ARTIFACT_FILTERS = [
  { id: 'all', label: '全部' },
  ...Object.entries(ARTIFACT_KIND_META).map(([id, meta]) => ({ id, label: meta.label, icon: meta.icon })),
];

/** 字节数 → 可读尺寸 */
export function formatArtifactSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** ISO 时间 → 相对文案（分钟/小时/天），今日内显示时刻 */
export function formatArtifactTime(iso, now = new Date()) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const diffMs = now.getTime() - t.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24 && t.getDate() === now.getDate()) {
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 类型 + 关键词过滤（title 匹配，大小写不敏感） */
export function filterArtifacts(artifacts, { kind = 'all', search = '' } = {}) {
  const keyword = String(search || '').trim().toLowerCase();
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter(a => (kind === 'all' ? true : a.kind === kind))
    .filter(a => (keyword ? String(a.title || '').toLowerCase().includes(keyword) : true));
}

/**
 * 按日期分组（今天/昨天/YYYY-MM-DD），组内保持传入顺序（服务端已按时间倒序）。
 * 返回 [{ key, label, items }]，空产物返回 []。
 */
export function groupArtifactsByDate(artifacts, now = new Date()) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const groups = [];
  const index = new Map();
  for (const a of list) {
    const t = new Date(a.createdAt).getTime();
    let key;
    let label;
    if (Number.isNaN(t)) { key = 'unknown'; label = '未知时间'; }
    else if (t >= startOfToday) { key = 'today'; label = '今天'; }
    else if (t >= startOfYesterday) { key = 'yesterday'; label = '昨天'; }
    else {
      key = String(a.createdAt).slice(0, 10);
      label = key;
    }
    if (!index.has(key)) {
      const group = { key, label, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).items.push(a);
  }
  return groups;
}

/** kind 的展示 meta 兜底（未知类型按文件处理） */
export function artifactKindMeta(kind) {
  return ARTIFACT_KIND_META[kind] || { label: '文件', icon: '📎' };
}
