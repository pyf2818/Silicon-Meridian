import { describe, expect, it } from 'vitest';
import {
  affinitySignal,
  behaviorSignal,
  corroborationSignal,
  depthSignal,
  freshnessSignal,
  hygieneSignal,
  sourceTrustSignal,
  velocitySignal,
} from '../signals.js';
import { HALF_LIFE_MS } from '../halfLife.js';

const NOW = Date.parse('2026-09-17T00:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3_600_000).toISOString();

describe('freshness', () => {
  it('新鲜且有真实发布时间 → 满衰减曲线 + 高置信', () => {
    const s = freshnessSignal({ publishedAt: hoursAgo(1) }, { now: NOW });
    expect(s.confidence).toBe(1);
    expect(s.value).toBeCloseTo(Math.pow(0.5, 1 / 18), 2);
  });

  it('旧闻按 18h 半衰衰减到低值但不为 0（长尾可见性）', () => {
    const s = freshnessSignal({ publishedAt: hoursAgo(72) }, { now: NOW });
    expect(s.value).toBeGreaterThan(HALF_LIFE_MS.freshness ? 0.05 : 0);
    expect(s.value).toBeLessThan(0.2);
  });

  it('估计时间（信源没给日期）→ 用入库时间代理，置信减半', () => {
    const s = freshnessSignal({ publishedAt: null, publishedAtEstimated: true, fetchedAt: hoursAgo(1) }, { now: NOW });
    expect(s.confidence).toBe(0.5);
    expect(s.value).toBeCloseTo(Math.pow(0.5, 1 / 18), 2);
    expect(s.reason).toContain('未提供发布时间');
  });

  it('未来时间 → 几乎不可信', () => {
    const s = freshnessSignal({ publishedAt: new Date(NOW + 10 * 3_600_000).toISOString() }, { now: NOW });
    expect(s.value).toBe(0);
    expect(s.confidence).toBeLessThan(0.3);
  });

  it('什么时间都没有 → 退出打分', () => {
    expect(freshnessSignal({}, { now: NOW }).confidence).toBe(0);
  });
});

describe('corroboration / sourceTrust', () => {
  it('独立来源数归一（4 个源满分）', () => {
    expect(corroborationSignal({ independentSourceCount: 1 }).value).toBe(0.25);
    expect(corroborationSignal({ independentSourceCount: 4 }).value).toBe(1);
    expect(corroborationSignal({ independentSourceCount: 9 }).value).toBe(1);
    expect(corroborationSignal({ independentSourceCount: 0 }).value).toBe(0);
  });

  it('源权重 0.5~1.0 归一到 0~1，桥接打折', () => {
    expect(sourceTrustSignal({ sourceWeight: 1 }).value).toBe(1);
    expect(sourceTrustSignal({ sourceWeight: 0.75 }).value).toBe(0.5);
    expect(sourceTrustSignal({ sourceWeight: 1, bridged: true }).value).toBeCloseTo(0.85);
  });
});

describe('velocity（热度斜率）', () => {
  it('1 小时扩散到 3 源 → 满热度（3/h ≥ 满分速率 2/h）', () => {
    const s = velocitySignal({}, { now: NOW, cluster: { independentSourceCount: 3, firstSeenAt: hoursAgo(1) } });
    expect(s.value).toBe(1);
    expect(s.reason).toContain('3 个独立源');
  });

  it('同样的源数拖了 12 小时 → 斜率自然下降（0.25/h）', () => {
    const hot = velocitySignal({}, { now: NOW, cluster: { independentSourceCount: 3, firstSeenAt: hoursAgo(1) } });
    const cold = velocitySignal({}, { now: NOW, cluster: { independentSourceCount: 3, firstSeenAt: hoursAgo(12) } });
    expect(cold.value).toBeLessThan(hot.value);
    expect(cold.value).toBeCloseTo(0.125, 2);   // 3源/12h = 0.25/h → 0.25/2 = 0.125
  });

  it('没有聚类数据 → 退出打分（不虚报热度）', () => {
    expect(velocitySignal({}, { now: NOW, cluster: null }).confidence).toBe(0);
    expect(velocitySignal({}, { now: NOW, cluster: { independentSourceCount: 0, firstSeenAt: hoursAgo(1) } }).confidence).toBe(0);
  });
});

describe('depth / hygiene / affinity / behavior', () => {
  it('占位摘要 = 没内容', () => {
    const s = depthSignal({ summary: '暂无摘要，请前往原文查看完整内容。' });
    expect(s.value).toBe(0);
    expect(s.reason).toContain('无可读摘要');
  });

  it('摘要长度归一（300 字满分）', () => {
    expect(depthSignal({ summary: '字'.repeat(150) }).value).toBe(0.5);
    expect(depthSignal({ summary: '字'.repeat(400) }).value).toBe(1);
  });

  it('正常标题满分；营销套路降分但不删内容', () => {
    expect(hygieneSignal({ title: 'OpenAI 发布新一代推理模型' }).value).toBe(1);
    const spam = hygieneSignal({ title: '突发！！震惊业界' });
    expect(spam.value).toBeLessThan(1);
    expect(spam.value).toBeGreaterThanOrEqual(0.5);
  });

  it('未配置画像 → 退出打分（公共版不因画像缺位而降分）', () => {
    expect(affinitySignal({ personalScore: 90 }, { hasProfile: false }).confidence).toBe(0);
    expect(affinitySignal({ personalScore: 80 }, { hasProfile: true }).value).toBe(0.8);
  });

  it('行为反馈：收藏/忽略/无记录', () => {
    expect(behaviorSignal({ id: 'a' }, { feedback: { a: 'favorited' } }).value).toBe(1);
    expect(behaviorSignal({ id: 'a' }, { feedback: { a: 'ignored' } }).value).toBe(0);
    expect(behaviorSignal({ id: 'a' }, { feedback: null }).confidence).toBe(0);
  });
});
