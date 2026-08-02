import React, { useState } from 'react';
import {
  PROFILE_TIER_OPTIONS,
  PROFILE_TIERS,
  SPECIAL_FOLLOW_TYPES,
} from '../domain/intelligence/profileTiers.js';
import { ICONS } from '../constants/index.jsx';
import { showToast } from '../utils/toast.js';
import { useUiStore, useBehaviorStore } from '../store';
import PendingSuggestionsSection from './profile/PendingSuggestionsSection.jsx';
import AgentMemorySection from './profile/AgentMemorySection.jsx';
import PersonaSummarySection from './profile/PersonaSummarySection.jsx';
import SnapshotHistorySection from './profile/SnapshotHistorySection.jsx';
import ProfileDashboard from './profile/ProfileDashboard.jsx';

export default function ProfilePage({
  intelligenceProfile,
  bookmarks,
  readingHistory,
  dailyProfileSnapshots,
  profileLearningEngine,
  profilePriorityItems,
  setDomainTiers,
  sourcePriorityItems,
  setSourceTiers,
  specialFollows,
  setSpecialFollows,
  specialFollowForm,
  setSpecialFollowForm,
  editingSpecialFollowId,
  setEditingSpecialFollowId,
  profileCalibrationCards,
  generateDailyProfileSnapshot,
  setShowInterestModal,
  selectedInterests,
}) {
  const resetForm = () => {
    setSpecialFollowForm({ type: 'source', target: '', note: '' });
    setEditingSpecialFollowId(null);
  };

  const submit = () => {
    const target = specialFollowForm.target.trim();
    const note = specialFollowForm.note.trim();
    if (!target) {
      showToast('请输入特别关注目标');
      return;
    }
    const duplicate = specialFollows.some(item =>
      item.id !== editingSpecialFollowId
      && item.type === specialFollowForm.type
      && item.target.toLocaleLowerCase() === target.toLocaleLowerCase()
    );
    if (duplicate) {
      showToast('该特别关注已存在');
      return;
    }
    if (editingSpecialFollowId) {
      setSpecialFollows(previous => previous.map(item => item.id === editingSpecialFollowId
        ? { ...item, type: specialFollowForm.type, target, note }
        : item));
    } else {
      setSpecialFollows(previous => [...previous, {
        id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
        type: specialFollowForm.type,
        target,
        note,
      }]);
    }
    resetForm();
  };

  const editFollow = item => {
    setEditingSpecialFollowId(item.id);
    setSpecialFollowForm({ type: item.type, target: item.target, note: item.note || '' });
  };

  // Phase 4: Tab 切换（仪表盘 / 设置）
  const profileTab = useUiStore(s => s.profileTab);
  const setProfileTab = useUiStore(s => s.setProfileTab);

  // 问题 2：把"只读校准状态"变成真纠错台 —— 直接写入 recommendationFeedback
  const setRecommendationFeedback = useBehaviorStore(s => s.setRecommendationFeedback);
  const recommendationFeedback = useBehaviorStore(s => s.recommendationFeedback);
  const [calibInput, setCalibInput] = useState('');
  const [calibType, setCalibType] = useState('boost'); // boost | mute | track

  const scrollToId = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const applyManualCalibration = () => {
    const value = calibInput.trim();
    if (!value) { showToast('请输入要校准的内容'); return; }
    setRecommendationFeedback(prev => {
      const next = { ...prev };
      if (calibType === 'boost') {
        next.boostedCategories = { ...(prev.boostedCategories || {}), [value]: ((prev.boostedCategories || {})[value] || 0) + 1 };
      } else if (calibType === 'mute') {
        next.mutedSources = { ...(prev.mutedSources || {}), [value]: ((prev.mutedSources || {})[value] || 0) + 1 };
      } else {
        next.trackedTerms = { ...(prev.trackedTerms || {}), [value]: ((prev.trackedTerms || {})[value] || 0) + 1 };
      }
      return next;
    });
    showToast(
      calibType === 'boost' ? `已提高「${value}」的推荐权重`
        : calibType === 'mute' ? `已降低「${value}」的推荐权重`
          : `已开始追踪「${value}」`
    );
    setCalibInput('');
  };

  return (
    <div className="product-page profile-center-page profile-hud-page">
              {/* 扫描线叠加层 */}
              <div className="hud-scanlines" aria-hidden="true" />

              <section className="product-hero profile-hero">
                <div>
                  <div className="workbench-kicker">Personal Intelligence Memory</div>
                  <h1>用户画像</h1>
                  <p>设置关注领域、领域优先级、信号源优先级，并按日期记录每日 AI 画像，让系统越用越懂你。</p>
                </div>
                <div className="product-hero-actions">
                  <button className="ai-primary-action" onClick={generateDailyProfileSnapshot}>生成今日画像</button>
                  <button className="secondary-action" onClick={() => setShowInterestModal(true)}>调整关注领域</button>
                </div>
              </section>

              {profileTab === 'dashboard' ? (
                <ProfileDashboard
                  intelligenceProfile={intelligenceProfile}
                  bookmarks={bookmarks}
                  readingHistory={readingHistory}
                  selectedInterests={selectedInterests}
                  specialFollows={specialFollows}
                />
              ) : (
                <div className="profile-settings-grid">
              <details className="pset-collapsible">
                <summary>AI 性格画像</summary>
                <PersonaSummarySection />
              </details>
              <details className="pset-collapsible">
                <summary>AI 建议待确认</summary>
                <PendingSuggestionsSection />
              </details>

              <div className="hud-stat-grid">
                <div className="hud-stat-tile">
                  <span className="hud-stat-label">关注领域</span>
                  <strong className="hud-stat-value">{selectedInterests.length}</strong>
                  <span className="hud-stat-sub">{intelligenceProfile.focusLabels.slice(0, 4).join('、') || '尚未设置'}</span>
                  <span className="hud-stat-bar"><i style={{ width: `${Math.min(100, selectedInterests.length * 8)}%` }} /></span>
                </div>
                <div className="hud-stat-tile">
                  <span className="hud-stat-label">阅读点击</span>
                  <strong className="hud-stat-value">{readingHistory.length}</strong>
                  <span className="hud-stat-sub">近 100 条点击记录用于校准推荐</span>
                  <span className="hud-stat-bar"><i style={{ width: `${Math.min(100, readingHistory.length)}%` }} /></span>
                </div>
                <div className="hud-stat-tile">
                  <span className="hud-stat-label">收藏资讯</span>
                  <strong className="hud-stat-value">{bookmarks.length}</strong>
                  <span className="hud-stat-sub">收藏会提高相似主题和来源权重</span>
                  <span className="hud-stat-bar"><i style={{ width: `${Math.min(100, (bookmarks.length / 50) * 100)}%` }} /></span>
                </div>
                <div className="hud-stat-tile">
                  <span className="hud-stat-label">每日画像</span>
                  <strong className="hud-stat-value">{dailyProfileSnapshots.length}</strong>
                  <span className="hud-stat-sub">按日期保留 AI 对你的理解变化</span>
                  <span className="hud-stat-bar"><i style={{ width: `${Math.min(100, (dailyProfileSnapshots.length / 30) * 100)}%` }} /></span>
                </div>
              </div>

              <section className="profile-learning-panel">
                <div className="profile-learning-main">
                  <div className="section-header">
                    <h2 className="section-title">{ICONS.sparkles} 画像学习引擎</h2>
                    <p className="section-desc">系统把关注领域、阅读点击、收藏、素材沉淀和反馈动作汇总成可解释的推荐记忆。</p>
                  </div>
                  <div className="profile-learning-score">
                    <strong>{profileLearningEngine.confidence}%</strong>
                    <span>{profileLearningEngine.confidenceLabel} · {profileLearningEngine.behaviorDepth}</span>
                    <p>{profileLearningEngine.summary}</p>
                  </div>
                  <div className="profile-learning-actions">
                    {(profileLearningEngine.nextActions.length ? profileLearningEngine.nextActions : ['继续阅读每日汇报并收藏真正有价值的内容']).map(action => (
                      <button key={action} onClick={() => showToast(action)}>{action}</button>
                    ))}
                  </div>
                </div>
                <div className="profile-learning-side">
                  <div>
                    <span>强领域</span>
                    <p>{profileLearningEngine.topCategories.slice(0, 3).map(item => item.label).join('、') || '等待校准'}</p>
                  </div>
                  <div>
                    <span>信任来源</span>
                    <p>{profileLearningEngine.topSources.slice(0, 3).map(item => item.name).join('、') || '等待阅读行为'}</p>
                  </div>
                  <div>
                    <span>记忆关键词</span>
                    <p>{profileLearningEngine.topTags.slice(0, 5).map(item => item.name).join('、') || '暂无'}</p>
                  </div>
                  <div>
                    <span>探索盲区</span>
                    <p>{profileLearningEngine.blindSpots.slice(0, 3).join('、') || '覆盖较均衡'}</p>
                  </div>
                </div>
              </section>

              <section className="profile-control-layout">
                <div className="profile-control-panel" id="profile-domain-tiers">
                  <div className="section-header">
                    <h2 className="section-title">{ICONS.target} 领域优先级</h2>
                    <p className="section-desc">一级进入核心必看，二级正常参与，三级保留探索价值但降低出现频率。</p>
                  </div>
                  <div className="priority-list">
                    {profilePriorityItems.map(item => (
                      <div key={item.id} className="priority-row" data-testid="profile-domain-row" data-domain-id={item.id}>
                        <span>{ICONS[item.icon]} {item.label}</span>
                        <div className="profile-tier-control" role="group" aria-label={item.label + '关注等级'}>
                          {PROFILE_TIER_OPTIONS.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              data-testid="profile-domain-tier"
                              data-tier={option.id}
                              aria-pressed={item.tier === option.id}
                              className={item.tier === option.id ? 'active' : ''}
                              onClick={() => setDomainTiers(prev => ({ ...prev, [item.id]: option.id }))}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <strong>{PROFILE_TIERS[item.tier]?.shortLabel || '二级'}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="profile-control-panel" id="profile-source-tiers">
                  <div className="section-header">
                    <h2 className="section-title">{ICONS.layers} 信号源优先级</h2>
                    <p className="section-desc">显式信任等级优先于隐式行为，避免一次误点长期改变信源判断。</p>
                  </div>
                  <div className="priority-list">
                    {sourcePriorityItems.map(item => (
                      <div key={item.name} className="priority-row" data-testid="profile-source-row" data-source-id={item.name}>
                        <span>{item.name}</span>
                        <div className="profile-tier-control" role="group" aria-label={item.name + '信源等级'}>
                          {PROFILE_TIER_OPTIONS.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              data-testid="profile-source-tier"
                              data-tier={option.id}
                              aria-pressed={item.tier === option.id}
                              className={item.tier === option.id ? 'active' : ''}
                              onClick={() => setSourceTiers(prev => ({ ...prev, [item.name]: option.id }))}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <strong>{PROFILE_TIERS[item.tier]?.shortLabel || '二级'}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="profile-special-follows" id="profile-special-follows" data-testid="profile-special-follows">
                <div className="section-header"><h2 className="section-title">{ICONS.star} 特别关注</h2><p className="section-desc">手动添加小众信息源、博主或特定URL，始终优先推荐。</p></div>
                {specialFollows.length === 0 ? (
                  <div className="empty-state"><p>暂无特别关注</p><p className="empty-state-hint">添加后这些目标的新内容会优先进入个人必看通道</p></div>
                ) : (
                  <div className="special-follows-list">
                    {specialFollows.map(f => (
                      <div key={f.id} className="special-follow-item">
                        <span className="special-follow-type">{SPECIAL_FOLLOW_TYPES.find(type => type.id === f.type)?.label || '信源'}</span>
                        <span className="special-follow-name">{f.target}</span>
                        <span className="special-follow-note">{f.note || '无备注'}</span>
                        <button type="button" className="special-follow-edit" onClick={() => editFollow(f)}>编辑</button>
                        <button type="button" className="special-follow-remove" onClick={() => {
                          setSpecialFollows(prev => prev.filter(x => x.id !== f.id));
                          if (editingSpecialFollowId === f.id) resetForm();
                        }}>删除</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="special-follow-form">
                  <select data-testid="profile-special-type" value={specialFollowForm.type} onChange={event => setSpecialFollowForm(prev => ({ ...prev, type: event.target.value }))} aria-label="特别关注类型">
                    {SPECIAL_FOLLOW_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <input data-testid="profile-special-target" value={specialFollowForm.target} onChange={event => setSpecialFollowForm(prev => ({ ...prev, target: event.target.value }))} placeholder="信源、博主、关键词或 URL" />
                  <input data-testid="profile-special-note" value={specialFollowForm.note} onChange={event => setSpecialFollowForm(prev => ({ ...prev, note: event.target.value }))} placeholder="备注（可选）" />
                  <button type="button" data-testid="profile-special-submit" onClick={submit}>{editingSpecialFollowId ? '保存' : '添加'}</button>
                  {editingSpecialFollowId && <button type="button" className="secondary-action" onClick={resetForm}>取消</button>}
                </div>
              </section>

              <section className="profile-calibration-panel">
                <div className="section-header">
                  <h2 className="section-title">{ICONS.sparkles} 推荐校准台</h2>
                  <p className="section-desc">这些信号已接入推荐排序。如果系统理解错了你，下面可以直接纠正——校准会立刻影响后续推荐。</p>
                </div>
                <div className="profile-calibration-grid">
                  {profileCalibrationCards.map(signal => {
                    const jumpId = signal.label === '高优先领域' ? 'profile-domain-tiers'
                      : signal.label === '高信任来源' ? 'profile-source-tiers'
                        : null;
                    const inner = (
                      <>
                        <span>{signal.label}</span>
                        <strong>{signal.value}</strong>
                        <p>{signal.desc}</p>
                        {jumpId && <span className="calib-jump-hint">去调整 →</span>}
                      </>
                    );
                    return jumpId ? (
                      <button type="button" key={signal.label} className="profile-calibration-card is-clickable" onClick={() => scrollToId(jumpId)}>
                        {inner}
                      </button>
                    ) : (
                      <div key={signal.label} className="profile-calibration-card">{inner}</div>
                    );
                  })}
                </div>

                <div className="calibration-console">
                  <div className="calibration-console-head">
                    <span className="calibration-console-title">手动纠错</span>
                    <span className="calibration-console-sub">系统理解错了？直接告诉它你真正关心的</span>
                  </div>
                  <div className="calibration-type-toggle" role="group" aria-label="纠错类型">
                    <button type="button" className={calibType === 'boost' ? 'active' : ''} onClick={() => setCalibType('boost')}>提升领域</button>
                    <button type="button" className={calibType === 'mute' ? 'active' : ''} onClick={() => setCalibType('mute')}>屏蔽来源</button>
                    <button type="button" className={calibType === 'track' ? 'active' : ''} onClick={() => setCalibType('track')}>盯住关键词</button>
                  </div>
                  <div className="calibration-console-row">
                    <input
                      className="calibration-console-input"
                      value={calibInput}
                      onChange={e => setCalibInput(e.target.value)}
                      placeholder={calibType === 'boost' ? '如：芯片、Agent、机器人' : calibType === 'mute' ? '如：某公众号 / 某媒体' : '如：GPU、端侧模型'}
                      onKeyDown={e => { if (e.key === 'Enter') applyManualCalibration(); }}
                    />
                    <button type="button" className="ai-primary-action calibration-apply" onClick={applyManualCalibration}>记录校准</button>
                  </div>
                  {(() => {
                    const fb = recommendationFeedback || {};
                    const boostCount = Object.keys(fb.boostedCategories || {}).length;
                    const muteCount = Object.keys(fb.mutedSources || {}).length;
                    const trackCount = Object.keys(fb.trackedTerms || {}).length;
                    const hiddenCount = (fb.hiddenIds || []).length;
                    const total = boostCount + muteCount + trackCount + hiddenCount;
                    return (
                      <div className="calibration-summary">
                        {total > 0
                          ? <span>已记录 <strong>{total}</strong> 条校准：提升 {boostCount} 个领域 · 屏蔽 {muteCount} 个来源 · 盯住 {trackCount} 个关键词</span>
                          : <span>还没有手动校准，试着纠正一条，让推荐更懂你。</span>}
                      </div>
                    );
                  })()}
                </div>
              </section>

              <section className="profile-memory-panel">
                <div className="section-header">
                  <h2 className="section-title">{ICONS.calendar} 每日 AI 画像记录</h2>
                  <p className="section-desc">每日记录会保留系统对你的关注领域、追踪关键词和输出目标的理解。</p>
                </div>
                {dailyProfileSnapshots.length === 0 ? (
                  <div className="empty-state"><p>还没有画像记录</p><button onClick={generateDailyProfileSnapshot}>生成第一条记录</button></div>
                ) : (
                  <div className="profile-snapshot-list">
                    {dailyProfileSnapshots.map(snapshot => (
                      <article key={snapshot.date} className="profile-snapshot">
                        <span>{snapshot.date}</span>
                        <strong>{snapshot.depth} · {snapshot.outputGoal}</strong>
                        <p>关注：{snapshot.focus.join('、') || '未设置'}；追踪：{snapshot.tracked.join('、') || '暂无'}；来源：{snapshot.sources.join('、') || '暂无'}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <AgentMemorySection />
              <SnapshotHistorySection />
              </div>
              )}
            </div>
  );
}
