/** Canonical identity helpers shared by recommendations, workflows and assets. */
export function canonicalItemId(value) {
  return value == null ? '' : String(value).trim();
}

export function matchesItemId(left, right) {
  const a = canonicalItemId(left);
  const b = canonicalItemId(right);
  return Boolean(a && b && a === b);
}

export function hasItemId(collection, field, itemId) {
  return (collection || []).some(entry => matchesItemId(entry?.[field], itemId));
}

/**
 * 空间 ID 归一化。
 *
 * 空间 ID 是**不透明字符串**（素材空间 `space-<uuid>`，创作空间 `Date.now()`）。
 * 历史 BUG 的根因正是把它当数字：`Number('space-xxxx')` → NaN，
 * 于是 `spaceId === NaN` 恒 false → 空间筛选恒空、指派静默丢失（NaN 落盘变 null）。
 * 因此：只接受 string / 有限 number，其余（null/undefined/NaN/布尔/对象）一律归为 ''
 * —— '' 表示「不限空间」，绝不与实际空间 ID 相等。
 */
export function canonicalSpaceId(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value !== 'string') return '';
  return value.trim();
}

/** 两个空间 ID 是否指向同一空间；任一侧为空（不限空间）都返回 false。 */
export function matchesSpaceId(left, right) {
  const a = canonicalSpaceId(left);
  const b = canonicalSpaceId(right);
  return Boolean(a && b && a === b);
}
