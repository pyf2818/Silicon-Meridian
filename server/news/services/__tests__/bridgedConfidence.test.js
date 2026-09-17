import { describe, it, expect } from 'vitest';
import { enrichItem, crossVerifyItems } from '../newsService.js';
import { BRIDGED_WEIGHT_FACTOR, SOURCE_WEIGHTS } from '../../config/constants.js';

const base = (over = {}) => ({
  source: '新智元',
  url: 'https://example.com/a',
  title: '测试标题',
  publishedAt: '2026-09-09T00:00:00Z',
  ...over,
});

describe('桥接源置信度（Batch1）', () => {
  it('enrichItem 给桥接源盖章 item.bridged=true', () => {
    expect(enrichItem(base()).bridged).toBe(true);
  });

  it('enrichItem 直连源与未知源 bridged=false', () => {
    expect(enrichItem(base({ source: '量子位' })).bridged).toBe(false);
    expect(enrichItem(base({ source: '不存在的源' })).bridged).toBe(false);
  });

  it('enrichItem 内容等级不受桥接影响（等级来自既有 GRADE_MAP）', () => {
    const item = enrichItem(base());
    expect(item.sourceGradeLabel).toBeTruthy();
    expect(item.bridged).toBe(true);
  });

  it('crossVerifyItems：单条桥接源 qualityScore 按 BRIDGED_WEIGHT_FACTOR 折扣', () => {
    const w = SOURCE_WEIGHTS['新智元'];
    expect(w).toBeGreaterThan(0);
    const [out] = crossVerifyItems([enrichItem(base())]);
    expect(out.crossVerifyScore).toBe(1);
    expect(out.sourceWeight).toBe(w); // 内容权重原样保留
    expect(out.qualityScore).toBe(Math.round(1 * w * BRIDGED_WEIGHT_FACTOR * 10) / 10);
  });

  it('crossVerifyItems：未盖章（直连）item 不受折扣影响', () => {
    const w = SOURCE_WEIGHTS['AIHOT 精选摘要'];
    const [out] = crossVerifyItems([base({ source: 'AIHOT 精选摘要' })]);
    expect(out.bridged).toBeUndefined();
    expect(out.qualityScore).toBe(Math.round(1 * w * 10) / 10);
  });

  it('多源同 URL 高可信：桥接组 = 直连组 × 折扣系数', () => {
    const url = 'https://example.com/same-story';
    const names = ['新智元', 'AI 前线', 'PaperWeekly'];
    const items = names.map((source) => enrichItem(base({ source, url })));
    const group = crossVerifyItems(items);
    for (const item of group) expect(item.crossVerifyScore).toBe(3);
    const w0 = SOURCE_WEIGHTS[names[0]];
    expect(group[0].qualityScore).toBe(Math.round(3 * w0 * BRIDGED_WEIGHT_FACTOR * 10) / 10);
  });

  it('缺少原文 URL 的条目不因共享空值获得交叉验证分', () => {
    const items = [
      base({ url: '', source: '源A' }),
      base({ url: '', source: '源B' }),
    ];
    const group = crossVerifyItems(items);
    expect(group.map(item => item.crossVerifyScore)).toEqual([0, 0]);
    expect(group.map(item => item.qualityScore)).toEqual([0, 0]);
  });

  it('同一来源重复条目不计作多个独立来源', () => {
    const items = [
      base({ url: 'https://example.com/dup', source: '同一媒体' }),
      base({ url: 'https://example.com/dup', source: '同一媒体' }),
    ];
    expect(crossVerifyItems(items).map(item => item.crossVerifyScore)).toEqual([1, 1]);
  });

  it('合并脏来源数据时跳过缺失标题和非对象条目', async () => {
    const { mergeDiverseItems } = await import('../newsService.js');
    const result = mergeDiverseItems([
      null,
      { source: 'A', title: null, url: 'https://example.com/bad' },
      { source: 'A', title: '  Valid title  ', url: 'https://example.com/good' },
    ], [], 10, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: 'A', title: 'Valid title' });
  });
});
