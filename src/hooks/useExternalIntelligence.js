// useExternalIntelligence - 行业情报外部数据加载，从 App.jsx 1014-1020 + 4314-4356 行提取

import { useState, useCallback } from 'react';

export function useExternalIntelligence() {
  const [externalIntelligenceItems, setExternalIntelligenceItems] = useState([]);
  const [externalIntelligenceOpportunities, setExternalIntelligenceOpportunities] = useState([]);
  const [externalIntelligenceWeeklySectors, setExternalIntelligenceWeeklySectors] = useState(null);
  const [externalIntelligenceAlerts, setExternalIntelligenceAlerts] = useState([]);
  const [externalIntelligenceLoading, setExternalIntelligenceLoading] = useState(false);
  const [externalIntelligenceError, setExternalIntelligenceError] = useState('');
  const [externalIntelligenceUpdatedAt, setExternalIntelligenceUpdatedAt] = useState('');

  const loadExternalIntelligence = useCallback(async (selectedInterests = [], profile = {}) => {
    setExternalIntelligenceLoading(true);
    setExternalIntelligenceError('');
    try {
      // 画像闭环（B3）：把特殊关注（keyword 型→follows 文本匹配）与信息源分级（源名→sourceTiers 源匹配）
      // 一并传给服务端 personalScore，让 28pt follows / 14pt sourceTiers 加分真正生效
      const { sourceTiers = {}, specialFollows = [] } = profile || {};
      const keywordFollows = (specialFollows || [])
        .filter(f => f && f.type === 'keyword' && f.target)
        .map(f => String(f.target).trim())
        .filter(Boolean);
      const sourceTargets = (specialFollows || [])
        .filter(f => f && f.type === 'source' && f.target)
        .map(f => String(f.target).trim())
        .filter(Boolean);
      const tierNames = Object.entries(sourceTiers || {})
        .filter(([, tier]) => tier && tier !== 'none')
        .map(([name]) => String(name).trim())
        .filter(Boolean);
      const follows = [...new Set(keywordFollows)].join(',');
      const sourceTiersParam = [...new Set([...tierNames, ...sourceTargets])].join(',');

      const applyProfile = (params) => {
        if (follows) params.set('follows', follows);
        if (sourceTiersParam) params.set('sourceTiers', sourceTiersParam);
      };

      const intelligenceParams = new URLSearchParams({ take: '140', storage: 'auto' });
      if (selectedInterests.length) intelligenceParams.set('interests', selectedInterests.join(','));
      applyProfile(intelligenceParams);
      const opportunityParams = new URLSearchParams({ take: '80', storage: 'auto' });
      if (selectedInterests.length) opportunityParams.set('interests', selectedInterests.join(','));
      applyProfile(opportunityParams);
      const weeklyParams = new URLSearchParams({ take: '160', storage: 'auto', days: '7' });
      if (selectedInterests.length) weeklyParams.set('interests', selectedInterests.join(','));
      applyProfile(weeklyParams);
      const alertParams = new URLSearchParams({ take: '160', storage: 'auto', days: '7', limit: '10' });
      if (selectedInterests.length) alertParams.set('interests', selectedInterests.join(','));
      applyProfile(alertParams);
      const [eventsResponse, opportunitiesResponse, weeklyResponse, alertsResponse] = await Promise.all([
        fetch(`/api/intelligence/events?${intelligenceParams}`),
        fetch(`/api/intelligence/opportunities?${opportunityParams}`).catch(() => null),
        fetch(`/api/intelligence/weekly-sectors?${weeklyParams}`).catch(() => null),
        fetch(`/api/intelligence/alerts?${alertParams}`).catch(() => null),
      ]);
      const eventsPayload = await eventsResponse.json();
      const opportunitiesPayload = opportunitiesResponse ? await opportunitiesResponse.json().catch(() => ({ ok: false, opportunities: [] })) : { ok: false, opportunities: [] };
      const weeklyPayload = weeklyResponse ? await weeklyResponse.json().catch(() => ({ ok: false })) : { ok: false };
      const alertsPayload = alertsResponse ? await alertsResponse.json().catch(() => ({ ok: false, alerts: [] })) : { ok: false, alerts: [] };
      setExternalIntelligenceOpportunities(opportunitiesPayload.ok && Array.isArray(opportunitiesPayload.opportunities) ? opportunitiesPayload.opportunities : []);
      setExternalIntelligenceWeeklySectors(weeklyPayload.ok ? weeklyPayload : null);
      setExternalIntelligenceAlerts(alertsPayload.ok && Array.isArray(alertsPayload.alerts) ? alertsPayload.alerts : []);
      if (eventsPayload.ok && Array.isArray(eventsPayload.events) && eventsPayload.events.length > 0) {
        setExternalIntelligenceItems(eventsPayload.events);
        setExternalIntelligenceUpdatedAt(eventsPayload.updatedAt || new Date().toISOString());
        return;
      }

      const itemsResponse = await fetch('/api/intelligence/items?take=120');
      const itemsPayload = await itemsResponse.json();
      if (!itemsPayload.ok) throw new Error(itemsPayload.error?.message || '行业情报加载失败');
      setExternalIntelligenceItems(Array.isArray(itemsPayload.items) ? itemsPayload.items : []);
      setExternalIntelligenceUpdatedAt(itemsPayload.updatedAt || new Date().toISOString());
    } catch (error) {
      setExternalIntelligenceError(error.message || '行业情报加载失败');
    } finally {
      setExternalIntelligenceLoading(false);
    }
  }, []);

  return {
    externalIntelligenceItems, setExternalIntelligenceItems,
    externalIntelligenceOpportunities, setExternalIntelligenceOpportunities,
    externalIntelligenceWeeklySectors, setExternalIntelligenceWeeklySectors,
    externalIntelligenceAlerts, setExternalIntelligenceAlerts,
    externalIntelligenceLoading,
    externalIntelligenceError,
    externalIntelligenceUpdatedAt,
    loadExternalIntelligence,
  };
}
