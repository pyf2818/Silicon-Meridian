import { ICONS } from '../../constants/index.jsx';

/**
 * SettingsModal > 大模型 Tab
 * - OpenAI 兼容 API 配置（Base URL / Key / 模型列表 / 测试连接）
 * - Tavily API Key（联网搜索，留空时 fallback DuckDuckGo）
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
}) {
  return (
    <>
      <div className="setting-item">
        <label>大模型配置</label>
        <p className="setting-desc">配置 OpenAI 兼容 API，自动拉取或手动输入模型</p>
        <div className="llm-config-form">
          <div className="llm-config-row">
            <input type="text" placeholder="API Base URL (如 https://api.openai.com)" value={llmConfig.baseUrl} onChange={e => setLlmConfig(prev => ({ ...prev, baseUrl: e.target.value }))} className="llm-input url-input" />
            <input type="password" placeholder="API Key (可选)" value={llmConfig.apiKey} onChange={e => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))} className="llm-input" />
            <button className="fetch-models-btn" onClick={fetchLlmModels} disabled={llmFetching || !llmConfig.baseUrl}>{llmFetching ? '拉取中...' : '拉取模型'}</button>
          </div>
          {llmFetchError && <div className="llm-fetch-error">{llmFetchError}</div>}
          <div className="llm-config-row">
            <select className="llm-model-select" value={llmConfig.selectedModel} onChange={e => setLlmConfig(prev => ({ ...prev, selectedModel: e.target.value }))}>
              <option value="">选择模型</option>
              {allLlmModels.map(m => <option key={m.id} value={m.id}>{m.name}{m.owned_by ? ` (${m.owned_by})` : ''}</option>)}
            </select>
            <input type="text" placeholder="手动输入模型名称" value={llmManualInput} onChange={e => setLlmManualInput(e.target.value)} className="llm-input" />
            <button className="add-source-btn" onClick={addManualModel} disabled={!llmManualInput.trim()}>{ICONS.plus}</button>
          </div>
          {(llmConfig.manualModels || []).length > 0 && (
            <div className="manual-models-list">
              {(llmConfig.manualModels || []).map(m => <div key={m.id} className="custom-source-item"><div className="custom-source-info"><span className="custom-source-name">{m.name}</span><span className="custom-source-region">手动</span></div><button className="remove-source-btn" onClick={() => removeManualModel(m.id)}>{ICONS.x}</button></div>)}
            </div>
          )}
          <div className="llm-config-row">
            <button className="test-llm-btn" onClick={testLlmConnection} disabled={llmTesting || !llmConfig.baseUrl || !llmConfig.selectedModel}>{llmTesting ? '测试中...' : '测试连接'}</button>
          </div>
          {llmTestResult && (
            <div className={`source-verify-result ${llmTestResult.ok ? 'verify-ok' : 'verify-fail'}`}>
              {llmTestResult.ok ? <>{ICONS.check} 连接成功 ({llmTestResult.model}): {llmTestResult.reply}</> : <>连接失败: {llmTestResult.message}</>}
            </div>
          )}
        </div>
      </div>

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
    </>
  );
}
