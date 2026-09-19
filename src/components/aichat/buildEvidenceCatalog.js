// 情报/素材「目录层」构造：预注入只放 ID + 标题 + 元信息，正文一律按需取。
//
// 为什么要有这一层（上下文预算 vs 数据充分性）：
//   站内此刻有数百条资讯，全量塞进 system prompt 会把上下文撑爆；但只塞十几条正文，
//   agent 又「看不见」库里有什么，只能靠猜或联网。
//   目录层用「一行一条」的紧凑格式让 agent 看见全貌（几十条 ≈ 1.5K token 固定成本），
//   正文则交给工具按需取（read_intelligence_focus / search_news / list_knowledge /
//   read_workspace_file）。引用仍然只写 [资讯:ID]，正文不进上下文。

/** 各类目录的条数上限（超出按传入顺序截断，调用方负责按相关度排序） */
export const CATALOG_LIMITS = { news: 60, materials: 12, files: 12 };
/** 单行标题截断长度（中文 46 字足够辨认） */
export const CATALOG_TITLE_MAX = 46;
/** 文件/素材的一瞥摘要长度 */
export const CATALOG_GLIMPSE_MAX = 70;

const clip = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** 时间紧凑化：09-19 17:21（跨年时带年份） */
function shortTime(value) {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const now = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return d.getFullYear() === now.getFullYear()
    ? `${mm}-${dd} ${hh}:${mi}`
    : `${d.getFullYear()}-${mm}-${dd}`;
}

/** 单条资讯的目录行：[资讯:ID] 标题｜来源｜时间｜分类 */
export function catalogNewsLine(item) {
  const id = item?.id || '';
  const title = clip(item?.title, CATALOG_TITLE_MAX) || '(无标题)';
  const source = clip(item?.source || item?.sourceName || '未知', 16);
  const time = shortTime(item?.publishedAt || item?.lastSeenAt || item?.createdAt);
  const category = item?.categoryLabel || item?.category || '';
  return `[资讯:${id}] ${title}｜${source}${time ? `｜${time}` : ''}${category ? `｜${category}` : ''}`;
}

/** 单条素材的目录行：[素材:ID] 标题｜来源｜标签 */
export function catalogMaterialLine(material, index = 0) {
  const id = material?.id || index + 1;
  const title = clip(material?.title, CATALOG_TITLE_MAX) || '未命名素材';
  const source = clip(material?.source || '未知', 14);
  const tags = (Array.isArray(material?.tags) ? material.tags : []).slice(0, 3).join('/');
  return `[素材:${id}] ${title}｜${source}${tags ? `｜${tags}` : ''}`;
}

/** 单个文件的目录行：[文件:名称] 一瞥 */
export function catalogFileLine(file) {
  const name = clip(file?.name || file?.title, 32) || '未命名';
  const glimpse = clip(file?.content || file?.summary, CATALOG_GLIMPSE_MAX);
  return `[文件:${name}]${glimpse ? ` ${glimpse}` : ''}`;
}

/**
 * 构造完整目录（资讯 + 素材 + 文件），返回可直接注入 prompt 的文本与统计。
 * @returns {{text:string, lines:string[], counts:object, approxChars:number}}
 */
export function buildEvidenceCatalog({
  items = [],
  materials = [],
  files = [],
  limits = CATALOG_LIMITS,
} = {}) {
  const newsLines = (Array.isArray(items) ? items : [])
    .slice(0, limits.news ?? CATALOG_LIMITS.news)
    .map(catalogNewsLine);
  const materialLines = (Array.isArray(materials) ? materials : [])
    .slice(0, limits.materials ?? CATALOG_LIMITS.materials)
    .map(catalogMaterialLine);
  const fileLines = (Array.isArray(files) ? files : [])
    .slice(0, limits.files ?? CATALOG_LIMITS.files)
    .map(catalogFileLine);

  const lines = [...newsLines, ...materialLines, ...fileLines];
  const text = lines.join('\n');
  return {
    text,
    lines,
    counts: {
      news: newsLines.length,
      materials: materialLines.length,
      files: fileLines.length,
      total: lines.length,
    },
    approxChars: text.length,
  };
}

/** 目录后的「按需取详情」指引（告诉 agent 这些只是目录，正文要自己取） */
export const CATALOG_USAGE_HINT = [
  '【目录使用说明】以上是站内资讯/素材/文件的**目录**（只有标题与元信息，不是正文）。',
  '需要某条的详情时按序取用：search_news（关键词/范围检索站内资讯）→ read_intelligence_focus（按主题取聚焦事件与交叉验证）→ list_knowledge（检索工作空间知识库）→ read_workspace_file（按文件名读全文）。',
  '回答中请用 [资讯:ID] / [素材:ID] 引用对应条目，不要复述正文——被引用条目的正文由前端展开。',
].join('\n');
