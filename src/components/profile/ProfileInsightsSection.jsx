// src/components/profile/ProfileInsightsSection.jsx
// 行为洞察 —— 11 维画像数据 + 阅读画像 + 学习引擎明细。
// 展示：阅读趋势 / 兴趣·来源·标签分布 / 提问模式 / 表达偏好 / 最近关注实体 / 盲区建议。
import { useMemo } from 'react';
import { ICONS } from '../../constants/index.jsx';
import { HudLineChart, HudBarChart } from './charts/HudCharts.jsx';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { computeReadingProfile } from '../../utils/profileModel.js';

const PATTERN_LABELS = {
  compare: '对比分析', analyze: '深度拆解', summarize: '总结归纳', how: '操作方法',
  what: '概念解释', why: '探究原因', predict: '趋势预测', evaluate: '评估判断',
  list: '清单列举', create: '创作生成',
};

function InsightRow({ label, children }) {
  return (
    <div className="profile-insight-row">
      <span className="profile-insight-label">{label}</span>
      <div className="profile-insight-content">{children}</div>
    </div>
  );
}

function TagList({ items, render, empty }) {
  if (!items || items.length === 0) return <span className="profile-empty-hint">{empty || '暂无'}</span>;
  return (
    <div className="profile-insight-tags">
      {items.map((item, idx) => (
        <span key={idx} className="profile-insight-tag" title={item.count != null ? `观测 ${item.count} 次` : undefined}>
          {render ? render(item) : (item.label || item.name || item.key || item)}
        </span>
      ))}
    </div>
  );
}

export default function ProfileInsightsSection({
  readingHistory,
  bookmarks,
  profileLearningEngine,
  learnedPrefs,
}) {
  const theme = useThemeColors();
  const reading = useMemo(() => computeReadingProfile(bookmarks), [bookmarks]);
  const ins = learnedPrefs?.insights || {};

  // 30 天阅读趋势
  const trend = useMemo(() => ({
    labels: reading.day30?.map(d => d.slice(5)) || [],
    series: [{ name: '阅读', values: reading.trendData || [], color: theme.cyan }],
  }), [reading, theme.cyan]);

  // 兴趣分布柱状图
  const interestBars = useMemo(() => ({
    labels: (reading.topInterests || []).map(i => i.id),
    values: (reading.topInterests || []).map(i => i.count),
    color: theme.green,
  }), [reading, theme.green]);

  // 提问模式
  const patterns = (ins.patterns || []).map(p => ({
    ...p,
    label: PATTERN_LABELS[p.key] || p.key,
  }));

  const prefs = [
    ins.format && { label: '格式', value: ins.format.label },
    ins.depth && { label: '深度', value: ins.depth.label },
    ins.length && { label: '长度', value: ins.length.label },
    ins.language && { label: '语言', value: ins.language.label },
  ].filter(Boolean);

  return (
    <div className="profile-insights">
      <div className="profile-insight-cards">
        <div className="profile-insight-card">
          <div className="section-header">
            <h2 className="section-title">{ICONS.trendingUp} 阅读趋势</h2>
            <p className="section-desc">近 30 天收藏/阅读分布 · 峰值 {reading.peakHour}:00</p>
          </div>
          <HudLineChart labels={trend.labels} series={trend.series} height={130} area />
        </div>

        <div className="profile-insight-card">
          <div className="section-header">
            <h2 className="section-title">{ICONS.target} 兴趣分布</h2>
            <p className="section-desc">连续阅读 {reading.streak} 天 · 日均 {reading.avgDailyRead} 条</p>
          </div>
          <HudBarChart items={interestBars.values.map((v, i) => ({ label: interestBars.labels[i], value: v, color: interestBars.color }))} height={130} />
        </div>
      </div>

      <section className="profile-insight-detail">
        <div className="section-header">
          <h2 className="section-title">{ICONS.chart} 行为画像</h2>
          <p className="section-desc">系统从你的互动中观测到的模式</p>
        </div>

        <div className="profile-insight-list">
          <InsightRow label="提问模式">
            <TagList items={patterns} empty="暂无观测" />
          </InsightRow>

          <InsightRow label="表达偏好">
            {prefs.length > 0
              ? <TagList items={prefs.map(p => ({ label: `${p.label}: ${p.value}` }))} />
              : <span className="profile-empty-hint">暂无观测</span>}
          </InsightRow>

          <InsightRow label="最近关注">
            <TagList items={ins.recentEntities || []} render={e => `${e.entity}`} empty="暂无" />
          </InsightRow>

          <InsightRow label="高频来源">
            <TagList
              items={(reading.topSources || []).map(s => ({ label: s.name, count: s.count }))}
              empty="暂无来源数据"
            />
          </InsightRow>

          <InsightRow label="记忆关键词">
            <TagList
              items={(profileLearningEngine?.topTags || []).map(t => ({ label: t.name, count: t.score }))}
              empty="暂无"
            />
          </InsightRow>

          <InsightRow label="探索盲区">
            <TagList
              items={(profileLearningEngine?.blindSpots || []).map(b => ({ label: b }))}
              empty="覆盖较均衡"
            />
          </InsightRow>
        </div>
      </section>
    </div>
  );
}
