import { useRef, useState } from 'react';
import { ICONS } from '../../constants/index.jsx';

/** 当前联网搜索实际生效的渠道：豆包 > Tavily > DuckDuckGo（与服务端选择顺序一致） */
function resolveWebSearchProvider(llmConfig) {
  if (llmConfig?.webSearchEnabled === false) return { id: 'off', label: '已关闭', desc: '联网工具不可用' };
  if (llmConfig?.doubaoSearchKey) return { id: 'doubao', label: '豆包搜索 API', desc: '国内稳定 · 每月 500 次免费' };
  if (llmConfig?.tavilyKey) return { id: 'tavily', label: 'Tavily API', desc: '海外备选 · 每月 1000 次免费' };
  return { id: 'duckduckgo', label: 'DuckDuckGo', desc: '免费兜底 · 稳定性一般' };
}

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
 * SettingsModal > 大模型 Tab（v13 重设计：一卡式）
 *
 * 只保留用户需要的五件事，说明文字收进 placeholder/tooltip：
 * ① 自定义 Base URL + API Key
 * ② 自动拉取模型（OpenAI 兼容 /models）+ 手动补充
 * ③ 测试连接
 * ④ 多套配置：我的预设（chips，点击即切换）+ 另存为预设
 * ⑤ 模型选择经 llmConfig 实时同步到输入框模型胶囊
 * 联网搜索（可选）折叠进底部 details，不再占主视线。
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

  llmPresets,
  activePresetId,
  currentPresetId,
  applyUserPreset,
  saveAsPreset,
  deletePreset,
  savePresetName,
  setSavePresetName,
}) {
  const handleSaveAs = () => {
    // 填了名字 = 新建/覆盖同名；不填 = 覆盖更新最近应用的那套预设（activePresetId）
    const presetIdToUpdate = activePresetId && !savePresetName.trim() ? activePresetId : undefined;
    const usedName = savePresetName.trim()
      || (presetIdToUpdate ? '' : `配置 · ${(llmConfig.selectedModel || '未选模型').slice(0, 12)}`);
    saveAsPreset({ name: usedName, presetId: presetIdToUpdate });
    setSavePresetName('');
  };

  const doubaoInputRef = useRef(null);
  const websearchDetailsRef = useRef(null);
  const [searchKeyVisible, setSearchKeyVisible] = useState(false);
  const webSearchProvider = resolveWebSearchProvider(llmConfig);

  /** 快速跳转：展开联网搜索区块并聚焦豆包 Key 输入框 */
  const jumpToDoubaoSearch = () => {
    const details = websearchDetailsRef.current;
    if (details) details.open = true;
    requestAnimationFrame(() => {
      doubaoInputRef.current?.focus();
      doubaoInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <div className="llm-tab-root">
      {/* 联网搜索状态条：一眼看清当前用的哪家，点击直达豆包 Key 配置 */}
      <div className={`llm-websearch-status provider-${webSearchProvider.id}`}>
        <span className="llm-websearch-status-dot" aria-hidden="true" />
        <div className="llm-websearch-status-main">
          <b>联网搜索 · {webSearchProvider.label}</b>
          <small>{webSearchProvider.desc}{llmConfig?.doubaoSearchKey ? ' · Key 已配置' : ''}</small>
        </div>
        <button type="button" className="llm-websearch-status-btn" onClick={jumpToDoubaoSearch}>
          {webSearchProvider.id === 'doubao' ? '管理豆包 Key' : '配置豆包搜索（推荐）'}
        </button>
      </div>
      {/* 我的预设：chips 一行，点击即切换整套配置（chips 稳定命名，用户下次还认得） */}
      {(llmPresets || []).length > 0 && (
        <div className="llm-presets-chips">
          {llmPresets
            .slice()
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .map(preset => {
              const inUse = preset.id === currentPresetId;
              return (
                <span key={preset.id} className={`llm-preset-chip ${inUse ? 'in-use' : ''}`}>
                  <button
                    type="button"
                    className="llm-preset-chip-main"
                    disabled={inUse}
                    title={`${preset.name}\n${preset.provider || ''} · ${preset.selectedModel || '未选模型'} · ${formatRelative(preset.updatedAt)}${inUse ? '\n正在使用' : '\n点击应用这套配置'}`}
                    onClick={() => applyUserPreset(preset)}
                  >{preset.name}</button>
                  <button
                    type="button"
                    className="llm-preset-chip-del"
                    title="删除该预设（不影响当前运行中的配置）"
                    onClick={() => deletePreset(preset.id)}
                  >×</button>
                </span>
              );
            })}
        </div>
      )}

      {/* 当前配置：一张卡说清楚（URL / Key / 拉模型 / 选模型 / 测试 / 存预设） */}
      <div className="setting-item">
        <div className="llm-config-form" style={{ marginTop: 0 }}>
          <div className="llm-config-row">
            <input
              type="text"
              placeholder="API Base URL（如 https://api.openai.com，OpenAI 兼容即可）"
              value={llmConfig.baseUrl}
              onChange={e => setLlmConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
              className="llm-input url-input"
            />
            <input
              type="password"
              placeholder="API Key（sk-...）"
              value={llmConfig.apiKey}
              onChange={e => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
              className="llm-input"
              autoComplete="off"
            />
            <button
              className="fetch-models-btn"
              onClick={fetchLlmModels}
              disabled={llmFetching || !llmConfig.baseUrl}
              title="从 /v1/models 自动拉取可用模型列表"
            >{llmFetching ? '拉取中...' : '拉取模型'}</button>
          </div>
          {llmFetchError && <div className="llm-fetch-error">{llmFetchError}</div>}
          <div className="llm-config-row">
            <select
              className="llm-model-select"
              value={llmConfig.selectedModel}
              onChange={e => setLlmConfig(prev => ({ ...prev, selectedModel: e.target.value }))}
              title="选中的模型会实时同步到对话输入框的模型胶囊"
            >
              <option value="">选择模型</option>
              {allLlmModels.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.owned_by ? ` (${m.owned_by})` : ''}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="拉不到？手动输入模型名后点 +"
              value={llmManualInput}
              onChange={e => setLlmManualInput(e.target.value)}
              className="llm-input"
            />
            <button
              className="add-source-btn"
              onClick={addManualModel}
              disabled={!llmManualInput.trim()}
              title="把手动输入的模型加入候选列表"
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
              placeholder="预设名（留空自动命名）"
              value={savePresetName}
              onChange={e => setSavePresetName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="llm-btn-save-as"
              onClick={handleSaveAs}
              disabled={!llmConfig.baseUrl}
              title="把当前 URL/Key/模型 保存为一套预设，顶部 chips 一键切换"
              style={{ whiteSpace: 'nowrap' }}
            >存为预设</button>
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

      {/* 联网搜索（可选）：折叠收纳，不占主视线 */}
      <details className="llm-websearch-details" ref={websearchDetailsRef}>
        <summary>联网搜索（可选 · Agent 联网工具的 Key）</summary>
        <div className="llm-websearch-body">
          <div className="llm-config-row" style={{ alignItems: 'center' }}>
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
          <div className="llm-config-row llm-doubao-row">
            <input
              ref={doubaoInputRef}
              type={searchKeyVisible ? 'text' : 'password'}
              placeholder="豆包搜索 API Key（国内稳定 · 每月 500 次免费 · 推荐优先）"
              value={llmConfig.doubaoSearchKey || ''}
              onChange={e => setLlmConfig(prev => ({ ...prev, doubaoSearchKey: e.target.value }))}
              className="llm-input"
              autoComplete="off"
              title="火山引擎控制台订阅「豆包搜索 Custom 版」后创建；填写后 web_search 优先使用"
            />
            <button
              type="button"
              className="llm-key-toggle"
              onClick={() => setSearchKeyVisible(v => !v)}
              title={searchKeyVisible ? '隐藏 Key' : '显示 Key'}
            >{searchKeyVisible ? '隐藏' : '显示'}</button>
          </div>
          <p className="llm-doubao-hint">
            当前联网搜索由 <b>{webSearchProvider.label}</b> 提供服务。
            豆包 Key 在火山引擎控制台「豆包搜索 Custom 版」订阅后创建，每月 500 次免费额度；填入后 Agent 的 web_search 工具将优先走豆包。
            <a href="https://console.volcengine.com/ai-search" target="_blank" rel="noreferrer">打开火山引擎控制台 ↗</a>
          </p>
          <div className="llm-config-row">
            <input
              type="password"
              placeholder="Tavily API Key（海外备选 · 每月 1000 次免费；都留空则用 DuckDuckGo）"
              value={llmConfig.tavilyKey || ''}
              onChange={e => setLlmConfig(prev => ({ ...prev, tavilyKey: e.target.value }))}
              className="llm-input"
              autoComplete="off"
            />
          </div>
        </div>
      </details>
    </div>
  );
}
