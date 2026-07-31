// useSelfEvolution.js - P4 自进化记忆 Hook
// 暴露记忆健康度、置信度分布、最近进化时间、手动触发进化入口
// 轻量设计：只读 + 手动触发，不接管写入（写入仍由 runAgentLoop 内的 evolveMemory 负责）

import { useCallback, useEffect, useState } from 'react';
import {
  computeMemoryHealth,
  rankMemoriesByConfidence,
  evolveMemory,
  fetchPersonaSummary,
} from '../utils/memoryEvolver.js';

const REFRESH_INTERVAL_MS = 60_000; // 60s 自动刷新一次（仅当面板可见时）

/**
 * @param {Object} opts
 * @param {Object} [opts.llmConfig] - LLM 配置（手动触发进化时使用）
 * @param {Object} [opts.personaSummary] - 当前 personaSummary（从 profileStore 读取，避免重复请求）
 * @param {boolean} [opts.enabled=true] - 是否启用自动刷新
 */
export function useSelfEvolution({ llmConfig, personaSummary, enabled = true } = {}) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [evolving, setEvolving] = useState(false);
  const [lastEvolvedAt, setLastEvolvedAt] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 拉取最近 100 条记忆（不分页，用于计算健康度）
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/agent-memory/list?limit=100&offset=0');
      if (!resp.ok) throw new Error(`http ${resp.status}`);
      const data = await resp.json();
      const items = Array.isArray(data?.memories) ? data.memories : [];
      setMemories(items);
    } catch (err) {
      setError(err?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh, refreshKey]);

  // 定时刷新（面板可见时）
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setRefreshKey(k => k + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  // 从 personaSummary 同步 lastEvolvedAt
  useEffect(() => {
    if (personaSummary?.lastEvolvedAt) {
      setLastEvolvedAt(personaSummary.lastEvolvedAt);
    } else if (personaSummary?.updatedAt) {
      // 兼容旧字段
      setLastEvolvedAt(personaSummary.updatedAt);
    }
  }, [personaSummary?.lastEvolvedAt, personaSummary?.updatedAt]);

  // 手动触发进化（force=true，忽略轮数限制）
  const triggerEvolution = useCallback(async ({ messages = [], sessionId = '', agentId = 'orchestrator' } = {}) => {
    if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
      return { skipped: true, reason: 'no llm config' };
    }
    setEvolving(true);
    try {
      const result = await evolveMemory({
        messages,
        sessionId,
        agentId,
        llmConfig: { baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, selectedModel: llmConfig.selectedModel },
        totalRounds: 0,
        force: true,
      });
      // 刷新记忆列表 + personaSummary
      await refresh();
      try {
        const ps = await fetchPersonaSummary();
        if (ps?.lastEvolvedAt) setLastEvolvedAt(ps.lastEvolvedAt);
      } catch { /* silent */ }
      return result;
    } finally {
      setEvolving(false);
    }
  }, [llmConfig, refresh]);

  // 派生：按置信度排序 + 整体健康度
  const rankedMemories = useCallback(() => rankMemoriesByConfidence(memories), [memories]);
  const health = useCallback(() => computeMemoryHealth(memories), [memories]);

  return {
    memories,
    rankedMemories: rankedMemories(),
    health: health(),
    loading,
    error,
    evolving,
    lastEvolvedAt,
    refresh,
    triggerEvolution,
  };
}
