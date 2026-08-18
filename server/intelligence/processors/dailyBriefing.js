const SECTION_LABELS = {
  'ai-models': '模型发布',
  'ai-products': '产品动态',
  industry: '行业动向',
  paper: '前沿研究',
  tip: '技术观点',
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildOpportunity(event) {
  const entities = event.entities?.length ? ` (${event.entities.slice(0, 3).join(', ')})` : '';
  if ((event.impactScore || 0) >= 70) return `高影响信号${entities}：${event.title}`;
  if ((event.sources || []).length >= 2) return `多源交叉验证${entities}：${event.title}`;
  return `值得跟进${entities}：${event.title}`;
}

function buildRisk(event) {
  const text = `${event.title || ''} ${event.summary || ''}`.toLowerCase();
  if (/regulation|lawsuit|copyright|safety|risk|监管|诉讼|版权|安全|风险/.test(text)) {
    return `风险信号：${event.title}`;
  }
  if ((event.confidence || 0) < 40) return `需更多确认：${event.title}`;
  return '';
}

export function buildDailyIntelligenceBriefing({ events = [], date = new Date().toISOString().slice(0, 10), generatedAt = new Date().toISOString(), source = 'live' } = {}) {
  const sorted = [...events].sort((a, b) => {
    const scoreDiff = (b.intelligenceScore || 0) - (a.intelligenceScore || 0);
    if (scoreDiff) return scoreDiff;
    return (Date.parse(b.lastSeenAt) || 0) - (Date.parse(a.lastSeenAt) || 0);
  });
  const topEvents = sorted.slice(0, 8);
  const lead = topEvents[0] || null;
  const categories = unique(sorted.map(event => event.category));
  const citations = sorted.flatMap(event => event.citations || []).slice(0, 40);
  const watchEntities = unique(sorted.flatMap(event => event.entities || [])).slice(0, 12);
  const opportunities = topEvents.map(buildOpportunity).slice(0, 5);
  const risks = topEvents.map(buildRisk).filter(Boolean).slice(0, 5);

  return {
    ok: true,
    version: 1,
    mode: 'algorithm',
    source,
    date,
    generatedAt,
    oneLine: lead
      ? `${lead.title} 是今日领跑的 AI 情报事件，影响力 ${Math.round(lead.impactScore || 0)}，智能评分 ${Math.round(lead.intelligenceScore || 0)}。`
      : '今日暂无可用 AI 情报事件。',
    lead,
    topEvents,
    sections: categories.map(category => ({
      category,
      label: SECTION_LABELS[category] || category,
      events: sorted.filter(event => event.category === category).slice(0, 6),
    })),
    opportunities,
    risks,
    watchEntities,
    citationIds: unique(citations.map(item => item.id)),
    citations,
    diagnostics: {
      eventCount: sorted.length,
      categoryCount: categories.length,
      citationCount: citations.length,
    },
  };
}
