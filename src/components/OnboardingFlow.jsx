import { useState, useEffect, useRef } from 'react';
import { ICONS } from '../constants/index.jsx';
import { showToast } from '../utils/toast.js';

const ONBOARDED_KEY = 'meridian_onboarded';
const SOURCE_PREFS_KEY = 'meridian_source_prefs';

const SOURCE_TYPES = [
  { id: 'ai-vendor', label: 'AI 厂商官网', icon: 'cpu', desc: 'OpenAI / Anthropic / Google 等一手发布' },
  { id: 'academic', label: '学术期刊', icon: 'document', desc: 'arXiv / Nature / 顶会论文前沿' },
  { id: 'kol', label: 'KOL 博主', icon: 'star', desc: '一线研究者与从业者观点' },
  { id: 'policy', label: '政策监管', icon: 'shield', desc: '中美欧 AI 监管与产业政策' },
  { id: 'domestic', label: '国内来源', icon: 'building', desc: '加大中文 / 国内信源比重' },
  { id: 'intl', label: '国际媒体', icon: 'globe', desc: 'TechCrunch / The Verge 等' },
];

const STEPS = [
  { id: 'welcome', label: '欢迎', icon: 'sparkle' },
  { id: 'interests', label: '兴趣领域', icon: 'target' },
  { id: 'sources', label: '信源偏好', icon: 'globe' },
  { id: 'llm', label: '智能引擎', icon: 'bot' },
  { id: 'tour', label: '功能导览', icon: 'grid' },
];

// 功能导览：按侧栏 4 分组介绍核心模块（与 SIDEBAR_NAV_GROUPS 语义对齐）
const TOUR_GROUPS = [
  {
    label: '资讯情报', icon: 'globe',
    items: [
      ['今日汇报', '按兴趣生成的个性化 AI 简报，多智能体分析实时可见进度'],
      ['全部动态', '多域资讯总览，点标题可侧边预览原文'],
      ['股市动向', '行情终端 + AI 诊断：大师级买卖剧本、流式生成、历史记录、token 消耗可见'],
      ['竞争监测', '维护监测词，自动聚合竞品/赛道情报'],
    ],
  },
  {
    label: '智能体工作', icon: 'cpu',
    items: [
      ['AI 工作站', '多智能体深度研究：多视角产出实时直播、团队协作、工具编排，全程可中断'],
      ['无限画布', '拖拽搭建工作流，支持真实运行（流式 trace + 停止按钮）与模拟运行，成果一键存档'],
      ['群聊协作', '像拉群一样给 AI 角色派活，成员回复流式产出，跟进度收结果'],
    ],
  },
  {
    label: '创作与社区', icon: 'layers',
    items: [
      ['素材管理', '收藏的资讯/仓库/AI 分析成果都在这里，可续写创作；股市分析可一键跳回对应个股'],
      ['用户广场', '分享与发现其他用户的工作流与洞察'],
    ],
  },
  {
    label: '个人后勤', icon: 'target',
    items: [
      ['用户画像', '领域/信源优先级、学习偏好、AI 简报快照'],
      ['AI 精灵', '右下角悬浮助手：拖入资讯秒析、划词翻译、聊天记录侧栏管理'],
    ],
  },
];

function loadSourcePrefs() {
  try { return JSON.parse(localStorage.getItem(SOURCE_PREFS_KEY) || '[]'); } catch { return []; }
}

/**
 * 首跑引导：把「兴趣 → 信源 → 大模型配置/算法兜底 → 首份简报」串成一次性多步向导。
 * 全程纯前端落地（兴趣存 selectedInterests / 信源存本地偏好 / LLM 存 llmConfig），
 * 不依赖 PostgreSQL，dev（DEV_MEMORY_AUTH）与生产均可用。
 */
export default function OnboardingFlow({
  show,
  onFinish,
  replay = false,        // 重放模式（从设置/命令面板再次打开）：跳过简报预热直接进入
  categories = [],
  CATEGORY_GROUPS = [],
  selectedInterests,
  setSelectedInterests,
  llmConfig,
  setLlmConfig,
  applyBuiltinTemplate,
  LLM_PRESETS = [],
  fetchLlmModels,
  allLlmModels,
  llmFetching,
  llmFetchError,
  llmTestResult,
  llmTesting,
  testLlmConnection,
  goNav,
}) {
  const [step, setStep] = useState(0);
  const [sourcePrefs, setSourcePrefs] = useState(loadSourcePrefs);
  const [llmPath, setLlmPath] = useState('algorithm'); // 'algorithm' | 'config'
  const [generating, setGenerating] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(SOURCE_PREFS_KEY, JSON.stringify(sourcePrefs)); } catch { /* local only */ }
  }, [sourcePrefs]);

  if (!show) return null;

  const llmReady = Boolean(llmConfig?.baseUrl && llmConfig?.apiKey && llmConfig?.selectedModel);
  const canNext = step !== 1 || selectedInterests.length > 0;

  const toggleInterest = (catId) => {
    setSelectedInterests(prev => (prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]));
  };
  const toggleSource = (id) => {
    setSourcePrefs(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleEnter = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/profile/snapshots/preheat', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) showToast('已为你生成今日简报');
    } catch {
      /* 离线 / 无 DB 时静默降级，进入推荐页仍可凭 interests 看到个性化内容 */
    } finally {
      setGenerating(false);
      try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* ignore */ }
      onFinish?.();
      goNav('recommendations');
    }
  };

  const back = () => setStep(s => Math.max(0, s - 1));
  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="新用户引导">
      <div className="onb-card" ref={cardRef}>
        {/* 左侧进度轨 */}
        <aside className="onb-rail">
          <div className="onb-brand">
            <span className="onb-brand-mark">{ICONS.sparkle}</span>
            <div>
              <div className="onb-brand-name">万般硅川</div>
              <div className="onb-brand-sub">Silicon Meridian</div>
            </div>
          </div>
          <ol className="onb-steps">
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                className={`onb-step-item ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
                onClick={() => i < step && setStep(i)}
              >
                <span className="onb-step-dot">{i < step ? ICONS.check : ICONS[s.icon]}</span>
                <span className="onb-step-label">{s.label}</span>
              </li>
            ))}
          </ol>
          <button className="onb-skip" onClick={() => { try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch {} onFinish?.(); }}>跳过引导</button>
        </aside>

        {/* 右侧内容 */}
        <section className="onb-main">
          <div className="onb-body" key={step}>
            {step === 0 && (
              <div className="onb-welcome">
                <div className="onb-eyebrow">欢迎来到你的个人情报与创作 OS</div>
                <h1 className="onb-title">三分钟，让硅川记住你是谁</h1>
                <p className="onb-lead">
                  我们会根据你的兴趣与信源，每日为你生成精准的 AI 情报简报，
                  并把阅读、创作、画像沉淀为持续进化的个人知识资产。
                </p>
                <ul className="onb-points">
                  <li><span className="onb-point-ic">{ICONS.target}</span>按领域精准推送，告别信息噪音</li>
                  <li><span className="onb-point-ic">{ICONS.globe}</span>精选 200+ 优质信源，含学术与国内来源</li>
                  <li><span className="onb-point-ic">{ICONS.bot}</span>接入大模型即获得 AI 增强的简报与诊断</li>
                </ul>
              </div>
            )}

            {step === 1 && (
              <div className="onb-interests">
                <h2 className="onb-h2">你对什么感兴趣？</h2>
                <p className="onb-sub">选择你关注的领域，简报与推荐将围绕它们展开。至少选 1 个。</p>
                <div className="onb-interest-groups">
                  {CATEGORY_GROUPS.map(group => (
                    <div key={group.id} className="onb-igroup">
                      <div className="onb-igroup-title">
                        <span className="onb-igroup-ic">{ICONS[group.icon]}</span>
                        <span>{group.label}</span>
                      </div>
                      <div className="onb-igroup-items">
                        {group.categories.map(catId => {
                          const cat = categories.find(c => c.id === catId);
                          if (!cat) return null;
                          const isSel = selectedInterests.includes(cat.id);
                          return (
                            <button
                              key={cat.id}
                              className={`onb-chip ${isSel ? 'sel' : ''}`}
                              onClick={() => toggleInterest(cat.id)}
                            >
                              <span className="onb-chip-ic">{ICONS[cat.icon]}</span>
                              <span>{cat.label}</span>
                              {isSel && <span className="onb-chip-check">{ICONS.check}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="onb-sources">
                <h2 className="onb-h2">想看哪类信源？</h2>
                <p className="onb-sub">我们已为你精选一批优质信源。勾选你偏好的类型，让简报更对味（可多选 / 可跳过）。</p>
                <div className="onb-source-grid">
                  {SOURCE_TYPES.map(t => {
                    const isSel = sourcePrefs.includes(t.id);
                    return (
                      <button key={t.id} className={`onb-source-card ${isSel ? 'sel' : ''}`} onClick={() => toggleSource(t.id)}>
                        <span className="onb-source-ic">{ICONS[t.icon]}</span>
                        <span className="onb-source-label">{t.label}</span>
                        <span className="onb-source-desc">{t.desc}</span>
                        <span className="onb-source-check">{isSel ? ICONS.check : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="onb-llm">
                <h2 className="onb-h2">选择你的智能引擎</h2>
                <p className="onb-sub">接入大模型可获得 AI 增强的简报、诊断与创作；也可以先用算法模式立即体验。</p>

                <div className="onb-llm-options">
                  <button className={`onb-llm-opt ${llmPath === 'algorithm' ? 'sel' : ''}`} onClick={() => setLlmPath('algorithm')}>
                    <span className="onb-llm-opt-ic">{ICONS.bolt}</span>
                    <span className="onb-llm-opt-title">先用算法模式 <em>推荐起步</em></span>
                    <span className="onb-llm-opt-desc">零配置，立即生成今日简报；之后随时在设置里接入大模型。</span>
                    {llmPath === 'algorithm' && <span className="onb-llm-opt-check">{ICONS.check}</span>}
                  </button>

                  <button className={`onb-llm-opt ${llmPath === 'config' ? 'sel' : ''}`} onClick={() => setLlmPath('config')}>
                    <span className="onb-llm-opt-ic">{ICONS.bot}</span>
                    <span className="onb-llm-opt-title">配置大模型 <em>AI 增强</em></span>
                    <span className="onb-llm-opt-desc">填入兼容 OpenAI 的接口，获得更聪明的简报与诊断。</span>
                    {llmPath === 'config' && <span className="onb-llm-opt-check">{ICONS.check}</span>}
                  </button>
                </div>

                {llmPath === 'config' && (
                  <div className="onb-llm-form">
                    <div className="onb-presets">
                      {(LLM_PRESETS || []).slice(0, 6).map(p => (
                        <button key={p.id} className="onb-preset" type="button" onClick={() => applyBuiltinTemplate?.(p)}>{p.name}</button>
                      ))}
                    </div>
                    <label className="onb-field">
                      <span>接口地址 (Base URL)</span>
                      <input
                        value={llmConfig?.baseUrl || ''}
                        placeholder="https://api.openai.com/v1"
                        onChange={e => setLlmConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                      />
                    </label>
                    <label className="onb-field">
                      <span>API Key</span>
                      <input
                        type="password"
                        value={llmConfig?.apiKey || ''}
                        placeholder="sk-..."
                        onChange={e => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                      />
                    </label>
                    <div className="onb-field-row">
                      <button className="onb-btn-ghost" type="button" disabled={!llmConfig?.baseUrl || llmFetching} onClick={() => fetchLlmModels?.()}>
                        {llmFetching ? '获取中…' : '获取模型列表'}
                      </button>
                      {llmFetchError && <span className="onb-err">{llmFetchError}</span>}
                    </div>
                    {allLlmModels?.length > 0 && (
                      <label className="onb-field">
                        <span>选择模型</span>
                        <select value={llmConfig?.selectedModel || ''} onChange={e => setLlmConfig(prev => ({ ...prev, selectedModel: e.target.value }))}>
                          <option value="">请选择模型</option>
                          {allLlmModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </label>
                    )}
                    {llmConfig?.baseUrl && llmConfig?.selectedModel && (
                      <div className="onb-field-row">
                        <button className="onb-btn-ghost" type="button" disabled={llmTesting} onClick={() => testLlmConnection?.()}>测试连接</button>
                        {llmTestResult && (
                          <span className={`onb-test ${llmTestResult.ok ? 'ok' : 'bad'}`}>
                            {llmTestResult.ok ? '连接成功' : (llmTestResult.message || '连接失败')}
                          </span>
                        )}
                      </div>
                    )}
                    {llmReady && <div className="onb-ready">{ICONS.check} 大模型已就绪，将用于 AI 增强简报</div>}
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="onb-tour">
                <h2 className="onb-h2">认识你的工作台</h2>
                <p className="onb-sub">四大分区各司其职；按 <kbd className="onb-kbd">?</kbd> 可随时查看全部快捷键，之后可在设置里重看本导览。</p>
                <div className="onb-tour-grid">
                  {TOUR_GROUPS.map(group => (
                    <div key={group.label} className="onb-tour-group">
                      <div className="onb-tour-group-title">
                        <span className="onb-tour-group-ic">{ICONS[group.icon]}</span>
                        <span>{group.label}</span>
                      </div>
                      <ul className="onb-tour-items">
                        {group.items.map(([name, desc]) => (
                          <li key={name}><strong>{name}</strong><span>{desc}</span></li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部操作条 */}
          <footer className="onb-footer">
            <div className="onb-footer-left">
              {step > 0 && (
                <button className="onb-btn-ghost" onClick={back}>{ICONS.chevronLeft}<span>上一步</span></button>
              )}
            </div>
            <div className="onb-footer-right">
              {step < STEPS.length - 1 ? (
                <button className="onb-btn-primary" disabled={!canNext} onClick={next}>
                  {step === 1 && selectedInterests.length === 0 ? '请至少选 1 个领域' : '下一步'}{ICONS.arrowRight}
                </button>
              ) : (
                <button className="onb-btn-primary" disabled={generating} onClick={handleEnter}>
                  {generating ? '正在生成首份简报…' : replay ? '进入工作台' : '生成首份简报并进入工作台'}{!generating && ICONS.rocket}
                </button>
              )}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
