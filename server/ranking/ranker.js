/**
 * 排序内核：把信号按策略权重合成一个 0-100 的可解释分数。
 *
 * 设计要点：
 *   - **confidence 参与归一**：score = 100 × Σ(w·v·c) / Σ(w·c)。
 *     「没有数据的信号」(c=0) 自然退出，既不拉低也不虚高总分——
 *     这是「估计时间」「无画像」「无聚类」条目能公平参与排序的关键。
 *   - 全程产出 rankParts（每信号的价值/权重/置信/理由），卡片可解释。
 *   - 同分 tie-break 走 compareByRecency（估计时间沉底），再按 id 保证完全确定。
 */
import { SIGNAL_DEFS } from './signals.js';
import { POLICY_VERSION, policyFor, validatePolicy } from './policy.js';
import { clamp01 } from './halfLife.js';
import { compareByRecency } from '../news/utils/dateUtils.js';

export const RANKER_VERSION = 'ranker-v2.1';

/** 单条打分（纯函数；`now` 必须注入以保证可测与稳定） */
export function rankItem(item = {}, options = {}) {
  const { lane = 'public', now = Date.now(), cluster = null, feedback = null, hasProfile = false } = options;
  const policy = policyFor(lane);

  const parts = [];
  let numerator = 0;
  let denominator = 0;
  for (const { id, fn } of SIGNAL_DEFS) {
    const weight = policy[id] ?? 0;
    if (weight <= 0) continue;
    const { value, confidence, reason } = fn(item, { now, cluster, feedback, hasProfile });
    const v = clamp01(value);
    const c = clamp01(confidence);
    numerator += weight * v * c;
    denominator += weight * c;
    parts.push({ id, value: Math.round(v * 100) / 100, weight, confidence: Math.round(c * 100) / 100, reason });
  }

  return {
    rankScore: denominator > 0 ? Math.round((100 * numerator) / denominator) : 0,
    rankVersion: RANKER_VERSION,
    policyVersion: POLICY_VERSION,
    rankLane: lane,
    rankParts: parts,
  };
}

/**
 * 批量打分并排序。返回**新数组**（不改入参）。
 * 非生产环境对策略硬红线自检一次（每批一次，避免逐条刷日志）。
 */
export function rankItems(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const { lane = 'public' } = options;
  if (process.env.NODE_ENV !== 'production' && !validatePolicy(policyFor(lane))) {
    console.warn(`[ranker] lane "${lane}" 的策略突破事件价值红线 (EVENT_VALUE_FLOOR_RATIO)`);
  }
  return list
    .map(item => ({ ...item, ...rankItem(item, options) }))
    .sort((a, b) =>
      (b.rankScore - a.rankScore)
      || compareByRecency(a, b)
      || String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

/**
 * 影子模式对比：新排序 vs 旧排序的 TOP-N 重合度与升降级清单。
 * 供 scripts/quality-report.mjs 使用——切换默认排序前，先用它拿数据。
 */
export function compareOrders(legacyOrder = [], nextOrder = [], { topN = 10 } = {}) {
  const keyOf = item => String(item?.id ?? '');
  const legacyTop = legacyOrder.slice(0, topN).map(keyOf);
  const nextTop = nextOrder.slice(0, topN).map(keyOf);
  const legacySet = new Set(legacyTop);
  const nextSet = new Set(nextTop);
  const nextRankById = new Map(nextOrder.map((item, index) => [keyOf(item), index]));
  const legacyRankById = new Map(legacyOrder.map((item, index) => [keyOf(item), index]));

  const promoted = nextOrder
    .filter(item => (legacyRankById.get(keyOf(item)) ?? Infinity) - (nextRankById.get(keyOf(item)) ?? 0) >= topN)
    .slice(0, 5)
    .map(item => ({ id: keyOf(item), title: String(item.title || '').slice(0, 50), rankScore: item.rankScore }));
  const demoted = legacyOrder
    .filter(item => (legacyRankById.get(keyOf(item)) ?? 0) - (nextRankById.get(keyOf(item)) ?? Infinity) >= topN)
    .slice(0, 5)
    .map(item => ({ id: keyOf(item), title: String(item.title || '').slice(0, 50), rankScore: nextRankById.has(keyOf(item)) ? nextOrder[nextRankById.get(keyOf(item))].rankScore : null }));

  return {
    topN,
    overlapCount: nextTop.filter(id => legacySet.has(id)).length,
    promoted,
    demoted,
  };
}
