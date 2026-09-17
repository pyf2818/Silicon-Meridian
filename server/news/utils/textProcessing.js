import { CATEGORY_RULES, TAG_RULES, CATEGORIES } from '../config/constants.js';
import { decodeEntities } from '../../utils/htmlEntities.js';
import { normalizeDate as normalizeDateImpl } from './dateUtils.js';
import { stripBoilerplate } from './boilerplate.js';

// 实体解码实现已抽到 server/utils/htmlEntities.js（零依赖），
// 供 fetchPageHandler 等 serverless 入口复用而不必拖入 271 个源配置。
// 这里原样转出，保持既有调用方（feedParser / sourceDiscovery）不变。
export { decodeEntities };

export function cleanText(value) {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function trimSummary(value) {
  // 先去站点模板/推广尾巴，再截断：否则 160 字会被「点击阅读原文」这类话术白占
  const cleaned = stripBoilerplate(value);
  if (!cleaned) return '暂无摘要，请前往原文查看完整内容。';
  return cleaned.length > 160 ? `${cleaned.slice(0, 160).trim()}...` : cleaned;
}

export function trimIntro(value) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 220 ? `${compact.slice(0, 220).trim()}...` : compact;
}

export function normalizeDate(value) {
  // 唯一实现在 dateUtils.js（dev 端与 serverless 端共用；此处转出保持既有调用方不变）
  return normalizeDateImpl(value);
}

export function detectCategory(text, fallback) {
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? fallback;
}

export function detectTags(text, category) {
  const tags = TAG_RULES.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  const categoryLabel = CATEGORIES.find(item => item.id === category)?.label;
  return [...new Set([...tags, categoryLabel].filter(Boolean))].slice(0, 4);
}

export function detectMode(text, sourceName) {
  if (/\b(how to|tutorial|guide|developer|api|release|open source|github|技术|教程|开源|implementation)\b/i.test(text)) return 'technical';
  if (/\b(analysis|review|why|inside|research|study|report|解读|研究|报告|deep dive)\b/i.test(text) || /MIT|ArXiv|Nature/i.test(sourceName)) return 'deep';
  return 'flash';
}

export function applyBlockedWords(items, blocked) {
  if (!blocked.length) return items;
  return items.filter(item => {
    const searchable = `${item.title} ${item.summary} ${item.source} ${item.tags.join(' ')}`.toLowerCase();
    return blocked.every(word => !searchable.includes(word));
  });
}

export function hash(value) {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result << 5) - result + value.charCodeAt(i);
    result |= 0;
  }
  return Math.abs(result).toString(36);
}

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeUrl(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}
