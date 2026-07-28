import { useEffect, useRef } from 'react';
import { showToast } from '../utils/toast.js';

function tierMap(rows) { return Object.fromEntries((rows || []).map(row => [row.id, row.tier])); }

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload?.error?.message || '画像同步失败');
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

// ============ Phase 1.4 Task 19: 纯函数 helper ============
// 抽离出可测试的纯逻辑，避免依赖 React 渲染进行单元测试。

/**
 * 合并远端 snapshots 到本地，规则：
 * - 本地已有的日期：保留本地（本地优先，避免本地今日 snapshot 被远端旧版本覆盖）
 * - 远端新增的日期：加入本地
 * - 按 date 倒序排序，最多保留 30 条
 *
 * @param {Array<{date:string, confidence:number, summary?:string}>} local
 * @param {Array<{date:string, confidence:number, summary?:string}>} remote
 * @returns {Array} merged snapshots (date desc, cap 30)
 */
export function mergeSnapshots(local = [], remote = []) {
  if (!Array.isArray(local)) local = [];
  if (!Array.isArray(remote)) remote = [];
  if (remote.length === 0) return local;

  const localDates = new Set(local.map(s => s.date));
  const additions = remote.filter(s => s && s.date && !localDates.has(s.date));
  const merged = [...local, ...additions];

  return merged
    .filter(s => s && typeof s.date === 'string')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
}

/**
 * 构造 PUT /api/profile/state 请求体。
 *
 * 规则：
 * - 原有 3 块（domainTiers/sourceTiers/specialFollows）+ expectedVersion 必带
 * - briefingConfig 仅在提供时才放入 payload（避免 null 覆盖远端）
 * - dailyProfileSnapshots 仅传今日（最新日期）一条，避免全量传输
 * - 空 snapshots 列表 -> 不传该字段
 *
 * @param {Object} state - 包含 5 块状态 + expectedVersion
 * @returns {Object} PUT 请求体
 */
export function buildSavePayload(state = {}) {
  const {
    domainTiers = {},
    sourceTiers = {},
    specialFollows = [],
    briefingConfig = null,
    dailyProfileSnapshots = [],
    expectedVersion = null,
  } = state;

  const payload = {
    domainTiers,
    sourceTiers,
    specialFollows,
    expectedVersion,
  };

  // briefingConfig 仅在提供时才放入 payload（避免 null 覆盖远端）
  if (briefingConfig && typeof briefingConfig === 'object' && !Array.isArray(briefingConfig)) {
    payload.briefingConfig = briefingConfig;
  }

  // dailyProfileSnapshots：仅传今日（最新日期）一条
  if (Array.isArray(dailyProfileSnapshots) && dailyProfileSnapshots.length > 0) {
    const sorted = [...dailyProfileSnapshots]
      .filter(s => s && typeof s.date === 'string')
      .sort((a, b) => b.date.localeCompare(a.date));
    if (sorted.length > 0) {
      payload.dailyProfileSnapshots = [sorted[0]];
    }
  }
  if (!payload.dailyProfileSnapshots) {
    payload.dailyProfileSnapshots = [];
  }

  return payload;
}

export function useProfileSync({
  user,
  // 原有三块
  domainTiers, sourceTiers, specialFollows,
  setDomainTiers, setSourceTiers, setSpecialFollows,
  // Phase 1.4 Task 19: 新增两块
  dailyProfileSnapshots = [],
  briefingConfig = null,
  setDailyProfileSnapshots = () => {},
  setBriefingConfig = () => {},
}) {
  const hydratedUser = useRef('');
  const version = useRef(null);
  const skipSave = useRef(false);
  const pending = useRef(null);
  const saving = useRef(false);
  const timer = useRef(null);
  const drain = useRef(null);

  drain.current = async () => {
    if (saving.current || !user?.id) return;
    saving.current = true;
    try {
      while (pending.current) {
        const state = pending.current;
        pending.current = null;
        try {
          const body = buildSavePayload({ ...state, expectedVersion: version.current });
          const payload = await responseJson(await fetch('/api/profile/state', {
            method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }));
          version.current = payload.data?.version || version.current;
        } catch (error) {
          if (error.code === 'PROFILE_VERSION_CONFLICT') {
            const latest = await fetch('/api/profile/state', { credentials: 'include' }).then(responseJson).catch(() => null);
            version.current = latest?.data?.version || version.current;
            // 重新拉取远端数据并合并（避免覆盖远端最新）
            if (latest?.data) {
              const remote = latest.data;
              skipSave.current = true;
              if (remote.domains?.length) setDomainTiers(tierMap(remote.domains));
              if (remote.sources?.length) setSourceTiers(tierMap(remote.sources));
              if (remote.specialFollows?.length) setSpecialFollows(remote.specialFollows);
              if (remote.dailyProfileSnapshots?.length) {
                setDailyProfileSnapshots(prev => mergeSnapshots(prev, remote.dailyProfileSnapshots));
              }
              if (remote.briefingConfig) setBriefingConfig(remote.briefingConfig);
            }
            showToast('画像在其他窗口或设备发生变化，本次修改未覆盖远端数据');
          } else {
            showToast(`画像未保存：${error.message}`);
          }
          break;
        }
      }
    } finally {
      saving.current = false;
      if (pending.current) queueMicrotask(() => drain.current?.());
    }
  };

  useEffect(() => {
    clearTimeout(timer.current);
    pending.current = null;
    if (!user?.id) { hydratedUser.current = ''; version.current = null; return undefined; }
    if (hydratedUser.current === user.id) return undefined;
    let cancelled = false;
    fetch('/api/profile/state', { credentials: 'include' }).then(responseJson).then(payload => {
      if (cancelled) return;
      const state = payload.data || {};
      version.current = state.version || 1;
      const hasRemoteData = (state.domains?.length || state.sources?.length || state.specialFollows?.length) > 0;
      const hasRemoteSnapshots = state.dailyProfileSnapshots?.length > 0;
      const hasRemoteBriefing = !!state.briefingConfig;
      if (hasRemoteData || hasRemoteSnapshots || hasRemoteBriefing) {
        skipSave.current = true;
        if (hasRemoteData) {
          setDomainTiers(tierMap(state.domains));
          setSourceTiers(tierMap(state.sources));
          setSpecialFollows(state.specialFollows || []);
        }
        // Phase 1.4 Task 19: 合并远端 snapshots（远端有则覆盖本地，本地新于远端的保留）
        if (hasRemoteSnapshots) {
          setDailyProfileSnapshots(prev => mergeSnapshots(prev, state.dailyProfileSnapshots));
        }
        if (hasRemoteBriefing) {
          setBriefingConfig(state.briefingConfig);
        }
      }
      hydratedUser.current = user.id;
    }).catch(error => {
      if (!cancelled) showToast(`画像加载失败：${error.message}`);
    });
    return () => { cancelled = true; };
  }, [user?.id, setDomainTiers, setSourceTiers, setSpecialFollows, setDailyProfileSnapshots, setBriefingConfig]);

  useEffect(() => {
    if (!user?.id || hydratedUser.current !== user.id) return undefined;
    if (skipSave.current) { skipSave.current = false; return undefined; }
    pending.current = { domainTiers, sourceTiers, specialFollows, briefingConfig, dailyProfileSnapshots };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => drain.current?.(), 600);
    return () => clearTimeout(timer.current);
  }, [user?.id, domainTiers, sourceTiers, specialFollows, briefingConfig, dailyProfileSnapshots]);
}
