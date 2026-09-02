/**
 * llmSummarizer.js - LLM 真压缩摘要器（对标 pi 的 compaction：摘要由 LLM 生成而非本地截断）
 *
 * 背景：runAgentLoop / runElfAgentLoop 此前超预算时传 summaryText=localSummary(...)，
 * buildContext 的 generateSummary（LLM 摘要）参数从未被接通——"压缩"实际上是本地截断清单。
 * 本模块提供 createLlmSummarizer 工厂：
 *   - 调 /api/ai-generate（非流式、单发、25s 超时、跟随父级 abort）生成结构化摘要
 *   - 失败/超时返回 ''，由 buildContext 内部自动降级为 localSummary（零破坏）
 *   - 按"压缩区域"内容特征做 LRU 缓存：压缩判定每轮都会触发，无缓存会每轮多打一次 LLM
 *
 * 注意：本模块是 fetch 编排层（非纯函数）；纯逻辑部分（提示词构造）在 contextManager.buildCompactionPrompt。
 */

import { buildCompactionPrompt } from './contextManager.js';

const CACHE_MAX = 20;
const summaryCache = new Map(); // cacheKey -> summary text

function cacheKey(region) {
  try {
    const sig = (region || []).map(m => `${m.role}:${String(m.content ?? '').length}:${String(m.content ?? '').slice(0, 40)}`).join('|');
    let h = 0;
    for (let i = 0; i < sig.length; i += 1) {
      h = (h * 31 + sig.charCodeAt(i)) | 0;
    }
    return String(h);
  } catch {
    return `len-${region?.length || 0}`;
  }
}

function cacheGet(key) {
  if (!summaryCache.has(key)) return undefined;
  const v = summaryCache.get(key);
  summaryCache.delete(key);
  summaryCache.set(key, v); // LRU bump
  return v;
}

function cacheSet(key, value) {
  if (summaryCache.has(key)) summaryCache.delete(key);
  summaryCache.set(key, value);
  if (summaryCache.size > CACHE_MAX) {
    const oldest = summaryCache.keys().next().value;
    if (oldest !== undefined) summaryCache.delete(oldest);
  }
}

/**
 * 创建一个 (region) => Promise<string> 的摘要函数，供 buildContext 的 generateSummary 使用。
 * @param {Object} opts
 * @param {Object} opts.llmConfig { baseUrl, apiKey }
 * @param {string} opts.selectedModel
 * @param {AbortSignal} [opts.parentSignal] 父级循环的 abort 信号（用户点停止时取消摘要请求）
 * @returns {(region: Array) => Promise<string>} 失败时 resolve('')
 */
export function createLlmSummarizer({ llmConfig, selectedModel, parentSignal } = {}) {
  return async function generateSummary(region) {
    if (!Array.isArray(region) || region.length === 0) return '';
    if (parentSignal?.aborted) return '';
    const key = cacheKey(region);
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    const { system, user } = buildCompactionPrompt(region);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) { clearTimeout(timer); return ''; }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    try {
      const response = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          baseUrl: llmConfig?.baseUrl,
          apiKey: llmConfig?.apiKey,
          model: selectedModel,
          action: 'chat',
          systemPrompt: system,
          messages: [{ role: 'user', content: user }],
          max_tokens: 1200,
        }),
      });
      if (!response.ok) return '';
      const data = await response.json();
      if (data?.ok === false) return '';
      const summary = typeof data?.content === 'string' ? data.content.trim() : '';
      if (summary) cacheSet(key, summary);
      return summary;
    } catch {
      return ''; // 失败降级：buildContext 会回落到 localSummary
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  };
}
