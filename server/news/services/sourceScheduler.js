/**
 * sourceScheduler.js - 信息源分级调度器
 *
 * 目标：265 个源不再「每轮全量并行」，改为按 S/A/B/C/D 等级差异化轮询：
 *   - S=15min / A=30min / B=60min / C=3h / D=6h
 *   - 失败指数退避（最多 16 倍），连续失败自动降档（最多 2 档），成功后逐级恢复
 *   - 并发池执行，S 级优先出队，永不排在 D 级后面
 *
 * 纯逻辑与状态管理分离：intervalFor/nextDueAt/recordOutcome/pickDueSources 均为
 * 纯函数（可单测）；runWithConcurrency 是通用并发池。
 */

import { getSourceGrade } from '../config/sourceGrades.js';

export const GRADE_INTERVALS_MS = Object.freeze({
  S: 15 * 60 * 1000,
  A: 30 * 60 * 1000,
  B: 60 * 60 * 1000,
  C: 3 * 60 * 60 * 1000,
  D: 6 * 60 * 60 * 1000,
});

export const GRADE_ORDER = Object.freeze({ S: 0, A: 1, B: 2, C: 3, D: 4 });

/** 退避上限：interval * 2^4 = 16 倍 */
const MAX_BACKOFF_EXPONENT = 4;
/** 连续失败该次数后自动降一档（拉长基准间隔） */
const DEGRADE_AFTER_FAILS = 4;
/** 最多降档数（D 级源再降也只是变慢，不会永久停抓） */
const MAX_DEGRADE_STEPS = 2;
/** 默认并发池大小 */
export const DEFAULT_CONCURRENCY = 16;

/* ============ 源亲和度（画像反哺采集闭环） ============
 * 推荐链路（personalScore 高分事件）→ 源亲和度 → 调度优先级/频率：
 * 高亲和源出队更靠前、轮询间隔最多缩短一半（下限 5 分钟）。
 * 亲和度按 24h 半衰期惰性衰减，单源上限 10 分，防止刷请求灌爆。 */
const sourceAffinity = new Map();
export const AFFINITY_HALF_LIFE_MS = 24 * 60 * 60 * 1000;
export const AFFINITY_SCORE_CAP = 10;
export const AFFINITY_MIN_INTERVAL_MS = 5 * 60 * 1000;

function decayedAffinity(name, now = Date.now()) {
  const entry = sourceAffinity.get(name);
  if (!entry) return 0;
  const elapsed = now - (entry.updatedAt || 0);
  if (elapsed > AFFINITY_HALF_LIFE_MS) {
    const halvings = Math.floor(elapsed / AFFINITY_HALF_LIFE_MS);
    entry.score = entry.score * Math.pow(0.5, halvings);
    entry.updatedAt = now;
    if (entry.score < 0.1) {
      sourceAffinity.delete(name);
      return 0;
    }
  }
  return entry.score;
}

/**
 * 上报一批高表现源（来自个性化推荐高分事件）。每次调用每个源 +1（去重）。
 */
export function bumpSourceAffinity(sourceNames = [], now = Date.now()) {
  const unique = [...new Set(sourceNames.map(n => String(n || '').trim()).filter(Boolean))];
  for (const name of unique) {
    const score = Math.min(AFFINITY_SCORE_CAP, decayedAffinity(name, now) + 1);
    sourceAffinity.set(name, { score, updatedAt: now });
  }
  return unique.length;
}

/** 亲和度加速因子：score>=4 → 2x，score>=2 → 1.5x，其余 1x */
export function affinityBoost(name, now = Date.now()) {
  const score = decayedAffinity(name, now);
  if (score >= 4) return 2;
  if (score >= 2) return 1.5;
  return 1;
}

/** 源亲和度快照（测试/诊断用） */
export function getSourceAffinitySnapshot() {
  const now = Date.now();
  return [...sourceAffinity.entries()].map(([name]) => ({ name, score: decayedAffinity(name, now) }));
}

/**
 * 新建一个源的调度状态。
 * @returns {{ failCount: number, degradeSteps: number, lastFetchedAt: number, lastOkAt: number }}
 */
export function createSourceState(now = 0) {
  return { failCount: 0, degradeSteps: 0, lastFetchedAt: 0, lastOkAt: 0 };
}

function gradeInterval(source, degradeSteps) {
  const grade = getSourceGrade(source?.name || '');
  const base = GRADE_INTERVALS_MS[grade] ?? GRADE_INTERVALS_MS.D;
  // 降档 = 等级序号 +steps，封顶 D
  const degradedOrder = Math.min((GRADE_ORDER[grade] ?? 4) + Math.max(0, degradeSteps), 4);
  const orderToGrade = Object.keys(GRADE_ORDER).find(g => GRADE_ORDER[g] === degradedOrder);
  return GRADE_INTERVALS_MS[orderToGrade] ?? base;
}

/**
 * 计算某源下一次应抓取的时间间隔（含退避 + 降档 + 亲和度加速）。
 * 亲和源最多缩短一半，但绝不低于 AFFINITY_MIN_INTERVAL_MS（5 分钟）。
 */
export function intervalFor(source, state = createSourceState(), now = Date.now()) {
  const base = gradeInterval(source, state.degradeSteps);
  const exponent = Math.min(Math.max(0, state.failCount), MAX_BACKOFF_EXPONENT);
  const raw = base * Math.pow(2, exponent);
  const boost = affinityBoost(source?.name || '', now);
  return Math.max(AFFINITY_MIN_INTERVAL_MS, Math.round(raw / boost));
}

/**
 * 计算某源下一次到期时间戳。
 * 从未抓取过的源（lastFetchedAt=0）视为立即到期——冷启动时全部源进入首轮抓取。
 * now 必须透传给 intervalFor（内含亲和度惰性衰减，时钟源混用会导致亲和度被误衰减/清除）。
 */
export function nextDueAt(source, state = createSourceState(), now = Date.now()) {
  if (!state.lastFetchedAt) return 0;
  return state.lastFetchedAt + intervalFor(source, state, now);
}

/**
 * 记录一次抓取结果，返回新状态（不可变更新）。
 * 成功：failCount 清零；degradeSteps 每次成功恢复 1 档（渐进恢复，避免抖动）。
 * 失败：failCount+1；达到阈值自动降档。
 */
export function recordOutcome(state = createSourceState(), ok, now = Date.now()) {
  const next = {
    failCount: state.failCount,
    degradeSteps: state.degradeSteps,
    lastFetchedAt: now,
    lastOkAt: state.lastOkAt,
  };
  if (ok) {
    next.failCount = 0;
    next.lastOkAt = now;
    if (next.degradeSteps > 0) next.degradeSteps -= 1;
  } else {
    next.failCount += 1;
    if (next.failCount >= DEGRADE_AFTER_FAILS && next.degradeSteps < MAX_DEGRADE_STEPS) {
      next.degradeSteps += 1;
    }
  }
  return next;
}

/**
 * 挑出到期源，按优先级排序：等级高（S 最优先）→ 失败少 → 到期更早。
 * 从未抓取过的源视为立即到期（冷启动时全量进入，但按等级排序出队）。
 *
 * @param {Array} sources 源列表（{name, ...}）
 * @param {Map<string, object>} states 源名 → 调度状态
 * @param {number} now 当前时间戳
 * @returns {Array} 到期源列表（已排序）
 */
export function pickDueSources(sources = [], states = new Map(), now = Date.now()) {
  const due = [];
  for (const source of sources) {
    const state = states.get(source.name) || createSourceState();
    if (nextDueAt(source, state, now) <= now) due.push({ source, state });
  }
  due.sort((a, b) => {
    const ga = GRADE_ORDER[getSourceGrade(a.source.name)] ?? 4;
    const gb = GRADE_ORDER[getSourceGrade(b.source.name)] ?? 4;
    if (ga !== gb) return ga - gb;
    // 同级源：亲和度高的优先出队（画像反哺采集）
    const aa = decayedAffinity(a.source.name, now);
    const ab = decayedAffinity(b.source.name, now);
    if (aa !== ab) return ab - aa;
    if (a.state.failCount !== b.state.failCount) return a.state.failCount - b.state.failCount;
    return nextDueAt(a.source, a.state, now) - nextDueAt(b.source, b.state, now);
  });
  return due.map(entry => entry.source);
}

/**
 * 通用并发池：最多 concurrency 个 worker 同时消费任务队列。
 * 单任务失败不中断其他任务（与 Promise.allSettled 语义一致），返回每个任务的结果。
 *
 * @param {Array} items 任务输入列表
 * @param {(item) => Promise<any>} worker 单任务执行器
 * @param {number} concurrency 并发上限
 * @returns {Promise<Array<{status:'fulfilled'|'rejected', value?:any, reason?:any}>>}
 */
export async function runWithConcurrency(items = [], worker, concurrency = DEFAULT_CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/* 测试辅助：清空源亲和度（仅单测使用） */
export function __resetAffinityForTests() {
  sourceAffinity.clear();
}
