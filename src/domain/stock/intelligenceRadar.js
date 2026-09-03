import { evaluatePolicyFit } from './investorPolicy.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function percentile(value, values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2 || !Number.isFinite(value)) return 0.5;
  const rank = sorted.findIndex(item => item >= value);
  return (rank < 0 ? sorted.length - 1 : rank) / (sorted.length - 1);
}

function freshness(timestamp, now) {
  const age = now - Number(timestamp || 0);
  if (!Number.isFinite(age) || age < 0) return { score: 0, label: '时间未知' };
  if (age <= 20_000) return { score: 4, label: '数据新鲜' };
  if (age <= 90_000) return { score: 2, label: '数据稍旧' };
  return { score: 0, label: '数据过期' };
}

/**
 * Builds an explainable opportunity radar from the currently available quote sample.
 * This is intentionally a ranking aid, not a buy/sell signal.
 */
export function buildCandidateRadar(stocks = [], { now = Date.now(), limit = 5, policy = null } = {}) {
  const rows = Array.isArray(stocks) ? stocks.filter(item => item?.code && finite(item.price) > 0) : [];
  const changes = rows.map(item => finite(item.changePct)).filter(Number.isFinite);
  const amounts = rows.map(item => finite(item.amount)).filter(value => Number.isFinite(value) && value > 0);

  return rows.map(stock => {
    const changePct = finite(stock.changePct) ?? 0;
    const amount = finite(stock.amount) ?? 0;
    const high = finite(stock.high);
    const low = finite(stock.low);
    const price = finite(stock.price) ?? 0;
    const dayPosition = high !== null && low !== null && high > low ? (price - low) / (high - low) : null;
    const changeRank = percentile(changePct, changes);
    const liquidityRank = amount > 0 ? percentile(amount, amounts) : 0;
    const changeScore = Math.max(-14, Math.min(18, changePct * 4));
    const liquidityScore = amounts.length > 1 && amount > 0 ? liquidityRank * 8 : 0;
    const positionScore = dayPosition === null ? 0 : (dayPosition >= 0.72 ? 6 : dayPosition <= 0.28 ? -6 : 1);
    const fresh = freshness(stock.timestamp, now);
    const policyFit = evaluatePolicyFit(stock, policy || {});
    const score = Math.max(0, Math.min(100, Math.round(50 + changeScore + liquidityScore + positionScore + fresh.score + policyFit.adjustment)));
    const hasChangeEvidence = finite(stock.changePct) !== null;
    const hasLiquidityEvidence = amounts.length >= 2 && amount > 0;
    const availableEvidence = [hasChangeEvidence, amount > 0, dayPosition !== null, fresh.score > 0].filter(Boolean).length;
    const confidenceScore = Math.min(68, Math.round(
      18
      + (fresh.score >= 4 ? 18 : fresh.score >= 2 ? 10 : 0)
      + (amount > 0 ? 12 : 0)
      + (dayPosition !== null ? 10 : 0)
      + (rows.length >= 20 ? 10 : rows.length >= 8 ? 5 : 0)
    ));
    const factorScores = {
      momentum: changes.length >= 2 && hasChangeEvidence ? Math.round(changeRank * 100) : null,
      liquidity: hasLiquidityEvidence ? Math.round(liquidityRank * 100) : null,
      position: dayPosition === null ? null : Math.round(dayPosition * 100),
      policy: Math.max(0, Math.min(100, 70 + policyFit.adjustment)),
    };
    const reasons = [];
    const risks = [];
    if (changePct >= 2) reasons.push(`日内动量 +${changePct.toFixed(2)}%`);
    else if (changePct <= -2) risks.push(`日内回撤 ${changePct.toFixed(2)}%`);
    if (liquidityScore >= 5) reasons.push('成交额处于样本高位');
    if (dayPosition !== null && dayPosition >= 0.72) reasons.push('价格接近日内高位');
    if (dayPosition !== null && dayPosition <= 0.28) risks.push('价格接近日内低位');
    if (fresh.score === 0) risks.push(fresh.label);
    if (amount <= 0) risks.push('成交额未提供');
    risks.push(...policyFit.flags);
    if (reasons.length === 0) reasons.push('暂未形成明确强势证据');
    if (risks.length === 0) risks.push('仅为活跃样本排序，不含基本面验证');
    const state = !policyFit.eligible ? '超出策略范围' : score >= 68 ? '值得研究' : score <= 38 ? '风险偏高' : '等待证据';
    return {
      ...stock,
      score,
      changePct,
      dayPosition,
      freshness: fresh.label,
      confidence: confidenceScore >= 60 ? '中等' : confidenceScore >= 42 ? '有限' : '低',
      confidenceScore,
      evidenceCoverage: `${availableEvidence}/4`,
      factorScores,
      eligible: policyFit.eligible,
      policyFlags: policyFit.flags,
      reasons,
      risks,
      state,
      beginnerSummary: state === '\u503c\u5f97\u7814\u7a76'
        ? [
            changePct >= 2 ? '\u52a8\u91cf\u9760\u524d' : null,
            liquidityScore >= 5 ? '\u6210\u4ea4\u989d\u6d3b\u8dc3' : null,
            dayPosition !== null && dayPosition >= 0.72 ? '\u4ef7\u683c\u63a5\u8fd1\u65e5\u5185\u9ad8\u4f4d' : null,
            fresh.score >= 2 ? '\u6570\u636e\u8f83\u65b0' : null,
          ].filter(Boolean).join('\u3001') || '\u7efc\u5408\u8bc4\u5206\u6682\u65f6\u9760\u524d\uff0c\u5efa\u8bae\u7ee7\u7eed\u6838\u5bf9\u8bc1\u636e\u3002'
        : state === '\u8d85\u51fa\u7b56\u7565\u8303\u56f4'
          ? '\u5b83\u4e0d\u7b26\u5408\u4f60\u8bbe\u7f6e\u7684\u6295\u8d44\u8303\u56f4\uff0c\u5148\u4e0d\u8981\u88ab\u77ed\u671f\u6da8\u5e45\u5438\u5f15\u3002'
          : '\u73b0\u6709\u8bc1\u636e\u8fd8\u4e0d\u591f\u4e00\u81f4\uff0c\u5148\u7b49\u5f85\u66f4\u591a\u6570\u636e\u786e\u8ba4\u3002',
      nextCheck: risks[0] || '\u8865\u5145\u8d22\u52a1\u3001\u516c\u544a\u548c\u4f30\u503c\u4fe1\u606f',
    };
  }).sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore || b.changePct - a.changePct).slice(0, limit);
}

export function buildMarketEvidence({ indices = [], sectors = [], coverage = null } = {}) {
  const validIndices = indices.filter(item => finite(item.changePct) !== null);
  const up = validIndices.filter(item => item.changePct > 0).length;
  const down = validIndices.filter(item => item.changePct < 0).length;
  const leaders = sectors.filter(item => finite(item.changePct) !== null).slice(0, 3);
  return {
    indexTone: up > down ? '指数偏强' : down > up ? '指数偏弱' : '指数分化',
    indexBreadth: `${up} 涨 / ${down} 跌`,
    leaders,
    coverageLabel: coverage?.label || '活跃样本',
    limitation: '雷达只用于研究排序，不代表全市场机会或确定性收益。',
  };
}

export function buildDecisionCard({ stock = {}, realtime = null, diagnosis = null } = {}) {
  const quote = realtime || stock;
  const price = finite(quote?.price);
  const changePct = finite(quote?.changePct);
  const facts = [];
  if (price !== null) facts.push(`现价 ${price.toFixed(2)}`);
  if (changePct !== null) facts.push(`日内涨跌 ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`);
  if (diagnosis?.metrics?.excessReturn20 !== null && diagnosis?.metrics?.excessReturn20 !== undefined) facts.push(`20期超额 ${diagnosis.metrics.excessReturn20}%`);
  if (diagnosis?.metrics?.volumeTrend) facts.push(`量能 ${diagnosis.metrics.volumeTrend}`);

  const support = diagnosis?.bullCase?.slice(0, 3) || [];
  const counter = diagnosis?.bearCase?.slice(0, 3) || [];
  const invalidation = diagnosis?.invalidation?.slice(0, 3) || [];
  const missing = [];
  if (!diagnosis || diagnosis.status !== 'ready') missing.push('尚未运行日 K 诊断');
  missing.push('暂未接入财务、公告、估值与资金流验证');

  return {
    status: diagnosis?.status === 'ready' ? 'evidence_ready' : 'needs_analysis',
    headline: diagnosis?.status === 'ready' ? `${diagnosis.rating} · ${diagnosis.risk === 'high' ? '高风险' : diagnosis.risk === 'low' ? '低风险' : '中等风险'}` : '等待证据分析',
    facts: facts.length ? facts : ['实时行情尚未返回'],
    support: support.length ? support : ['当前没有可复核的支持证据'],
    counter: counter.length ? counter : ['运行诊断后生成反方证据'],
    invalidation: invalidation.length ? invalidation : ['在证据不足前不形成行动结论'],
    missing,
    nextAction: diagnosis?.status === 'ready' ? '先核验缺失数据，再进入情景推演和仓位预算。' : '先运行确定性诊断，补齐趋势、波动和相对强弱证据。',
  };
}
