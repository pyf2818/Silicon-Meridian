import { useMemo } from 'react';
import { ICONS } from '../../constants/index.jsx';
import { useProfileStore } from '../../store';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { computeReadingProfile } from '../../utils/profileModel.js';
import { HudLineChart, HudRadarChart, HudSparkline } from './charts/HudCharts.jsx';

function TagCloud({ items, emptyText = '暂无数据' }) {
  if (!items || items.length === 0) return <div className="profile-empty-hint">{emptyText}</div>;
  const max = Math.max(...items.map(item => item.weight ?? item.count ?? 1), 1);
  return <div className="profile-tag-cloud">{items.map((item, index) => {
    const strength = Math.max(0.45, (item.weight ?? item.count ?? 1) / max);
    return <span key={index} className="profile-tag-cloud-item" style={{ opacity: strength }}>{item.label || item.name || item.key || item.entity}</span>;
  })}</div>;
}

function Metric({ label, value, note, tone = '' }) {
  return <div className={'profile-metric ' + tone}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export default function ProfileOverviewSection({ readingHistory, bookmarks, materials = [], selectedInterests, profileLearningEngine, learnedPrefs }) {
  const theme = useThemeColors();
  const personaSummary = useProfileStore(state => state.personaSummary);
  const reading = useMemo(() => computeReadingProfile(bookmarks), [bookmarks]);
  const persona = personaSummary || {};
  const personaTags = [...(persona.traits || []), ...(persona.habits || []), ...(persona.needs || [])].slice(0, 8);
  const radar = useMemo(() => {
    const categories = profileLearningEngine?.topCategories || [];
    const max = Math.max(...categories.map(item => item.score || 0), 1);
    return { axes: categories.slice(0, 6).map(item => item.label), values: categories.slice(0, 6).map(item => Math.round((item.score || 0) / max * 100)) };
  }, [profileLearningEngine]);
  const topicCloud = useMemo(() => {
    const merged = [
      ...(profileLearningEngine?.topTags || []).map(item => ({ name: item.name, weight: item.score })),
      ...(learnedPrefs?.insights?.topics || []).map(item => ({ name: item.key, weight: item.weight * 10 })),
    ];
    const seen = new Set();
    return merged.filter(item => item.name && !seen.has(item.name.toLowerCase()) && seen.add(item.name.toLowerCase())).slice(0, 14);
  }, [profileLearningEngine, learnedPrefs]);
  const trend = { labels: reading.day30?.map(day => day.slice(5)) || [], series: [{ name: '阅读', values: reading.trendData || [], color: theme.cyan }] };
  const heatValues = reading.trendData || [];
  const heatMax = Math.max(...heatValues, 1);
  const prefs = learnedPrefs?.insights || {};
  const prefRows = [
    prefs.format && ['内容形式', prefs.format.label],
    prefs.depth && ['阅读深度', prefs.depth.label],
    prefs.length && ['内容长度', prefs.length.label],
    prefs.language && ['语言偏好', prefs.language.label],
  ].filter(Boolean);
  const confidence = profileLearningEngine?.confidence ?? 0;

  return <div className="profile-overview profile-dashboard-v2">
    <div className="profile-dashboard-kpis">
      <Metric label="近 30 日阅读" value={readingHistory.length} note="条行为记录" tone="cyan" />
      <Metric label="连续阅读" value={reading.streak} note="天" tone="green" />
      <Metric label="收藏沉淀" value={bookmarks.length} note="条" tone="amber" />
      <Metric label="素材转化" value={materials.length} note="份" tone="violet" />
      <Metric label="画像置信度" value={confidence + '%'} note={profileLearningEngine?.confidenceLabel || '持续学习'} tone="cyan" />
    </div>

    <div className="profile-dashboard-grid profile-dashboard-grid-main">
      <section className="profile-data-panel profile-learning-panel">
        <div className="profile-panel-head"><div><span className="profile-panel-kicker">LEARNING SIGNAL</span><h2>{ICONS.sparkles} AI 正在如何理解你</h2></div><span className="profile-panel-status">LIVE</span></div>
        <p className="profile-panel-summary">{profileLearningEngine?.summary || '继续阅读与收藏，系统会逐步形成更稳定的偏好判断。'}</p>
        <div className="profile-confidence-bar"><span>{profileLearningEngine?.confidenceLabel || '需要更多样本'}</span><div className="profile-confidence-track"><i style={{ width: confidence + '%' }} /></div><strong>{confidence}%</strong></div>
        <HudLineChart labels={trend.labels} series={trend.series} height={164} area />
        <div className="profile-chart-caption"><span>过去 30 天阅读节奏</span><b>峰值 {reading.peakHour}:00</b><span>日均 {reading.avgDailyRead} 条</span></div>
      </section>

      <section className="profile-data-panel profile-radar-panel">
        <div className="profile-panel-head"><div><span className="profile-panel-kicker">INTEREST MAP</span><h2>{ICONS.target} 兴趣结构</h2></div><span className="profile-panel-meta">{selectedInterests.length} 个关注域</span></div>
        {radar.axes.length ? <HudRadarChart axes={radar.axes} values={radar.values} max={100} color={theme.cyan} /> : <div className="profile-empty-hint">积累阅读后生成兴趣结构</div>}
        <div className="profile-mini-legend"><span><i className="dot cyan" />关注强度</span><span><i className="dot green" />行为样本</span></div>
      </section>
    </div>

    <div className="profile-dashboard-grid profile-dashboard-grid-secondary">
      <section className="profile-data-panel profile-heatmap-panel">
        <div className="profile-panel-head"><div><span className="profile-panel-kicker">ACTIVITY RHYTHM</span><h2>{ICONS.calendar} 阅读热力图</h2></div><span className="profile-panel-meta">30 DAYS</span></div>
        <div className="profile-heatmap-wrap"><div className="profile-heatmap-weekdays"><span>一</span><span>三</span><span>五</span></div><div className="profile-heatmap-grid">{heatValues.map((value, index) => <span key={index} className="profile-heat-cell" data-level={value ? Math.min(4, Math.ceil(value / heatMax * 4)) : 0} title={(reading.day30?.[index] || '') + ' · ' + (value || 0) + ' 条'} />)}</div></div>
        <div className="profile-heatmap-foot"><span>低</span><i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" /><span>高</span></div>
      </section>

      <section className="profile-data-panel profile-persona-panel">
        <div className="profile-panel-head"><div><span className="profile-panel-kicker">PERSONA LAYER</span><h2>{ICONS.user} AI 性格画像</h2></div><HudSparkline values={heatValues.slice(-10)} color={theme.violet} width={86} height={28} /></div>
        <TagCloud items={personaTags.map(label => ({ label }))} emptyText="与 AI 对话后生成性格画像" />
        <div className="profile-topic-divider" />
        <div className="profile-panel-head profile-topic-head"><h3>高频关注主题</h3><span>{topicCloud.length} 个信号</span></div>
        <TagCloud items={topicCloud} emptyText="暂无主题数据" />
      </section>
    </div>

    <section className="profile-data-panel profile-preference-panel">
      <div className="profile-panel-head"><div><span className="profile-panel-kicker">CONTROL SURFACE</span><h2>{ICONS.chart} 当前偏好 · 可调整</h2></div><span className="profile-panel-meta">系统将按此优化推荐</span></div>
      <div className="profile-preference-grid">{prefRows.length ? prefRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><i /></div>) : <span className="profile-empty-hint">暂无足够行为样本，先调整关注领域或开始阅读</span>}</div>
    </section>
  </div>;
}