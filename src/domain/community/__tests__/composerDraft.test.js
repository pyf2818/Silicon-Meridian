import { describe, expect, it } from 'vitest';
import {
  clearComposerDraft, emptyDraft, isDraftMeaningful, loadComposerDraft, normalizeDraft, saveComposerDraft,
} from '../composerDraft.js';

/** 最小 localStorage 桩（无 store 语义，仅 getItem/setItem/removeItem） */
function stubStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  };
}

describe('composerDraft（B3 草稿暂存类型自愈）', () => {
  it('normalizeDraft：非法类型字段全部回落默认（persist 复活前科防御）', () => {
    const healed = normalizeDraft({
      type: 'hack', channel: 42, title: 123, body: null, tags: 'not-array', cover: 'x', visibility: 'evil', savedAt: 'x',
    });
    expect(healed).toEqual({ ...emptyDraft(), title: '', body: '' });
  });

  it('normalizeDraft：合法字段按上限截断（tags 5×24、summary 120、body 100000）', () => {
    const healed = normalizeDraft({
      type: 'review', channel: 'review', visibility: 'followers',
      title: 't'.repeat(200), body: 'b'.repeat(200000), summary: 's'.repeat(300),
      tags: Array.from({ length: 8 }, (_, i) => `标签${i}个`), cover: { kind: 'url', url: 'https://x/a.png' }, savedAt: 100,
    });
    expect(healed.title.length).toBe(180);
    expect(healed.body.length).toBe(100000);
    expect(healed.summary.length).toBe(120);
    expect(healed.tags.length).toBe(5);
    expect(healed.cover).toEqual({ kind: 'url', url: 'https://x/a.png' });
  });

  it('load/save 往返一致（savedAt = 保存时刻）；非 JSON 脏数据返回 null 不抛错', () => {
    const storage = stubStorage();
    expect(loadComposerDraft(storage)).toBeNull();
    const draft = normalizeDraft({ type: 'work', channel: 'share', title: '草稿标题', body: '正文', tags: ['创作分享'], savedAt: 1 });
    expect(saveComposerDraft(draft, storage)).toBe(true);
    const loaded = loadComposerDraft(storage);
    expect(loaded).toEqual({ ...draft, savedAt: loaded.savedAt });
    expect(loaded.savedAt).toBeGreaterThan(0);
    storage.setItem('meridian.community.composerDraft.v1', '{oops');
    expect(loadComposerDraft(storage)).toBeNull();
  });

  it('空表单不落盘且清除已有草稿；meaningful 判定', () => {
    const storage = stubStorage();
    saveComposerDraft(normalizeDraft({ title: '有内容' }), storage);
    expect(saveComposerDraft(normalizeDraft({}), storage)).toBe(false);
    expect(loadComposerDraft(storage)).toBeNull();
    expect(isDraftMeaningful(normalizeDraft({ body: '  ' }))).toBe(false);
    expect(isDraftMeaningful(normalizeDraft({ tags: ['x'] }))).toBe(true);
    clearComposerDraft(storage);
    expect(loadComposerDraft(storage)).toBeNull();
  });

  it('cover.kind 非法回落 auto 且清空 url', () => {
    expect(normalizeDraft({ cover: { kind: 'javascript:', url: 'x' } }).cover).toEqual({ kind: 'auto', url: '' });
  });
});
