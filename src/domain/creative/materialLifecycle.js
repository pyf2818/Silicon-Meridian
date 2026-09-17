/**
 * 素材生命周期纯逻辑：导入归一 / 软删除入回收站 / 恢复 / 彻底删除。
 *
 * 抽出来的动机（不只是为了好测）：
 * 原实现把副作用写在 state updater 内部，例如
 *   setMaterials(prev => { moveToTrash([target]); creativeWorkspace.removeAsset(...); return ... })
 * 而 `main.jsx` 开着 `<React.StrictMode>` —— **updater 函数在开发模式下会被调用两次**，
 * 于是删除会向回收站写入两条、恢复会把同一条素材插入两次。updater 必须保持纯函数，
 * 副作用（写回收站、通知创作工作区）一律留在事件处理器里。
 * 这里只放纯函数：同一个输入永远同一个输出，重复调用无副作用。
 */
import { createStableId } from '../../utils/stableId.js';
import { canonicalSpaceId } from '../../utils/itemIdentity.js';

/** 回收站容量上限（条） */
export const TRASH_LIMIT = 30;
/** 单次导入条数上限 */
export const IMPORT_LIMIT = 500;

const nowIso = () => new Date().toISOString();
const toList = value => (Array.isArray(value) ? value : []);

/**
 * 归一化「外部导入」的素材（来自用户上传的 JSON，属不可信数据）。
 * 返回 null 表示该条应被丢弃。
 */
export function buildImportedMaterial(input, { now = nowIso(), createId = () => createStableId('material'), spaceIds = null } = {}) {
  if (!input || typeof input !== 'object') return null;
  const title = String(input.title || '').trim().slice(0, 200);
  const content = String(input.content || input.fullContent || '').slice(0, 100_000);
  if (!title || !content) return null;

  // 空间归属：归一成字符串；若调用方给了有效空间集合，指向未知空间的归属一并清空
  // （导入的备份可能来自另一台设备，那里的空间在本机并不存在）
  const rawSpaceId = canonicalSpaceId(input.spaceId);
  const known = spaceIds instanceof Set ? spaceIds : null;
  const spaceId = rawSpaceId && (!known || known.has(rawSpaceId)) ? rawSpaceId : null;

  return {
    ...input,
    id: createId(),
    title,
    content,
    fullContent: String(input.fullContent || content).slice(0, 200_000),
    tags: Array.isArray(input.tags) ? input.tags.map(String).map(t => t.trim()).filter(Boolean).slice(0, 50) : [],
    spaceId,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

/** 批量导入：切到上限、逐条归一，并回报被丢弃的数量（便于提示用户）。 */
export function collectImportedMaterials(rawList, { limit = IMPORT_LIMIT, ...opts } = {}) {
  const list = toList(rawList);
  const capped = list.slice(0, limit);
  const imported = capped.map(entry => buildImportedMaterial(entry, opts)).filter(Boolean);
  return { imported, rejected: capped.length - imported.length };
}

/** 追加素材；incoming 为空时原样返回（保持引用，避免无谓重渲染）。 */
export function mergeMaterials(existing, incoming, { front = false } = {}) {
  const base = toList(existing);
  const add = toList(incoming);
  if (!add.length) return base;
  return front ? [...add, ...base] : [...base, ...add];
}

/** 按 id 移除素材（容忍 number/string 混用）。 */
export function removeMaterialsByIds(materials, ids) {
  const base = toList(materials);
  const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(id => String(id ?? '')).filter(Boolean));
  if (!wanted.size) return base;
  return base.filter(m => !wanted.has(String(m?.id ?? '')));
}

/** 软删除：写入回收站，标记 deletedAt，最新在前，超出上限截断。 */
export function pushMaterialsToTrash(trash, items, { now = nowIso(), limit = TRASH_LIMIT } = {}) {
  const base = toList(trash);
  const add = toList(items).filter(Boolean).map(item => ({ ...item, deletedAt: item.deletedAt || now }));
  if (!add.length) return base;
  return [...add, ...base].slice(0, limit);
}

/** 从回收站取出（恢复）一条：返回余下的回收站与被取出的素材（已去掉 deletedAt）。 */
export function pullMaterialFromTrash(trash, id) {
  const base = toList(trash);
  const wanted = String(id ?? '');
  const target = base.find(m => String(m?.id ?? '') === wanted);
  if (!target) return { trash: base, item: null };
  const { deletedAt, ...item } = target;
  return { trash: base.filter(m => String(m?.id ?? '') !== wanted), item };
}

/** 彻底删除一条（不可恢复）。 */
export function purgeMaterialFromTrash(trash, id) {
  const base = toList(trash);
  const wanted = String(id ?? '');
  return base.filter(m => String(m?.id ?? '') !== wanted);
}
