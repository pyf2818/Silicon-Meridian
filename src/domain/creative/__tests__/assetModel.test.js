import { describe, expect, it } from 'vitest';
import {
  buildCitation,
  dedupeAssets,
  isAiElfAsset,
  isUuidValue,
  migrateAssetIdsToUuid,
  normalizeAsset,
} from '../assetModel.js';

const MATERIAL_ID = 'material-3f9d1c2e-1111-4111-8111-111111111111';
const UUID_ID = '9f8d1c2e-1111-4111-8111-111111111111';

describe('creative asset model', () => {
  it('preserves source evidence when news becomes a material', () => {
    const asset = normalizeAsset({
      id: 'n1',
      title: 'Model update',
      url: 'https://example.com/a',
      source: 'Example',
      publishedAt: '2026-07-14T01:00:00Z',
      summary: 'Summary',
      tags: ['AI', 'AI'],
    }, '2026-07-14T02:00:00Z');

    expect(asset.originalItemId).toBe('n1');
    expect(asset.citation).toEqual({
      id: 'n1',
      title: 'Model update',
      source: 'Example',
      url: 'https://example.com/a',
      publishedAt: '2026-07-14T01:00:00Z',
      origin: null,
      agentName: null,
      sessionId: null,
    });
    expect(asset.tags).toEqual(['AI']);
    expect(buildCitation(asset, 1)).toContain('[1] Model update - Example');
  });

  it('preserves AI Elf handoff provenance', () => {
    const asset = normalizeAsset({
      id: 'elf-1',
      title: 'AI research note',
      source: 'AI 精灵 / 风险雷达',
      content: 'A structured conclusion.',
      tags: ['AI精灵', 'AI工作站'],
      metadata: {
        origin: 'ai-elf',
        agentName: '风险雷达',
        sessionId: 'session-1',
      },
    }, '2026-07-14T02:00:00Z');

    expect(isAiElfAsset(asset)).toBe(true);
    expect(asset.citation.origin).toBe('ai-elf');
    expect(asset.citation.agentName).toBe('风险雷达');
    expect(asset.fullContent).toBe('A structured conclusion.');
  });

  it('rejects assets without a stable title', () => {
    expect(() => normalizeAsset({ id: 'n1' })).toThrow('ASSET_TITLE_REQUIRED');
  });
});

describe('资产 id UUID 契约（云同步修复）', () => {
  const MATERIAL_ID = 'material-3f9d1c2e-1111-4111-8111-111111111111';

  it('素材转资产：id 一律新生成 UUID，素材 id 挂到 originalItemId', () => {
    const asset = normalizeAsset({ id: MATERIAL_ID, title: '来自素材的资产', content: '正文' });
    expect(isUuidValue(asset.id)).toBe(true);              // ← 修复点：不再是 material-<uuid>
    expect(asset.id).not.toBe(MATERIAL_ID);
    expect(asset.originalItemId).toBe(MATERIAL_ID);        // 来源链路保留，removeAsset 双匹配删除
  });

  it('显式 assetId 优先；news 来源的 originalItemId 保留', () => {
    const asset = normalizeAsset({ assetId: '9f8d1c2e-1111-4111-8111-111111111111', id: 'news-1', title: 'T' });
    expect(asset.id).toBe('9f8d1c2e-1111-4111-8111-111111111111');
    expect(asset.originalItemId).toBe('news-1');
  });

  it('同一输入两次调用产生不同 id（id 由资产生成，不依赖调用方）', () => {
    expect(normalizeAsset({ title: '同一素材' }).id).not.toBe(normalizeAsset({ title: '同一素材' }).id);
  });
});

describe('dedupeAssets —— 按 id 与 originalItemId 双重去重', () => {
  it('同一素材二次入库不产生重复资产', () => {
    const existing = { id: 'uuid-a', originalItemId: MATERIAL_ID, title: '已有' };
    const incoming = { id: 'uuid-b', originalItemId: MATERIAL_ID, title: '重复来源' };
    const result = dedupeAssets([incoming, existing]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(incoming);
  });

  it('不同来源互不误伤；无 originalItemId 只按 id 去重', () => {
    expect(dedupeAssets([
      { id: 'a', originalItemId: 'material-x' },
      { id: 'b', originalItemId: 'material-y' },
    ])).toHaveLength(2);
    expect(dedupeAssets([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toHaveLength(2);
  });
});

describe('migrateAssetIdsToUuid —— 存量数据迁移（幂等）', () => {
  const UUID_ID = '9f8d1c2e-1111-4111-8111-111111111111';

  it('非 UUID 资产 id 重写：能提取 UUID 就复用，文稿 assetIds 同步改写', () => {
    const { assets, documents, migratedCount, idMap } = migrateAssetIdsToUuid({
      assets: [{ id: MATERIAL_ID, title: 'A' }, { id: UUID_ID, title: 'B' }],
      documents: [{ id: 'd1', assetIds: [MATERIAL_ID, UUID_ID] }],
    });
    expect(migratedCount).toBe(1);
    expect(assets[0].id).toBe(MATERIAL_ID.slice('material-'.length));
    expect(assets[0].legacyId).toBe(MATERIAL_ID);
    expect(assets[1].id).toBe(UUID_ID);
    expect(documents[0].assetIds).toEqual([assets[0].id, UUID_ID]);
    expect(idMap[MATERIAL_ID]).toBe(assets[0].id);
  });

  it('无 UUID 子串的旧 id → 新 UUID 且不与现有冲突', () => {
    const { assets, idMap } = migrateAssetIdsToUuid({
      assets: [{ id: 'm1', title: 'A' }, { id: UUID_ID, title: 'B' }],
    });
    expect(isUuidValue(assets[0].id)).toBe(true);
    expect(assets[0].legacyId).toBe('m1');
    expect(assets[0].id).not.toBe(UUID_ID);
    expect(idMap.m1).toBe(assets[0].id);
  });

  it('幂等：迁移后的数据再跑一次不再变化', () => {
    const first = migrateAssetIdsToUuid({
      assets: [{ id: MATERIAL_ID, title: 'A' }],
      documents: [{ id: 'd1', assetIds: [MATERIAL_ID] }],
    });
    const second = migrateAssetIdsToUuid({ assets: first.assets, documents: first.documents });
    expect(second.migratedCount).toBe(0);
    expect(second.assets).toEqual(first.assets);
    expect(second.documents).toEqual(first.documents);
  });

  it('versions 的 assetIds 引用同步改写；空输入安全', () => {
    const { versions } = migrateAssetIdsToUuid({
      assets: [{ id: MATERIAL_ID, title: 'A' }],
      versions: [{ documentId: 'd1', assetIds: [MATERIAL_ID] }],
    });
    expect(versions[0].assetIds).toEqual([MATERIAL_ID.slice('material-'.length)]);
    expect(migrateAssetIdsToUuid({}).migratedCount).toBe(0);
  });
});
