/**
 * Phase 3 Task B3: 单用户预热流程
 * 1. 检查今日快照是否已存在（缓存命中直接返回）
 * 2. 拉取 profile + 新闻 + LLM config
 * 3. 聚类 → 打分 → 选 lane
 * 4. 调 LLM 生成 ai-insights（可选）
 * 5. 构建 algorithm briefing + merge ai briefing
 * 6. 写入三表（snapshotRepository.insertSnapshot）
 */
import { createProfileRepository } from './profileRepository.js';
import { getNews } from '../news/services/newsService.js';
import { insertSnapshot, getSnapshotByDate } from './snapshotRepository.js';
import { clusterEvents, buildRecommendation, selectBriefingLanes } from '../../src/domain/intelligence/recommendationEngine.js';
import { buildAlgorithmBriefing, mergeAiBriefing } from '../../src/domain/intelligence/briefingEngine.js';
import { buildAiInsightsPrompt } from '../http/aiHandlers.js';
import { callAiBriefingGenerator } from './briefingLlmHelper.js';

const ALGORITHM_VERSION = 2;

/**
 * 纯函数：从 lanes 中选 top 30 items 传给 LLM（public 前 15 + personal 前 15）
 */
export function selectItemsForAiInsights(lanes) {
  if (!lanes || typeof lanes !== 'object') return [];
  const pub = Array.isArray(lanes.public) ? lanes.public.slice(0, 15) : [];
  const per = Array.isArray(lanes.personal) ? lanes.personal.slice(0, 15) : [];
  return [...pub, ...per];
}

/**
 * 内部：调 ai-insights LLM（直接 fetch，不经过 HTTP handler）
 */
async function callAiInsightsInternal({ items, personaSummary, llmConfig }) {
  if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
    throw new Error('llmConfig missing baseUrl or selectedModel');
  }
  const prompt = buildAiInsightsPrompt(items, personaSummary);
  const cleanBaseUrl = String(llmConfig.baseUrl).replace(/\/+$/, '');
  const apiUrl = /\/v[1-4]$/.test(cleanBaseUrl) ? `${cleanBaseUrl}/chat/completions` : `${cleanBaseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: llmConfig.selectedModel,
        messages: [
          { role: 'system', content: '你是科技趋势分析师' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2500,
        temperature: 0.5,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`ai-insights failed: ${response.status} ${errText.slice(0, 200)}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    let cleaned = content.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('ai-insights returned no JSON object');
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function defaultLlmConfig() {
  return {
    baseUrl: process.env.DEFAULT_LLM_BASE_URL || '',
    apiKey: process.env.DEFAULT_LLM_API_KEY || '',
    selectedModel: process.env.DEFAULT_LLM_MODEL || '',
  };
}

/**
 * 单用户预热流程。返回 { lanes, briefing, aiInsights, aiStatus, cached }。
 * 缓存命中（今日已有快照）时直接返回 cached: true。
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {Object|null} [params.personaSummary] - { habits: [], traits: [], needs: [] }
 * @param {string} [params.today] - YYYY-MM-DD，默认今天
 * @param {Object} [params.options] - 传给 getNews 的额外 options
 */
export async function preheatForUser({ userId, personaSummary = null, today, options = {} }) {
  const date = today || new Date().toISOString().slice(0, 10);

  // 1. 缓存命中检查
  // 快照对账：algorithmVersion=0 是前端分析写透传创建的占位行（无 lanes/算法简报），
  // 不算缓存命中——继续走完整预热补全三表（PG 返回 algorithm_version，内存版 algorithmVersion）。
  const existing = await getSnapshotByDate(userId, date);
  const existingVersion = existing?.algorithmVersion ?? existing?.algorithm_version;
  if (existing && existingVersion !== 0) return { cached: true, snapshot: existing };

  // 2. 拉取 profile + LLM config
  const repo = createProfileRepository();
  const profile = await repo.getState(userId);
  const storedLlmConfig = await repo.getLlmConfig(userId);
  const llmConfig = storedLlmConfig && storedLlmConfig.baseUrl
    ? storedLlmConfig
    : defaultLlmConfig();

  // Phase 5 Bug 1 修复：cron/lazy 路径无前端传入 personaSummary 时，从 DB 自动读取
  // 避免 LLM prompt 缺失用户性格画像
  let personaSummaryArg = personaSummary;
  if (!personaSummaryArg) {
    try {
      const { getPersonaSummary } = await import('../agent/agentMemoryService.js');
      const psResult = await getPersonaSummary(userId);
      personaSummaryArg = psResult?.personaSummary || null;
    } catch (err) {
      console.warn('[snapshotService] read personaSummary failed:', err.message);
      personaSummaryArg = null;
    }
  }

  // 3. 拉取新闻（最多 500 条用于聚类）
  const newsResult = await getNews(
    [],                                 // blocked
    [],                                 // customSources
    0,                                  // page
    500,                                // pageSize
    '',                                 // search
    [],                                 // disabledSources
    [],                                 // interests (top stories, not personalized)
    { forceRefresh: options.forceRefresh || false }
  );
  const newsItems = newsResult.items || [];

  // 4. 聚类 → 打分 → 选 lane
  const clustered = clusterEvents(newsItems);
  const scored = clustered.map(item => buildRecommendation(item, {
    domainTiers: Object.fromEntries((profile.domains || []).map(d => [d.id, d.tier])),
    sourceTiers: Object.fromEntries((profile.sources || []).map(s => [s.id, s.tier])),
    specialFollows: profile.specialFollows || [],
    personaSummary: personaSummaryArg,
    relevantMemories: [],
  }));
  const lanes = selectBriefingLanes(scored);

  // 5. LLM 增强 ai-insights（可选）
  let aiInsights = null;
  let aiStatus = 'not_requested';
  if (llmConfig.baseUrl && llmConfig.selectedModel) {
    try {
      aiInsights = await callAiInsightsInternal({
        items: selectItemsForAiInsights(lanes),
        personaSummary: personaSummaryArg,
        llmConfig,
      });
      aiStatus = 'generated';
    } catch (err) {
      console.warn('[snapshotService] ai-insights failed:', err.message);
      aiStatus = 'ai_failed';
    }
  }

  // 6. 构建 algorithm briefing + merge ai briefing
  const algorithmBriefing = buildAlgorithmBriefing({
    date,
    lanes,
    generatedAt: new Date().toISOString(),
  });

  let mergedBriefing = algorithmBriefing;
  let aiPayload = null;
  if (aiInsights && llmConfig.baseUrl && llmConfig.selectedModel) {
    try {
      aiPayload = await callAiBriefingGenerator({
        algorithmBriefing,
        personaSummary: personaSummaryArg,
        llmConfig,
      });
      mergedBriefing = mergeAiBriefing(algorithmBriefing, aiPayload);
      aiStatus = mergedBriefing.aiValidationError ? 'validation_failed' : 'merged';
    } catch (err) {
      console.warn('[snapshotService] ai briefing generator failed:', err.message);
      aiStatus = 'ai_failed';
    }
  }

  // 7. 写入三表
  await insertSnapshot({
    userId,
    date,
    algorithmVersion: ALGORITHM_VERSION,
    lanes,
    algorithmPayload: mergedBriefing,
    aiPayload,
    aiCitationIds: aiPayload?.citationIds || [],
    aiStatus,
  });

  return { lanes, briefing: mergedBriefing, aiInsights, aiStatus, cached: false };
}
