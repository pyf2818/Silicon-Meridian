import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { loadLS, saveLS } from '../utils/localStorage.js';

const DEFAULT_LLM_CONFIG = {
  baseUrl: '',
  apiKey: '',
  selectedModel: '',
  manualModels: [],
  provider: 'custom',
  tavilyKey: '',
  doubaoSearchKey: '',
  webSearchEnabled: true,
};

const CONFIG_KEY = 'llmConfig';
const PRESETS_KEY = 'llmPresets:v1';
const ACTIVE_KEY = 'llmActivePreset:v1';

// ========== 纯函数（单一职责，易测试 & 零副作用）==========

function createPresetId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 规范化"用户预设"对象。
 * - 只接受用户自己保存的预设字段；和"服务商模板"（LLM_PRESETS）结构严格区分。
 * - 服务商模板不会进 presets list；用户"另存为预设"时才会基于当前配置生成一个用户预设。
 */
function normalizeUserPreset(raw = {}) {
  return {
    id: String(raw.id || createPresetId()),
    name: String(raw.name || raw.selectedModel || '未命名预设').trim() || '未命名预设',
    provider: String(raw.provider || DEFAULT_LLM_CONFIG.provider),
    baseUrl: String(raw.baseUrl || ''),
    apiKey: String(raw.apiKey || ''),
    selectedModel: String(raw.selectedModel || ''),
    manualModels: Array.isArray(raw.manualModels) ? raw.manualModels : [],
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function loadRawConfig() {
  try {
    const loaded = loadLS(CONFIG_KEY, DEFAULT_LLM_CONFIG);
    return loaded && typeof loaded === 'object' ? loaded : {};
  } catch {
    return {};
  }
}

function loadRawPresets() {
  try {
    const raw = loadLS(PRESETS_KEY, []);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadActivePresetId() {
  const raw = loadLS(ACTIVE_KEY, null);
  return typeof raw === 'string' && raw ? raw : null;
}

/**
 * 两个预设在"配置层面"是否等价（忽略 id / name / updatedAt 这些元数据）。
 * 用来判断"当前配置"是否就等于某个已保存预设，从而高亮那个预设卡片为"正在使用"。
 */
function presetConfigEq(a, b) {
  if (!a || !b) return false;
  return (
    a.provider === b.provider &&
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    a.selectedModel === b.selectedModel &&
    JSON.stringify(a.manualModels || []) === JSON.stringify(b.manualModels || [])
  );
}

// ========== Hook ==========

export function useLlmConfig({ LLM_PRESETS = [], onPresetAction, user } = {}) {
  // —— 状态 ———————————————————————————————————————————
  const [llmConfig, setLlmConfig] = useState(() => ({
    ...DEFAULT_LLM_CONFIG,
    ...loadRawConfig(),
  }));
  const [llmPresets, setLlmPresets] = useState(() => loadRawPresets().map(normalizeUserPreset));
  const [activePresetId, setActivePresetId] = useState(loadActivePresetId);

  const [llmModels, setLlmModels] = useState([]);
  const [llmFetching, setLlmFetching] = useState(false);
  const [llmFetchError, setLlmFetchError] = useState('');
  const [llmTestResult, setLlmTestResult] = useState(null);
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmManualInput, setLlmManualInput] = useState('');

  // "另存为预设"输入框 —— 只属于 UI 状态
  const [savePresetName, setSavePresetName] = useState('');

  // "快速配置"弹窗开关 —— UI 状态，保持与旧 API 兼容（App.jsx / StockPage / RightPanel 都在用）
  const [showLlmQuickConfig, setShowLlmQuickConfig] = useState(false);

  // —— 持久化：每个状态只管自己，互不耦合 ———————————————
  useEffect(() => { saveLS(CONFIG_KEY, llmConfig); }, [llmConfig]);
  useEffect(() => { saveLS(PRESETS_KEY, llmPresets); }, [llmPresets]);
  useEffect(() => { saveLS(ACTIVE_KEY, activePresetId); }, [activePresetId]);

  // —— 跨设备 LLM 配置同步（fire-and-forget，2s 防抖）——
  const syncTimerRef = useRef(null);
  useEffect(() => {
    if (!user?.id) return;
    if (!llmConfig.baseUrl || !llmConfig.apiKey) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      fetch('/api/profile/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: llmConfig }),
        credentials: 'include',
      }).catch(() => {});
    }, 2000);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [
    user?.id,
    llmConfig.baseUrl, llmConfig.apiKey, llmConfig.selectedModel,
    llmConfig.provider, llmConfig.tavilyKey, llmConfig.doubaoSearchKey, llmConfig.webSearchEnabled,
  ]);

  // —— 衍生：候选模型列表（远程拉到的 + 手动添加的 + 当前选中兜底）
  const allLlmModels = useMemo(() => {
    const models = [...llmModels, ...(llmConfig.manualModels || [])];
    if (llmConfig.selectedModel && !models.some(m => m.id === llmConfig.selectedModel)) {
      models.push({ id: llmConfig.selectedModel, name: llmConfig.selectedModel });
    }
    return models;
  }, [llmModels, llmConfig.manualModels, llmConfig.selectedModel]);

  // —— 衍生：当前工作配置对应的"正在使用"的已保存预设 id（没有则为 null）
  //   注意和 activePresetId 区别：
  //   activePresetId   = 最近一次点击"应用预设"的那个预设 id（用户主动行为的锚点）
  //   currentPresetId  = 衍生比较得出的等价预设 id（纯由 llmConfig 决定）
  const currentPresetId = useMemo(() => {
    const found = llmPresets.find(p => presetConfigEq(p, llmConfig));
    return found ? found.id : null;
  }, [llmPresets, llmConfig]);

  // —— 动作 1：应用内置"服务商模板"（仅此动作和 LLM_PRESETS 常量相关）
  //   只改 provider / baseUrl / 候选模型列表，**绝不清掉已填好的 apiKey & 已选模型**。
  //   这是之前最乱的点：旧 handleSelectPreset 会把 apiKey 强行清空、selectedModel 也清掉——
  //   点一次服务商卡片就把用户输好的 Key 擦掉了，反直觉。
  const applyBuiltinTemplate = useCallback((template) => {
    if (!template || typeof template !== 'object') return;
    const candidateModels = Array.isArray(template.models)
      ? template.models.map(m => ({ id: m, name: m, owned_by: template.name }))
      : [];
    setLlmConfig(prev => {
      // 若用户还没选模型，则顺手挑第一个候选（如果有）。
      const nextSelected = prev.selectedModel || candidateModels[0]?.id || '';
      // 若当前 baseUrl 还没填过，才用模板的 baseUrl；避免覆盖用户已经改好的自建 URL。
      const nextBaseUrl = prev.baseUrl || String(template.baseUrl || '');
      return {
        ...prev,
        provider: String(template.id || template.provider || prev.provider),
        baseUrl: nextBaseUrl,
        selectedModel: nextSelected,
      };
    });
    if (candidateModels.length) {
      setLlmModels(candidateModels);
      setLlmFetchError('');
    }
  }, []);

  // —— 动作 2：应用一条"用户自己保存的预设"——直接把整份 6 字段写回 llmConfig。
  const applyUserPreset = useCallback((preset) => {
    if (!preset) return;
    const normalized = normalizeUserPreset(preset);
    setLlmConfig({
      ...DEFAULT_LLM_CONFIG,
      // 保留"非预设字段"（tavilyKey / doubaoSearchKey / webSearchEnabled / manualModels 里的用户额外项等不要无脑覆盖）
      ...llmConfig,
      provider: normalized.provider,
      baseUrl: normalized.baseUrl,
      apiKey: normalized.apiKey,
      selectedModel: normalized.selectedModel,
      manualModels: normalized.manualModels,
    });
    setActivePresetId(normalized.id);
    setLlmModels([]); // 清缓存，重新拉/按 manualModels 生成
    setLlmTestResult(null);
    setLlmFetchError('');
    if (typeof onPresetAction === 'function') onPresetAction('apply', normalized);
  }, [llmConfig, onPresetAction]);

  // —— 动作 3：把"当前工作配置"另存为一条用户预设。
  //   - 传了 presetId → 覆盖更新这条（重命名也行）
  //   - 没传 presetId 但当前 activePresetId 存在 → 视为"再存一次"覆盖同一条（避免每次另存都多一条）
  //   - 否则 → 新建
  const saveAsPreset = useCallback(({ name, presetId } = {}) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName && !presetId) return null;

    const draft = normalizeUserPreset({
      id: presetId || activePresetId || undefined,
      name: trimmedName,
      provider: llmConfig.provider,
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      selectedModel: llmConfig.selectedModel,
      manualModels: llmConfig.manualModels || [],
    });

    let savedId = draft.id;
    setLlmPresets(prev => {
      const idx = prev.findIndex(p => p.id === draft.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], ...draft, id: next[idx].id, updatedAt: Date.now() };
        savedId = next[idx].id;
        return next;
      }
      savedId = draft.id;
      return [...prev, { ...draft, updatedAt: Date.now() }];
    });
    setActivePresetId(savedId);
    setSavePresetName('');
    if (typeof onPresetAction === 'function') onPresetAction('save', { ...draft, id: savedId });
    return savedId;
  }, [activePresetId, llmConfig, onPresetAction]);

  // —— 动作 4：删除一条用户预设。
  const deletePreset = useCallback((id) => {
    if (!id) return;
    setLlmPresets(prev => prev.filter(p => p.id !== id));
    setActivePresetId(prev => (prev === id ? null : prev));
    if (typeof onPresetAction === 'function') onPresetAction('delete', { id });
  }, [onPresetAction]);

  // —— 拉模型列表 ————————————————————————————————————
  const fetchLlmModels = useCallback(() => {
    if (!llmConfig.baseUrl) return;
    setLlmFetching(true);
    setLlmFetchError('');
    fetch('/api/llm-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) setLlmModels(d.models || []);
        else { setLlmFetchError(d.message || '拉取模型失败'); setLlmModels([]); }
      })
      .catch((err) => {
        setLlmFetchError(`网络错误：${err?.message || '请确认开发服务器已启动'}`);
        setLlmModels([]);
      })
      .finally(() => setLlmFetching(false));
  }, [llmConfig.baseUrl, llmConfig.apiKey]);

  // —— 手动增删候选模型 ————————————————————————————————
  const addManualModel = useCallback(() => {
    const id = llmManualInput.trim();
    if (!id) return;
    setLlmConfig(prev => ({
      ...prev,
      manualModels: [...(prev.manualModels || []), { id, name: id }],
      selectedModel: prev.selectedModel || id,
    }));
    setLlmManualInput('');
  }, [llmManualInput]);

  const removeManualModel = useCallback((modelId) => {
    setLlmConfig(prev => ({
      ...prev,
      manualModels: (prev.manualModels || []).filter(m => m.id !== modelId),
      selectedModel: prev.selectedModel === modelId ? '' : prev.selectedModel,
    }));
  }, []);

  // —— 测试连接 ————————————————————————————————————
  const testLlmConnection = useCallback(() => {
    if (!llmConfig.baseUrl || !llmConfig.selectedModel) return;
    setLlmTesting(true);
    setLlmTestResult(null);
    fetch('/api/llm-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: llmConfig.selectedModel,
      }),
    })
      .then(r => r.json())
      .then(d => setLlmTestResult(d))
      .catch(() => setLlmTestResult({ ok: false, message: '网络错误' }))
      .finally(() => setLlmTesting(false));
  }, [llmConfig.baseUrl, llmConfig.apiKey, llmConfig.selectedModel]);

  return {
    // 核心状态
    llmConfig, setLlmConfig,
    llmPresets,
    activePresetId, setActivePresetId,
    currentPresetId, // 纯衍生：哪条已保存预设 ≡ 当前配置（用于 UI 高亮"正在使用"）

    // 候选模型
    llmModels, setLlmModels,
    allLlmModels,
    llmManualInput, setLlmManualInput,
    addManualModel, removeManualModel,
    fetchLlmModels,
    llmFetching, llmFetchError, setLlmFetchError,

    // 测试
    llmTestResult, llmTesting, testLlmConnection,

    // 预设四件套（唯一出入口，UI 不再内联 upsert/remove/activate 细节）
    applyBuiltinTemplate, // 点"服务商卡片"
    applyUserPreset,      // 点"我的预设卡片 → 应用"
    saveAsPreset,         // 点"另存为预设"
    deletePreset,         // 点"我的预设卡片 → 删除"

    // "另存为预设"输入框的受控值
    savePresetName, setSavePresetName,

    // 快速配置弹窗开关（App.jsx / StockPage / RightPanel 三处使用，保持 API 向后兼容）
    showLlmQuickConfig, setShowLlmQuickConfig,

    // 为未来 UI 调试留的纯函数
    _normalizeUserPreset: normalizeUserPreset,
    _presetConfigEq: presetConfigEq,
  };
}
