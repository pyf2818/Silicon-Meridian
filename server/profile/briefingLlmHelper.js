/**
 * Phase 3 Task B3: 调 LLM 生成 algorithm briefing 的 ai_payload。
 * 输入 algorithmBriefing（来自 briefingEngine.buildAlgorithmBriefing）+ personaSummary + llmConfig，
 * 输出 { oneLine, opportunities, risks, citationIds }。
 *
 * 失败时抛错，由调用方决定如何处理（catch 后 aiStatus = 'ai_failed'）。
 */

import { requestChatCompletion } from '../agent/llmClient.js';

function safeJoin(arr, fallback = '无') {
  return Array.isArray(arr) && arr.length ? arr.join('、') : fallback;
}

export async function callAiBriefingGenerator({ algorithmBriefing, personaSummary, llmConfig }) {
  if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
    throw new Error('llmConfig missing baseUrl or selectedModel');
  }

  const habits = safeJoin(personaSummary?.habits);
  const traits = safeJoin(personaSummary?.traits);
  const needs = safeJoin(personaSummary?.needs);

  const publicTitles = (algorithmBriefing?.sections?.public || []).slice(0, 3).map(i => i.title).join('、') || '无';
  const personalTitles = (algorithmBriefing?.sections?.personal || []).slice(0, 3).map(i => i.title).join('、') || '无';
  const citationIds = algorithmBriefing?.citationIds || [];

  const prompt = `你是科技趋势简报生成器。基于以下 algorithm briefing 和用户画像，生成可验证的 AI 简报。

【用户画像】
- 习惯：${habits}
- 性格：${traits}
- 需求：${needs}

【Algorithm Briefing】
- 日期：${algorithmBriefing?.date || 'N/A'}
- OneLine：${algorithmBriefing?.oneLine || 'N/A'}
- Public Lane（公共必读）：${publicTitles}
- Personal Lane（个人必看）：${personalTitles}

【可用 Citation IDs】
${citationIds.join(', ') || '（无）'}

【输出要求】
严格输出 JSON：
{
  "oneLine": "一句话概括今日核心（≤30 字）",
  "opportunities": [{"itemId": "xxx", "text": "机会描述（≤30 字）"}],
  "risks": [{"itemId": "xxx", "text": "风险描述（≤30 字）"}],
  "citationIds": ["必须从上面的 Citation IDs 中选取，至少 1 个，最多 5 个"]
}

约束：
1. citationIds 必须是上面列表的子集
2. citationIds 不能为空
3. oneLine 不能为空
4. opportunities 和 risks 中的 itemId 必须在 citationIds 中`;

  const data = await requestChatCompletion(llmConfig, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1500,
    temperature: 0.4,
  }, { timeoutMs: 30_000 });
  const content = data.choices?.[0]?.message?.content || '';
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('briefing generator returned no JSON object');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}
