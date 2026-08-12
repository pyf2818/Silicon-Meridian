/**
 * semanticCluster.test.js - 验证语义聚类模块核心逻辑（离线、确定性）
 *
 * 不依赖任何 embedding 供应商：用"字符 n-gram 哈希"生成确定性向量，
 * 证明 cosine + greedyCluster 能正确合并近义/重复、分离不相关项。
 */
import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  greedyCluster,
  clusterByEmbeddings,
} from '../semanticCluster.js';

/** 极简确定性 embedding：字符二元组计数向量（仅用于单测，非真实语义） */
function ngramEmbed(text, dim = 53) {
  const vec = new Array(dim).fill(0);
  const t = String(text).toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i < t.length - 1; i += 1) {
    const code = (t.charCodeAt(i) * 31 + t.charCodeAt(i + 1)) % dim;
    vec[code] += 1;
  }
  return vec;
}

describe('cosineSimilarity', () => {
  it('相同向量 = 1', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });
  it('正交向量 = 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('空向量返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
  it('长度不一致返回 0', () => {
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});

describe('greedyCluster', () => {
  it('相似项连通、不相关项分离', () => {
    const items = ['alpha beta', 'alpha beta gamma', 'xxxx yyyy'];
    const embs = items.map((t) => ngramEmbed(t));
    const sim = (i, j) => cosineSimilarity(embs[i], embs[j]);
    const groups = greedyCluster(items, sim, { threshold: 0.3 });
    // 前两篇共享大量字符 → 一簇；第三篇独立 → 另一簇
    expect(groups.length).toBe(2);
    const big = groups.find((g) => g.length === 2);
    expect(big).toBeTruthy();
  });

  it('阈值过高时不合并', () => {
    const items = ['apple', 'apple pie', 'banana'];
    const embs = items.map((t) => ngramEmbed(t));
    const sim = (i, j) => cosineSimilarity(embs[i], embs[j]);
    const groups = greedyCluster(items, sim, { threshold: 0.99 });
    expect(groups.length).toBe(3);
  });

  it('空输入返回空', () => {
    expect(greedyCluster([], () => 0)).toEqual([]);
  });
});

describe('clusterByEmbeddings', () => {
  const items = [
    { id: '1', title: 'AI chip export controls', source: 'Reuters', publishedAt: '2026-08-11T08:00:00Z', mustReadScore: 80 },
    { id: '2', title: 'AI chip export controls', source: 'Bloomberg', publishedAt: '2026-08-11T09:00:00Z', mustReadScore: 70 },
    { id: '3', title: 'Football match result', source: 'Sports', publishedAt: '2026-08-11T10:00:00Z', mustReadScore: 20 },
  ];

  it('返回同形状簇对象，且能按相似度合并重复', () => {
    const embs = items.map((it) => ngramEmbed(it.title));
    const clusters = clusterByEmbeddings(items, embs, { threshold: 0.85 });
    // 1 和 2 标题相同 → 一簇；3 独立 → 一簇
    expect(clusters.length).toBe(2);
    const dup = clusters.find((c) => c.itemIds.length === 2);
    expect(dup).toBeTruthy();
    expect(dup.independentSources.sort()).toEqual(['Bloomberg', 'Reuters']);
    // 输出形状与 clusterEvents 对齐
    expect(dup).toHaveProperty('primaryItem');
    expect(dup).toHaveProperty('items');
    expect(dup).toHaveProperty('independentSourceCount');
    expect(dup.method).toBe('semantic');
  });

  it('primaryItem 取 mustReadScore 最高者', () => {
    const embs = items.map((it) => ngramEmbed(it.title));
    const clusters = clusterByEmbeddings(items, embs, { threshold: 0.85 });
    const dup = clusters.find((c) => c.itemIds.length === 2);
    expect(dup.primaryItem.id).toBe('1'); // mustReadScore 80 > 70
  });
});
