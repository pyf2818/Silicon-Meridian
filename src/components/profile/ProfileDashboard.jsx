// src/components/profile/ProfileDashboard.jsx
// Phase 6: 双栏布局容器，管理 selectedIdx 状态联动时间轴与趋势图
import { useState, useCallback } from 'react';
import { useProfileDashboard } from '../../hooks/useProfileDashboard.js';
import { useProfileStore } from '../../store';
import { diffPersonaSnapshots } from '../../utils/dashboardBuilders.js';
import PersonaTimelineRail from './PersonaTimelineRail.jsx';
import PersonaHeroCard from './PersonaHeroCard.jsx';
import BehaviorObservedCard from './BehaviorObservedCard.jsx';
import PreheatCard from './PreheatCard.jsx';
import KpiStrip from './KpiStrip.jsx';
import PersonaEvolutionMiniChart from './PersonaEvolutionMiniChart.jsx';

export default function ProfileDashboard({
  intelligenceProfile,
  bookmarks,
  readingHistory,
  selectedInterests,
  specialFollows,
}) {
  const dash = useProfileDashboard();
  const personaSummary = useProfileStore(s => s.personaSummary);

  // 时间轴/趋势图节点选择 → 切换 diff 模式
  const [selectedIdx, setSelectedIdx] = useState(null);
  const handleSelectNode = useCallback((idx) => {
    setSelectedIdx(prev => (prev === idx ? null : idx));
  }, []);

  // 计算 diff：当前画像 vs 历史快照
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

  return (
    <div className="profile-dashboard profile-dashboard-v2">
      <div className="dashboard-layout">
        <PersonaTimelineRail
          history={history}
          loading={dash.historyLoading}
          selectedIdx={selectedIdx}
          onSelectNode={handleSelectNode}
        />
        <main className="dashboard-content">
          <PersonaHeroCard
            personaSummary={personaSummary}
            confidence={intelligenceProfile.confidence}
            diff={diff}
            diffLabel={diffLabel}
            onClearDiff={() => setSelectedIdx(null)}
          />
          <div className="dashboard-row-2">
            <BehaviorObservedCard prefs={dash.learnedPrefs} loading={dash.prefsLoading} />
            <PreheatCard
              onPreheat={dash.preheat}
              loading={dash.preheatLoading}
              result={dash.preheatResult}
              error={dash.preheatError}
            />
          </div>
          <KpiStrip
            focusCount={selectedInterests.length}
            readingCount={readingHistory.length}
            bookmarkCount={bookmarks.length}
            specialFollowCount={specialFollows.length}
          />
          <PersonaEvolutionMiniChart
            history={history}
            loading={dash.historyLoading}
            selectedIdx={selectedIdx}
            onSelectNode={handleSelectNode}
          />
        </main>
      </div>
    </div>
  );
}
