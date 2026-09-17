/**
 * 信号层：每个信号是一个**纯函数**，输出 `{ value, confidence, reason }`。
 *
 * 契约（policy.js / ranker.js 依赖它）：
 *   - value ∈ [0,1]：这一维有多好（1 = 最好）
 *   - confidence ∈ [0,1]：这个判断有多可信（0 = 数据不存在，信号整体退出打分）
 *   - reason：给 scoreParts 用的短句，卡片上要能回答「为什么它在最前面」
 *
 * 数据全部来自现有管线，零新依赖：
 *   - crossVerifyItems 已产出 crossVerifyScore / sourceWeight / independentSourceCount
 *   - 第 1 点修复已产出 publishedAt / publishedAtEstimated / fetchedAt
 *   - 第 2 点修复已产出正文抽取与模板语占比（此处先用摘要长度作为 depth 代理）
 */
import { HALF_LIFE_MS, clamp01, decay } from './halfLife.js';
import { isEstimatedPublishTime } from '../news/utils/dateUtils.js';
import { getDynamicSourceScore } from './sourceStats.js';

const FRESHNESS_HALF_LIFE_MS = HALF_LIFE_MS.freshness;
const VELOCITY_HALF_LIFE_MS = HALF_LIFE_MS.velocity;
/** depth 满分需要的正文字符数（中文信息密度高，300 字已能说明一件事） */
const DEPTH_FULL_LENGTH = 300;
/** corroboration 满分需要的独立来源数 */
const CORROBORATION_FULL_SOURCES = 4;
/** velocity 满分需要的「每小时新增独立源数」 */
const VELOCITY_FULL_RATE_PER_HOUR = 2;

const PLACEHOLDER_SUMMARY_PATTERN = /暂无摘要/;

/** 标题卫生：这些模式命中说明是营销号套路而非信息本身 */
const HYGIENE_PATTERNS = [
  /[!?！？]{2,}/,                                   // 连续感叹/问号
  /^(突发|重磅|震惊|惊呆|速看|删前速看|必看|紧急)/, // 标题党开头
  /([！!]{3,}|…{3,}|。{3,})/,                       // 标点灌水
];

function isoToElapsedMs(iso, now) {
  const time = new Date(iso ?? '').getTime();
  return Number.isFinite(time) ? Math.max(0, now - time) : NaN;
}

/** 新鲜度：真实发布时间优先；估计时间可用但可信度减半；未来时间几乎不可信 */
export function freshnessSignal(item = {}, { now = Date.now() } = {}) {
  if (isEstimatedPublishTime(item.publishedAt, { now }) && item.publishedAt) {
    // 未来时间：原值保留但不参与新鲜度（避免"排期文"冒充最新）
    return { id: 'freshness', value: 0, confidence: 0.15, reason: '发布时间在将来，不可信' };
  }
  if (item.publishedAt) {
    const elapsed = isoToElapsedMs(item.publishedAt, now);
    if (!Number.isFinite(elapsed)) return { id: 'freshness', value: 0, confidence: 0, reason: '发布时间无法解析' };
    return { id: 'freshness', value: decay({ halfLifeMs: FRESHNESS_HALF_LIFE_MS, elapsedMs: elapsed }), confidence: 1, reason: '信源提供了发布时间' };
  }
  if (item.fetchedAt) {
    const elapsed = isoToElapsedMs(item.fetchedAt, now);
    if (!Number.isFinite(elapsed)) return { id: 'freshness', value: 0, confidence: 0, reason: '入库时间无法解析' };
    // 估计时间：用入库时间做代理，可信度减半（这正是「时间未知」条目的语义）
    return { id: 'freshness', value: decay({ halfLifeMs: FRESHNESS_HALF_LIFE_MS, elapsedMs: elapsed }), confidence: 0.5, reason: '信源未提供发布时间，按入库时间估计' };
  }
  return { id: 'freshness', value: 0, confidence: 0, reason: '无任何时间信息' };
}

/** 真实性：跨独立来源交叉验证（同源转载不抬分——crossVerifyItems 已保证） */
export function corroborationSignal(item = {}) {
  const count = Number.isFinite(item.independentSourceCount)
    ? item.independentSourceCount
    : item.crossVerifyScore ?? 0;
  if (!count) return { id: 'corroboration', value: 0, confidence: 1, reason: '单一来源，未经交叉验证' };
  return {
    id: 'corroboration',
    value: clamp01(count / CORROBORATION_FULL_SOURCES),
    confidence: 1,
    reason: `${count} 个独立来源报道`,
  };
}

/** 信源可信：静态等级 + **动态表现分**（P4：按可见命中/被屏蔽的历史统计修正） */
export function sourceTrustSignal(item = {}) {
  const weight = Number.isFinite(item.sourceWeight) ? item.sourceWeight : 0.5;
  // sourceWeight 0.5~1.0 → 0~1；桥接（RSSHub 等聚合通道）传输层可信度打折
  let value = clamp01((weight - 0.5) / 0.5);
  let reason = item.bridged ? '聚合桥接通道（传输可信度打折）' : '一手直连源';
  if (item.bridged) value *= 0.85;

  // 动态修正：源的实际表现（进可见集的命中率 vs 被屏蔽率）参与 30% 权重。
  // 样本不足（<10）时 getDynamicSourceScore 返回 null → 完全沿用静态等级。
  const dynamic = getDynamicSourceScore(item.source);
  if (dynamic != null) {
    value = clamp01(value * 0.7 + dynamic * 0.3);
    reason = `静态等级 + 动态表现 ${(dynamic * 100).toFixed(0)}%（样本已达标）`;
  }

  return { id: 'sourceTrust', value, confidence: 1, reason };
}

/** 热度：事件扩散斜率（独立源数 / 首见至今小时数）。
 *  注意：不要在这里再乘半衰衰减——rate 本身就随时间自然下降，双重惩罚会让「正常冷却」的事件被过度打压。 */
export function velocitySignal(item = {}, { now = Date.now(), cluster = null } = {}) {
  const sources = Number.isFinite(cluster?.independentSourceCount) ? cluster.independentSourceCount : 0;
  const firstSeenMs = isoToElapsedMs(cluster?.firstSeenAt, now);
  if (!sources || !Number.isFinite(firstSeenMs)) {
    // 无聚类上下文时，资讯流条目退而用「独立源数 + 入库时间」保守估计
    // （mergeIntoPool 对已存在的 key 跳过 → fetchedAt 即首次见到的时间；置信度略低于聚类）
    const newsCount = Number.isFinite(item.independentSourceCount) ? item.independentSourceCount : 0;
    const seenMs = isoToElapsedMs(item.fetchedAt, now);
    if (newsCount >= 2 && Number.isFinite(seenMs)) {
      const hours = Math.max(1, seenMs / 3_600_000);
      const ratePerHour = newsCount / hours;
      return {
        id: 'velocity',
        value: clamp01(ratePerHour / VELOCITY_FULL_RATE_PER_HOUR),
        confidence: 0.7,
        reason: `按入库时间估计：${hours.toFixed(1)} 小时内 ${newsCount} 个独立源`,
      };
    }
    return { id: 'velocity', value: 0, confidence: 0, reason: '暂无聚类数据，热度未知' };
  }
  const hours = Math.max(1, firstSeenMs / 3_600_000);           // 下限 1h，防止首分钟除零爆分
  const ratePerHour = sources / hours;
  return {
    id: 'velocity',
    value: clamp01(ratePerHour / VELOCITY_FULL_RATE_PER_HOUR),
    confidence: 1,
    reason: `${hours.toFixed(1)} 小时内扩散到 ${sources} 个独立源（${ratePerHour.toFixed(2)}/h）`,
  };
}

/** 内容厚度：有可读正文才给分；占位摘要 = 没内容 */
export function depthSignal(item = {}) {
  const text = String(item.bodyIntro || item.summary || '');
  if (!text || PLACEHOLDER_SUMMARY_PATTERN.test(text)) {
    return { id: 'depth', value: 0, confidence: 1, reason: '无可读摘要内容' };
  }
  return { id: 'depth', value: clamp01(text.length / DEPTH_FULL_LENGTH), confidence: 1, reason: `摘要 ${text.length} 字` };
}

/** 标题卫生：命中营销套路则降分（不删内容，只降排序权） */
export function hygieneSignal(item = {}) {
  const title = String(item.title || '');
  if (!title) return { id: 'hygiene', value: 0, confidence: 0, reason: '无标题' };
  const hits = HYGIENE_PATTERNS.filter(pattern => pattern.test(title)).length;
  if (!hits) return { id: 'hygiene', value: 1, confidence: 1, reason: '标题无营销套路' };
  return { id: 'hygiene', value: Math.max(0.5, 1 - 0.25 * hits), confidence: 1, reason: `标题命中 ${hits} 类营销套路` };
}

/** 画像契合：personalScore 归一；没有画像时整个信号退出（conf 0，不拉低也不抬高） */
export function affinitySignal(item = {}, { hasProfile = false } = {}) {
  if (!hasProfile) return { id: 'affinity', value: 0, confidence: 0, reason: '未配置画像' };
  const score = Number.isFinite(item.personalScore) ? item.personalScore : 0;
  return { id: 'affinity', value: clamp01(score / 100), confidence: 1, reason: '按关注领域/特别关注计算' };
}

/** 行为反馈：收藏/忽略（历史行为已有 hooks，v1 先做显式反馈映射） */
export function behaviorSignal(item = {}, { feedback = null } = {}) {
  if (!feedback) return { id: 'behavior', value: 0, confidence: 0, reason: '无行为数据' };
  const state = feedback[item.id];
  if (state === 'favorited') return { id: 'behavior', value: 1, confidence: 1, reason: '你收藏过该来源/话题' };
  if (state === 'ignored') return { id: 'behavior', value: 0, confidence: 1, reason: '你标记过忽略' };
  return { id: 'behavior', value: 0, confidence: 0, reason: '无行为记录' };
}

/** 信号注册表：顺序即语义优先级（ranker 按 policy 权重取用） */
export const SIGNAL_DEFS = Object.freeze([
  { id: 'freshness', fn: freshnessSignal },
  { id: 'corroboration', fn: corroborationSignal },
  { id: 'sourceTrust', fn: sourceTrustSignal },
  { id: 'velocity', fn: velocitySignal },
  { id: 'depth', fn: depthSignal },
  { id: 'hygiene', fn: hygieneSignal },
  { id: 'affinity', fn: affinitySignal },
  { id: 'behavior', fn: behaviorSignal },
]);
