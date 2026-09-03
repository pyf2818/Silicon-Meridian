const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function validBars(rows) {
  return Array.isArray(rows) ? rows.filter(row => finite(row?.close) !== null) : [];
}

function formatAmount(value) {
  const amount = finite(value);
  if (amount === null || amount <= 0) return null;
  if (amount >= 1e8) return `${(amount / 1e8).toFixed(2)} 亿元`;
  if (amount >= 1e4) return `${(amount / 1e4).toFixed(2)} 万元`;
  return `${Math.round(amount)} 元`;
}

function quoteFreshness(timestamp, now) {
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return { status: 'partial', label: '更新时间未知' };
  if (parsed > now) return { status: 'partial', label: '更新时间异常' };
  const age = now - parsed;
  if (age <= 120_000) return { status: 'ready', label: '行情较新' };
  if (age <= 30 * 60_000) return { status: 'partial', label: '行情稍旧' };
  return { status: 'partial', label: '行情已过期' };
}

function dimension(key, label, status, detail) {
  return { key, label, status, detail };
}

function seriesFreshness(rows, now, maxAgeMs = 10 * 24 * 60 * 60_000) {
  const series = Array.isArray(rows) ? rows : [];
  if (series.length === 0) return { status: 'missing', label: '序列缺失' };
  const dates = series
    .map(row => {
      const value = row?.date ?? row?.timestamp;
      return typeof value === 'number' ? value : Date.parse(value || '');
    })
    .filter(Number.isFinite);
  if (dates.length === 0) return { status: 'partial', label: '更新时间未知' };
  const latest = Math.max(...dates);
  if (latest > now) return { status: 'partial', label: '时间异常' };
  return now - latest <= maxAgeMs
    ? { status: 'ready', label: '序列较新' }
    : { status: 'partial', label: '序列较旧' };
}

/**
 * Creates a deterministic evidence inventory for stock research.
 * Coverage describes connected evidence dimensions, not prediction confidence.
 */
export function buildStockEvidencePacket({
  stock = {},
  realtime = null,
  klines = [],
  benchmarkKlines = [],
  benchmark = null,
  sectors = [],
  diagnosis = null,
  now = Date.now(),
} = {}) {
  const quote = realtime || stock || {};
  const price = finite(quote.price);
  const changePct = finite(quote.changePct);
  const amount = finite(quote.amount);
  const bars = validBars(klines);
  const benchmarkBars = validBars(benchmarkKlines);
  const freshness = quoteFreshness(quote.timestamp, now);
  const trendFreshness = seriesFreshness(bars, now);
  const benchmarkFreshness = seriesFreshness(benchmarkBars, now);
  const diagnosisReady = diagnosis?.status === 'ready';
  const excessReturn = finite(diagnosis?.metrics?.excessReturn20);
  const sectorRows = Array.isArray(sectors)
    ? sectors.filter(item => item?.name && finite(item.changePct) !== null).slice(0, 3)
    : [];
  const sectorFreshness = seriesFreshness(sectorRows, now);

  const quoteStatus = price !== null && changePct !== null ? freshness.status : price !== null ? 'partial' : 'missing';
  const trendStatus = diagnosisReady || bars.length >= 20 ? trendFreshness.status : bars.length > 0 ? 'partial' : 'missing';
  const benchmarkStatus = excessReturn !== null || (bars.length >= 20 && benchmarkBars.length >= 20) ? benchmarkFreshness.status : benchmarkBars.length > 0 ? 'partial' : 'missing';
  const liquidityStatus = amount !== null && amount > 0
    ? freshness.status
    : finite(quote.volume) > 0 ? 'partial' : 'missing';
  const marketStatus = sectorRows.length > 0 ? sectorFreshness.status : 'missing';

  const dimensions = [
    dimension('quote', '实时行情', quoteStatus, price === null ? '缺少现价' : `${freshness.label}${changePct === null ? '，缺少涨跌幅' : ''}`),
    dimension('trend', '趋势与波动', trendStatus, diagnosisReady ? `${diagnosis.dataQuality?.bars || bars.length} 根 K 线已诊断（${trendFreshness.label}）` : bars.length ? `${bars.length} 根 K 线，样本未达诊断要求（${trendFreshness.label}）` : '缺少有效 K 线'),
    dimension('benchmark', '相对基准', benchmarkStatus, excessReturn !== null ? `20 期超额 ${excessReturn}%（${benchmarkFreshness.label}）` : benchmarkBars.length ? `${benchmarkBars.length} 根基准 K 线（${benchmarkFreshness.label}）` : `缺少${benchmark?.name || '基准指数'}数据`),
    dimension('liquidity', '成交与流动性', liquidityStatus, formatAmount(amount) ? `成交额 ${formatAmount(amount)}（${freshness.label}）` : finite(quote.volume) > 0 ? `仅有成交量，缺少成交额（${freshness.label}）` : '缺少成交额与成交量'),
    dimension('market', '市场环境', marketStatus, sectorRows.length ? `板块样本：${sectorRows.map(item => item.name).join('、')}（${sectorFreshness.label}）` : '缺少板块环境样本'),
    dimension('fundamentals', '财务质量', 'missing', '尚未接入财务报表与盈利质量'),
    dimension('disclosures', '公告事件', 'missing', '尚未接入公司公告与重大事项'),
    dimension('valuation', '估值', 'missing', '尚未接入估值及历史分位'),
    dimension('capitalFlow', '资金流', 'missing', '尚未接入可验证的资金流数据'),
    dimension('news', '新闻催化', 'missing', '尚未接入个股相关新闻与事件时间线'),
  ];

  const unavailableResearchKeys = new Set(['fundamentals', 'disclosures', 'valuation', 'capitalFlow', 'news']);
  const assessedDimensions = dimensions.filter(item => !unavailableResearchKeys.has(item.key));
  const available = assessedDimensions.filter(item => item.status !== 'missing').length;
  const earned = assessedDimensions.reduce((sum, item) => sum + (item.status === 'ready' ? 1 : item.status === 'partial' ? 0.5 : 0), 0);
  const score = assessedDimensions.length ? Math.round(earned / assessedDimensions.length * 100) : 0;
  const label = score >= 80 ? '较完整' : score >= 40 ? '有限' : '不足';
  const facts = [];
  if (quoteStatus === 'ready' && price !== null) facts.push(`现价 ${price.toFixed(2)}${changePct === null ? '' : `，日内${changePct >= 0 ? '上涨' : '下跌'} ${Math.abs(changePct).toFixed(2)}%`}`);
  if (diagnosisReady && trendStatus === 'ready') {
    facts.push(`技术评级 ${diagnosis.rating}，风险等级 ${diagnosis.risk === 'high' ? '高' : diagnosis.risk === 'low' ? '低' : '中等'}`);
    if (finite(diagnosis.metrics?.momentum5) !== null) facts.push(`5 期动量 ${diagnosis.metrics.momentum5}%`);
  } else if (bars.length > 0) {
    facts.push(`已取得 ${bars.length} 根有效 K 线，尚未完成确定性诊断`);
  }
  if (benchmarkStatus === 'ready' && excessReturn !== null) facts.push(`相对${benchmark?.name || diagnosis?.dataQuality?.benchmark?.name || '基准'}的 20 期超额为 ${excessReturn}%`);
  if (liquidityStatus === 'ready' && formatAmount(amount)) facts.push(`当前成交额 ${formatAmount(amount)}`);
  if (marketStatus === 'ready' && sectorRows.length) facts.push(`市场板块样本领先项：${sectorRows.map(item => `${item.name} ${item.changePct >= 0 ? '+' : ''}${Number(item.changePct).toFixed(2)}%`).join('、')}`);

  const missing = dimensions.filter(item => item.status === 'missing').map(item => item.detail);
  const partial = dimensions.filter(item => item.status === 'partial').map(item => item.detail);

  return {
    stock: { code: stock.code || quote.code || '', name: stock.name || quote.name || '' },
    coverage: { available, total: assessedDimensions.length, score, label },
    dimensions,
    facts,
    missing,
    partial,
    guardrail: label === '较完整'
      ? '证据覆盖较完整，但仍需核对来源时效与失效条件。'
      : label === '有限'
        ? '当前只能形成研究假设，不能把有限证据升级为确定性结论。'
        : '证据不足，优先补齐数据，不形成行动结论。',
  };
}

export function formatEvidencePacketForPrompt(packet) {
  if (!packet) return '证据包不可用。';
  const confirmed = packet.facts?.length ? packet.facts.join('；') : '暂无可确认事实';
  const partial = packet.partial?.length ? packet.partial.join('；') : '无';
  const missing = packet.missing?.length ? packet.missing.join('；') : '无';
  return `证据覆盖：${packet.coverage.available}/${packet.coverage.total}（${packet.coverage.label}，${packet.coverage.score}%）\n已确认：${confirmed}\n部分可用：${partial}\n待补充：${missing}\n约束：${packet.guardrail}`;
}