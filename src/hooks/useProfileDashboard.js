// src/hooks/useProfileDashboard.js
// Phase 4: Profile Dashboard 聚合数据 hook
// 聚合 snapshots / learnedPreferences / personaSummary / preheat API

import { useState, useEffect, useCallback } from 'react';
import { useProfileStore } from '../store';
import { buildTrendSeries, buildAiStatusCounts, normalizeError, buildPersonaTrendSeries, diffPersonaSnapshots } from '../utils/dashboardBuilders.js';

// Re-export 纯函数（便于从 hook 文件统一 import）
export { buildTrendSeries, buildAiStatusCounts, normalizeError, buildPersonaTrendSeries, diffPersonaSnapshots };

/**
 * Phase 4 仪表盘聚合 hook
 * - snapshots: 30 天推荐快照列表
 * - learnedPrefs: learned_preferences 字段（topics/preferredDepth/preferredFormat）
 * - personaSummary: 直接读 profileStore（跨组件共享）
 * - preheat: 手动触发今日预热
 */
export function useProfileDashboard() {
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState(null);

  const [learnedPrefs, setLearnedPrefs] = useState({ topics: [], preferredDepth: '', preferredFormat: '' });
  const [prefsLoading, setPrefsLoading] = useState(true);

  const [preheatLoading, setPreheatLoading] = useState(false);
  const [preheatResult, setPreheatResult] = useState(null); // { cached, aiStatus } | null
  const [preheatError, setPreheatError] = useState(null);

  const [personaHistory, setPersonaHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const personaSummary = useProfileStore(s => s.personaSummary);

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    setSnapshotsError(null);
    try {
      const resp = await fetch('/api/profile/snapshots');
      const data = await resp.json();
      if (data.ok) setSnapshots(data.snapshots || []);
      else setSnapshotsError(normalizeError(data.error) || '加载失败');
    } catch (err) {
      setSnapshotsError(normalizeError(err) || '网络错误');
    } finally {
      setSnapshotsLoading(false);
    }
  }, []);

  // 复用已有 GET /api/agent-memory/persona 端点（返回 personaSummary + learnedPreferences + personaUpdatedAt）
  const loadLearnedPrefs = useCallback(async () => {
    setPrefsLoading(true);
    try {
      const resp = await fetch('/api/agent-memory/persona');
      const data = await resp.json();
      if (data.ok) setLearnedPrefs(data.learnedPreferences || {});
    } catch {
      /* silent: 行为观测失败不影响仪表盘 */
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  // Phase 5: 加载 personaSummary 进化历史（最新在前，最多 30 条）
  const loadPersonaHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await fetch('/api/agent-memory/persona/history?limit=30');
      const data = await resp.json();
      if (data.ok) setPersonaHistory(data.history || []);
    } catch {
      /* silent: 历史加载失败不阻塞仪表盘 */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const preheat = useCallback(async () => {
    setPreheatLoading(true);
    setPreheatError(null);
    setPreheatResult(null);
    try {
      const resp = await fetch('/api/profile/snapshots/preheat', { method: 'POST' });
      const data = await resp.json();
      if (data.ok) {
        setPreheatResult({ cached: data.cached, aiStatus: data.aiStatus });
        if (!data.cached) loadSnapshots(); // 重新拉取列表
      } else {
        setPreheatError(normalizeError(data.error) || '预热失败');
      }
    } catch (err) {
      setPreheatError(normalizeError(err) || '网络错误');
    } finally {
      setPreheatLoading(false);
    }
  }, [loadSnapshots]);

  useEffect(() => {
    loadSnapshots();
    loadLearnedPrefs();
    loadPersonaHistory();
  }, [loadSnapshots, loadLearnedPrefs, loadPersonaHistory]);

  return {
    snapshots, snapshotsLoading, snapshotsError,
    learnedPrefs, prefsLoading,
    personaSummary,
    personaHistory, historyLoading,
    preheat, preheatLoading, preheatResult, preheatError,
    refresh: () => { loadSnapshots(); loadLearnedPrefs(); loadPersonaHistory(); },
  };
}
