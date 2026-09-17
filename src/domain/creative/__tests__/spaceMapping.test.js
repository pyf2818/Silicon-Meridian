import { describe, expect, it } from 'vitest';
import { matchesSpaceId } from '../../../utils/itemIdentity.js';
import {
  assignSpaceToMaterials,
  detachMaterialsFromSpace,
  filterBySpaceId,
  normalizeStoredMaterials,
  normalizeStoredSpaces,
} from '../spaceMapping.js';

const SPACE_A = 'space-2f1c-aaaa';
const SPACE_B = 'space-2f1c-bbbb';

const material = (id, spaceId = null) => ({ id, title: `m-${id}`, spaceId });

describe('assignSpaceToMaterials', () => {
  it('writes the opaque space id as a string (never NaN)', () => {
    const next = assignSpaceToMaterials([material('m1'), material('m2')], ['m1'], SPACE_A);
    expect(next[0].spaceId).toBe(SPACE_A);
    expect(next[1].spaceId).toBe(null);
    // 反证：历史上 Number('space-xxxx') 会写成 NaN，落盘即变 null
    expect(Number.isNaN(Number(next[0].spaceId))).toBe(true);
    expect(next[0].spaceId).not.toBe(Number(next[0].spaceId));
  });

  it('accepts a single id and numeric/string id mixes', () => {
    const next = assignSpaceToMaterials([material(7), material('8')], 7, SPACE_B);
    expect(next[0].spaceId).toBe(SPACE_B);
    expect(next[1].spaceId).toBe(null);
    expect(assignSpaceToMaterials([material('8')], '8', SPACE_B)[0].spaceId).toBe(SPACE_B);
  });

  it('clears the space when given null / empty (回到「不限空间」)', () => {
    const next = assignSpaceToMaterials([material('m1', SPACE_A)], ['m1'], '');
    expect(next[0].spaceId).toBe(null);
    expect(assignSpaceToMaterials([material('m1', SPACE_A)], ['m1'], null)[0].spaceId).toBe(null);
    expect(assignSpaceToMaterials([material('m1', SPACE_A)], ['m1'], NaN)[0].spaceId).toBe(null);
  });

  it('leaves untouched materials by reference (no needless re-render)', () => {
    const untouched = material('m2', SPACE_B);
    const next = assignSpaceToMaterials([material('m1'), untouched], ['m1'], SPACE_A);
    expect(next[1]).toBe(untouched);
  });

  it('is a no-op for empty id list', () => {
    const list = [material('m1', SPACE_A)];
    expect(assignSpaceToMaterials(list, [], SPACE_B)[0].spaceId).toBe(SPACE_A);
  });
});

describe('detachMaterialsFromSpace', () => {
  it('clears matches regardless of numeric/string representation', () => {
    const list = [material('m1', '42'), material('m2', 42), material('m3', SPACE_A)];
    const next = detachMaterialsFromSpace(list, '42');
    expect(next.map(m => m.spaceId)).toEqual([null, null, SPACE_A]);
  });

  it('does not touch materials with no space', () => {
    const noSpace = material('m1', null);
    const absent = { id: 'm2', title: 'm-2' }; // 老数据可能压根没有 spaceId 字段
    const next = detachMaterialsFromSpace([noSpace, absent], SPACE_A);
    expect(next[0]).toBe(noSpace);
    expect(next[1]).toBe(absent);
    expect(next[1].spaceId).toBeUndefined();
  });
});

describe('filterBySpaceId', () => {
  it('matches materials across numeric/string space ids', () => {
    const list = [material('m1', '42'), material('m2', 42), material('m3', SPACE_A), material('m4')];
    expect(filterBySpaceId(list, '42').map(m => m.id)).toEqual(['m1', 'm2']);
    expect(filterBySpaceId(list, 42).map(m => m.id)).toEqual(['m1', 'm2']);
    expect(filterBySpaceId(list, SPACE_A).map(m => m.id)).toEqual(['m3']);
  });

  it('treats "all" / empty filter as no filtering', () => {
    const list = [material('m1', SPACE_A), material('m2')];
    expect(filterBySpaceId(list, 'all')).toHaveLength(2);
    expect(filterBySpaceId(list, null)).toHaveLength(2);
    expect(filterBySpaceId(list, '')).toHaveLength(2);
  });

  it('returns empty for a space nobody belongs to (空态不被误判成有数据)', () => {
    const list = [material('m1', SPACE_A)];
    expect(filterBySpaceId(list, SPACE_B)).toEqual([]);
    expect(filterBySpaceId(list, 'space-does-not-exist')).toEqual([]);
  });

  it('never matches a material without space to a real space filter', () => {
    expect(filterBySpaceId([material('m1', null)], SPACE_A)).toEqual([]);
  });

  it('tolerates corrupt input', () => {
    expect(filterBySpaceId(null, SPACE_A)).toEqual([]);
    expect(filterBySpaceId({}, SPACE_A)).toEqual([]);
    expect(filterBySpaceId([null, undefined], SPACE_A)).toEqual([]);
  });
});

describe('normalizeStoredMaterials (冷启动自愈)', () => {
  it('canonicalizes legacy numeric and padded ids', () => {
    const next = normalizeStoredMaterials([material('m1', 1712345678901), material('m2', '  7  ')]);
    expect(next[0].spaceId).toBe('1712345678901');
    expect(next[1].spaceId).toBe('7');
  });

  it('keeps clean records by reference', () => {
    const clean = material('m1', SPACE_A);
    const noSpace = material('m2', null);
    const next = normalizeStoredMaterials([clean, noSpace]);
    expect(next[0]).toBe(clean);
    expect(next[1]).toBe(noSpace);
  });

  it('drops NaN / Infinity to null and keeps garbage objects as-is', () => {
    const next = normalizeStoredMaterials([material('m1', NaN), material('m2', Infinity), null]);
    expect(next[0].spaceId).toBe(null);
    expect(next[1].spaceId).toBe(null);
    expect(next[2]).toBe(null);
  });

  it('returns [] for corrupt containers (不让脏数据整站崩)', () => {
    expect(normalizeStoredMaterials(null)).toEqual([]);
    expect(normalizeStoredMaterials({ a: 1 })).toEqual([]);
  });
});

describe('normalizeStoredSpaces', () => {
  it('stringifies numeric ids and drops invalid / duplicate entries', () => {
    const next = normalizeStoredSpaces([
      { id: 1712345678901, name: '创作空间' },
      { id: SPACE_A, name: '素材空间' },
      { id: 1712345678901, name: '重复' },
      { id: '', name: '无 id' },
      { name: '缺 id' },
      null,
    ]);
    expect(next.map(s => s.id)).toEqual(['1712345678901', SPACE_A]);
    expect(next.map(s => s.name)).toEqual(['创作空间', '素材空间']);
  });

  it('keeps already-canonical spaces by reference', () => {
    const space = { id: SPACE_A, name: 'A' };
    expect(normalizeStoredSpaces([space])[0]).toBe(space);
  });
});

describe('端到端：建空间 → 指派 → 筛选 → 删空间', () => {
  it('keeps assignment discoverable, then detaches on space deletion', () => {
    // 1. 空间 ID 由 createStableId('space') 生成 → 不透明字符串
    const spaces = normalizeStoredSpaces([{ id: SPACE_A, name: 'A' }]);
    let materials = [material('m1'), material('m2')];

    // 2. 从下拉框指派：UI 传的就是 option 的字符串 value（历史上这里被 Number() 成 NaN）
    materials = assignSpaceToMaterials(materials, ['m1'], spaces[0].id);
    expect(materials[0].spaceId).toBe(SPACE_A);

    // 3. 侧栏筛选 + 计数都要能看见它
    expect(filterBySpaceId(materials, SPACE_A).map(m => m.id)).toEqual(['m1']);
    // 与 MaterialsPage 计数表达式一致，期望值是写死的字面量（非自引用）
    expect(materials.filter(m => matchesSpaceId(m.spaceId, spaces[0].id)).length).toBe(1);
    // 另一个空间应为空（反证没有过度匹配）
    expect(filterBySpaceId(materials, SPACE_B)).toEqual([]);

    // 4. 删除该空间 → 素材回到「不限空间」，不留孤儿是筛选不出的归属
    materials = detachMaterialsFromSpace(materials, SPACE_A);
    expect(materials[0].spaceId).toBe(null);
    expect(filterBySpaceId(materials, SPACE_A)).toEqual([]);
    expect(filterBySpaceId(materials, 'all')).toHaveLength(2);
  });

  it('survives a reload round-trip through JSON (NaN 落盘会变 null 的那条路)', () => {
    const assigned = assignSpaceToMaterials([material('m1')], ['m1'], SPACE_A);
    const restored = normalizeStoredMaterials(JSON.parse(JSON.stringify(assigned)));
    expect(restored[0].spaceId).toBe(SPACE_A);
    expect(filterBySpaceId(restored, SPACE_A).map(m => m.id)).toEqual(['m1']);
  });
});

describe('回归守卫：旧表达式 Number() 强转', () => {
  const legacyFilter = (items, filter) => items.filter(m => m.spaceId === Number(filter));

  it('matched nothing for opaque string space ids', () => {
    const opaque = [material('m1', SPACE_A)];
    expect(legacyFilter(opaque, SPACE_A)).toEqual([]); // 'space-xxxx' → NaN → 恒空（旧 BUG 本体）
    expect(filterBySpaceId(opaque, SPACE_A)).toHaveLength(1);
  });

  it('happened to work for numeric ids — 这正是 BUG 长期潜伏的原因', () => {
    const numeric = [{ id: 'm2', title: 'm-2', spaceId: 42 }];
    expect(legacyFilter(numeric, '42')).toHaveLength(1);
    expect(filterBySpaceId(numeric, '42')).toHaveLength(1);
  });

  it('mixed representation: legacy missed, new matches', () => {
    const mixed = [{ id: 'm3', title: 'm-3', spaceId: '42' }]; // 存字符串、比数字
    expect(legacyFilter(mixed, '42')).toEqual([]);
    expect(filterBySpaceId(mixed, '42')).toHaveLength(1);
  });
});
