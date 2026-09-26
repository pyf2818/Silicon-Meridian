import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ICONS, REGION_MAP, AGENT_CATEGORIES } from '../constants/index.jsx';
import { showToast } from '../utils/toast.js';
import SourcesTab from './settings/SourcesTab.jsx';
import AgentsTab from './settings/AgentsTab.jsx';
import CustomToolsPanel from './settings/CustomToolsPanel.jsx';
import SandboxPanel from './settings/SandboxPanel.jsx';
import LlmTab from './settings/LlmTab.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import AboutTab from './settings/AboutTab.jsx';
import DesktopTab from './settings/DesktopTab.jsx';
import AppearanceTab from './settings/AppearanceTab.jsx';
import NotificationsTab from './settings/NotificationsTab.jsx';
import ShortcutsTab from './settings/ShortcutsTab.jsx';
import HelpTab from './settings/HelpTab.jsx';
import PlannedTab from './settings/PlannedTab.jsx';
import pkg from '../../package.json';
import { SC_ICONS } from './settings/scIcons.jsx';

function truncateUrl(url, maxLength) {
  if (!url) return '';
  return url.length > maxLength ? url.slice(0, maxLength) + '...' : url;
}
function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}
function getSourceHealthIndicator(sourceHealth, sourceId) {
  const health = sourceHealth[sourceId];
  if (!health) return <span className="health-indicator health-unknown" title="未验证">?</span>;
  if (health.status === 'healthy') return <span className="health-indicator health-good" title="健康">✓</span>;
  if (health.status === 'warning') return <span className="health-indicator health-warning" title="警告">!</span>;
  if (health.status === 'error') return <span className="health-indicator health-bad" title="错误">✗</span>;
  return <span className="health-indicator health-unknown" title="未验证">?</span>;
}

// 导航分组（偏好 / 智能引擎 / 数据 / 系统）
const NAV_GROUPS = [
  {
    id: 'preferences',
    items: [
      { id: 'appearance', icon: 'palette' },
      { id: 'general', icon: 'sliders' },
      { id: 'notifications', icon: 'bell' },
    ],
  },
  {
    id: 'engine',
    items: [
      { id: 'sources', icon: 'rss' },
      { id: 'llm', icon: 'cpu' },
      { id: 'agents', icon: 'bot' },
      { id: 'tools', icon: 'tool' },
      { id: 'sandbox', icon: 'shield' },
    ],
  },
  {
    id: 'data',
    items: [
      { id: 'account', icon: 'user' },
      { id: 'personalization', icon: 'sparkles' },
      { id: 'storage', icon: 'database' },
    ],
  },
  {
    id: 'system',
    items: [
      { id: 'desktop', icon: 'sliders' },
      { id: 'shortcuts', icon: 'keyboard' },
      { id: 'labs', icon: 'flask' },
      { id: 'help', icon: 'help' },
      { id: 'about', icon: 'info' },
    ],
  },
];

export default function SettingsModal({
  settingsTab, setSettingsTab,
  showSettings, setShowSettings,
  stats,
  blocked, setBlocked,
  allSources, customSources, setCustomSources, disabledSources, setDisabledSources, sourceGrades,
  newSource, setNewSource, editingSource, setEditingSource,
  showSourceForm, setShowSourceForm,
  searchQuery, setSearchQuery,
  customSourceFilter, setCustomSourceFilter,
  regionFilter, setRegionFilter,
  statusFilter, setStatusFilter,
  gradeFilter, setGradeFilter,
  sourceTypeTab, setSourceTypeTab,
  sourceHealth, setSourceHealth,
  sourceFilter, setSourceFilter,
  addCustomSource, removeCustomSource, verifySource, verifyAllSources,
  verifySingleSource, exportSources, importSources,
  sourceDiscoveryUrl, setSourceDiscoveryUrl, sourceDiscoveryState, discoverSource, addDiscoveredSource,
  verifyingAllSources, allSourcesVerifyResults, setAllSourcesVerifyResults,
  autoMonitorEnabled, setAutoMonitorEnabled,
  monitorInterval, setMonitorInterval,
  monitorAlerts, showAlertPanel, setShowAlertPanel, clearAlerts,
  llmConfig, setLlmConfig, llmModels, llmFetching, llmFetchError,
  llmTestResult, llmTesting, llmManualInput, setLlmManualInput,
  showLlmQuickConfig, setShowLlmQuickConfig,
  allLlmModels,
  fetchLlmModels, addManualModel, removeManualModel, testLlmConnection,
  LLM_PRESETS,
  llmPresets,
  activePresetId,
  currentPresetId,
  applyBuiltinTemplate,
  applyUserPreset,
  saveAsPreset,
  deletePreset,
  savePresetName,
  setSavePresetName,
  agents, setAgents, currentAgent, setCurrentAgent,
  showAgentForm, setShowAgentForm, editingAgent, setEditingAgent,
  newAgent, setNewAgent, agentFilter, setAgentFilter,
  agentPromptRefining, setAgentPromptRefining,
  elfAvatar, setElfAvatar, elfAvatarHistory, setElfAvatarHistory,
  elfName, setElfName,
  formatRelative,
  loadNews,
}) {
  const [showSourceAdvanced, setShowSourceAdvanced] = React.useState(false);
  const [query, setQuery] = useState('');
  const { t } = useTranslation();

  if (!showSettings) return null;

  const tabLabel = (id) => t(`settings.tabs.${id}`, id);
  const q = query.trim().toLowerCase();
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => !q || tabLabel(it.id).toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);

  const renderTab = () => {
    switch (settingsTab) {
      case 'appearance':
        return <AppearanceTab onNavigate={setSettingsTab} />;
      case 'notifications':
        return <NotificationsTab autoMonitorEnabled={autoMonitorEnabled} setAutoMonitorEnabled={setAutoMonitorEnabled} />;
      case 'shortcuts':
        return <ShortcutsTab />;
      case 'help':
        return <HelpTab onNavigate={setSettingsTab} />;
      case 'account':
      case 'personalization':
      case 'storage':
      case 'labs':
        return <PlannedTab section={settingsTab} />;
      case 'general':
        return (
          <div className="sc-tab">
            <div className="sc-tab-head">
              <h2 className="sc-tab-title">{t('settings.tabs.general')}</h2>
              <p className="sc-tab-desc">{t('settings.general.languageDesc')}</p>
            </div>
            <div className="sc-card">
              <div className="sc-row">
                <div className="sc-row-main">
                  <div className="sc-row-label">{t('settings.general.language')}</div>
                  <div className="sc-row-desc">{t('settings.general.languageDesc')}</div>
                </div>
                <div className="sc-row-control">
                  <LanguageSwitcher variant="full" />
                </div>
              </div>
              <div className="sc-row">
                <div className="sc-row-main">
                  <div className="sc-row-label">{t('settings.general.blockedTitle', '关键词屏蔽')}</div>
                  <div className="sc-row-desc">{t('settings.general.blockedDesc', '输入屏蔽词，逗号分隔')} · {t('settings.general.blockedCount', '已过滤 {{n}} 条资讯', { n: stats.blockedCount })}</div>
                </div>
              </div>
              <textarea
                className="sc-textarea"
                value={blocked}
                onChange={(e) => setBlocked(e.target.value)}
                placeholder={t('settings.general.blockedPlaceholder', '输入屏蔽词，逗号分隔')}
              />
            </div>
          </div>
        );
      case 'sources':
        return (
          <div className="sc-tab">
            <SourcesTab
              allSources={allSources}
              customSources={customSources}
              setCustomSources={setCustomSources}
              disabledSources={disabledSources}
              setDisabledSources={setDisabledSources}
              sourceHealth={sourceHealth}
              setSourceHealth={setSourceHealth}
              sourceGrades={sourceGrades}
              newSource={newSource}
              setNewSource={setNewSource}
              editingSource={editingSource}
              setEditingSource={setEditingSource}
              showSourceForm={showSourceForm}
              setShowSourceForm={setShowSourceForm}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              customSourceFilter={customSourceFilter}
              setCustomSourceFilter={setCustomSourceFilter}
              regionFilter={regionFilter}
              setRegionFilter={setRegionFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              gradeFilter={gradeFilter}
              setGradeFilter={setGradeFilter}
              sourceTypeTab={sourceTypeTab}
              setSourceTypeTab={setSourceTypeTab}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              sourceDiscoveryUrl={sourceDiscoveryUrl}
              setSourceDiscoveryUrl={setSourceDiscoveryUrl}
              sourceDiscoveryState={sourceDiscoveryState}
              discoverSource={discoverSource}
              addDiscoveredSource={addDiscoveredSource}
              verifyAllSources={verifyAllSources}
              verifyingAllSources={verifyingAllSources}
              verifySingleSource={verifySingleSource}
              allSourcesVerifyResults={allSourcesVerifyResults}
              setAllSourcesVerifyResults={setAllSourcesVerifyResults}
              autoMonitorEnabled={autoMonitorEnabled}
              setAutoMonitorEnabled={setAutoMonitorEnabled}
              monitorInterval={monitorInterval}
              setMonitorInterval={setMonitorInterval}
              monitorAlerts={monitorAlerts}
              clearAlerts={clearAlerts}
              truncateUrl={truncateUrl}
              truncateText={truncateText}
              getSourceHealthIndicator={getSourceHealthIndicator}
              showSourceAdvanced={showSourceAdvanced}
              setShowSourceAdvanced={setShowSourceAdvanced}
            />
          </div>
        );
      case 'llm':
        return (
          <div className="sc-tab">
            <LlmTab
              llmConfig={llmConfig}
              setLlmConfig={setLlmConfig}
              llmFetching={llmFetching}
              llmFetchError={llmFetchError}
              allLlmModels={allLlmModels}
              llmManualInput={llmManualInput}
              setLlmManualInput={setLlmManualInput}
              addManualModel={addManualModel}
              removeManualModel={removeManualModel}
              fetchLlmModels={fetchLlmModels}
              testLlmConnection={testLlmConnection}
              llmTesting={llmTesting}
              llmTestResult={llmTestResult}
              LLM_PRESETS={LLM_PRESETS}
              llmPresets={llmPresets}
              activePresetId={activePresetId}
              currentPresetId={currentPresetId}
              applyBuiltinTemplate={applyBuiltinTemplate}
              applyUserPreset={applyUserPreset}
              saveAsPreset={saveAsPreset}
              deletePreset={deletePreset}
              savePresetName={savePresetName}
              setSavePresetName={setSavePresetName}
            />
          </div>
        );
      case 'agents':
        return (
          <div className="sc-tab">
            <AgentsTab
              elfName={elfName}
              setElfName={setElfName}
              elfAvatar={elfAvatar}
              setElfAvatar={setElfAvatar}
              agents={agents}
              setAgents={setAgents}
              currentAgent={currentAgent}
              setCurrentAgent={setCurrentAgent}
              agentFilter={agentFilter}
              setAgentFilter={setAgentFilter}
              editingAgent={editingAgent}
              setEditingAgent={setEditingAgent}
              showAgentForm={showAgentForm}
              setShowAgentForm={setShowAgentForm}
              newAgent={newAgent}
              setNewAgent={setNewAgent}
              agentPromptRefining={agentPromptRefining}
              setAgentPromptRefining={setAgentPromptRefining}
              llmConfig={llmConfig}
            />
          </div>
        );
      case 'tools':
        return <div className="sc-tab"><CustomToolsPanel /></div>;
      case 'sandbox':
        return <div className="sc-tab"><SandboxPanel /></div>;
      case 'desktop':
        return <div className={'sc-tab'}><DesktopTab /></div>;
      case 'about':
        return <div className="sc-tab"><AboutTab /></div>;
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-console" onClick={(e) => e.stopPropagation()}>
        <header className="sc-header">
          <div>
            <h2 className="sc-title">
              {t('settings.title')}
              <span className="sc-title-seal">Silicon Meridian</span>
            </h2>
            <div className="sc-subtitle">{t('settings.subtitle', '智控中枢 · 个性化你的情报工作台')}</div>
          </div>
          <div className="sc-header-spacer" />
          <div className="sc-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.search', '搜索设置')}
              aria-label={t('settings.search', '搜索设置')}
            />
          </div>
          <span className="sc-saved">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            {t('settings.saved', '已保存')}
          </span>
          <button className="sc-close" onClick={() => setShowSettings(false)} aria-label="关闭">{ICONS.x}</button>
        </header>

        <div className="sc-body">
          <nav className="sc-rail" aria-label="设置导航">
            {groups.map((g) => (
              <div className="sc-rail-group" key={g.id}>
                <div className="sc-group-label">{t(`settings.groups.${g.id}`, g.id)}</div>
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    className={`sc-nav-item ${settingsTab === it.id ? 'active' : ''}`}
                    onClick={() => setSettingsTab(it.id)}
                  >
                    <span className="sc-nav-icon">{SC_ICONS[it.icon]}</span>
                    <span>{tabLabel(it.id)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="sc-content">
            {renderTab()}
          </div>
        </div>

        <footer className="sc-footer">
          <span className="sc-footer-meta">万般硅川 · v{pkg.version} · {NAV_GROUPS.reduce((n, g) => n + g.items.length, 0)} 项设置</span>
          <div className="sc-footer-actions">
            <button className="sc-btn" onClick={() => setShowSettings(false)}>{t('settings.cancel', '取消')}</button>
            <button className="sc-btn sc-btn-primary" onClick={() => { loadNews(); setShowSettings(false); }}>{t('settings.done', '保存并刷新')}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
