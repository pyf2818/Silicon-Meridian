/**
 * useSnapshotPreheat - Phase 3 Task B8
 * Lazy 预热触发：用户登录后若今日快照缺失，自动调 /api/profile/snapshots/preheat
 *
 * 触发条件：enabled && llmConfig.baseUrl && 今日无 snapshot
 * 行为：
 *   - 成功：写入 profileStore.dailyProfileSnapshots
 *   - 失败：silent，不影响主流程（cron 6:00 还会再跑）
 *   - 30s 超时，避免阻塞用户操作
 */
import { useState, useEffect } from 'react';
import { useProfileStore } from '../store';
import { normalizeError } from '../utils/dashboardBuilders.js';

const PREHEAT_TIMEOUT_MS = 30_000;

export function useSnapshotPreheat({ enabled = false, llmConfig } = {}) {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !llmConfig?.baseUrl) return;

    const today = new Date().toISOString().slice(0, 10);
    const hasToday = useProfileStore
      .getState()
      .dailyProfileSnapshots.some(s => s?.date === today);
    if (hasToday) {
      setStatus('ready');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PREHEAT_TIMEOUT_MS);

    setStatus('loading');
    fetch('/api/profile/snapshots/preheat', {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.ok) {
          setSnapshot(data.snapshot);
          setStatus('ready');
          if (data.snapshot?.briefing) {
            useProfileStore.getState().setDailyProfileSnapshots(prev =>
              [...prev, { date: today, ...data.snapshot.briefing }].slice(-30)
            );
          }
        } else {
          setError(normalizeError(data.error) || '预热失败');
          setStatus('error');
        }
      })
      .catch(err => {
        if (cancelled) return;
        if (err.name === 'AbortError') {
          setError('预热超时');
        } else {
          setError(normalizeError(err) || '预热失败');
        }
        setStatus('error');
      })
      .finally(() => {
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, llmConfig?.baseUrl]);

  return { status, snapshot, error };
}
