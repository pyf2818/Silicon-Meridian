// src/components/profile/ProfileDashboard.jsx
// 电影指挥中心布局：KPI火花条 + 推荐趋势线图 + 领域雷达 + AI状态柱图
// + 画像进化线图 + 阅读活跃度 + 时间轴 + 主画像 + 行为/预热
import { useState, useCallback, useMemo } from 'react';
import { useProfileDashboard, buildTrendSeries, buildPersonaTrendSeries, buildDomainRadar, buildReadingActivity, buildAiStatusSeries } from '../../hooks/useProfileDashboard.js';
import { useProfileStore } from '../../store';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { diffPersonaSnapshots } from '../../utils/dashboardBuilders.js';
import PersonaTimelineRail from './PersonaTimelineRail.jsx';
import PersonaHeroCard from './PersonaHeroCard.jsx';
import BehaviorObservedCard from './BehaviorObservedCard.jsx';
import PreheatCard from './PreheatCard.jsx';
import { HudLineChart, HudRadarChart, HudBarChart } from './charts/HudCharts.jsx';
import { HudPanel, KpiStripHud } from './dashboard/HudPanel.jsx';
import { AviationGauge } from './charts/AviationGauge.jsx';

export default function ProfileDashboard({
  intelligenceProfile,
  bookmarks,
  readingHistory,
  selectedInterests,
  specialFollows,
}) {
  const dash = useProfileDashboard();
  const personaSummary = useProfileStore(s => s.personaSummary);

  // 主题动态色（跟随 data-mode + data-palette 实时切换）
  const theme = useThemeColors();
  const TREND_COLOR = theme.cyan;
  const READ_COLOR = theme.green;
  const EVOL_COLORS = [theme.cyan, theme.green, theme.amber];

  const [selectedIdx, setSelectedIdx] = useState(null);
  const handleSelectNode = useCallback((idx) => {
    setSelectedIdx(prev => (prev === idx ? null : idx));
  }, []);

  const history = dash.personaHistory || [];
  const selectedSnapshot = selectedIdx != null && history[selectedIdx]
    ? history[selectedIdx].snapshot
    : null;
  const diff = selectedSnapshot
    ? diffPersonaSnapshots(selectedSnapshot, personaSummary || {})
    : null;
  const diffLabel = selectedIdx != null && history[selectedIdx]
    ? history[selectedIdx].evolved_at
    : null;

  // 真实数据派生
  const trend = useMemo(() => {
    const t = buildTrendSeries(dash.snapshots);
    return {
      labels: t.labels,
      series: t.series.map(s => ({ ...s, color: TREND_COLOR })),
    };
  }, [dash.snapshots]);

  const evolution = useMemo(() => {
    const e = buildPersonaTrendSeries(history);
    return {
      labels: e.labels,
      series: e.series.map((s, i) => ({ ...s, color: EVOL_COLORS[i % EVOL_COLORS.length] })),
    };
  }, [history]);

  const radar = useMemo(
    () => buildDomainRadar(readingHistory, selectedInterests, 6),
    [readingHistory, selectedInterests]
  );

  const reading = useMemo(() => {
    const r = buildReadingActivity(readingHistory, 14);
    return { labels: r.labels, series: [{ name: '阅读点击', values: r.values, color: READ_COLOR }] };
  }, [readingHistory]);

  const aiStatus = useMemo(() => buildAiStatusSeries(dash.snapshots), [dash.snapshots]);

  const kpiItems = [
    {
      label: '关注领域',
      value: selectedInterests.length,
      sub: '已配置兴趣维度',
      meter: Math.min(100, selectedInterests.length * 14),
      color: TREND_COLOR,
    },
    {
      label: '阅读点击',
      value: readingHistory.length,
      sub: '近 14 天行为校准',
      spark: reading.values,
      color: READ_COLOR,
    },
    {
      label: '收藏资讯',
      value: bookmarks.length,
      sub: '提升相似主题权重',
      meter: Math.min(100, bookmarks.length * 9),
      color: theme.amber,
    },
    {
      label: '特别关注',
      value: specialFollows.length,
      sub: '优先推荐通道',
      meter: Math.min(100, specialFollows.length * 22),
      color: theme.violet,
    },
  ];

  const hasSnapshots = dash.snapshots && dash.snapshots.length > 0;

  return (
    <div className="profile-dashboard profile-dashboard-v3">
      <div className="hud-backgrid" aria-hidden="true" />

      <div className="dashboard-grid">
        <div className="dash-kpi">
          <KpiStripHud items={kpiItems} />
        </div>

        <div className="dash-aviation">
          <HudPanel title="画像飞行仪表盘" kicker="PROFILE FLIGHT INSTRUMENTS" accent={TREND_COLOR} className="aviation" right={<span className="hud-panel-tag">实时数据</span>}>
            <div className="aviation-grid">
              <AviationGauge
                value={Math.min(100, intelligenceProfile.confidence || 0)}
                label="画像置信度"
                unit="%"
                sub={`${intelligenceProfile?.confidenceLabel || '—'}`}
              />
              <AviationGauge
                value={Math.min(100, (readingHistory.length / 20) * 100)}
                label="阅读活跃度"
                unit="次"
                sub={`共 ${readingHistory.length} 条行为`}
              />
              <AviationGauge
                value={Math.min(100, (bookmarks.length / 50) * 100)}
                label="收藏浓度"
                unit="条"
                sub={`已收藏 ${bookmarks.length}`}
              />
              <AviationGauge
                value={Math.min(100, selectedInterests.length * 14)}
                label="领域覆盖"
                unit="域"
                sub={`${selectedInterests.length} 个关注领域`}
              />
            </div>
          </HudPanel>
        </div>

        <aside className="dash-rail">
          <PersonaTimelineRail
            history={history}
            loading={dash.historyLoading}
            selectedIdx={selectedIdx}
            onSelectNode={handleSelectNode}
          />
        </aside>

        <div className="dash-main">
          <HudPanel
            title="推荐流趋势"
            kicker="RECOMMENDATION STREAM · 30D"
            accent={TREND_COLOR}
            className="trend"
            right={<span className="hud-panel-tag">每日推荐条目</span>}
          >
            {dash.snapshotsLoading ? (
              <p className="card-loading">加载中...</p>
            ) : hasSnapshots ? (
              <HudLineChart labels={trend.labels} series={trend.series} height={150} unit=" 条" />
            ) : (
              <p className="card-empty">暂无推荐快照，点击「生成今日画像」开始累积</p>
            )}
          </HudPanel>

          <HudPanel title="领域关注雷达" kicker="DOMAIN RADAR" accent={theme.green} className="radar" right={<span className="hud-panel-tag">阅读行为分布</span>}>
            {radar.axes.length > 0 ? (
              <HudRadarChart axes={radar.axes} values={radar.values} max={100} color={theme.green} />
            ) : (
              <p className="card-empty">暂无阅读行为数据</p>
            )}
          </HudPanel>

          <HudPanel title="AI 生成状态" kicker="AI STATUS DISTRIBUTION" accent={theme.amber} className="aistatus" right={<span className="hud-panel-tag">{dash.snapshots?.length || 0} 次快照</span>}>
            {aiStatus.length > 0 ? (
              <HudBarChart items={aiStatus} height={140} />
            ) : (
              <p className="card-empty">暂无快照状态</p>
            )}
          </HudPanel>

          <HudPanel
            title="画像进化趋势"
            kicker="PERSONA EVOLUTION"
            accent={TREND_COLOR}
            className="evolution"
            right={<span className="hud-panel-tag">点击左侧轨迹查看 diff</span>}
          >
            {dash.historyLoading ? (
              <p className="card-loading">加载中...</p>
            ) : history.length > 0 ? (
              <HudLineChart labels={evolution.labels} series={evolution.series} height={150} />
            ) : (
              <p className="card-empty">暂无画像进化历史</p>
            )}
          </HudPanel>

          <HudPanel title="阅读活跃度" kicker="READING ACTIVITY · 14D" accent={READ_COLOR} className="reading" right={<span className="hud-panel-tag">按日聚合</span>}>
            <HudLineChart labels={reading.labels} series={reading.series} height={140} area />
          </HudPanel>
        </div>

        <HudPanel
          className="dash-hero"
          title="当前用户画像"
          kicker="LIVE PERSONA MATRIX"
          accent={TREND_COLOR}
          right={diff ? <span className="hud-panel-tag diff">DIFF · {diffLabel}</span> : <span className="hud-panel-tag">实时</span>}
        >
          <PersonaHeroCard
            personaSummary={personaSummary}
            confidence={intelligenceProfile.confidence}
            diff={diff}
            diffLabel={diffLabel}
            onClearDiff={() => setSelectedIdx(null)}
          />
        </HudPanel>

        <HudPanel className="dash-behavior" title="行为观测" kicker="OBSERVED BEHAVIOR" accent={theme.green}>
          <BehaviorObservedCard prefs={dash.learnedPrefs} loading={dash.prefsLoading} />
        </HudPanel>

        <HudPanel className="dash-preheat" title="预热引擎" kicker="PREHEAT ENGINE" accent={theme.amber}>
          <PreheatCard
            onPreheat={dash.preheat}
            loading={dash.preheatLoading}
            result={dash.preheatResult}
            error={dash.preheatError}
          />
        </HudPanel>
      </div>
    </div>
  );
}
