import { describe, expect, it } from 'vitest';
import {
  IMPORT_LIMIT,
  TRASH_LIMIT,
  buildImportedMaterial,
  collectImportedMaterials,
  mergeMaterials,
  pullMaterialFromTrash,
  purgeMaterialFromTrash,
  pushMaterialsToTrash,
  removeMaterialsByIds,
} from '../materialLifecycle.js';

const NOW = '2026-09-14T02:00:00.000Z';
const mk = (id, extra = {}) => ({ id, title: `t-${id}`, content: `c-${id}`, ...extra });
const idFactory = (() => { let n = 0; return () => `material-test-${++n}`; })();

describe('buildImportedMaterial', () => {
  const opts = { now: NOW, createId: idFactory };

  it('rejects malformed entries', () => {
    expect(buildImportedMaterial(null, opts)).toBe(null);
    expect(buildImportedMaterial('nope', opts)).toBe(null);
    expect(buildImportedMaterial({ content: 'only content' }, opts)).toBe(null);
    expect(buildImportedMaterial({ title: 'only title' }, opts)).toBe(null);
    expect(buildImportedMaterial({ title: '   ', content: '   ' }, opts)).toBe(null);
  });

  it('mints a fresh id and stamps timestamps', () => {
    const m = buildImportedMaterial({ id: 'old-id', title: ' A ', content: 'B' }, opts);
    expect(m.id).toMatch(/^material-test-\d+$/);   // 导入不走原 id，避免与库内既有 id 撞车
    expect(m.id).not.toBe('old-id');
    expect(m.title).toBe('A');
    expect(m.createdAt).toBe(NOW);
    expect(m.updatedAt).toBe(NOW);
  });

  it('keeps the original createdAt when present', () => {
    const m = buildImportedMaterial({ title: 'A', content: 'B', createdAt: '2020-01-01T00:00:00.000Z' }, opts);
    expect(m.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(m.updatedAt).toBe(NOW);
  });

  it('caps field sizes', () => {
    const m = buildImportedMaterial({ title: 'x'.repeat(500), content: 'y'.repeat(5000) }, opts);
    expect(m.title).toHaveLength(200);
    expect(m.content).toHaveLength(5000);
    expect(m.fullContent).toHaveLength(5000); // 无 fullContent 时回填 content
  });

  it('normalizes tags, ignoring non-array input', () => {
    const withTags = buildImportedMaterial({ title: 'A', content: 'B', tags: [' x ', '', 7, 'y'] }, opts);
    expect(withTags.tags).toEqual(['x', '7', 'y']);
    const stringTags = buildImportedMaterial({ title: 'A', content: 'B', tags: 'x,y' }, opts);
    expect(stringTags.tags).toEqual([]);
  });

  it('canonicalizes spaceId to a string', () => {
    expect(buildImportedMaterial({ title: 'A', content: 'B', spaceId: 1712345678901 }, opts).spaceId).toBe('1712345678901');
    expect(buildImportedMaterial({ title: 'A', content: 'B', spaceId: '  space-a  ' }, opts).spaceId).toBe('space-a');
    expect(buildImportedMaterial({ title: 'A', content: 'B', spaceId: NaN }, opts).spaceId).toBe(null);
    expect(buildImportedMaterial({ title: 'A', content: 'B' }, opts).spaceId).toBe(null);
  });

  it('clears space ids that do not exist on this device', () => {
    const spaceIds = new Set(['space-a']);
    expect(buildImportedMaterial({ title: 'A', content: 'B', spaceId: 'space-a' }, { ...opts, spaceIds }).spaceId).toBe('space-a');
    // 备份来自另一台设备：本机没有这个空间 → 归「不限空间」，而不是留下筛不出的孤儿 id
    expect(buildImportedMaterial({ title: 'A', content: 'B', spaceId: 'space-elsewhere' }, { ...opts, spaceIds }).spaceId).toBe(null);
    // 不传 spaceIds 时不做存在性校验
    expect(buildImportedMaterial({ title: 'A', content: 'B', spaceId: 'space-elsewhere' }, opts).spaceId).toBe('space-elsewhere');
  });
});

describe('collectImportedMaterials', () => {
  it('caps at the limit and reports rejected count', () => {
    const raw = [mk(1), mk(2), mk(3)];
    const { imported, rejected } = collectImportedMaterials(raw, { limit: 2, now: NOW, createId: idFactory });
    expect(imported).toHaveLength(2);
    expect(rejected).toBe(0);
    expect(imported[0].title).toBe('t-1');
  });

  it('counts dropped entries', () => {
    const { imported, rejected } = collectImportedMaterials([mk(1), null, { title: '' }, mk(4)], { now: NOW, createId: idFactory });
    expect(imported).toHaveLength(2);
    expect(rejected).toBe(2);
  });

  it('uses the 500 default limit and tolerates non-array input', () => {
    expect(collectImportedMaterials({}, { now: NOW, createId: idFactory })).toEqual({ imported: [], rejected: 0 });
    const many = Array.from({ length: IMPORT_LIMIT + 20 }, (_, i) => mk(i));
    expect(collectImportedMaterials(many, { now: NOW, createId: idFactory }).imported).toHaveLength(IMPORT_LIMIT);
  });
});

describe('mergeMaterials', () => {
  it('appends and prepends', () => {
    expect(mergeMaterials([mk(1)], [mk(2)]).map(m => m.id)).toEqual([1, 2]);
    expect(mergeMaterials([mk(1)], [mk(2)], { front: true }).map(m => m.id)).toEqual([2, 1]);
  });

  it('returns the same reference when there is nothing to add', () => {
    const list = [mk(1)];
    expect(mergeMaterials(list, [])).toBe(list);
    expect(mergeMaterials(list, null)).toBe(list);
  });

  it('returns [] for corrupt containers', () => {
    expect(mergeMaterials(null, [mk(1)])).toEqual([mk(1)]);
    expect(mergeMaterials({ a: 1 }, [])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const list = [mk(1)];
    mergeMaterials(list, [mk(2)]);
    expect(list).toHaveLength(1);
  });
});

describe('removeMaterialsByIds', () => {
  it('removes by id across number/string representations', () => {
    const list = [mk(1), mk('2'), mk(3)];
    expect(removeMaterialsByIds(list, [1, '2']).map(m => m.id)).toEqual([3]);
    expect(removeMaterialsByIds(list, 3).map(m => m.id)).toEqual([1, '2']);
  });

  it('is a no-op for empty or unknown ids', () => {
    const list = [mk(1)];
    expect(removeMaterialsByIds(list, [])).toBe(list);
    expect(removeMaterialsByIds(list, ['nope'])).toHaveLength(1);
  });
});

describe('pushMaterialsToTrash', () => {
  it('prepends newest first with deletedAt stamped', () => {
    const next = pushMaterialsToTrash([mk('old')], [mk('new')], { now: NOW });
    expect(next.map(m => m.id)).toEqual(['new', 'old']);
    expect(next[0].deletedAt).toBe(NOW);
  });

  it('keeps an existing deletedAt (恢复再删不刷新时间)', () => {
    const next = pushMaterialsToTrash([], [{ ...mk('a'), deletedAt: '2020-01-01T00:00:00.000Z' }], { now: NOW });
    expect(next[0].deletedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it(`caps the trash at ${TRASH_LIMIT} entries, dropping the oldest`, () => {
    const existing = Array.from({ length: TRASH_LIMIT }, (_, i) => mk(`t${i}`));
    const next = pushMaterialsToTrash(existing, [mk('fresh')], { now: NOW });
    expect(next).toHaveLength(TRASH_LIMIT);
    expect(next[0].id).toBe('fresh');
    expect(next.map(m => m.id)).not.toContain(`t${TRASH_LIMIT - 1}`);
  });

  it('same reference when nothing to push', () => {
    const trash = [mk('a')];
    expect(pushMaterialsToTrash(trash, [], { now: NOW })).toBe(trash);
    expect(pushMaterialsToTrash(trash, null, { now: NOW })).toBe(trash);
  });
});

describe('pullMaterialFromTrash (恢复)', () => {
  it('returns the item without deletedAt and the remaining trash', () => {
    const trash = [{ ...mk('a'), deletedAt: NOW }, mk('b')];
    const { trash: next, item } = pullMaterialFromTrash(trash, 'a');
    expect(item.id).toBe('a');
    expect('deletedAt' in item).toBe(false);
    expect(next.map(m => m.id)).toEqual(['b']);
    expect(trash).toHaveLength(2); // 不原地修改
  });

  it('reports a miss without touching the trash', () => {
    const trash = [mk('a')];
    const { trash: next, item } = pullMaterialFromTrash(trash, 'missing');
    expect(item).toBe(null);
    expect(next).toBe(trash);
  });
});

describe('purgeMaterialFromTrash / 彻底删除', () => {
  it('removes exactly one entry', () => {
    expect(purgeMaterialFromTrash([mk('a'), mk('b')], 'a').map(m => m.id)).toEqual(['b']);
    expect(purgeMaterialFromTrash([mk('a')], 'nope')).toHaveLength(1);
  });
});

/**
 * StrictMode 契约：main.jsx 开着 <React.StrictMode>，state updater 会被调用两次。
 * 这些函数必须「纯」——同输入同输出、不改输入、不产生外部副作用，
 * 否则删除会往回收站写两条、恢复会把素材插两次。
 */
describe('StrictMode 纯度契约（updater 会被调用两次）', () => {
  const cases = [
    ['mergeMaterials', () => mergeMaterials([mk(1)], [mk(2)])],
    ['removeMaterialsByIds', () => removeMaterialsByIds([mk(1), mk(2)], [1])],
    ['pushMaterialsToTrash', () => pushMaterialsToTrash([mk(1)], [mk(2)], { now: NOW })],
    ['pullMaterialFromTrash', () => pullMaterialFromTrash([{ ...mk(1), deletedAt: NOW }], 1)],
    ['purgeMaterialFromTrash', () => purgeMaterialFromTrash([mk(1), mk(2)], 1)],
  ];

  it.each(cases)('%s 两次调用结果一致（深相等）', (_name, run) => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('重复 push 同一批素材不会复制（纯函数由 React 反复调用也安全）', () => {
    const trash = [];
    const items = [mk('a')];
    const once = pushMaterialsToTrash(trash, items, { now: NOW });
    const twice = pushMaterialsToTrash(trash, items, { now: NOW });
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1); // 若把 push 写成对外部累积状态的自增，这里会是 2
  });
});
