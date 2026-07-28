// src/hooks/useProfileDashboard.js
// Phase 4: Profile Dashboard 聚合数据 hook
// 聚合 snapshots / learnedPreferences / personaSummary / preheat API

import { useState, useEffect, useCallback } from 'react';
import { useProfileStore } from '../store';
import { buildTrendSeries, buildAiStatusCounts, normalizeError } from '../utils/dashboardBuilders.js';

// Re-export 纯函数（便于从 hook 文件统一 import）
export { buildTrendSeries, buildAiStatusCounts, normalizeError };

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
  }, [loadSnapshots, loadLearnedPrefs]);

  return {
    snapshots, snapshotsLoading, snapshotsError,
    learnedPrefs, prefsLoading,
    personaSummary,
    preheat, preheatLoading, preheatResult, preheatError,
    refresh: () => { loadSnapshots(); loadLearnedPrefs(); },
  };
}
