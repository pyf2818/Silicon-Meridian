import { describe, it, expect } from 'vitest';
import { createMemoryStorage, createSnapshotStore } from '../snapshotStore.js';
import {
  topicMatch,
  topicKey,
  shiftDate,
  diffDigests,
  digestFromBriefing,
  saveDailyDigest,
  buildBriefingEvolution,
} from '../briefingEvolution.js';

describe('briefingEvolution - topicMatch', () => {
  it('同事件改写（中文）判为同一事件', () => {
    expect(topicMatch('OpenAI 发布 GPT-5 多模态模型', 'OpenAI 推出 GPT-5 支持图像与语音')).toBe(true);
    expect(topicMatch('欧盟通过 AI 法案补充条款', '欧盟 AI 法案新增高风险模型审查要求')).toBe(true);
  });

  it('不同事件判为不同', () => {
    expect(topicMatch('半导体工厂因停电停产', '国产大模型厂商公布最新开源权重')).toBe(false);
    expect(topicMatch('AI 模型 X', 'AI 模型 Y')).toBe(false); // 仅靠通用词，不应误匹配
  });

  it('空标题安全返回 false', () => {
    expect(topicMatch('', '某事件')).toBe(false);
    expect(topicMatch('', '')).toBe(false);
  });

  it('topicKey 取拉丁/数字专名', () => {
    expect(topicKey('OpenAI 发布 GPT-5 多模态模型')).toContain('openai');
    expect(topicKey('欧盟通过 AI 法案补充条款')).toBe(''); // 无足够拉丁专名
  });
});

describe('briefingEvolution - shiftDate', () => {
  it('按 UTC 平移天数，跨月正确', () => {
    expect(shiftDate('2026-08-12', -1)).toBe('2026-08-11');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('非法输入原样返回', () => {
    expect(shiftDate('not-a-date', -1)).toBe('not-a-date');
  });
});

describe('briefingEvolution - diffDigests', () => {
  const yest = { topics: [
    { key: 'a', title: 'OpenAI 发布 GPT-5 多模态模型', sourceCount: 3 },
    { key: 'b', title: '欧盟通过 AI 法案补充条款', sourceCount: 2 },
    { key: 'c', title: '半导体工厂因停电停产', sourceCount: 1 },
  ] };
  const today = { topics: [
    { key: 'a2', title: 'OpenAI 推出 GPT-5 支持图像与语音', sourceCount: 4 },
    { key: 'b2', title: '欧盟 AI 法案新增高风险模型审查要求', sourceCount: 2 },
    { key: 'd', title: '国产大模型厂商公布最新开源权重', sourceCount: 1 },
  ] };

  it('产出 持续/新增/已消退 三段', () => {
    const { ongoing, added, resolved } = diffDigests(yest, today);
    expect(ongoing.map((o) => o.title)).toEqual([
      'OpenAI 推出 GPT-5 支持图像与语音',
      '欧盟 AI 法案新增高风险模型审查要求',
    ]);
    expect(added.map((t) => t.title)).toEqual(['国产大模型厂商公布最新开源权重']);
    expect(resolved.map((r) => r.title)).toEqual(['半导体工厂因停电停产']);
  });

  it('空前日返回全新增', () => {
    const { ongoing, added, resolved } = diffDigests(null, today);
    expect(ongoing).toHaveLength(0);
    expect(resolved).toHaveLength(0);
    expect(added).toHaveLength(3);
  });
});

describe('briefingEvolution - digestFromBriefing', () => {
  it('兼容 agenticBriefing（.clusters）', () => {
    const digest = digestFromBriefing({
      date: '2026-08-12',
      clusters: [{ clusterId: 'e1', primaryTitle: '事件一', sourceCount: 2, itemIds: ['x', 'y'] }],
    });
    expect(digest.date).toBe('2026-08-12');
    expect(digest.topics[0]).toMatchObject({ key: 'e1', title: '事件一', sourceCount: 2 });
  });

  it('兼容 briefingEngine（.sections）', () => {
    const digest = digestFromBriefing({
      date: '2026-08-12',
      sections: { lead: { id: 'l1', title: '头条' }, public: [{ id: 'p1', title: '公域' }] },
    });
    expect(digest.topics.map((t) => t.title)).toEqual(['头条', '公域']);
  });
});

describe('briefingEvolution - 端到端（内存快照）', () => {
  it('读前日快照并生成演化段与 narrative', () => {
    const store = createSnapshotStore(createMemoryStorage());
    const day1 = {
      date: '2026-08-11',
      clusters: [
        { clusterId: 'e1', primaryTitle: 'OpenAI 发布 GPT-5 多模态模型', sourceCount: 3 },
        { clusterId: 'e2', primaryTitle: '欧盟通过 AI 法案补充条款', sourceCount: 2 },
      ],
    };
    const day2 = {
      date: '2026-08-12',
      clusters: [
        { clusterId: 'e1b', primaryTitle: 'OpenAI 推出 GPT-5 支持图像与语音', sourceCount: 4 },
        { clusterId: 'e2b', primaryTitle: '欧盟 AI 法案新增高风险模型审查要求', sourceCount: 2 },
        { clusterId: 'e3', primaryTitle: '国产大模型厂商公布最新开源权重', sourceCount: 1 },
      ],
    };
    saveDailyDigest(store, digestFromBriefing(day1));
    saveDailyDigest(store, digestFromBriefing(day2));

    const evo = buildBriefingEvolution({
      store,
      todayDigest: digestFromBriefing(day2),
      todayDate: '2026-08-12',
      lookbackDays: 1,
    });

    expect(evo.hasPrevious).toBe(true);
    expect(evo.prevDate).toBe('2026-08-11');
    expect(evo.ongoing).toHaveLength(2);
    expect(evo.added).toHaveLength(1);
    expect(evo.resolved).toHaveLength(0);
    expect(evo.narrative).toContain('持续演进');
  });

  it('无前日快照时 hasPrevious=false', () => {
    const store = createSnapshotStore(createMemoryStorage());
    const day2 = { date: '2026-08-12', clusters: [{ clusterId: 'e3', primaryTitle: '国产大模型', sourceCount: 1 }] };
    const evo = buildBriefingEvolution({ store, todayDigest: digestFromBriefing(day2), todayDate: '2026-08-12' });
    expect(evo.hasPrevious).toBe(false);
    expect(evo.ongoing).toHaveLength(0);
    expect(evo.added).toHaveLength(1);
  });

  it('saveDailyDigest 缺 date 抛错', () => {
    const store = createSnapshotStore(createMemoryStorage());
    expect(() => saveDailyDigest(store, { topics: [] })).toThrow(/date/);
  });
});
