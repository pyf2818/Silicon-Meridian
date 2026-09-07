import React, { useState, useEffect } from 'react';
import { ICONS, AGENT_CATEGORIES } from '../../constants/index.jsx';
import { showToast } from '../../utils/toast.js';
import { getAllTools, subscribeTools } from '../../utils/toolRegistry.js';
import { compressImageFile } from '../../utils/imageCompress.js';
import { useElfStore } from '../../store/elfStore.js';

/* v23 #1：精灵协作能力 + 划词翻译开关（直读 elfStore，避免层层透传 props） */
function ElfCapabilityPanel() {
  const elfCollab = useElfStore(s => s.elfCollab);
  const setElfCollab = useElfStore(s => s.setElfCollab);
  const selTranslate = useElfStore(s => s.selectionTranslateEnabled);
  const setSelTranslate = useElfStore(s => s.setSelectionTranslateEnabled);

  return (
    <div className="setting-item">
      <label>精灵协作能力（对接 AI 工作站）</label>
      <p className="setting-desc">
        让 AI 精灵调用工作站的智能体引擎：多智能体协作会把子任务派给 explorer / researcher / writer / critic
        等子代理并行执行；团队群聊会组建成员团队，通过共享任务列表与邮箱协作推进。子代理的写操作仍受审批闸门约束，不会绕过安全策略。
      </p>
      <div className="elf-collab-list">
        <label className="elf-collab-item">
          <input
            type="checkbox"
            checked={!!elfCollab.subagent}
            onChange={(e) => setElfCollab({ subagent: e.target.checked })}
          />
          <div className="elf-collab-info">
            <b>多智能体协作（spawn_subagent）</b>
            <small>多个独立子任务并行派发并收集报告，适合多信源侦察、多课题调研</small>
          </div>
        </label>
        <label className="elf-collab-item">
          <input
            type="checkbox"
            checked={!!elfCollab.team}
            onChange={(e) => setElfCollab({ team: e.target.checked })}
          />
          <div className="elf-collab-info">
            <b>团队群聊（spawn_agent_team）</b>
            <small>组建多成员团队，共享任务列表 + 互通消息协作完成复杂任务</small>
          </div>
        </label>
        <label className="elf-collab-item">
          <input
            type="checkbox"
            checked={selTranslate}
            onChange={(e) => setSelTranslate(e.target.checked)}
          />
          <div className="elf-collab-info">
            <b>划词翻译与解释</b>
            <small>在任意页面选中文字后自动弹出翻译与解释气泡，可一键转交 AI 精灵追问</small>
          </div>
        </label>
      </div>
    </div>
  );
}

/* 工具勾选区块：在新建/编辑 Agent 表单中复用。
 * 动态从 toolRegistry 取值（含自定义工具），subscribeTools 自动同步。 */
function AgentToolsSelector({ value, onChange }) {
  const [tools, setTools] = useState(() => getAllTools());
  useEffect(() => subscribeTools(setTools), []);
  const selected = Array.isArray(value) ? value : [];
  const toggle = (name) => {
    if (selected.includes(name)) {
      onChange(selected.filter(n => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };
  // 内置工具在前，自定义工具在后
  const sorted = [...tools].sort((a, b) => {
    if (a.source === 'builtin' && b.source !== 'builtin') return -1;
    if (a.source !== 'builtin' && b.source === 'builtin') return 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <div className="agent-form-tools">
      <label>可用工具（勾选后该智能体将走 Agent Loop 模式，可主动调用工具）</label>
      <div className="agent-form-tools-grid">
        {sorted.map(entry => {
          const fn = entry.schema.function;
          const checked = selected.includes(fn.name);
          const isCustom = entry.source !== 'builtin';
          return (
            <label key={fn.name} className={`agent-tool-chip${checked ? ' is-checked' : ''}${isCustom ? ' is-custom' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(fn.name)}
              />
              <span className="agent-tool-chip-icon">{entry.meta?.icon || ICONS.settings}</span>
              <span className="agent-tool-chip-name">{fn.name}</span>
              <span className="agent-tool-chip-desc">{fn.description?.slice(0, 40) || ''}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function AgentsTab({
  elfName, setElfName,
  elfAvatar, setElfAvatar,
  agents, setAgents,
  currentAgent, setCurrentAgent,
  agentFilter, setAgentFilter,
  editingAgent, setEditingAgent,
  showAgentForm, setShowAgentForm,
  newAgent, setNewAgent,
  agentPromptRefining, setAgentPromptRefining,
  llmConfig,
}) {
  return (
                  <>
                    <div className="setting-item">
                      <label>AI精灵名称</label>
                      <p className="setting-desc">自定义AI精灵在聊天窗口中的显示名称</p>
                      <input 
                        type="text" 
                        value={elfName} 
                        onChange={e => setElfName(e.target.value || 'AI精灵')}
                        placeholder="AI精灵"
                        className="elf-name-input"
                        maxLength={20}
                      />
                    </div>
                    <div className="setting-item">
                      <label>AI精灵头像</label>
                      <p className="setting-desc">自定义AI精灵的头像图片</p>
                      <div className="elf-avatar-setting">
                        <div className="elf-avatar-preview">
                          {elfAvatar ? (
                            <img src={elfAvatar} alt="AI精灵头像" />
                          ) : (
                            <div className="elf-avatar-default">AI</div>
                          )}
                        </div>
                        <div className="elf-avatar-actions">
                          <label htmlFor="elf-avatar-upload" className="elf-avatar-upload-btn">选择图片</label>
                          <input
                            id="elf-avatar-upload"
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              e.target.value = ''; // 允许连续选择同一文件
                              if (!file) return;
                              try {
                                // v23 #1 修复头像报错：先压缩（192px JPEG），再落 localStorage；
                                // 写入失败（配额满）时 setElfAvatar 会回滚并返回 false
                                const base64 = await compressImageFile(file, { maxSize: 192, quality: 0.85 });
                                const ok = setElfAvatar(base64);
                                if (ok) showToast('头像已更新');
                                else showToast('头像保存失败：本地存储空间不足，请清理浏览器存储后重试');
                              } catch (err) {
                                showToast(`头像处理失败: ${err?.message || err}`);
                              }
                            }}
                            style={{ display: 'none' }}
                          />
                          {elfAvatar && (
                            <button
                              className="elf-avatar-reset-btn"
                              onClick={() => {
                                setElfAvatar('');
                                showToast('已恢复默认头像');
                              }}
                            >
                              恢复默认
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <ElfCapabilityPanel />
                    <div className="setting-item">
                      <label>工作站角色</label>
                      <p className="setting-desc">管理 AI 工作站对话的角色（每个角色有独立的专长与提示词；AI 精灵为固定单例，不在此列）</p>
                      <div className="agent-filter-bar">
                        {AGENT_CATEGORIES.map(cat => (
                          <button
                            key={cat}
                            className={`agent-filter-btn ${agentFilter === cat ? 'active' : ''}`}
                            onClick={() => setAgentFilter(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <div className="agent-list">
                        {agents.filter(a => agentFilter === '全部' || a.category === agentFilter).map(agent => (
                          <div key={agent.id} className={`agent-card ${currentAgent === agent.id ? 'active' : ''}`}>
                            <div className="agent-card-main">
                              <img src={agent.avatar || '/ai-elf-avatar.png'} alt={agent.name} className="agent-card-avatar" />
                              <div className="agent-card-info">
                                <span className="agent-card-name">{agent.name}</span>
                              <span className="agent-card-desc">{agent.description}</span>
                              <div className="agent-card-tags">
                                <span className="agent-card-category">{agent.category}</span>
                                {(agent.tags || []).map((tag, i) => (
                                  <span key={i} className="agent-card-tag">{tag}</span>
                                ))}
                              </div>
                              </div>
                            </div>
                            <div className="agent-card-actions">
                              <button
                                className={`agent-card-select ${currentAgent === agent.id ? 'selected' : ''}`}
                                onClick={() => setCurrentAgent(agent.id)}
                              >
                                {currentAgent === agent.id ? '使用中' : '选择'}
                              </button>
                              <button
                                className="agent-card-detail-btn"
                                onClick={() => setEditingAgent(agent)}
                              >
                                详情
                              </button>
                              {agent.isCustom && (
                                <button className="agent-card-delete" onClick={() => {
                                  if (confirm(`确定删除Agent「${agent.name}」？`)) {
                                    setAgents(prev => prev.filter(a => a.id !== agent.id));
                                    if (currentAgent === agent.id) setCurrentAgent('analyst');
                                  }
                                }}>
                                  {ICONS.x}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button className="agent-create-btn" onClick={() => setShowAgentForm(true)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:16,height:16,marginRight:6}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        创建自定义Agent
                      </button>
                    </div>

                    {showAgentForm && (
                      <div className="agent-form-overlay">
                        <div className="agent-form">
                          <div className="agent-form-header">
                            <h4>创建自定义Agent</h4>
                            <button className="agent-form-close" onClick={() => setShowAgentForm(false)}>{ICONS.x}</button>
                          </div>
                          <div className="agent-form-body">
                            <div className="agent-form-avatar-section">
                              <img src={newAgent.avatar || '/ai-elf-avatar.png'} alt="预览" className="agent-form-avatar-preview" />
                              <div className="agent-form-avatar-actions">
                                <input
                                  type="file"
                                  accept="image/*"
                                  id="agent-avatar-upload-new"
                                  className="elf-avatar-file-input"
                                  onChange={async (e) => {
                                    const file = e.target.files[0];
                                    e.target.value = '';
                                    if (!file) return;
                                    try {
                                      const base64 = await compressImageFile(file, { maxSize: 192, quality: 0.85 });
                                      setNewAgent(prev => ({ ...prev, avatar: base64 }));
                                    } catch (err) {
                                      showToast(`头像处理失败: ${err?.message || err}`);
                                    }
                                  }}
                                />
                                <label htmlFor="agent-avatar-upload-new" className="elf-avatar-upload-btn">选择图片</label>
                                {newAgent.avatar && (
                                  <button className="elf-avatar-reset-btn" onClick={() => setNewAgent(prev => ({ ...prev, avatar: '' }))}>恢复默认</button>
                                )}
                              </div>
                            </div>
                            <label>名称</label>
                            <input
                              type="text"
                              value={newAgent.name}
                              onChange={e => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="如：产品经理助手"
                              className="agent-form-input"
                            />
                            <label>分类</label>
                            <select
                              value={newAgent.category}
                              onChange={e => setNewAgent(prev => ({ ...prev, category: e.target.value }))}
                              className="agent-form-select"
                            >
                              {AGENT_CATEGORIES.filter(c => c !== '全部').map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <label>描述</label>
                            <input
                              type="text"
                              value={newAgent.description}
                              onChange={e => setNewAgent(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="简短描述这个Agent的用途"
                              className="agent-form-input"
                            />
                            <label>标签（逗号分隔）</label>
                            <input
                              type="text"
                              value={(newAgent.tags || []).join(', ')}
                              onChange={e => setNewAgent(prev => ({ ...prev, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))}
                              placeholder="如：资讯分析, 结构化思维"
                              className="agent-form-input"
                            />
                            <label>系统提示词</label>
                            <textarea
                              value={newAgent.systemPrompt}
                              onChange={e => setNewAgent(prev => ({ ...prev, systemPrompt: e.target.value }))}
                              placeholder="定义这个Agent的角色、技能和回答风格..."
                              rows={6}
                              className="agent-form-textarea"
                            />
                            <button
                              className="agent-refine-btn"
                              onClick={async () => {
                                if (!newAgent.systemPrompt.trim() || !llmConfig.baseUrl) return;
                                setAgentPromptRefining(true);
                                try {
                                  const res = await fetch('/api/ai-generate', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      baseUrl: llmConfig.baseUrl,
                                      apiKey: llmConfig.apiKey,
                                      model: llmConfig.selectedModel,
                                      action: 'chat',
                                      content: `请帮我优化以下AI Agent的系统提示词，使其更加专业、清晰、有效。保持原意，但让提示词更加精炼有力。直接输出优化后的提示词，不要添加额外说明：

  ${newAgent.systemPrompt}`
                                    })
                                  });
                                  const data = await res.json();
                                  if (data.content) {
                                    setNewAgent(prev => ({ ...prev, systemPrompt: data.content.trim() }));
                                  }
                                } catch (e) {
                                  alert('润色失败: ' + e.message);
                                } finally {
                                  setAgentPromptRefining(false);
                                }
                              }}
                              disabled={agentPromptRefining || !newAgent.systemPrompt.trim() || !llmConfig.baseUrl}
                            >
                              {agentPromptRefining ? '润色中...' : 'AI润色提示词'}
                            </button>
                          </div>
                          <AgentToolsSelector
                            value={newAgent.tools}
                            onChange={(tools) => setNewAgent(prev => ({ ...prev, tools }))}
                          />
                          <div className="agent-form-footer">
                            <button className="btn-cancel" onClick={() => setShowAgentForm(false)}>取消</button>
                            <button
                              className="btn-save"
                              onClick={() => {
                                if (!newAgent.name.trim() || !newAgent.systemPrompt.trim()) return;
                                const agent = {
                                  id: 'custom-' + Date.now(),
                                  name: newAgent.name.trim(),
                                  description: newAgent.description.trim() || '自定义Agent',
                                  systemPrompt: newAgent.systemPrompt.trim(),
                                  category: newAgent.category,
                                  tags: newAgent.tags || [],
                                  avatar: newAgent.avatar || '',
                                  tools: Array.isArray(newAgent.tools) ? newAgent.tools : [],
                                  isDefault: false,
                                  isCustom: true
                                };
                                setAgents(prev => [...prev, agent]);
                                 setNewAgent({ name: '', description: '', systemPrompt: '', category: '分析', tags: [], avatar: '', tools: [] });
                                setShowAgentForm(false);
                              }}
                              disabled={!newAgent.name.trim() || !newAgent.systemPrompt.trim()}
                            >
                              创建
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Agent详情编辑 */}
                    {editingAgent && (
                      <div className="agent-form-overlay">
                        <div className="agent-form">
                          <div className="agent-form-header">
                            <h4>Agent详情</h4>
                            <button className="agent-form-close" onClick={() => setEditingAgent(null)}>{ICONS.x}</button>
                          </div>
                          <div className="agent-form-body">
                            <div className="agent-form-avatar-section">
                              <img src={editingAgent.avatar || '/ai-elf-avatar.png'} alt={editingAgent.name} className="agent-form-avatar-preview" />
                              <div className="agent-form-avatar-actions">
                                <input
                                  type="file"
                                  accept="image/*"
                                  id="agent-avatar-upload-edit"
                                  className="elf-avatar-file-input"
                                  onChange={async (e) => {
                                    const file = e.target.files[0];
                                    e.target.value = '';
                                    if (!file) return;
                                    try {
                                      const base64 = await compressImageFile(file, { maxSize: 192, quality: 0.85 });
                                      setEditingAgent(prev => ({ ...prev, avatar: base64 }));
                                    } catch (err) {
                                      showToast(`头像处理失败: ${err?.message || err}`);
                                    }
                                  }}
                                />
                                <label htmlFor="agent-avatar-upload-edit" className="elf-avatar-upload-btn">选择图片</label>
                                {editingAgent.avatar && (
                                  <button className="elf-avatar-reset-btn" onClick={() => setEditingAgent(prev => ({ ...prev, avatar: '' }))}>恢复默认</button>
                                )}
                              </div>
                            </div>
                            <label>ID</label>
                            <input type="text" value={editingAgent.id} disabled className="agent-form-input" />
                            <label>名称</label>
                            <input
                              type="text"
                              value={editingAgent.name}
                              onChange={e => setEditingAgent(prev => ({ ...prev, name: e.target.value }))}
                              className="agent-form-input"
                            />
                            <label>描述</label>
                            <input
                              type="text"
                              value={editingAgent.description}
                              onChange={e => setEditingAgent(prev => ({ ...prev, description: e.target.value }))}
                              className="agent-form-input"
                            />
                            <label>分类</label>
                            <select
                              value={editingAgent.category}
                              onChange={e => setEditingAgent(prev => ({ ...prev, category: e.target.value }))}
                              className="agent-form-select"
                            >
                              {AGENT_CATEGORIES.filter(c => c !== '全部').map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <label>标签（逗号分隔）</label>
                            <input
                              type="text"
                              value={(editingAgent.tags || []).join(', ')}
                              onChange={e => setEditingAgent(prev => ({ ...prev, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))}
                              placeholder="如：资讯分析, 结构化思维"
                              className="agent-form-input"
                            />
                            <label>系统提示词</label>
                            <textarea
                              value={editingAgent.systemPrompt}
                              onChange={e => setEditingAgent(prev => ({ ...prev, systemPrompt: e.target.value }))}
                              rows={6}
                              className="agent-form-textarea"
                            />
                            <AgentToolsSelector
                              value={editingAgent.tools}
                              onChange={(tools) => setEditingAgent(prev => ({ ...prev, tools }))}
                            />
                          </div>
                          <div className="agent-form-footer">
                            <button className="btn-cancel" onClick={() => setEditingAgent(null)}>取消</button>
                            <button
                              className="btn-save"
                              onClick={() => {
                                setAgents(prev => {
                                  const updated = prev.map(a => a.id === editingAgent.id ? editingAgent : a);
                                  // 保存自定义agents到localStorage
                                  const customAgents = updated.filter(a => a.isCustom);
                                  try {
                                    localStorage.setItem('elfAgents', JSON.stringify(customAgents));
                                  } catch (e) {
                                    console.warn('Failed to save custom agents to localStorage:', e);
                                  }
                                  return updated;
                                });
                                setEditingAgent(null);
                              }}
                            >
                              保存修改
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
  );
}
