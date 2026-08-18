import React from 'react';

function truncateUrl(url, maxLength) {
  if (!url) return '';
  return url.length > maxLength ? url.slice(0, maxLength) + '...' : url;
}

function normalizeSourceUrl(url) {
  return (url || '').replace(/\/$/, '').toLowerCase();
}

export default function SourceOpsPanel({
  allSources,
  customSources,
  disabledSources,
  sourceHealth,
  setSourceTypeTab,
  setGradeFilter,
  setStatusFilter,
  setCustomSourceFilter,
  sourceDiscoveryUrl,
  setSourceDiscoveryUrl,
  sourceDiscoveryState,
  discoverSource,
  addDiscoveredSource,
  verifyAllSources,
  verifyingAllSources,
}) {
  const managedSources = [...(allSources || []), ...(customSources || [])].filter(source => source?.name || source?.url);
  const enabledSources = managedSources.filter(source => !disabledSources.includes(source.name));
  const healthValues = Object.values(sourceHealth || {});
  const healthyCount = healthValues.filter(health => health.status === 'healthy').length;
  const warningCount = healthValues.filter(health => health.status === 'warning').length;
  const errorCount = healthValues.filter(health => health.status === 'error').length;
  const urlCounts = managedSources.reduce((map, source) => {
    if (!source.url) return map;
    const key = normalizeSourceUrl(source.url);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const duplicateUrlCount = [...urlCounts.values()].filter(count => count > 1).length;
  const premiumSourceCount = managedSources.filter(source => ['S', 'A'].includes(source.grade)).length;
  const disabledCount = managedSources.length - enabledSources.length;
  const customCount = customSources?.length || 0;
  const reviewCount = warningCount + errorCount;
  const premiumRatio = managedSources.length ? Math.round((premiumSourceCount / managedSources.length) * 100) : 0;
  const healthCoverageRatio = managedSources.length ? Math.round((healthValues.length / managedSources.length) * 100) : 0;

  const resetCommonFilters = () => {
    setGradeFilter?.('all');
    setStatusFilter?.('all');
    setCustomSourceFilter?.('all');
  };

  const focusActions = [
    {
      id: 'premium',
      label: '高价值',
      value: premiumSourceCount,
      note: 'S/A 级源',
      onClick: () => {
        setSourceTypeTab('builtin');
        setGradeFilter?.('S');
        setStatusFilter?.('all');
      },
    },
    {
      id: 'review',
      label: '待复核',
      value: reviewCount,
      note: '警告/异常',
      attention: reviewCount > 0,
      onClick: () => {
        setSourceTypeTab('custom');
        setCustomSourceFilter?.(errorCount > 0 ? 'error' : 'warning');
      },
    },
    {
      id: 'disabled',
      label: '已禁用',
      value: disabledCount,
      note: '未投喂',
      onClick: () => {
        setSourceTypeTab('builtin');
        setStatusFilter?.('disabled');
        setGradeFilter?.('all');
      },
    },
    {
      id: 'custom',
      label: '自定义',
      value: customCount,
      note: '用户源',
      onClick: () => {
        setSourceTypeTab('custom');
        resetCommonFilters();
      },
    },
    {
      id: 'verified',
      label: '已检测',
      value: `${healthCoverageRatio}%`,
      note: '健康覆盖率',
      onClick: () => verifyAllSources?.(),
      disabled: verifyingAllSources,
    },
  ];

  const recommendedActions = [
    reviewCount > 0 && {
      title: '优先复核不稳定源',
      detail: `${reviewCount} 个源存在健康信号，扩展覆盖前需要先关注。`,
      action: '前往复核',
      onClick: () => {
        setSourceTypeTab('custom');
        setCustomSourceFilter?.(errorCount > 0 ? 'error' : 'warning');
      },
    },
    duplicateUrlCount > 0 && {
      title: '清理重复订阅',
      detail: `${duplicateUrlCount} 个订阅链接在库中重复，会浪费抓取配额。`,
      action: '查看源',
      onClick: () => {
        setSourceTypeTab('builtin');
        resetCommonFilters();
      },
    },
    premiumRatio < 35 && {
      title: '提升高等级源密度',
      detail: `当前仅 ${premiumRatio}% 的源为 S/A 级，优先信任源而非广覆盖。`,
      action: '查看 S 级',
      onClick: () => {
        setSourceTypeTab('builtin');
        setGradeFilter?.('S');
      },
    },
    customCount === 0 && {
      title: '添加第一个聚焦源',
      detail: '通过源发现，添加匹配你画像的小众订阅。',
      action: '自定义源',
      onClick: () => {
        setSourceTypeTab('custom');
        resetCommonFilters();
      },
    },
  ].filter(Boolean).slice(0, 3);

  return (
    <>
      <div className="source-ops-dashboard">
        <div className="source-ops-header">
          <div>
            <span>运营视图</span>
            <strong>少而精，管理优质信息源</strong>
          </div>
          <div className="source-ops-actions">
            <button type="button" onClick={() => setSourceTypeTab('custom')}>自定义</button>
            <button type="button" onClick={() => { setGradeFilter('S'); setSourceTypeTab('builtin'); }}>S 级</button>
            <button type="button" onClick={verifyAllSources} disabled={verifyingAllSources}>
              {verifyingAllSources ? '检测中...' : '检测'}
            </button>
          </div>
        </div>
        <div className="source-ops-grid">
          <div className="source-ops-card"><span>总数</span><strong>{managedSources.length}</strong><small>{enabledSources.length} 个已启用</small></div>
          <div className="source-ops-card"><span>高质量</span><strong>{premiumSourceCount}</strong><small>S/A 级占比 {premiumRatio}%</small></div>
          <div className="source-ops-card"><span>健康</span><strong>{healthyCount}</strong><small>{warningCount} 警告 / {errorCount} 异常</small></div>
          <div className={`source-ops-card ${duplicateUrlCount ? 'attention' : ''}`}><span>重复源</span><strong>{duplicateUrlCount}</strong><small>{duplicateUrlCount ? '存在重复订阅，请检查' : '无重复订阅'}</small></div>
        </div>
        <div className="source-focus-strip" aria-label="信息源聚焦筛选">
          {focusActions.map(action => (
            <button
              key={action.id}
              type="button"
              className={action.attention ? 'attention' : ''}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              <span>{action.label}</span>
              <strong>{action.value}</strong>
              <small>{action.note}</small>
            </button>
          ))}
        </div>
        {recommendedActions.length > 0 && (
          <div className="source-action-queue">
            <div className="source-action-queue-title">
              <span>下一步行动</span>
              <strong>让信息源库更小更智能</strong>
            </div>
            <div className="source-action-list">
              {recommendedActions.map(action => (
                <div key={action.title} className="source-action-item">
                  <div>
                    <strong>{action.title}</strong>
                    <p>{action.detail}</p>
                  </div>
                  <button type="button" onClick={action.onClick}>{action.action}</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="source-discovery-panel">
        <div className="source-discovery-copy">
          <span>信息源发现</span>
          <strong>发现可靠的 RSS / Atom 订阅</strong>
          <p>输入主页或订阅链接，系统自动发现候选、验证，并让你添加最佳源。</p>
        </div>
        <div className="source-discovery-form">
          <input
            type="text"
            value={sourceDiscoveryUrl}
            onChange={event => setSourceDiscoveryUrl(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') discoverSource(); }}
            placeholder="https://example.com"
            className="source-search-input"
          />
          <button type="button" onClick={discoverSource} disabled={sourceDiscoveryState.loading}>
            {sourceDiscoveryState.loading ? '发现中...' : '发现'}
          </button>
        </div>
        {sourceDiscoveryState.error && (
          <div className="source-discovery-error">{sourceDiscoveryState.error}</div>
        )}
        {sourceDiscoveryState.result?.candidates?.length > 0 && (
          <div className="source-discovery-results">
            {sourceDiscoveryState.result.candidates.map(candidate => (
              <div key={candidate.url} className="source-discovery-card">
                <div className="source-discovery-main">
                  <strong>{candidate.title}</strong>
                  <span title={candidate.url}>{truncateUrl(candidate.url, 76)}</span>
                  <p>{candidate.description || candidate.message || '已验证的候选源'}</p>
                </div>
                <div className="source-discovery-meta">
                  <span>{candidate.itemCount || 0} 条</span>
                  <span>{candidate.suggestedGrade || 'D'} 级</span>
                  <span>{candidate.score || 0}/100</span>
                </div>
                <div className="source-discovery-actions">
                  <button type="button" onClick={() => addDiscoveredSource(candidate)}>添加</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}