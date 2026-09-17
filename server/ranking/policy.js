/**
 * 策略层：**纯数据配置**。调参只动这张表，不碰 signals.js / ranker.js 的逻辑。
 *
 * 权重含义：signal 的加权平均分母按 confidence 归一（见 ranker.js），
 * 所以"没有数据的信号"（confidence=0）会自然退出，不会拉低总分。
 *
 * lane 语义：
 *   - public   公共热点版：事件本身的价值优先，画像不参与（affinity=0）
 *   - personal 个人必看版：画像与行为参与，但仍保留事件价值为主体
 *   关键约束：任何 lane 里「事件价值类信号（freshness+corroboration+sourceTrust）」
 *   的总权重不得低于 50% —— 这是防止信息茧房的硬红线。
 */
export const POLICY_VERSION = 1;

export const LANES = Object.freeze({
  public: Object.freeze({
    freshness: 22,
    corroboration: 26,
    sourceTrust: 20,
    velocity: 16,
    depth: 8,
    hygiene: 8,
    affinity: 0,
    behavior: 0,
  }),
  personal: Object.freeze({
    freshness: 18,
    corroboration: 20,
    sourceTrust: 14,
    velocity: 12,
    depth: 6,
    hygiene: 4,
    affinity: 16,
    behavior: 4,
  }),
});

/** 事件价值类信号的总权重占比下限（防信息茧房的硬红线） */
export const EVENT_VALUE_FLOOR_RATIO = 0.5;

export function policyFor(lane = 'public') {
  return LANES[lane] ?? LANES.public;
}

/** 校验一条策略没有突破硬红线（ranker 启动时自检 + 测试用） */
export function validatePolicy(weights) {
  const eventValue = (weights.freshness ?? 0) + (weights.corroboration ?? 0) + (weights.sourceTrust ?? 0);
  const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
  return total > 0 && eventValue / total >= EVENT_VALUE_FLOOR_RATIO;
}
