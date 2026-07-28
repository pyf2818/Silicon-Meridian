// src/components/profile/ProfileDashboard.jsx
// Phase 4 D6: 画像仪表盘主组件
// 5 个区块：KPI 卡片 / 推荐历史趋势 / 当前画像 / 行为观测 / 手动重跑预热
// 纯前端聚合：复用 useProfileDashboard hook + props 传入的 intelligence/bookmarks 等

import { useProfileDashboard } from '../../hooks/useProfileDashboard.js';
import { buildTrendSeries, buildAiStatusCounts } from '../../utils/dashboardBuilders.js';
import { BlockGrid, BlockStat } from '../../blocks/index.js';
import TrendLineChart from '../TrendLineChart.jsx';
import PersonaSummaryCard from './PersonaSummaryCard.jsx';
import LearnedPrefsCard from './LearnedPrefsCard.jsx';
import PreheatButton from './PreheatButton.jsx';

// KPI 卡片：BlockStat 卡片形态（自带 label/value/desc 三段）
function KpiCard({ label, value, desc }) {
  return (
    <BlockGrid.Card>
      <BlockStat variant="card" label={label} value={value} desc={desc} />
    </BlockGrid.Card>
  );
}

export default function ProfileDashboard({
  intelligenceProfile,
  bookmarks,
  readingHistory,
  selectedInterests,
}) {
  const dash = useProfileDashboard();

  // 趋势图数据 + ai_status 分布（纯函数转换）
  const { labels: trendLabels, series: trendSeries } = buildTrendSeries(dash.snapshots);
  const aiStatusCounts = buildAiStatusCounts(dash.snapshots);

  return (
    <div className="profile-dashboard">
      {/* 1. KPI 卡片区 */}
      <BlockGrid columns={4}>
        <KpiCard
          label="关注领域"
          value={selectedInterests?.length ?? 0}
          desc={intelligenceProfile?.focusLabels?.slice(0, 3).join('、') || '未设置'}
        />
        <KpiCard
          label="阅读点击"
          value={readingHistory?.length ?? 0}
          desc="近 100 条点击记录"
        />
        <KpiCard
          label="收藏资讯"
          value={bookmarks?.length ?? 0}
          desc="收藏提高相似主题权重"
        />
        <KpiCard
          label="画像置信度"
          value={`${intelligenceProfile?.confidence ?? 0}%`}
          desc={intelligenceProfile?.confidenceLabel || '需要校准'}
        />
      </BlockGrid>

      {/* 2. 推荐历史趋势图 */}
      <section className="dashboard-section">
        <div className="section-header">
          <h2 className="section-title">推荐历史趋势</h2>
          <p className="section-desc">最近 {dash.snapshots.length} 天的推荐快照</p>
        </div>
        {dash.snapshotsLoading ? (
          <div className="dashboard-loading">加载中...</div>
        ) : dash.snapshotsError ? (
          <div className="dashboard-error">{dash.snapshotsError}</div>
        ) : dash.snapshots.length === 0 ? (
          <div className="dashboard-empty">暂无历史快照</div>
        ) : (
          <>
            <TrendLineChart labels={trendLabels} series={trendSeries} />
            {Object.keys(aiStatusCounts).length > 0 && (
              <div className="ai-status-distribution">
                {Object.entries(aiStatusCounts).map(([status, count]) => (
                  <span key={status} className={`ai-status-badge status-${status}`}>
                    {status}: {count}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* 3. 当前画像 + 4. 行为观测 并排 */}
      <div className="dashboard-row">
        <PersonaSummaryCard personaSummary={dash.personaSummary} loading={false} />
        <LearnedPrefsCard prefs={dash.learnedPrefs} loading={dash.prefsLoading} />
      </div>

      {/* 5. 手动重跑预热 */}
      <section className="dashboard-section">
        <PreheatButton
          onPreheat={dash.preheat}
          loading={dash.preheatLoading}
          result={dash.preheatResult}
          error={dash.preheatError}
        />
      </section>
    </div>
  );
}
