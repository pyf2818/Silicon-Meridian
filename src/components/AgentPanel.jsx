/**
 * AgentPanel - AI 工作站右侧智能管理面板
 *
 * 三层布局（方案 C）：
 * 1. 顶部固定卡：当前任务摘要（轮次/回复/工具/tokens/模型 LED，永远可见）
 * 2. 中部 Tab 区：技能｜智能体｜记忆（按需切换，避免堆砌）
 *    - 技能 tab：Skills 生态管理（列表/详情/编辑保存/新建）
 *    - 智能体 tab：工具能力清单 + 定时任务 + 用户画像（聚焦配置态，运行态信息已在顶部卡呈现）
 *    - 记忆 tab：上下文召回（相关记忆 + 工作空间文件，合并）+ 学习偏好（基于对话总结的习惯）
 * 3. 无底部 sticky
 *
 * 角色/灵魂设定入口已移至 chat-header 的 PersonaDrawer，本面板不承载
 */
import { useMemo, useState } from 'react';
import { setLearningEnabled } from '../utils/profileLearning.js';
import { AGENT_TOOL_SCHEMAS, getToolMetaByName } from '../utils/agentTools.js';
import { useSkills } from '../hooks/useSkills.js';
import { ICONS } from '../constants/appConstants.jsx';
import AgentJobsSection from './agent/AgentJobsSection.jsx';
import SkillsPanel from './SkillsPanel.jsx';

/* 工具元信息：从 toolRegistry 派生，返回 iconKey 供 ICONS 查表渲染 SVG */
function getToolDisplay(name) {
  const meta = getToolMetaByName(name);
  return { label: meta?.label || name, iconKey: meta?.iconKey || 'settings' };
}

/* 自进化记忆相对时间格式化：刚刚 / N 分钟前 / N 小时前 / N 天前 */
function formatRelativeEvolution(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚进化';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

/* Tab 配置：图标 + label
 * 注：原 task tab 已替换为 skills tab（任务模块功能不大，改为 Skills 生态管理）
 * 智能体 tab 已精简：去掉执行计划/智能体状态两个 section，聚焦于「配置/能力」维度
 */
const TABS = [
  { id: 'skills', label: '技能', icon: ICONS.sparkles },
  { id: 'agent', label: '智能体', icon: ICONS.settings },
  { id: 'memory', label: '记忆', icon: ICONS.bookmark },
];


export default function AgentPanel({
  messages = [],
  llmConfig,
  selectedModel,
  isStreaming,
  intelligenceProfile,
  relevantMemories = [],
  recalledFiles = [],
  onAddContextFiles,
  learnedPrefs = {},
  agent,
  memoryHealth,
  lastEvolvedAt,
  skillsHook,
  input = '',
  onInvokeTool,
}) {
  const [activeTab, setActiveTab] = useState('skills'); // skills | agent | memory

  // Skills hook：优先复用外层传入的实例（与左上角技能菜单 + 对话沉淀共享同一缓存）
  // 仅当外层未传入时才启用本地实例，避免重复 fetch
  const localSkillsHook = useSkills({ enabled: !skillsHook });
  const skills = skillsHook || localSkillsHook;

  const stats = useMemo(() => {
    const userMsgs = messages.filter(m => m.role === 'user');
    const aiMsgs = messages.filter(m => m.role === 'assistant' && !m.error);
    const charCount = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const firstQuestion = userMsgs[0]?.content?.slice(0, 60) || '—';
    // 统计本次会话的工具调用次数（来自 assistant 消息的 toolCalls 字段）
    const toolCallTotal = messages.reduce((sum, m) => sum + (Array.isArray(m.toolCalls) ? m.toolCalls.length : 0), 0);
    return {
      total: messages.length,
      rounds: userMsgs.length,
      aiReplies: aiMsgs.length,
      firstQuestion,
      estTokens: Math.ceil(charCount / 2.5),
      toolCallTotal,
    };
  }, [messages]);

  const hasConfig = Boolean(llmConfig?.baseUrl && selectedModel);

  /* 当前任务标签：用户正在输入时实时显示输入预览（截断 80 字符），
   * 否则回退到首条用户问题，都没有则显示"新对话"。
   * taskFull 为完整内容用于 title 悬停。 */
  const taskView = useMemo(() => {
    const draft = String(input || '').trim();
    if (draft) {
      return { label: '正在输入', text: draft.slice(0, 80), full: draft, isDraft: true };
    }
    const first = stats.firstQuestion;
    if (first && first !== '—') {
      return { label: '当前任务', text: first, full: first, isDraft: false };
    }
    return { label: '当前任务', text: '新对话', full: '新对话', isDraft: false };
  }, [input, stats.firstQuestion]);

  // 当前 agent 的工具能力清单（用于右栏展示）
  // 规则：
  //   1. 若 agent.tools 明确配置了白名单 → 只渲染白名单内的工具（仍需在注册表中存在，不存在的忽略）
  //   2. 若 agent.tools 未配置 / 为空 → 兜底渲染全部已启用工具（兼容旧自定义 agent 或未手动配置的 agent，避免显示"没有工具"）
  const agentTools = useMemo(() => {
    const whitelist = Array.isArray(agent?.tools) ? agent.tools : [];
    const allEnabled = Array.isArray(AGENT_TOOL_SCHEMAS) ? AGENT_TOOL_SCHEMAS : [];
    const schemas = whitelist.length > 0
      ? whitelist
          .map(name => AGENT_TOOL_SCHEMAS.find(s => s.function.name === name))
          .filter(Boolean)
      : allEnabled;

    return schemas.map(schema => {
      const name = schema?.function?.name;
      const display = getToolDisplay(name);
      return {
        name,
        label: display.label,
        iconKey: display.iconKey,
        desc: schema?.function?.description || '',
      };
    });
  }, [agent]);

  // 各 tab 的 badge 计算（用于 tab 标题右上角小红点）
  const tabBadges = useMemo(() => ({
    skills: skills.skills.length,
    agent: 0, // 智能体配置类，无未读概念
    memory: relevantMemories.length + recalledFiles.length,
  }), [skills.skills.length, relevantMemories.length, recalledFiles.length]);

  return (
    <aside className="agent-panel custom-scrollbar">
      {/* ============ 顶部固定卡：当前任务摘要（永远可见，含模型连接 LED） ============ */}
      <div className={`agent-topcard ${isStreaming ? 'is-streaming' : ''} ${taskView.isDraft ? 'is-draft' : ''} ${!hasConfig ? 'is-warn' : ''}`}>
        <span className="agent-topcard-stripe" aria-hidden="true" />
        <div className="agent-topcard-main">
          <div className="agent-topcard-head">
            <div className="agent-topcard-head-left">
              <span className="agent-topcard-label">
                <span className="agent-topcard-led" title={isStreaming ? '生成中' : (hasConfig ? '已连接' : '未配置')} />
                {isStreaming ? '生成中' : taskView.label}
              </span>
            </div>
            {isStreaming && <span className="agent-topcard-badge is-running" title="模型正在生成回复">运行中</span>}
            {taskView.isDraft && !isStreaming && <span className="agent-topcard-badge is-draft" title="输入预览（未发送）">草稿</span>}
          </div>
          <p className={`agent-topcard-title ${taskView.isDraft ? 'is-draft' : ''}`} title={taskView.full}>{taskView.text}</p>
          <div className="agent-topcard-model-row">
            <span className="agent-topcard-model" title={selectedModel || '未配置模型'}>
              <span className="agent-topcard-model-dot" />
              {selectedModel ? selectedModel.split('/').pop() : '未配置'}
            </span>
          </div>
        </div>
        <div className="agent-topcard-metrics">
          <div className="agent-topcard-metric" title="对话轮次">
            <span className="agent-topcard-metric-value">{stats.rounds}</span>
            <span className="agent-topcard-metric-label">轮次</span>
          </div>
          <div className="agent-topcard-metric" title="AI 回复数">
            <span className="agent-topcard-metric-value">{stats.aiReplies}</span>
            <span className="agent-topcard-metric-label">回复</span>
          </div>
          <div className="agent-topcard-metric" title="工具调用次数">
            <span className="agent-topcard-metric-value">{stats.toolCallTotal}</span>
            <span className="agent-topcard-metric-label">工具</span>
          </div>
          <div className="agent-topcard-metric" title="估算 token 用量">
            <span className="agent-topcard-metric-value">~{stats.estTokens}</span>
            <span className="agent-topcard-metric-label">tokens</span>
          </div>
        </div>
        {memoryHealth && memoryHealth.total > 0 && (
          <div className="agent-topcard-evolution" title="自进化记忆健康度：总记忆数 / 平均置信度 / 高置信记忆数">
            <span className="agent-evolution-label">自进化</span>
            <span className="agent-evolution-stat">
              <span className="agent-evolution-value">{memoryHealth.total}</span>
              <span className="agent-evolution-unit">条</span>
            </span>
            <span className="agent-evolution-divider" />
            <span className="agent-evolution-stat" title={`平均置信度 ${memoryHealth.avgConfidence}/100`}>
              <span className="agent-evolution-value">{memoryHealth.avgConfidence}</span>
              <span className="agent-evolution-unit">/100</span>
            </span>
            <span className="agent-evolution-divider" />
            <span className="agent-evolution-stat" title={`高置信记忆 ${memoryHealth.highConfidenceCount} 条`}>
              <span className="agent-evolution-value">{memoryHealth.highConfidenceCount}</span>
              <span className="agent-evolution-unit">高</span>
            </span>
            {lastEvolvedAt && (
              <>
                <span className="agent-evolution-divider" />
                <span className="agent-evolution-time" title={`最近一次进化：${new Date(lastEvolvedAt).toLocaleString()}`}>
                  {formatRelativeEvolution(lastEvolvedAt)}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ============ Tab 导航 ============ */}
      <nav className="agent-tabs" role="tablist">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const badge = tabBadges[tab.id] || 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`agent-tab${isActive ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
            >
              <span className="agent-tab-icon">{tab.icon}</span>
              <span className="agent-tab-label">{tab.label}</span>
              {badge > 0 && <span className="agent-tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      {/* ============ Tab 内容区 ============ */}
      <div className="agent-tab-panes custom-scrollbar">
        {/* ---------- 技能 tab（取代原任务 tab）---------- */}
        {activeTab === 'skills' && (
          <div className="agent-tab-pane agent-tab-pane-skills" role="tabpanel">
            <SkillsPanel skillsHook={skills} />
          </div>
        )}

        {/* ---------- 智能体 tab：能力清单 + 定时任务 + 用户画像 ---------- */}
        {activeTab === 'agent' && (
          <div className="agent-tab-pane" role="tabpanel">
            {/* Agent 工具能力：当智能体配置了 tools 白名单时展示 */}
            {agentTools.length > 0 && (
              <section className="agent-section">
                <header className="agent-section-head">
                  <h3>工具能力</h3>
                  <span className="agent-badge agent-badge-tool">{agentTools.length}</span>
                </header>
                <div className="agent-capabilities">
                  {agentTools.map(t => (
                    <div
                      key={t.name}
                      className="agent-capability-chip"
                      role="button"
                      tabIndex={0}
                      title={`${t.desc}\n（双击可快速调用，指令将填入输入框）`}
                      onDoubleClick={() => onInvokeTool?.(t.name, t.label)}
                    >
                      <span className="agent-capability-icon">{ICONS[t.iconKey] || ICONS.settings}</span>
                      <span className="agent-capability-name">{t.label}</span>
                    </div>
                  ))}
                  <p className="agent-capabilities-hint">双击工具可快速调用 · 指令将填入输入框，补充参数后回车即执行</p>
                </div>
              </section>
            )}

            {/* 定时任务：cron 触发的 agent 任务，跨会话持久化在服务端 */}
            <AgentJobsSection agent={agent} />

            {/* 用户画像：平台主体依据 */}
            {intelligenceProfile && (
              <section className="agent-section">
                <header className="agent-section-head">
                  <h3>用户画像</h3>
                  <span className="agent-profile-confidence" title="画像置信度">{intelligenceProfile.confidence || 0}%</span>
                </header>
                <div className="agent-profile-card">
                  {intelligenceProfile.focusLabels?.length > 0 && (
                    <div className="agent-profile-row">
                      <span className="agent-profile-label">关注</span>
                      <div className="agent-profile-tags">
                        {intelligenceProfile.focusLabels.map(l => <span key={l} className="agent-profile-tag">{l}</span>)}
                      </div>
                    </div>
                  )}
                  {intelligenceProfile.tracked?.length > 0 && (
                    <div className="agent-profile-row">
                      <span className="agent-profile-label">追踪</span>
                      <div className="agent-profile-tags">
                        {intelligenceProfile.tracked.map(t => <span key={t} className="agent-profile-tag tracked">{t}</span>)}
                      </div>
                    </div>
                  )}
                  <div className="agent-profile-row">
                    <span className="agent-profile-label">深度</span>
                    <span className="agent-profile-value">{intelligenceProfile.depth || 'standard'}</span>
                  </div>
                  <div className="agent-profile-row">
                    <span className="agent-profile-label">目标</span>
                    <span className="agent-profile-value">{intelligenceProfile.outputGoal || 'daily briefing'}</span>
                  </div>
                  {intelligenceProfile.muted?.length > 0 && (
                    <div className="agent-profile-row">
                      <span className="agent-profile-label">降权</span>
                      <span className="agent-profile-value muted">{intelligenceProfile.muted.join('、')}</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 空状态 */}
            {agentTools.length === 0 && !intelligenceProfile && (
              <div className="agent-tab-empty">
                <div className="agent-tab-empty-icon">{ICONS.sparkles}</div>
                <div className="agent-tab-empty-text">
                  当前智能体未配置工具，也暂无用户画像。<br />
                  可在「设置 → 智能体」中给当前 agent 分配工具能力，或在对话中让智能体学习你的偏好。
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- 记忆 tab ---------- */}
        {activeTab === 'memory' && (
          <div className="agent-tab-pane" role="tabpanel">
            {/* 上下文召回：相关记忆 + 工作空间文件 合并展示 */}
            {(relevantMemories.length > 0 || recalledFiles.length > 0) && (
              <section className="agent-section">
                <header className="agent-section-head">
                  <h3>上下文召回</h3>
                  <span className="agent-memory-count" title="已自动注入上下文">
                    {relevantMemories.length + recalledFiles.length}
                  </span>
                </header>
                <div className="agent-memory-list">
                  {relevantMemories.map(m => (
                    <div key={m.sessionId} className="agent-memory-item" title={`来自会话：${m.title}`}>
                      <span className="agent-memory-topic"><span className="icon-sm">{ICONS.chat}</span> {m.topic}</span>
                      {m.conclusions.map((c, i) => (
                        <span key={i} className="agent-memory-conclusion">{c}</span>
                      ))}
                      <span className="agent-memory-date">{new Date(m.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  ))}
                  {recalledFiles.map(f => (
                    <div key={f.path} className="agent-recall-item" title={f.path}>
                      <span className="agent-recall-name"><span className="icon-sm">{ICONS.document}</span> {f.name}</span>
                      <button
                        type="button"
                        className="agent-recall-add"
                        onClick={() => onAddContextFiles?.([{ name: f.name, path: f.path, content: f.content }])}
                        title="加入上下文"
                      >加入</button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 学习偏好：基于对话总结出的用户习惯（11 维度动态展示） */}
            {learnedPrefs.hasData && (
              <section className="agent-section agent-learn-section">
                <header className="agent-section-head">
                  <h3>学习偏好</h3>
                  <label className="agent-learn-toggle" title="自动学习开关">
                    <input
                      type="checkbox"
                      checked={learnedPrefs.learningEnabled !== false}
                      onChange={e => setLearningEnabled(e.target.checked)}
                    />
                    <span>自动学习</span>
                  </label>
                </header>
                <div className="agent-insights">
                  {(() => {
                    const ins = learnedPrefs.insights || {};
                    const rows = [];
                    // 兴趣领域（按观测次数排序的标签云）
                    if (ins.domains?.length > 0) {
                      rows.push(
                        <div key="domains" className="agent-insight-row">
                          <span className="agent-insight-label">兴趣领域</span>
                          <div className="agent-insight-tags">
                            {ins.domains.map(d => (
                              <span key={d.key} className="agent-insight-tag" title={`观测 ${d.count} 次`}>
                                {d.label} <em>×{d.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 提问模式
                    if (ins.patterns?.length > 0) {
                      rows.push(
                        <div key="patterns" className="agent-insight-row">
                          <span className="agent-insight-label">提问模式</span>
                          <div className="agent-insight-tags">
                            {ins.patterns.map(p => (
                              <span key={p.key} className="agent-insight-tag" title={`观测 ${p.count} 次`}>
                                {p.label} <em>×{p.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 高频主题（带权重）
                    if (ins.topics?.length > 0) {
                      rows.push(
                        <div key="topics" className="agent-insight-row">
                          <span className="agent-insight-label">高频主题</span>
                          <div className="agent-insight-tags">
                            {ins.topics.map(t => (
                              <span key={t.key} className="agent-insight-tag" title={`count=${t.count}, weight=${t.weight}`}>
                                {t.key} <em>·{t.weight}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 最近关注实体（短期记忆）
                    if (ins.recentEntities?.length > 0) {
                      rows.push(
                        <div key="entities" className="agent-insight-row">
                          <span className="agent-insight-label">最近关注</span>
                          <div className="agent-insight-tags">
                            {ins.recentEntities.map(e => (
                              <span key={e.entity} className="agent-insight-tag entity" title={`提及 ${e.count} 次`}>
                                {e.entity} <em>×{e.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 偏好汇总：格式/深度/长度/语言
                    const prefs = [];
                    if (ins.format) prefs.push(<span key="fmt" className="agent-insight-mini">{ins.format.label}</span>);
                    if (ins.depth) prefs.push(<span key="depth" className="agent-insight-mini">{ins.depth.label}</span>);
                    if (ins.length) prefs.push(<span key="len" className="agent-insight-mini">{ins.length.label}</span>);
                    if (ins.language) prefs.push(<span key="lang" className="agent-insight-mini">{ins.language.label}</span>);
                    if (prefs.length > 0) {
                      rows.push(
                        <div key="prefs" className="agent-insight-row">
                          <span className="agent-insight-label">回复偏好</span>
                          <div className="agent-insight-prefs">{prefs}</div>
                        </div>
                      );
                    }
                    // 时段偏好
                    if (ins.time?.length > 0) {
                      rows.push(
                        <div key="time" className="agent-insight-row">
                          <span className="agent-insight-label">活跃时段</span>
                          <div className="agent-insight-tags">
                            {ins.time.map(t => (
                              <span key={t.key} className="agent-insight-tag" title={`${t.count} 次提问`}>
                                {t.label} <em>×{t.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 工具偏好
                    if (ins.tools?.length > 0) {
                      rows.push(
                        <div key="tools" className="agent-insight-row">
                          <span className="agent-insight-label">常用工具</span>
                          <div className="agent-insight-tags">
                            {ins.tools.map(t => (
                              <span key={t.key} className="agent-insight-tag tool" title={`调用 ${t.count} 次`}>
                                {t.key} <em>×{t.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 负面反馈信号
                    if (ins.negatives?.length > 0) {
                      rows.push(
                        <div key="neg" className="agent-insight-row agent-insight-row-neg">
                          <span className="agent-insight-label">反馈信号</span>
                          <div className="agent-insight-tags">
                            {ins.negatives.map(n => (
                              <span key={n.pattern} className="agent-insight-tag negative" title={`${n.count} 次表达`}>
                                {n.pattern} <em>×{n.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // 会话统计
                    if (ins.sessionStats?.totalSessions > 0) {
                      const s = ins.sessionStats;
                      rows.push(
                        <div key="stats" className="agent-insight-row">
                          <span className="agent-insight-label">会话统计</span>
                          <div className="agent-insight-prefs">
                            <span className="agent-insight-mini" title="总会话数">{s.totalSessions} 次会话</span>
                            <span className="agent-insight-mini" title="平均轮次">平均 {s.avgRounds} 轮</span>
                            {s.maxRounds > 0 && <span className="agent-insight-mini" title="最长会话">最长 {s.maxRounds} 轮</span>}
                          </div>
                        </div>
                      );
                    }
                    return rows;
                  })()}
                </div>
                {learnedPrefs.updatedAt > 0 && (
                  <div className="agent-learn-updated">
                    最后学习：{new Date(learnedPrefs.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </section>
            )}

            {/* 空状态 */}
            {relevantMemories.length === 0 && recalledFiles.length === 0 && !learnedPrefs.hasData && (
              <div className="agent-tab-empty">
                <div className="agent-tab-empty-icon">{ICONS.sparkles}</div>
                <div className="agent-tab-empty-text">
                  还没有记忆数据。<br />
                  随着你与智能体对话，它会自动总结你的习惯、想法、需求并保留在这里，越来越懂你。
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
