import { expect, it } from 'vitest';
import { createMemoryStorage, createSnapshotStore } from '../snapshotStore.js';

it('does not overwrite an existing daily base snapshot', () => {
  const store = createSnapshotStore(createMemoryStorage());
  store.create({ date: '2026-07-14', profileVersion: 1, items: ['a'] });
  store.create({ date: '2026-07-14', profileVersion: 2, items: ['b'] });
  expect(store.get('2026-07-14').items).toEqual(['a']);
});

it('appends updates without mutating base items', () => {
  const store = createSnapshotStore(createMemoryStorage());
  store.create({ date: '2026-07-14', profileVersion: 1, items: ['a'] });
  store.appendUpdate('2026-07-14', { id: 'event-2', at: 2 });
  const result = store.get('2026-07-14');
  expect(result.updates).toEqual([{ id: 'event-2', at: 2 }]);
  expect(result.items).toEqual(['a']);
});

it('prunes snapshots beyond the 60-day retention window (newest kept)', () => {
  const storage = createMemoryStorage();
  const store = createSnapshotStore(storage);
  // 造 65 天快照（date 递增保证可排序）
  for (let i = 0; i < 65; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    store.create({ date: `2026-06-${day}`, profileVersion: 1, items: [`d${i}`] });
  }
  const listed = store.list();
  expect(listed).toHaveLength(60);
  expect(listed[0].date).toBe('2026-06-65');            // 最新保留
  expect(listed[59].date).toBe('2026-06-06');
  expect(store.get('2026-06-01')).toBeNull();           // 最旧的被裁掉
  // 再次写入（appendUpdate 落盘路径）不会把已裁剪的快照"复活"
  store.appendUpdate('2026-06-65', { id: 'late', at: 1 });
  expect(store.list()).toHaveLength(60);
});
