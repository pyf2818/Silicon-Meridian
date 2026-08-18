import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  saveFrontendAiAnalysis,
  getSnapshotByDate,
  insertSnapshot,
} from '../memorySnapshotRepository.js';
import { snapshots, snapshotLists } from '../../db/devMemoryStore.js';

describe('memorySnapshotRepository - 前端分析写透传（快照对账）', () => {
  beforeEach(() => {
    process.env.DEV_MEMORY_AUTH = 'true';
    snapshots.clear();
    snapshotLists.clear();
  });
  afterEach(() => {
    delete process.env.DEV_MEMORY_AUTH;
  });

  it('当日无快照：创建 algorithmVersion=0 占位行（preheat 会识别并补全）', async () => {
    const result = await saveFrontendAiAnalysis({
      userId: 'u1',
      date: '2026-08-19',
      aiPayload: { frontend: true, model: 'gpt-x', analysis: { summary: 'ok' } },
    });
    expect(result.snapshotId).toBeTruthy();
    const snap = await getSnapshotByDate('u1', '2026-08-19');
    expect(snap.algorithmVersion).toBe(0);
    expect(snap.aiStatus).toBe('frontend-saved');
    expect(snap.aiPayload.frontend).toBe(true);
    expect(snap.aiPayload.analysis.summary).toBe('ok');
  });

  it('已有 aiPayload：首份权威不覆盖（kept=true）', async () => {
    await saveFrontendAiAnalysis({
      userId: 'u1',
      date: '2026-08-19',
      aiPayload: { frontend: true, model: 'first', analysis: { v: 1 } },
    });
    const second = await saveFrontendAiAnalysis({
      userId: 'u1',
      date: '2026-08-19',
      aiPayload: { frontend: true, model: 'second', analysis: { v: 2 } },
    });
    expect(second.kept).toBe(true);
    const snap = await getSnapshotByDate('u1', '2026-08-19');
    expect(snap.aiPayload.model).toBe('first');
  });

  it('已有快照但无 aiPayload：写入分析且不动其余字段', async () => {
    await insertSnapshot({
      userId: 'u1',
      date: '2026-08-19',
      algorithmVersion: 2,
      lanes: { public: [], personal: [] },
      algorithmPayload: { oneLine: 'algo' },
      aiStatus: 'not_requested',
    });
    const result = await saveFrontendAiAnalysis({
      userId: 'u1',
      date: '2026-08-19',
      aiPayload: { frontend: true, model: 'm', analysis: { v: 1 } },
    });
    expect(result.kept).toBeUndefined();
    const snap = await getSnapshotByDate('u1', '2026-08-19');
    expect(snap.algorithmVersion).toBe(2);
    expect(snap.algorithmPayload.oneLine).toBe('algo');
    expect(snap.aiPayload.frontend).toBe(true);
    expect(snap.aiStatus).toBe('frontend-saved');
  });

  it('preheat 补全（insertSnapshot）：无 AI 产物时保留前端分析', async () => {
    await saveFrontendAiAnalysis({
      userId: 'u1',
      date: '2026-08-19',
      aiPayload: { frontend: true, model: 'm', analysis: { v: 1 } },
    });
    // preheat 跑完但 LLM 未配置（aiPayload=null, aiStatus='not_requested'）→ 前端分析保留
    await insertSnapshot({
      userId: 'u1',
      date: '2026-08-19',
      algorithmVersion: 2,
      lanes: { public: [], personal: [] },
      algorithmPayload: { oneLine: 'algo' },
      aiPayload: null,
      aiStatus: 'not_requested',
    });
    const snap = await getSnapshotByDate('u1', '2026-08-19');
    expect(snap.algorithmVersion).toBe(2);
    expect(snap.aiPayload.frontend).toBe(true);
    expect(snap.aiStatus).toBe('frontend-saved');
  });

  it('preheat 生成了自己的 AI 产物：以 preheat 为准（定时任务为权威）', async () => {
    await saveFrontendAiAnalysis({
      userId: 'u1',
      date: '2026-08-19',
      aiPayload: { frontend: true, model: 'm', analysis: { v: 1 } },
    });
    await insertSnapshot({
      userId: 'u1',
      date: '2026-08-19',
      algorithmVersion: 2,
      lanes: { public: [], personal: [] },
      algorithmPayload: { oneLine: 'algo' },
      aiPayload: { citationIds: ['x'], content: 'server' },
      aiStatus: 'merged',
    });
    const snap = await getSnapshotByDate('u1', '2026-08-19');
    expect(snap.aiPayload.content).toBe('server');
    expect(snap.aiStatus).toBe('merged');
  });
});
