/**
 * useIntelligenceBriefing.js - 把「复刻 Meridian」G1/G2/G3 接到前端每日简报
 *
 * 设计（与项目约定一致，最小侵入）：
 * - 纯 React hook，输入 items / date / llmConfig，输出 { semanticClusters, evolution, agentic, llmStatus, runAgentic }。
 * - G1 语义聚类：在浏览器端用本地 TF-IDF + 中文字组 embedding（确定性、离线）跑 buildSemanticClusters，
 *   不依赖任何外部 embedding 服务；生产可替换为托管 embedding。
 * - G3 跨日演化：每日把今日 digest 落盘到 snapshotStore（localStorage），再读前日快照 diff 出演化段。
 * - G2 多智能体分析：点「生成」时调 buildAgenticBriefing，llmCall 走 /api/ai-generate（与 useMultiAgentOrchestrator 同构）；
 *   LLM 未配置时 llmStatus='no-config'，面板显示引导，不崩。
 *
 * 接入点：App.jsx 在资讯流顶部渲染 <IntelligenceBriefingPanel briefing={...} />。
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { buildSemanticClusters } from '../domain/intelligence/semanticCluster.js';
import { buildAgenticBriefing } from '../domain/intelligence/agenticBriefing.js';
import { createSnapshotStore } from '../domain/intelligence/snapshotStore.js';
import {
  buildBriefingEvolution,
  digestFromBriefing,
  saveDailyDigest,
} from '../domain/intelligence/briefingEvolution.js';

/**
 * 本地确定性 embedding：英文/数字实体词 + 中文字组（TF-IDF 加权）。导出以便单测。
 * 实体词（如 OpenAI、GPT-5）是「同一事件」的最强身份信号，权重高于中文字组，
 * 避免同事件两句话因中文谓语不同而被判为不相关。
 */
const ENTITY_WEIGHT = 2.5;
export function buildLocalEmbeddings(texts) {
  const docs = texts.map((t) => {
    const text = String(t || '').toLowerCase();
    const words = text.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/gi) || [];
    const cjk = text.replace(/[a-z0-9\s]/gi, '');
    const bigrams = [];
    for (let i = 0; i < cjk.length - 1; i += 1) bigrams.push(cjk.slice(i, i + 2));
    const tokens = [...words, ...bigrams];
    const isEntity = [...words.map(() => true), ...bigrams.map(() => false)];
    return { tokens, isEntity };
  });
  const N = docs.length || 1;
  const df = new Map();
  docs.forEach(({ tokens }) => { new Set(tokens).forEach((w) => df.set(w, (df.get(w) || 0) + 1)); });
  const vocab = [...df.keys()];
  const idf = (w) => Math.log((N + 1) / (df.get(w) || 1)) + 1;
  return docs.map(({ tokens, isEntity }) => {
    const tf = new Map();
    tokens.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    const vec = new Array(vocab.length).fill(0);
    vocab.forEach((w, i) => {
      if (tf.has(w)) {
        const idx = tokens.indexOf(w);
        const weight = isEntity[idx] ? ENTITY_WEIGHT : 1;
        vec[i] = (tf.get(w) || 0) * idf(w) * weight;
      }
    });
    const norm = Math.hypot(...vec) || 1;
    return vec.map((v) => v / norm);
  });
}

const makeLocalEmbedFn = () => async (texts) => buildLocalEmbeddings(texts);

export function useIntelligenceBriefing({ items = [], date, llmConfig }) {
  const todayItems = useMemo(
    () => items.filter((i) => (i.publishedAt || '').slice(0, 10) === date),
    [items, date],
  );

  const embedFn = useMemo(makeLocalEmbedFn, []);
  const [semanticClusters, setSemanticClusters] = useState([]);
  const [clustering, setClustering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (todayItems.length === 0) { setSemanticClusters([]); return undefined; }
    setClustering(true);
    buildSemanticClusters(todayItems, embedFn, { threshold: 0.16, maxItems: 300 })
      .then((cs) => { if (!cancelled) setSemanticClusters(cs); })
      .catch(() => { if (!cancelled) setSemanticClusters([]); })
      .finally(() => { if (!cancelled) setClustering(false); });
    return () => { cancelled = true; };
  }, [todayItems, embedFn]);

  // G3：每日把今日 digest 落盘 + 读前日快照 diff 演化段
  const store = useMemo(() => {
    try { return createSnapshotStore(globalThis.localStorage); } catch { return null; }
  }, []);

  const todayDigest = useMemo(
    () => digestFromBriefing({
      date,
      clusters: semanticClusters.map((c) => ({
        clusterId: c.id,
        primaryTitle: c.primaryItem?.title || '',
        sourceCount: c.independentSourceCount,
        itemIds: c.itemIds,
      })),
    }),
    [date, semanticClusters],
  );

  const [evolution, setEvolution] = useState(null);
  useEffect(() => {
    if (!store || semanticClusters.length === 0) return;
    try { saveDailyDigest(store, todayDigest); } catch { /* ignore */ }
    try {
      setEvolution(buildBriefingEvolution({ store, todayDigest, todayDate: date, lookbackDays: 1 }));
    } catch { /* ignore */ }
  }, [store, todayDigest, date, semanticClusters]);

  // G2：多智能体分析（需 LLM）
  const [agentic, setAgentic] = useState(null);
  const [llmStatus, setLlmStatus] = useState('idle');

  const runAgentic = useCallback(async () => {
    if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
      setLlmStatus('no-config');
      return;
    }
    setLlmStatus('running');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 上限流可重试：仅对 429 / 繁忙 / 超时类瞬时错误退避重试，避免一次抖动整段失败
    const isRetryableError = (msg) => /429|频繁|busy|rate|too many|超时|timeout|abo?rt/i.test(String(msg || ''));
    const withRetry = async (fn, retries = 3) => {
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try { return await fn(); }
        catch (e) {
          lastErr = e;
          if (attempt < retries && isRetryableError(e.message)) {
            const delay = Math.min(8000, 1200 * Math.pow(2, attempt)) + Math.random() * 400;
            await sleep(delay);
            continue;
          }
          throw lastErr;
        }
      }
      throw lastErr;
    };
    // 串行节流：两次 LLM 调用之间至少间隔 MIN_GAP，给上游限流留出余量（多智能体≈19 次调用）
    let lastCallAt = 0;
    const MIN_GAP = 500;
    const llmCall = async ({ system, user }) => {
      const now = Date.now();
      const wait = Math.max(0, lastCallAt + MIN_GAP - now);
      if (wait) await sleep(wait);
      lastCallAt = Date.now();
      return withRetry(async () => {
        const res = await fetch('/api/ai-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            model: llmConfig.selectedModel,
            action: 'chat',
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            max_tokens: 400,
          }),
        });
        if (!res.ok) throw new Error(`AI 请求失败 (${res.status})`);
        const data = await res.json();
        if (data.ok === false) throw new Error(data.error || 'AI 请求失败');
        if (!data.content) throw new Error('AI 返回为空');
        return data.content;
      });
    };
    try {
      const result = await buildAgenticBriefing({
        clusters: semanticClusters,
        llmCall,
        opts: { maxClusters: 3 },
      });
      setAgentic(result);
      // B5：大模型多智能体分析沉淀进当日快照（localStorage 本地数据库），跨日回溯可读
      // setValidatedAi 语义：当日快照已存在 ai 时不覆盖（当天首份分析即权威沉淀）
      if (store && date) {
        try {
          store.setValidatedAi(date, {
            generatedAt: new Date().toISOString(),
            model: llmConfig.selectedModel,
            analysis: result,
          });
        } catch { /* 快照缺失或已锁存：静默 */ }
      }
      setLlmStatus('done');
    } catch {
      setLlmStatus('error');
    }
  }, [llmConfig, semanticClusters, store, date]);

  return {
    todayItems,
    semanticClusters,
    clustering,
    evolution,
    agentic,
    llmStatus,
    runAgentic,
  };
}

export default useIntelligenceBriefing;
