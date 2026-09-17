import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isUuidValue } from '../../domain/creative/assetModel.js';
import {
  CREATIVE_ASSETS_KEY,
  CREATIVE_DOCUMENTS_KEY,
  CREATIVE_MIGRATION_KEY,
  initializeCreativeWorkspace,
  migrateLegacyCreativeState,
} from '../useCreativeWorkspace.js';

function installLocalStorage() {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(key => store.get(key) || null),
    setItem: vi.fn((key, value) => store.set(key, String(value))),
    removeItem: vi.fn(key => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  });
}

describe('useCreativeWorkspace migration helpers', () => {
  beforeEach(() => {
    installLocalStorage();
    // 确定性 UUID stub：合法 v4 形状（云同步契约要求真 UUID），且可计数断言。
    // 旧 stub 返回 `id-<random>` 不是 UUID——那正是本次修复要消灭的形态。
    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
      }),
    });
  });

  it('migrates legacy materials and articles into creative assets and documents', () => {
    const result = migrateLegacyCreativeState({
      now: '2026-07-14T01:00:00Z',
      legacyMaterials: [{
        id: 'm1',
        title: 'Material',
        content: 'Content',
        source: 'Source',
        url: 'https://example.com',
        tags: ['AI'],
      }],
      legacyArticles: [{
        id: 'a1',
        title: 'Article',
        content: 'Draft',
        materials: ['m1'],
        createdAt: '2026-07-14T00:00:00Z',
      }],
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].citation.title).toBe('Material');
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].draftContent).toBe('Draft');
    expect(result.documents[0].assetIds).toEqual(['m1']);
  });

  it('initializes from legacy localStorage once and then reuses creative keys', () => {
    localStorage.setItem('materials', JSON.stringify([{ id: 'm1', title: 'Material', content: 'Content' }]));
    localStorage.setItem('articles', JSON.stringify([{ id: 'a1', title: 'Article', content: 'Draft' }]));

    const first = initializeCreativeWorkspace('2026-07-14T01:00:00Z');
    expect(first.assets).toHaveLength(1);
    expect(first.documents).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(CREATIVE_MIGRATION_KEY)).done).toBe(true);

    localStorage.setItem('materials', JSON.stringify([{ id: 'm2', title: 'Late legacy', content: 'Ignored' }]));
    const second = initializeCreativeWorkspace('2026-07-14T02:00:00Z');
    // UUID 迁移后：legacy 的 'm1' 链路在 originalItemId（素材 id 从未作为资产 id 存在），
    // 资产 id 本身已是合法 UUID（云同步契约）；legacyId 仅在旧 id 无法提取 UUID 时才出现。
    expect(second.assets.map(asset => asset.originalItemId)).toEqual(['m1']);
    expect(second.assets.every(asset => isUuidValue(asset.id))).toBe(true);
    expect(second.assets.map(asset => asset.legacyId)).toEqual([undefined]);
    expect(JSON.parse(localStorage.getItem(CREATIVE_ASSETS_KEY))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(CREATIVE_DOCUMENTS_KEY))).toHaveLength(1);
  });
});
