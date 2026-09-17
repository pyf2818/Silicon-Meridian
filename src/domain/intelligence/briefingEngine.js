const unique = values => [...new Set(values.filter(Boolean))];

function summarizeLane(items, fallback) {
  const lead = items[0];
  if (!lead) return fallback;
  const reasons = lead.reasons || lead.recommendationReasons || [];
  return `${lead.title}${reasons[0] ? `：${reasons[0]}` : ''}`;
}

export function buildAlgorithmBriefing({ date, lanes = {}, generatedAt = new Date().toISOString() }) {
  const publicItems = Array.isArray(lanes.public) ? lanes.public : [];
  const personalItems = Array.isArray(lanes.personal) ? lanes.personal : [];
  const allItems = [...publicItems, ...personalItems];
  const categories = unique(allItems.map(item => item.category));
  const sources = unique(allItems.map(item => item.source));
  const citationIds = unique(allItems.map(item => item.id));
  const oneLine = publicItems.length || personalItems.length
    ? `今日需同时关注公共热点与个人重点：${summarizeLane(publicItems, summarizeLane(personalItems, '暂无可用资讯'))}`
    : '当前没有足够的有效资讯生成速报，请稍后刷新信源。';

  return {
    version: 1,
    date,
    generatedAt,
    mode: 'algorithm',
    oneLine,
    opportunities: personalItems.slice(0, 3).map(item => ({
      itemId: item.id,
      text: summarizeLane([item], item.title),
    })),
    risks: publicItems
      .filter(item => (item.health && item.health !== 'healthy') || (item.publicScore || 0) < 35)
      .slice(0, 3)
      .map(item => ({ itemId: item.id, text: `${item.title}：信息仍需更多来源确认` })),
    sections: {
      lead: allItems[0] || null,
      public: publicItems,
      personal: personalItems,
      domains: categories.map(category => ({
        category,
        items: allItems.filter(item => item.category === category),
      })),
      sources,
    },
    citationIds,
  };
}

/**
 * 归一 AI 观点列表，**保留每条观点的证据 ID**。
 *
 * 历史 BUG：这里只回 `text` 字符串，把 `itemId` 丢掉了 —— 而上面刚校验过
 * 「每条观点都必须带合法 itemId」，等于校验完就把证据链扔了。结果前端拿到的是
 * 纯文案，无法回答「这条判断依据哪条资讯」，TodayNewspaper 拿 `entry.itemId` 做 key
 * 也只能恒退 index。三个消费端（workspace.js / buildQuickActions.js / TodayNewspaper.jsx）
 * 早就写成 `typeof entry === 'string' ? entry : entry.text`，说明它们预期的是对象。
 */
function normalizeOpinions(value, allowed = null) {
  if (!Array.isArray(value)) return [];
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const itemId = entry.itemId == null ? '' : String(entry.itemId);
      const text = String(entry.text || '').trim();
      if (!itemId || !text) return null;
      if (allowed && !allowed.has(itemId)) return null;
      return { itemId, text };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function describeInvalidEvidence(entry) {
  if (!entry || typeof entry !== 'object') return '(缺少引用)';
  const itemId = entry.itemId == null ? '' : String(entry.itemId);
  return itemId || '(缺少引用)';
}

export function mergeAiBriefing(base, aiResult) {
  if (!base || !aiResult || typeof aiResult !== 'object') {
    return { ...base, aiValidationError: 'AI 返回结构无效' };
  }
  const cited = unique(Array.isArray(aiResult.citationIds) ? aiResult.citationIds.map(String) : []);
  const allowed = new Set(base.citationIds || []);
  const invalidCitations = cited.filter(id => !allowed.has(id));
  if (!cited.length || invalidCitations.length) {
    return {
      ...base,
      aiValidationError: invalidCitations.length
        ? `AI 引用了未知资讯：${invalidCitations.join('、')}`
        : 'AI 未提供可验证引用',
    };
  }
  const invalidEvidence = [...(Array.isArray(aiResult.opportunities) ? aiResult.opportunities : []), ...(Array.isArray(aiResult.risks) ? aiResult.risks : [])]
    .filter(entry => typeof entry !== 'object' || !entry || entry.itemId == null || !allowed.has(String(entry.itemId)))
    .map(describeInvalidEvidence);
  if (invalidEvidence.length) {
    return { ...base, aiValidationError: `AI 观点缺少有效引用：${unique(invalidEvidence).join('、')}` };
  }
  const oneLine = String(aiResult.oneLine || '').trim();
  if (!oneLine) return { ...base, aiValidationError: 'AI 未提供有效总判断' };

  return {
    ...base,
    mode: 'ai',
    oneLine,
    opportunities: normalizeOpinions(aiResult.opportunities, allowed),
    risks: normalizeOpinions(aiResult.risks, allowed),
    aiCitationIds: cited,
    aiValidatedAt: new Date().toISOString(),
    aiValidationError: undefined,
  };
}

/**
 * 把预热产物 aiInsights.itemScores（{id, score, label, reason}）合并进 lanes 条目。
 *
 * 背景：预热第 5 步已经用 LLM 对 TOP-30 事件算好了评分与理由，但此前只挂在返回值上、
 * 从不落卡 —— 每天白付一次 LLM 调用。本函数把它映射到既有前端契约字段：
 *   aiScore / aiLabel / aiReason / aiRelevanceScore（NewsItem 徽章与 ×0.3 排序直接消费）。
 *
 * 校验：id 必须能对上 lanes 里的条目（防幻觉引用）；score 收敛为 0-100 整数。
 * 纯函数，不修改入参。
 *
 * @param {{public?: Array, personal?: Array}} lanes
 * @param {Array<{id,score,label?,reason?}>} itemScores
 * @returns {{lanes: {public: Array, personal: Array}, mergedCount: number}}
 */
export function applyItemScoresToLanes(lanes = {}, itemScores = []) {
  const scores = Array.isArray(itemScores) ? itemScores : [];
  const scoreById = new Map();
  for (const entry of scores) {
    if (!entry || entry.id == null) continue;
    const score = Math.round(Number(entry.score));
    if (!Number.isFinite(score) || score < 0 || score > 100) continue;
    scoreById.set(String(entry.id), {
      aiScore: score,
      aiRelevanceScore: score,
      aiLabel: String(entry.label || '').slice(0, 12),
      aiReason: String(entry.reason || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    });
  }

  const mergeLane = lane => (Array.isArray(lane) ? lane : []).map(item => {
    if (!item || typeof item !== 'object') return item;
    const patch = scoreById.get(String(item.id));
    return patch ? { ...item, ...patch } : item;
  });

  const nextLanes = { public: mergeLane(lanes.public), personal: mergeLane(lanes.personal) };
  let mergedCount = 0;
  for (const lane of [nextLanes.public, nextLanes.personal]) {
    for (const item of lane) {
      if (item && item.aiScore != null) mergedCount += 1;
    }
  }
  return { lanes: nextLanes, mergedCount };
}
