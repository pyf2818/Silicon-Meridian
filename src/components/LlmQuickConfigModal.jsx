import { ICONS, LLM_PRESETS } from '../constants/index.jsx';

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

function builtinTemplateActiveByProvider(templateId, provider) {
  return templateId && provider === templateId;
}

/**
 * 大模型快速配置弹窗（三段式布局，无重复控件）
 * ① 顶部：内置服务商模板（卡片点选，仅改 provider+baseUrl+候选模型，绝不擦掉已填 Key）
 * ② 中部：我的预设（用户自己另存为的配置卡，每张卡有"应用 / 删除"两个按钮）
 * ③ 底部：当前工作配置表单 + 另存为预设 / 测试连接 / 关闭
 */
export default function LlmQuickConfigModal({
  showLlmQuickConfig,
  setShowLlmQuickConfig,
  llmConfig,
  setLlmConfig,
  allLlmModels,
  fetchLlmModels,
  llmFetching,
  llmFetchError,
  llmTestResult,
  llmTesting,
  testLlmConnection,
  llmManualInput,
  setLlmManualInput,
  addManualModel,
  removeManualModel,

  // presets 四件套（来自 useLlmConfig）
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
  if (!showLlmQuickConfig) return null;

  const selectedBuiltinId = llmConfig.provider;
  const builtinWithCustom = [...LLM_PRESETS];
  if (!builtinWithCustom.some(p => p.id === 'custom')) {
    builtinWithCustom.push({ id: 'custom', name: '自定义', baseUrl: '', models: [], abbrev: 'CT', placeholder: 'https://...' });
  }
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
    <div className="modal-overlay llm-config-overlay" onClick={() => setShowLlmQuickConfig(false)}>
      <div className="llm-config-modal" onClick={e => e.stopPropagation()}>
        <div className="llm-config-header">
          <div className="llm-config-title">
            <div>
              <h3>大模型配置</h3>
              <p>选模板 → 填凭证 → 选模型 → 测试并保存</p>
            </div>
          </div>
          <button className="llm-config-close" onClick={() => setShowLlmQuickConfig(false)} aria-label="关闭">{ICONS.x}</button>
        </div>

        <div className="llm-config-body">

          {/* ============ 第一段：服务商模板 ============ */}
          <section className="llm-section">
            <div className="llm-section-head">
              <h4><span className="llm-section-index">1</span>选择服务商模板</h4>
              <span className="llm-section-hint">选择后自动填入官方 Base URL 和候选模型，不会擦掉你已填好的 API Key</span>
            </div>
            <div className="llm-provider-select-row">
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
          </section>

          {/* ============ 第二段：我的预设 ============ */}
          <section className="llm-section">
            <div className="llm-section-head">
              <h4><span className="llm-section-index">2</span>我的预设</h4>
              <span className="llm-section-hint">点击"应用"立即切换整套配置；删除不会影响当前正在运行的配置</span>
            </div>
            {llmPresets.length === 0 ? (
              <div className="llm-empty-state">
                <div className="llm-empty-icon">{ICONS.bookmark || '★'}</div>
                <div>
                  <p className="llm-empty-title">还没有保存过预设</p>
                  <p className="llm-empty-desc">在下方填好 Base URL、API Key、模型后，点"另存为预设"即可存到这里，下次一键切换。</p>
                </div>
              </div>
            ) : (
              <div className="llm-user-presets-list">
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
          </section>

          {/* ============ 第三段：当前配置表单 ============ */}
          <section className="llm-section">
            <div className="llm-section-head">
              <h4><span className="llm-section-index">3</span>当前配置</h4>
              <span className="llm-section-hint">
                已启用自动保存到浏览器本地；登录后还会跨设备同步到服务器
              </span>
            </div>
            <div className="llm-config-fields">
              <div className="llm-field">
                <label>API Base URL</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={llmConfig.baseUrl}
                  onChange={e => setLlmConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                  className="llm-input"
                />
              </div>

              <div className="llm-field">
                <label>API Key</label>
                <input
                  type="password"
                  placeholder={currentBuiltinPlaceholder}
                  value={llmConfig.apiKey}
                  onChange={e => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  className="llm-input"
                  autoComplete="off"
                />
              </div>

              <div className="llm-field">
                <div className="llm-field-head">
                  <label>选择模型</label>
                  <button
                    type="button"
                    className="llm-fetch-btn"
                    onClick={fetchLlmModels}
                    disabled={!llmConfig.baseUrl || llmFetching}
                  >{llmFetching ? '拉取中...' : '拉取模型列表'}</button>
                </div>
                {llmFetchError ? <p className="llm-fetch-error">{llmFetchError}</p> : null}
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

                <div className="llm-manual-add-row" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <input
                    type="text"
                    placeholder="手动输入模型名称，如 deepseek-chat / gpt-4.1-mini"
                    value={llmManualInput}
                    onChange={e => setLlmManualInput(e.target.value)}
                    className="llm-input"
                  />
                  <button
                    type="button"
                    className="llm-add-btn"
                    onClick={addManualModel}
                    disabled={!llmManualInput.trim()}
                  >添加</button>
                </div>
                {(llmConfig.manualModels || []).length > 0 && (
                  <div className="manual-models-list" style={{ marginTop: '10px' }}>
                    {(llmConfig.manualModels || []).map(m => (
                      <div key={m.id} className="custom-source-item" style={{ marginTop: '6px' }}>
                        <div className="custom-source-info">
                          <span className="custom-source-name">{m.name}</span>
                          <span className="custom-source-region">手动</span>
                        </div>
                        <button className="remove-source-btn" onClick={() => removeManualModel(m.id)}>{ICONS.x}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {llmTestResult && (
              <div className={`llm-test-result ${llmTestResult.ok ? 'success' : 'fail'}`}>
                {llmTestResult.ok ? (
                  <><span className="result-icon">{ICONS.check}</span> 连接成功 ({llmTestResult.model}): {llmTestResult.reply}</>
                ) : (
                  <><span className="result-icon">⚠</span> 连接失败：{llmTestResult.message}</>
                )}
              </div>
            )}
          </section>
        </div>

        {/* ============ 底部操作栏 ============ */}
        <div className="llm-config-footer">
          <input
            className="llm-preset-name-input"
            type="text"
            placeholder="预设名称（填则新建 / 不填则覆盖更新当前预设）"
            value={savePresetName}
            onChange={e => setSavePresetName(e.target.value)}
          />
          <div className="llm-footer-spacer" />
          <button
            type="button"
            className="llm-btn-save-as"
            onClick={handleSaveAs}
            disabled={!llmConfig.baseUrl}
            title="把当前配置另存为命名预设，下次一键切换"
          >另存为预设</button>
          <button
            type="button"
            className="llm-btn-secondary"
            onClick={() => setShowLlmQuickConfig(false)}
          >关闭</button>
          <button
            type="button"
            className="llm-btn-test"
            onClick={testLlmConnection}
            disabled={llmTesting || !llmConfig.baseUrl || !llmConfig.selectedModel}
          >{llmTesting ? '测试中...' : '测试连接'}</button>
        </div>
      </div>
    </div>
  );
}
