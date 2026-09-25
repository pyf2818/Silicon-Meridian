import { describe, it, expect } from 'vitest';

const {
  selectForDistill, buildDistilledSummary, groupForBatch, runMemoryDistill,
} = await import('../memoryDistillService.js');

const NOW = new Date('2026-09-25T12:00:00Z');

const mk = (id, daysAgo, { hitCount = 0, topic = 't' } = {}) => ({
  id,
  content: `记忆内容 ${id}`,
  topic,
  hitCount,
  lastAccessedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
});

describe('memoryDistillService（记忆蒸馏）', () => {
  it('selectForDistill：仅选 30 天前未访问、未被保留、未蒸馏过的记忆', () => {
    const rows = [
      mk('fresh', 1),
      mk('stale-a', 60),
      mk('stale-b', 90),
      mk('hot-stale', 120, { hitCount: 10 }),
      mk('kept', 60),
      mk('done', 60),
    ];
    const picked = selectForDistill(rows, {
      now: NOW, keepIds: ['kept'], alreadyDistilledIds: ['done'],
    });
    const ids = picked.map(m => m.id).sort();
    // hot-stale 是 hitCount 最高者 → 被保护不蒸馏
    expect(ids).toEqual(['stale-a', 'stale-b']);
  });

  it('selectForDistill：缺时间戳的记忆不选（保守策略）', () => {
    const picked = selectForDistill([{ id: 'x', content: 'c' }], { now: NOW });
    expect(picked).toHaveLength(0);
  });

  it('buildDistilledSummary：按主题聚类、去重、截断，输出确定性文本', () => {
    const rows = [
      { id: '1', topic: '部署', content: '用 docker compose 部署' },
      { id: '2', topic: '部署', content: '用 docker compose 部署' }, // 重复 → 去重
      { id: '3', topic: '部署', content: '端口 8766' },
      { id: '4', topic: '偏好', content: '表格输出' },
    ];
    const out = buildDistilledSummary(rows);
    expect(out.count).toBe(4);
    expect(out.topics[0].topic).toBe('部署'); // 大簇在前
    expect(out.topics[0].points).toEqual(['用 docker compose 部署', '端口 8766']);
    expect(out.text).toContain('【部署】');
    expect(out.text).toContain('【偏好】');
  });

  it('buildDistilledSummary：空输入 → 空摘要', () => {
    expect(buildDistilledSummary([]).text).toBe('');
    expect(buildDistilledSummary([]).count).toBe(0);
  });

  it('groupForBatch：批次切分且 batchSize 下限 1', () => {
    expect(groupForBatch([1, 2, 3, 4, 5], { batchSize: 2 })).toEqual([[1, 2], [3, 4], [5]]);
    expect(groupForBatch([1, 2], { batchSize: 0 })).toEqual([[1], [2]]);
  });

  it('runMemoryDistill：repository 未接线 → skipped 不崩（cron 安全）', async () => {
    const r = await runMemoryDistill({});
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it('runMemoryDistill：端到端——选蒸馏 → 分批 → saveDistilled 写回', async () => {
    const rows = [
      mk('s1', 60, { topic: '部署' }),
      mk('s2', 60, { topic: '部署' }),
      mk('s3', 60, { topic: '偏好' }),
      mk('fresh', 2),
    ];
    const saved = [];
    const repo = {
      listMemories: async () => rows,
      saveDistilled: async (payload) => { saved.push(payload); },
    };
    const r = await runMemoryDistill({ repository: repo, now: NOW, staleDays: 30 });
    expect(r.ok).toBe(true);
    expect(r.distilled).toBe(3);
    expect(r.batches).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].sourceIds.sort()).toEqual(['s1', 's2', 's3']);
    expect(saved[0].summary.text).toContain('【部署】');
  });

  it('runMemoryDistill：无可蒸馏 → distilled 0', async () => {
    const repo = { listMemories: async () => [mk('f', 1)] };
    const r = await runMemoryDistill({ repository: repo, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.distilled).toBe(0);
  });
});
