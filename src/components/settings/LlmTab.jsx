import { ICONS, LLM_PRESETS } from '../../constants/index.jsx';

function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  const d = Math.floor(h / 24);
  return `${d}d 前`;
}

/**
 * SettingsModal > 大模型 Tab（三段式布局，与 LlmQuickConfigModal 视觉+交互完全一致）
 * ① 内置服务商模板
 * ② 我的预设
 * ③ 当前工作配置 + 联网搜索总开关 + 豆包/Tavily Key
 */
export default function LlmTab({
  llmConfig,
  setLlmConfig,
  llmFetching,
  llmFetchError,
  allLlmModels,
  llmManualInput,
  setLlmManualInput,
  addManualModel,
  removeManualModel,
  fetchLlmModels,
  testLlmConnection,
  llmTesting,
  llmTestResult,

  // presets 四件套 + 状态
  LLM_PRESETS: BUILTIN_TEMPLATES = LLM_PRESETS,
  llmPresets,
  activePresetId,
  currentPresetId,
  applyBuiltinTemplate,
  applyUserPreset,
  saveAsPreset,
  deletePreset,
  savePresetName,
  setSavePresetName,
}) {
  const builtinWithCustom = [...BUILTIN_TEMPLATES];
  if (!builtinWithCustom.some(p => p.id === 'custom')) {
    builtinWithCustom.push({ id: 'custom', name: '自定义', baseUrl: '', models: [], abbrev: 'CT', placeholder: 'https://...' });
  }
  const selectedBuiltinId = llmConfig.provider;
  const currentBuiltinPlaceholder =
    builtinWithCustom.find(p => p.id === llmConfig.provider)?.placeholder || 'sk-...';

  const handleSaveAs = () => {
    const presetIdToUpdate = activePresetId && !savePresetName.trim() ? activePresetId : undefined;
    const nameFallback =
      (builtinWithCustom.find(p => p.id === llmConfig.provider)?.name || '自定义') +
      ' · ' +
      (llmConfig.selectedModel || '未选模型').slice(0, 10);
    const usedName = savePresetName.trim() || (presetIdToUpdate ? '' : nameFallback);
    saveAsPreset({ name: usedName, presetId: presetIdToUpdate });
  };

  return (
    <div className="llm-tab-root">
      {/* 1）内置服务商模板 */}
      <div className="setting-item">
        <div className="llm-section-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <label><span className="llm-section-index" style={{ marginRight: 8 }}>1</span>选择服务商模板</label>
            <span className="llm-section-hint">选择后自动填入官方 Base URL 和候选模型，不会擦掉你已填好的 API Key</span>
          </div>
        </div>
        <div className="llm-provider-select-row" style={{ marginTop: 8 }}>
          <select
            className="llm-provider-select"
            value={selectedBuiltinId}
            onChange={e => {
              const tpl = builtinWithCustom.find(p => p.id === e.target.value);
              if (tpl) applyBuiltinTemplate(tpl);
            }}
          >
            {builtinWithCustom.map(tpl => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} ({tpl.id === 'custom' ? '自定义' : (tpl.models?.length ? `${tpl.models.length} 个候选` : '官方')})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 2）我的预设 */}
      <div className="setting-item">
        <div className="llm-section-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <label><span className="llm-section-index" style={{ marginRight: 8 }}>2</span>我的预设</label>
            <span className="llm-section-hint">点击"应用"立即切换整套配置；删除不会影响当前正在运行的配置</span>
          </div>
        </div>
        {llmPresets.length === 0 ? (
          <div className="llm-empty-state" style={{ marginTop: 12 }}>
            <div className="llm-empty-icon">{ICONS.bookmark || '★'}</div>
            <div>
              <p className="llm-empty-title">还没有保存过预设</p>
              <p className="llm-empty-desc">在下方填好 Base URL、API Key、模型后，点"另存为预设"即可存到这里，下次一键切换。</p>
            </div>
          </div>
        ) : (
          <div className="llm-user-presets-list" style={{ marginTop: 12 }}>
            {llmPresets
              .slice()
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .map(preset => {
                const inUse = preset.id === currentPresetId;
                const tpl = builtinWithCustom.find(p => p.id === preset.provider);
                return (
                  <div
                    key={preset.id}
                    className={`llm-preset-row ${inUse ? 'in-use' : ''}`}
                  >
                    <span className="llm-preset-badge" aria-hidden="true">
                      {tpl?.abbrev || (preset.provider || 'CT').toUpperCase().slice(0, 2)}
                    </span>
                    <div className="llm-preset-row-info">
                      <span className="llm-preset-name" title={preset.name}>{preset.name}</span>
                      <span className="llm-preset-sub">
                        {tpl?.name || preset.provider}
                        {preset.selectedModel && ` · ${preset.selectedModel}`}
                      </span>
                    </div>
                    {inUse && <span className="llm-preset-chip using">正在使用</span>}
                    <span className="llm-preset-updated">{formatRelative(preset.updatedAt)}</span>
                    <button
                      type="button"
                      className="llm-btn-apply"
                      disabled={inUse}
                      onClick={() => applyUserPreset(preset)}
                    >应用</button>
                    <button
                      type="button"
                      className="llm-btn-del"
                      onClick={() => deletePreset(preset.id)}
                    >删除</button>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* 3）当前配置 */}
      <div className="setting-item">
        <div className="llm-section-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <label><span className="llm-section-index" style={{ marginRight: 8 }}>3</span>当前配置</label>
            <span className="llm-section-hint">自动保存到浏览器本地；登录后还会跨设备同步到服务器</span>
          </div>
        </div>
        <p className="setting-desc">配置 OpenAI 兼容 API，自动拉取或手动输入模型</p>
        <div className="llm-config-form" style={{ marginTop: 8 }}>
          <div className="llm-config-row">
            <input
              type="text"
              placeholder="API Base URL (如 https://api.openai.com)"
              value={llmConfig.baseUrl}
              onChange={e => setLlmConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
              className="llm-input url-input"
            />
            <input
              type="password"
              placeholder={`API Key (${currentBuiltinPlaceholder})`}
              value={llmConfig.apiKey}
              onChange={e => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
              className="llm-input"
              autoComplete="off"
            />
            <button
              className="fetch-models-btn"
              onClick={fetchLlmModels}
              disabled={llmFetching || !llmConfig.baseUrl}
            >{llmFetching ? '拉取中...' : '拉取模型'}</button>
          </div>
          {llmFetchError && <div className="llm-fetch-error">{llmFetchError}</div>}
          <div className="llm-config-row">
            <select
              className="llm-model-select"
              value={llmConfig.selectedModel}
              onChange={e => setLlmConfig(prev => ({ ...prev, selectedModel: e.target.value }))}
            >
              <option value="">选择模型</option>
              {allLlmModels.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.owned_by ? ` (${m.owned_by})` : ''}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="手动输入模型名称"
              value={llmManualInput}
              onChange={e => setLlmManualInput(e.target.value)}
              className="llm-input"
            />
            <button
              className="add-source-btn"
              onClick={addManualModel}
              disabled={!llmManualInput.trim()}
            >{ICONS.plus}</button>
          </div>
          {(llmConfig.manualModels || []).length > 0 && (
            <div className="manual-models-list">
              {(llmConfig.manualModels || []).map(m => (
                <div key={m.id} className="custom-source-item">
                  <div className="custom-source-info">
                    <span className="custom-source-name">{m.name}</span>
                    <span className="custom-source-region">手动</span>
                  </div>
                  <button className="remove-source-btn" onClick={() => removeManualModel(m.id)}>{ICONS.x}</button>
                </div>
              ))}
            </div>
          )}
          <div className="llm-config-row">
            <input
              className="llm-preset-name-input"
              type="text"
              placeholder="预设名称（填则新建 / 不填则覆盖更新当前预设）"
              value={savePresetName}
              onChange={e => setSavePresetName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="llm-btn-save-as"
              onClick={handleSaveAs}
              disabled={!llmConfig.baseUrl}
              title="把当前配置另存为命名预设，下次一键切换"
              style={{ whiteSpace: 'nowrap' }}
            >另存为预设</button>
            <button
              className="test-llm-btn"
              onClick={testLlmConnection}
              disabled={llmTesting || !llmConfig.baseUrl || !llmConfig.selectedModel}
              style={{ whiteSpace: 'nowrap' }}
            >{llmTesting ? '测试中...' : '测试连接'}</button>
          </div>
          {llmTestResult && (
            <div className={`source-verify-result ${llmTestResult.ok ? 'verify-ok' : 'verify-fail'}`}>
              {llmTestResult.ok
                ? <>{ICONS.check} 连接成功 ({llmTestResult.model}): {llmTestResult.reply}</>
                : <>连接失败: {llmTestResult.message}</>}
            </div>
          )}
        </div>
      </div>

      {/* ========== 联网搜索总开关 ========== */}
      <div className="setting-item">
        <label>联网搜索总开关</label>
        <p className="setting-desc">
          关闭后，Agent 工具列表中的「联网搜索（web_search）」会被移除，LLM 不会发起联网搜索请求，从而节省豆包/Tavily 的调用额度。需要时随时回来打开。
        </p>
        <div className="llm-config-form">
          <div className="llm-config-row" style={{ alignItems: 'center', gap: '10px' }}>
            <label className="llm-toggle-wrap" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={llmConfig.webSearchEnabled !== false}
                onChange={e => setLlmConfig(prev => ({ ...prev, webSearchEnabled: e.target.checked }))}
                style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent-cyan, #22d3ee)' }}
              />
              <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                {llmConfig.webSearchEnabled === false ? '已关闭联网搜索' : '已开启联网搜索'}
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ========== 豆包搜索 Key ========== */}
      <div className="setting-item">
        <label>联网搜索（豆包搜索 API Key · 推荐）</label>
        <p className="setting-desc">
          火山引擎豆包搜索，国内访问稳定，每月 500 次免费。
          请前往 <a href="https://console.volcengine.com/search-infinity/web-search" target="_blank" rel="noreferrer">火山引擎控制台</a> 订阅「豆包搜索 Custom 版」并创建 API Key。
          填写后 Agent 的 web_search 工具将优先使用豆包搜索。
        </p>
        <div className="llm-config-form">
          <div className="llm-config-row">
            <input
              type="password"
              placeholder="豆包搜索 API Key（如 4d0e2***-****-****-****-************）"
              value={llmConfig.doubaoSearchKey || ''}
              onChange={e => setLlmConfig(prev => ({ ...prev, doubaoSearchKey: e.target.value }))}
              className="llm-input"
              autoComplete="off"
            />
            {(llmConfig.doubaoSearchKey || '').trim() && (
              <button
                className="fetch-models-btn"
                onClick={() => setLlmConfig(prev => ({ ...prev, doubaoSearchKey: '' }))}
                title="清空豆包搜索 Key"
              >清空</button>
            )}
          </div>
        </div>
      </div>

      {/* ========== Tavily Key ========== */}
      <div className="setting-item">
        <label>联网搜索（Tavily API Key · 海外备选）</label>
        <p className="setting-desc">
          海外 AI 搜索服务，每月 1000 次免费，<a href="https://tavily.com" target="_blank" rel="noreferrer">tavily.com</a> 注册。
          未填写豆包和 Tavily 时，自动 fallback 到 DuckDuckGo 免费搜索（无需注册，但国内可能不稳定）。
        </p>
        <div className="llm-config-form">
          <div className="llm-config-row">
            <input
              type="password"
              placeholder="Tavily API Key（可选，留空使用 DuckDuckGo 免费搜索）"
              value={llmConfig.tavilyKey || ''}
              onChange={e => setLlmConfig(prev => ({ ...prev, tavilyKey: e.target.value }))}
              className="llm-input"
              autoComplete="off"
            />
            {(llmConfig.tavilyKey || '').trim() && (
              <button
                className="fetch-models-btn"
                onClick={() => setLlmConfig(prev => ({ ...prev, tavilyKey: '' }))}
                title="清空 Tavily Key"
              >清空</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
