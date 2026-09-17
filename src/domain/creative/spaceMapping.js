/**
 * 素材 ↔ 空间 的纯映射逻辑（无 React、无 DOM、无 IO）
 *
 * 背景：素材空间 ID 是不透明字符串（`space-<uuid>`），但历史上多处把它当数字处理
 * （`Number('space-xxxx')` → NaN），造成两个真实故障：
 *   1. 空间筛选恒为空 —— `material.spaceId === NaN` 永远 false；
 *   2. 指派静默丢失 —— 写入 NaN，`JSON.stringify` 落盘成 null，归属彻底丢失。
 * 本模块把「写侧归一 + 读侧比较 + 冷启动自愈」收敛成一处，全部走
 * `canonicalSpaceId` / `matchesSpaceId`，禁止再做数字强转。
 */
import { canonicalSpaceId, matchesSpaceId } from '../../utils/itemIdentity.js';

const toList = value => (Array.isArray(value) ? value : []);

/** 排序无关地把 id 集合归一成 Set<string>，容忍 number / string 混用。 */
function toIdSet(ids) {
  const raw = Array.isArray(ids) ? ids : [ids];
  return new Set(raw.map(id => (typeof id === 'number' ? canonicalSpaceId(id) : String(id ?? ''))).filter(Boolean));
}

/** 写侧归一：'' → null（不限空间），其余 → 裁剪后的字符串。 */
function toStoredSpaceId(value) {
  return canonicalSpaceId(value) || null;
}

/** 把若干素材指派到指定空间（spaceId 传空 = 移出空间归「不限空间」）。 */
export function assignSpaceToMaterials(materials, ids, spaceId) {
  const idSet = toIdSet(ids);
  if (!idSet.size) return toList(materials);
  const next = toStoredSpaceId(spaceId);
  return toList(materials).map(material => (
    idSet.has(String(material?.id)) ? { ...material, spaceId: next } : material
  ));
}

/** 删除空间时把仍挂在该空间下的素材归零，避免留下永远筛不出的孤儿 spaceId。 */
export function detachMaterialsFromSpace(materials, spaceId) {
  return toList(materials).map(material => (
    matchesSpaceId(material?.spaceId, spaceId) ? { ...material, spaceId: null } : material
  ));
}

/**
 * 冷启动自愈：历史落盘数据里 spaceId 可能是数字、NaN（落盘成 null）或带空格字符串；
 * 已是规范形态的对象**保持引用不变**（避免无谓重渲染）。
 */
export function normalizeStoredMaterials(materials) {
  return toList(materials).map(material => {
    if (!material || typeof material !== 'object') return material;
    const canon = canonicalSpaceId(material.spaceId);
    if (canon === material.spaceId) return material;        // 原生字符串，未变
    if (!canon && material.spaceId == null) return material; // null / undefined 保持原样
    return { ...material, spaceId: canon || null };
  });
}

/** 空间列表自愈：ID 统一成字符串、丢弃无效项、按 ID 去重（保留先出现的）。 */
export function normalizeStoredSpaces(spaces) {
  const seen = new Set();
  return toList(spaces).reduce((acc, space) => {
    if (!space || typeof space !== 'object') return acc;
    const id = canonicalSpaceId(space.id);
    if (!id || seen.has(id)) return acc;
    seen.add(id);
    acc.push(id === space.id ? space : { ...space, id });
    return acc;
  }, []);
}

/**
 * 按空间过滤集合（素材 / 文稿通用）。
 * filter 为 'all' 或空值 → 原样返回；否则只保留 spaceId 与 filter 指向同一空间的项。
 */
export function filterBySpaceId(items, filter) {
  const list = toList(items);
  if (filter === 'all' || filter == null) return list;
  if (!canonicalSpaceId(filter)) return list;
  return list.filter(item => matchesSpaceId(item?.spaceId, filter));
}
