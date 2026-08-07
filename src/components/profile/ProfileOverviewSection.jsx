// src/components/profile/ProfileOverviewSection.jsx
// 画像总览 —— "AI 眼中的你"报告：AI 总结语 + 性格标签 + 置信度
// + 兴趣雷达 + 高频主题词云 + 偏好速览。数据来自学习引擎 / AI 性格 / 11 维画像。
import { useMemo } from 'react';
import { ICONS } from '../../constants/index.jsx';
import { useProfileStore } from '../../store';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { HudRadarChart } from './charts/HudCharts.jsx';

function TagCloud({ items, emptyText = '暂无' }) {
  if (!items || items.length === 0) {
    return <div className="profile-empty-hint">{emptyText}</div>;
  }
  const max = Math.max(...items.map(i => i.weight ?? i.count ?? 1), 1);
  return (
    <div className="profile-tag-cloud">
      {items.map((item, idx) => {
        const strength = Math.max(0.45, (item.weight ?? item.count ?? 1) / max);
        return (
          <span key={idx} className="profile-tag-cloud-item" style={{ opacity: strength, transform: `scale(${0.9 + strength * 0.25})` }}>
            {item.label || item.name || item.key || item.entity}
          </span>
        );
      })}
    </div>
  );
}

export default function ProfileOverviewSection({
  readingHistory,
  bookmarks,
  materials = [],
  selectedInterests,
  profileLearningEngine,
  learnedPrefs,
}) {
  const theme = useThemeColors();
  const personaSummary = useProfileStore(s => s.personaSummary);

  const persona = personaSummary || {};
  const personaTags = [
    ...(Array.isArray(persona.traits) ? persona.traits : []),
    ...(Array.isArray(persona.habits) ? persona.habits : []),
    ...(Array.isArray(persona.needs) ? persona.needs : []),
  ].slice(0, 10);

  // 兴趣雷达（来自学习引擎 topCategories 的分数）
  const radar = useMemo(() => {
    const cats = profileLearningEngine?.topCategories || [];
    if (cats.length === 0) return { axes: [], values: [] };
    const maxScore = Math.max(...cats.map(c => c.score), 1);
    return {
      axes: cats.slice(0, 6).map(c => c.label),
      values: cats.slice(0, 6).map(c => Math.round(c.score / maxScore * 100)),
    };
  }, [profileLearningEngine]);

  // 主题词云（学习引擎 topTags + 11 维高频主题）
  const topicCloud = useMemo(() => {
    const fromTags = (profileLearningEngine?.topTags || []).map(t => ({ name: t.name, weight: t.score }));
    const fromInsights = (learnedPrefs?.insights?.topics || []).map(t => ({ name: t.key, weight: t.weight * 10 }));
    const merged = [...fromTags, ...fromInsights];
    const seen = new Set();
    const out = [];
    merged.forEach(i => {
      const key = i.name.toLowerCase();
      if (seen.has(key) || !i.name) return;
      seen.add(key);
      out.push(i);
    });
    return out.slice(0, 16);
  }, [profileLearningEngine, learnedPrefs]);

  const prefs = learnedPrefs?.insights || {};
  const prefRows = [
    prefs.format && { label: '内容格式', value: prefs.format.label },
    prefs.depth && { label: '内容深度', value: prefs.depth.label },
    prefs.length && { label: '内容长度', value: prefs.length.label },
    prefs.language && { label: '语言偏好', value: prefs.language.label },
    prefs.time && prefs.time[0] && { label: '活跃时段', value: prefs.time[0].label },
  ].filter(Boolean);

  const confidence = profileLearningEngine?.confidence ?? 0;
  const confidenceLabel = profileLearningEngine?.confidenceLabel ?? '需要校准';

  return (
    <div className="profile-overview">
      {/* AI 总结卡片 */}
      <section className="profile-overview-hero">
        <div className="profile-ai-summary">
          <div className="section-header">
            <h2 className="section-title">{ICONS.sparkles} AI 眼中的你</h2>
            <p className="section-desc">基于你的阅读、收藏、对话与校准行为实时生成</p>
          </div>
          <p className="profile-ai-summary-text">{profileLearningEngine?.summary || '继续阅读和收藏，让系统更懂你。'}</p>
          {profileLearningEngine?.explanation && (
            <p className="profile-ai-summary-why">{profileLearningEngine.explanation}</p>
          )}
          <div className="profile-confidence-bar">
            <span className="profile-confidence-label">{confidenceLabel}</span>
            <div className="profile-confidence-track">
              <i style={{ width: `${Math.min(100, confidence)}%` }} />
            </div>
            <strong>{confidence}%</strong>
          </div>
        </div>
        <div className="profile-overview-stats">
          <div className="profile-ov-stat"><strong>{readingHistory.length}</strong><span>阅读行为</span></div>
          <div className="profile-ov-stat"><strong>{bookmarks.length}</strong><span>收藏沉淀</span></div>
          <div className="profile-ov-stat"><strong>{materials.length}</strong><span>素材转化</span></div>
          <div className="profile-ov-stat"><strong>{selectedInterests.length}</strong><span>关注领域</span></div>
        </div>
      </section>

      {/* 性格标签 + 兴趣雷达 */}
      <div className="profile-overview-grid">
        <section className="profile-persona-card">
          <div className="section-header">
            <h2 className="section-title">{ICONS.user} AI 性格画像</h2>
            <p className="section-desc">从历史对话中总结你的习惯、性格与需求</p>
          </div>
          <TagCloud items={personaTags.map(t => ({ label: t }))} emptyText="暂无 AI 性格总结，开始与 AI 对话累积" />
        </section>

        <section className="profile-radar-card">
          <div className="section-header">
            <h2 className="section-title">{ICONS.target} 兴趣雷达</h2>
            <p className="section-desc">领域关注度分布</p>
          </div>
          {radar.axes.length > 0
            ? <HudRadarChart axes={radar.axes} values={radar.values} max={100} color={theme.cyan} />
            : <div className="profile-empty-hint">暂无兴趣数据</div>}
        </section>
      </div>

      {/* 高频主题词云 */}
      <section className="profile-topics-card">
        <div className="section-header">
          <h2 className="section-title">{ICONS.trendingUp} 高频关注主题</h2>
          <p className="section-desc">权重越大越常出现，颜色深浅代表关注强度</p>
        </div>
        <TagCloud items={topicCloud} emptyText="暂无主题数据" />
      </section>

      {/* 偏好速览 */}
      {prefRows.length > 0 && (
        <section className="profile-prefs-card">
          <div className="section-header">
            <h2 className="section-title">{ICONS.chart} 表达偏好</h2>
            <p className="section-desc">AI 从你的互动中学习到的输出偏好</p>
          </div>
          <div className="profile-pref-rows">
            {prefRows.map(row => (
              <div key={row.label} className="profile-pref-row">
                <span className="profile-pref-label">{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
