/**
 * 统一时间衰减模型 —— 排序内核的公共底座。
 *
 * 设计约束（来自 dateUtils.js 的教训）：所有依赖时钟的计算必须显式注入 `now`，
 * 且衰减有下限（永不清零）——长尾内容 7 天后仍应可见，只是排后。
 */

export const HALF_LIFE_MS = Object.freeze({
  freshness: 18 * 60 * 60 * 1000,   // 18h：新闻价值的中位半衰期
  velocity: 6 * 60 * 60 * 1000,     // 6h：扩散热度的半衰期（热得快凉得也快）
  behavior: 7 * 24 * 60 * 60 * 1000 // 7d：用户行为的记忆窗口
});

/** 衰减下限：任何信号都不衰减到 0（长尾可见性） */
export const DECAY_FLOOR = 0.05;

/**
 * 指数半衰衰减。
 * @param {{halfLifeMs: number, elapsedMs: number, floor?: number}} p
 * @returns {number} 0..1（有下限）
 */
export function decay({ halfLifeMs, elapsedMs, floor = DECAY_FLOOR }) {
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 1;
  if (!Number.isFinite(elapsedMs)) return floor;
  if (elapsedMs <= 0) return 1;
  return Math.max(floor, Math.pow(0.5, elapsedMs / halfLifeMs));
}

/** 把任意数值收敛到 [0,1]，非有限值一律 0（NaN 永远不许进打分） */
export function clamp01(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
