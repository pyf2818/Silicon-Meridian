/**
 * memoryDistillService.js - 跨会话记忆蒸馏（对齐 WorkBuddy 三层记忆的蒸馏语义）
 *
 * 形态裁决（批 8）：
 * - 当前实现为「规则式抽取蒸馏」：选取长期未访问的低热记忆 → 去重归并 → 生成要点摘要。
 *   可跑、可测、无外部依赖；LLM 语义蒸馏（真摘要）为后续增强方向（注入 llmFn 即可切换，
 *   策略与批次逻辑复用本模块），不在本轮实现。
 * - 幂等防重：distilled 标记写回由调用方（repository 层）持久化，本模块保证同一输入
 *   在标记生效后不再被选中（seenIds 过滤）。
 * - 纯逻辑与 IO 分离：selectForDistill / buildDistilledSummary 均为纯函数，直接单测。
 */

/** 蒸馏候选：lastAccessed 超过 staleDays 且不在 keepIds（近期高热/置顶）中 */
export function selectForDistill(memories = [], {
  now = new Date(), staleDays = 30, keepIds = [], alreadyDistilledIds = [], maxKeepByHits = 3,
} = {}) {
  const list = Array.isArray(memories) ? memories : [];
  const keep = new Set(keepIds);
  const done = new Set(alreadyDistilledIds);
  const cutoff = now.getTime() - staleDays * 86_400_000;

  const candidates = list.filter(m => {
    if (!m || typeof m !== 'object') return false;
    if (done.has(m.id)) return false;
    if (keep.has(m.id)) return false;
    const accessed = m.lastAccessedAt || m.updatedAt || m.createdAt;
    const t = accessed ? new Date(accessed).getTime() : NaN;
    return Number.isFinite(t) && t < cutoff;
  });

  // 保留访问频次最高的 maxKeepByHits 条（陈旧但曾被高频使用 → 可能是长期事实，不蒸馏）。
  // 仅保护 hitCount > 0 的记忆：全零情况下（从未被访问统计）不应把候选全部保护掉。
  const sorted = [...candidates]
    .filter(m => (Number(m.hitCount) || 0) > 0)
    .sort((a, b) => (Number(b.hitCount) || 0) - (Number(a.hitCount) || 0));
  const protectedIds = new Set(sorted.slice(0, maxKeepByHits).map(m => m.id));

  return candidates.filter(m => !protectedIds.has(m.id));
}

/** 规则式蒸馏：按主题聚类 → 每簇取要点 → 输出结构化摘要（可测的确定性输出） */
export function buildDistilledSummary(memories = [], { maxPoints = 12, maxCharsPerPoint = 120 } = {}) {
  const list = (Array.isArray(memories) ? memories : []).filter(m => m && typeof m === 'object');
  if (list.length === 0) return { topics: [], text: '', count: 0 };

  // 主题键：显式 topic > memoryType > 'general'
  const byTopic = new Map();
  for (const m of list) {
    const key = String(m.topic || m.memoryType || 'general').slice(0, 50);
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(m);
  }

  const topics = [];
  for (const [topic, items] of byTopic) {
    // 每簇取前 N 条要点：content 截断 + 去重
    const seen = new Set();
    const points = [];
    for (const m of items) {
      const content = String(m.content || '').trim().slice(0, maxCharsPerPoint);
      if (!content || seen.has(content)) continue;
      seen.add(content);
      points.push(content);
      if (points.length >= 5) break;
    }
    if (points.length) topics.push({ topic, points, count: items.length });
  }

  // 按簇规模降序（大簇优先保留）
  topics.sort((a, b) => b.count - a.count);
  const trimmed = topics.slice(0, maxPoints);

  const text = trimmed
    .map(t => `【${t.topic}】${t.points.join('；')}`)
    .join('\n');

  return { topics: trimmed, text, count: list.length };
}

/** 批次切分：蒸馏一次调用处理的记忆条数上限（防止单次 payload 过大） */
export function groupForBatch(memories = [], { batchSize = 20 } = {}) {
  // batchSize=0 / 负数 / 非有限数字：undefined 与 NaN 回退默认 20，数字一律钳到 ≥1
  const n = Math.trunc(Number(batchSize));
  const size = Number.isFinite(n) ? Math.max(1, n) : 20;
  const list = Array.isArray(memories) ? memories : [];
  const batches = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches;
}

/**
 * cron 入口：跑一轮蒸馏（IO 壳）。
 * repository 契约：{ listMemories(): rows, saveDistilled({ userId, summary, sourceIds }) }
 * 当前服务端记忆仓储为 agent_memories（fetchRelevantMemories 读路径）；
 * 写路径接线属于仓储层增强，本入口在 repository 未提供时直接跳过（不报错不崩）。
 */
export async function runMemoryDistill({ repository, options = {} } = {}) {
  if (!repository || typeof repository.listMemories !== 'function') {
    return { ok: false, skipped: true, reason: 'repository not wired' };
  }
  const rows = await repository.listMemories();
  const selected = selectForDistill(rows, options);
  if (selected.length === 0) return { ok: true, distilled: 0, batches: 0 };

  const batches = groupForBatch(selected, options);
  let distilled = 0;
  for (const batch of batches) {
    const summary = buildDistilledSummary(batch, options);
    if (!summary.text) continue;
    if (typeof repository.saveDistilled === 'function') {
      await repository.saveDistilled({ summary, sourceIds: batch.map(m => m.id) });
      distilled += batch.length;
    }
  }
  return { ok: true, distilled, batches: batches.length };
}
