export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidValue(value) {
  return UUID_RE.test(String(value || ''));
}

/** 恒定返回合法 v4 UUID（无 crypto.randomUUID 的环境走手工拼字节，保证云同步 id 永远合规） */
function uuid4() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomId(prefix = 'asset') {
  return uuid4();
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))];
  if (typeof tags === 'string') return [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))];
  return [];
}

function buildCitationPayload(input, originalItemId, title) {
  const metadataCitation = input.citation && typeof input.citation === 'object' ? input.citation : null;
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  return Object.freeze({
    id: String(metadataCitation?.id || input.originalItemId || input.id || originalItemId),
    title,
    source: String(metadataCitation?.source || input.source || '未知来源'),
    url: String(metadataCitation?.url || input.url || ''),
    publishedAt: metadataCitation?.publishedAt || input.publishedAt || input.createdAt || null,
    origin: metadataCitation?.origin || metadata.origin || null,
    agentName: metadataCitation?.agentName || metadata.agentName || null,
    sessionId: metadataCitation?.sessionId || metadata.sessionId || null,
  });
}

export function normalizeAsset(input = {}, now = new Date().toISOString()) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('ASSET_TITLE_REQUIRED');

  // 云同步契约：资产 id 必须是纯 UUID（creativeService 只接受 UUID）。
  // 历史 BUG：素材转资产时把素材 id（material-<uuid>）直接当资产 id，
  // 被 syncNow 的 isUuid 过滤**静默丢弃** → 素材资产永远上不了云。
  // 现在：id 一律新生成 UUID；来源 id 统一挂 originalItemId
  //（removeAsset 按 id 或 originalItemId 双匹配删除，素材删除/恢复链路不受影响）。
  const originalItemId = String(input.originalItemId || input.id || input.metadata?.sourceId || uuid4());
  const citation = buildCitationPayload(input, originalItemId, title);

  return Object.freeze({
    id: String(input.assetId || uuid4()),
    originalItemId,
    title,
    content: String(input.content || input.summary || ''),
    fullContent: String(input.fullContent || input.content || input.summary || ''),
    type: input.type || 'news',
    source: String(input.source || citation.source || '未知来源'),
    url: String(input.url || citation.url || ''),
    tags: Object.freeze(normalizeTags(input.tags)),
    citation,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
    createdAt: input.createdAt || now,
    updatedAt: now,
  });
}

export function buildCitation(asset, index = 1) {
  const c = asset?.citation || {};
  const title = c.title || asset?.title || 'Untitled';
  const source = c.source || asset?.source || '未知来源';
  const date = c.publishedAt ? ` (${String(c.publishedAt).slice(0, 10)})` : '';
  const url = c.url ? ` ${c.url}` : '';
  return `[${index}] ${title} - ${source}${date}${url}`;
}

export function isAiElfAsset(asset = {}) {
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  return asset.metadata?.origin === 'ai-elf'
    || asset.citation?.origin === 'ai-elf'
    || String(asset.source || '').includes('AI精灵')
    || String(asset.source || '').includes('AI 精灵')
    || tags.some(tag => String(tag).includes('AI精灵') || String(tag).includes('AI工作站'));
}

/**
 * 资产去重：先按 id，再按 originalItemId（来源 id）。
 * 后者是素材转资产的链路——同一素材二次入库/远程合并时不产生重复资产。
 */
export function dedupeAssets(items = []) {
  const seenIds = new Set();
  const seenSources = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item !== 'object') return false;
    const id = String(item.id || '');
    const sourceId = String(item.originalItemId || '');
    if (id && seenIds.has(id)) return false;
    if (sourceId && seenSources.has(sourceId)) return false;
    if (id) seenIds.add(id);
    if (sourceId) seenSources.add(sourceId);
    return true;
  });
}

/** 从旧 id 里提取 UUID 子串（material-<uuid> / source-<uuid> 之类），没有则返回 '' */
function extractUuid(value) {
  return String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0] || '';
}

/**
 * 存量资产 id 迁移：把非 UUID 的资产 id 重写为 UUID，并同步改写文稿的 assetIds 引用。
 *
 * 为什么需要：云同步只接受 UUID 资产 id；存量数据里素材转资产的 id 是 `material-<uuid>`，
 * 它们永远同步不上去。迁移策略：能从旧 id 提取 UUID 就复用（保持与旧数据最大的连续性），
 * 否则新生成；旧 id 保留在 `legacyId` 便于人工排查，文稿 assetIds 同步改写避免悬空引用。
 *
 * 纯函数 + 幂等：已经是 UUID 的资产原样返回，跑多少次结果一致。
 */
export function migrateAssetIdsToUuid({ assets = [], documents = [], versions = [] } = {}) {
  const takenIds = new Set();
  for (const asset of Array.isArray(assets) ? assets : []) {
    const id = String(asset?.id || '');
    if (isUuidValue(id)) takenIds.add(id);
  }

  const idMap = new Map();
  const nextAssets = (Array.isArray(assets) ? assets : []).map(asset => {
    if (!asset || typeof asset !== 'object') return asset;
    const currentId = String(asset.id || '');
    if (isUuidValue(currentId)) return asset;
    let nextId = extractUuid(currentId);
    while (!nextId || takenIds.has(nextId)) nextId = uuid4();
    takenIds.add(nextId);
    idMap.set(currentId, nextId);
    return { ...asset, id: nextId, legacyId: currentId };
  });

  const remapList = ids => {
    if (!Array.isArray(ids) || !ids.length) return null;
    let changed = false;
    const next = ids.map(id => {
      const mapped = idMap.get(String(id));
      if (mapped && mapped !== String(id)) { changed = true; return mapped; }
      return id;
    });
    return changed ? next : null;
  };

  const nextDocuments = (Array.isArray(documents) ? documents : []).map(document => {
    if (!document || typeof document !== 'object') return document;
    const assetIds = remapList(document.assetIds);
    return assetIds ? { ...document, assetIds } : document;
  });

  const nextVersions = (Array.isArray(versions) ? versions : []).map(version => {
    if (!version || typeof version !== 'object') return version;
    const assetIds = remapList(version.assetIds);
    return assetIds ? { ...version, assetIds } : version;
  });

  return {
    assets: nextAssets,
    documents: nextDocuments,
    versions: nextVersions,
    migratedCount: idMap.size,
    idMap: Object.fromEntries(idMap),
  };
}
