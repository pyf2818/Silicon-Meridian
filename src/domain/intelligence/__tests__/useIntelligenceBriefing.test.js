import { describe, it, expect } from 'vitest';
import { buildLocalEmbeddings } from '../../../hooks/useIntelligenceBriefing.js';
import { cosineSimilarity } from '../semanticCluster.js';

describe('useIntelligenceBriefing - buildLocalEmbeddings (浏览器端本地 embedding)', () => {
  it('产出等长的单位向量', () => {
    const vecs = buildLocalEmbeddings([
      'OpenAI 发布 GPT-5 多模态模型',
      '欧盟通过 AI 法案补充条款',
    ]);
    expect(vecs).toHaveLength(2);
    vecs.forEach((v) => {
      expect(v.length).toBe(vecs[0].length);
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 5);
    });
  });

  it('同事件改写对的余弦相似度高于无关文本', () => {
    const texts = [
      'OpenAI 发布 GPT-5 多模态模型',
      'OpenAI 推出 GPT-5 支持图像与语音', // 同事件改写
      '半导体工厂因停电停产',               // 无关
    ];
    const [vA, vB, vC] = buildLocalEmbeddings(texts);
    const sameEvent = cosineSimilarity(vA, vB);
    const unrelated = cosineSimilarity(vA, vC);
    expect(sameEvent).toBeGreaterThan(unrelated);
    expect(sameEvent).toBeGreaterThan(0.3);
  });
});
