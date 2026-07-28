# 用户画像页面视觉重构（Phase 6）

- **日期**：2026-07-29
- **状态**：待 review
- **作者**：brainstorming 流程产出
- **范围**：Phase 4 仪表盘 + Phase 5 进化趋势的视觉与交互层重构，数据层与 hook 不动
- **用户感知**：仪表盘从"大块方块堆叠"变为左侧时间轴叙事 + 右侧画像主卡聚焦的双栏布局，时间轴点击切换 diff 视图

---

## 1. 背景与动机

### 1.1 Phase 4/5 现状

Phase 4 完成仪表盘 5 区块，Phase 5 增加画像进化趋势作为第 6 区块。功能齐全但视觉层有明显问题：

- **BlockGrid 4 列等宽卡片**：KPI 4 块、画像/行为观测并排，所有信息块视觉权重相等，缺乏主次
- **纵向堆叠无层次**：6 个 section 从上到下平铺，主视觉是哪一块不清楚
- **趋势图孤立**：Phase 5 的 PersonaEvolutionSection 在底部独立，与左侧时间轴无叙事关联
- **diff 视图隐蔽**：点击趋势图节点才能看到 diff，且 diff 卡片在视图底部，需滚动
- **PersonaSummaryCard 三栏平铺**：habits/traits/needs 用三个独立卡片并排，与"当前画像"的概念脱钩

### 1.2 Phase 6 目标

重构视觉与交互层，让仪表盘从"信息罗列"变为"画像叙事"：

1. **左右双栏布局**：左侧时间轴作为画像进化叙事入口，右侧聚焦当前画像 + 派生信号
2. **画像主卡为视觉焦点**：单卡占据顶部，含置信度环 + 三栏画像，渐变光晕装饰
3. **KPI 压成细条**：4 项均分细条，项间竖向分隔，不喧宾夺主
4. **时间轴节点带 delta chip**：每个节点显示当日变化（+2 习惯 / -1 性格），点击触发 diff
5. **diff 视图自然切换**：点击时间轴节点，主画像卡切到 diff 模式，列表项标 added/removed
6. **趋势图与时间轴联动**：点击趋势图节点 = 点击时间轴对应节点

### 1.3 不做（明确边界）

- **不动数据层**：`useProfileDashboard` hook / `profileStore` / API 端点 / migration 全部保留
- **不动纯函数**：`buildPersonaTrendSeries` / `diffPersonaSnapshots` / `buildTrendSeries` / `buildAiStatusCounts` 保留
- **不动"设置" Tab**：ProfilePage 设置 Tab 内的领域分层/信源分层/特别关注/校准状态等保留原样
- **不新增 API 端点或 migration**：纯前端重构
- **不增加 i18n**：文案沿用现有中文
- **不做响应式断点优化**：移动端布局可降级为单栏，但不专门优化

---

## 2. 架构总览

### 2.1 数据流

```
[ProfilePage]
    ├── Tab: 设置 (不动)
    │       └── PersonaSummarySection / PendingSuggestionsSection / 领域分层 / 信源分层 / 特别关注 / 校准状态 / AgentMemorySection / SnapshotHistorySection
    │
    └── Tab: 仪表盘 (重构)
            └── ProfileDashboard (主组件, 重构)
                    ├── PersonaTimelineRail         ← 新增：左侧时间轴
                    │     数据：useProfileDashboard.personaHistory
                    │     交互：onSelectNode(idx) → 父组件切换 diff
                    │
                    ├── PersonaHeroCard             ← 新增：右侧主画像卡
                    │     数据：profileStore.personaSummary + selectedSnapshot (diff)
                    │     状态：current / diff 两种渲染模式
                    │     子结构：
                    │       ├── hero-top (label + title + subtitle + 置信度环)
                    │       └── persona-cols (三栏：习惯/性格/需求)
                    │           └── 列表项标 added/removed (diff 模式)
                    │
                    ├── BehaviorObservedCard        ← 重命名：原 LearnedPrefsCard
                    │     数据：useProfileDashboard.learnedPrefs
                    │     展示：高频主题 chips + 偏好深度 + 偏好格式
                    │
                    ├── PreheatCard                  ← 保留：原 PreheatButton 包装
                    │     数据：useProfileDashboard.preheat / loading / result / error
                    │
                    ├── KpiStrip                     ← 新增：KPI 细条
                    │     数据：props 传入 (intelligenceProfile/bookmarks/readingHistory/selectedInterests/specialFollows)
                    │
                    └── PersonaEvolutionMiniChart    ← 新增：精简版进化趋势
                          数据：useProfileDashboard.personaHistory
                          交互：onSelectNode(idx) → 父组件切换 diff
                          渲染：SVG 3 条折线 + 节点 + 图例
```

### 2.2 模块边界

```
src/hooks/
  useProfileDashboard.js          不动（已有 personaHistory / learnedPrefs / preheat / snapshots）

src/utils/
  dashboardBuilders.js             不动（buildPersonaTrendSeries / diffPersonaSnapshots / normalizeError / buildTrendSeries / buildAiStatusCounts）

src/store/
  index.js                         不动（useUiStore.profileTab 已有）

src/components/profile/
  ProfileDashboard.jsx             重构（容器，状态管理 selectedIdx/diffMode）
  PersonaTimelineRail.jsx          新增（左侧时间轴）
  PersonaHeroCard.jsx              新增（主画像卡，含 diff 模式）
  PersonaDiffList.jsx              新增（diff 模式下的三栏列表，added/removed 标记）
  BehaviorObservedCard.jsx         新增（重命名 LearnedPrefsCard，重写视觉）
  PreheatCard.jsx                  新增（包装 PreheatButton，加卡片样式）
  KpiStrip.jsx                     新增（KPI 细条）
  PersonaEvolutionMiniChart.jsx    新增（精简版进化趋势，SVG 折线）

  PreheatButton.jsx                保留不动（被 PreheatCard 包装）
  PersonaSummaryCard.jsx           废弃（被 PersonaHeroCard 取代，删除文件）
  LearnedPrefsCard.jsx             废弃（被 BehaviorObservedCard 取代，删除文件）
  PersonaEvolutionSection.jsx      废弃（被 PersonaEvolutionMiniChart 取代，删除文件）
  PersonaDiffCard.jsx              废弃（被 PersonaDiffList 取代，删除文件）

src/components/
  TrendLineChart.jsx               保留（推荐历史趋势图用，不动 onSelect 回调）

src/styles.css                     修改（替换 .profile-dashboard 区段样式块）
```

### 2.3 与 Phase 4/5 的关系

| Phase 4/5 产出 | Phase 6 处理 |
|---|---|
| `useProfileDashboard` hook | 保留不动 |
| `buildPersonaTrendSeries` / `diffPersonaSnapshots` 纯函数 | 保留不动，被新组件消费 |
| `ProfileDashboard.jsx` 5 区块布局 | 重构为双栏 + 6 个子组件 |
| `PersonaSummaryCard`（三栏平铺） | 删除，由 `PersonaHeroCard` 取代 |
| `LearnedPrefsCard` | 删除，由 `BehaviorObservedCard` 取代 |
| `PreheatButton` | 保留，被 `PreheatCard` 包装 |
| `PersonaEvolutionSection` + `TrendLineChart` + `PersonaDiffCard` | 删除，由 `PersonaEvolutionMiniChart` 取代（精简 SVG，不复用 TrendLineChart） |
| `BlockGrid` / `BlockStat` 在仪表盘的引用 | 移除，仪表盘不再用 BlockGrid |
| 测试（27 个纯函数单元测试） | 全部保留不动 |

---

## 3. 详细设计

### 3.1 ProfileDashboard 容器

新增容器状态：`selectedIdx`（null = 当前视图 / 数字 = diff 视图对应当日历史快照）。

```jsx
// src/components/profile/ProfileDashboard.jsx
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
  intelligenceProfile, bookmarks, readingHistory,
  selectedInterests, specialFollows,
}) {
  const dash = useProfileDashboard();
  const personaSummary = useProfileStore(s => s.personaSummary);

  // 时间轴/趋势图节点选择 → 切换 diff 模式
  const [selectedIdx, setSelectedIdx] = useState(null);
  const handleSelectNode = useCallback((idx) => {
    setSelectedIdx(prev => prev === idx ? null : idx);  // 再次点击同一节点 = 取消
  }, []);

  // 计算 diff：当前画像 vs 历史快照
  const history = dash.personaHistory || [];
  const selectedSnapshot = selectedIdx != null && history[selectedIdx]
    ? history[selectedIdx].snapshot
    : null;
  const diff = selectedSnapshot
    ? diffPersonaSnapshots(selectedSnapshot, personaSummary || {})
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
            confidenceLabel={intelligenceProfile.confidenceLabel}
            diff={diff}
            diffLabel={selectedIdx != null ? history[selectedIdx]?.evolved_at : null}
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
```

### 3.2 PersonaTimelineRail

左侧时间轴，节点显示日期 + delta chip。

> **前置依赖**：`formatEvolvedAt` 当前是 `dashboardBuilders.js` 的内部函数（未 export）。需在实施前将其改为 `export function formatEvolvedAt(...)`。零风险改动，已有逻辑不动。

```jsx
// src/components/profile/PersonaTimelineRail.jsx
import { formatEvolvedAt } from '../../utils/dashboardBuilders.js';  // 依赖前置 export

function computeDelta(prev, current) {
  if (!prev || !current) return null;
  const prevH = prev.habits?.length || 0;
  const prevT = prev.traits?.length || 0;
  const prevN = prev.needs?.length || 0;
  const currH = current.habits?.length || 0;
  const currT = current.traits?.length || 0;
  const currN = current.needs?.length || 0;
  const delta = (currH - prevH) + (currT - prevT) + (currN - prevN);
  if (delta === 0) return null;
  return {
    delta,
    isPositive: delta > 0,
    labels: [
      currH !== prevH && '习惯',
      currT !== prevT && '性格',
      currN !== prevN && '需求',
    ].filter(Boolean),
  };
}

export default function PersonaTimelineRail({ history, loading, selectedIdx, onSelectNode }) {
  // history 按 evolved_at 降序（最新在前），index 0 = 今日
  // 时间轴顶部是"今日"节点（index 0），与 history[0] 对齐

  return (
    <aside className="timeline-rail">
      <div className="timeline-header">画像进化轨迹</div>
      {loading ? (
        <div className="timeline-loading">加载中...</div>
      ) : history.length === 0 ? (
        <div className="timeline-empty">暂无历史快照</div>
      ) : (
        <div className="timeline-list">
          {history.map((item, idx) => {
            const prev = history[idx + 1];  // 前一条（更早）
            const current = item.snapshot;
            const delta = idx === 0 ? null : computeDelta(prev, current);
            const isActive = selectedIdx === idx;
            const isToday = idx === 0;
            return (
              <div
                key={item.evolved_at || idx}
                className={`timeline-node ${isActive ? 'active' : ''}`}
                onClick={() => onSelectNode(idx)}
                role="button"
                tabIndex={0}
              >
                <div className="timeline-node-date">
                  {isToday ? '今日' : formatEvolvedAt(item.evolved_at)}
                </div>
                <div className="timeline-node-meta">
                  {isToday ? (
                    <span>当前画像</span>
                  ) : delta ? (
                    <>
                      <span className={`delta-chip ${delta.isPositive ? 'positive' : 'negative'}`}>
                        {delta.isPositive ? '+' : ''}{delta.delta}
                      </span>
                      <span>{delta.labels.join(' / ')}</span>
                    </>
                  ) : (
                    <span>无变化</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="timeline-footer">共 {history.length} 次进化</div>
    </aside>
  );
}
```

### 3.3 PersonaHeroCard

主画像卡，两种渲染模式。

```jsx
// src/components/profile/PersonaHeroCard.jsx
import PersonaDiffList from './PersonaDiffList.jsx';

function ConfidenceRing({ value }) {
  // SVG 圆环：value 0-100，stroke 用金色渐变
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  return (
    <div className="confidence-ring">
      <svg viewBox="0 0 80 80">
        <defs>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4B576" />
            <stop offset="100%" stopColor="#9A7B3F" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={radius} fill="none"
                stroke="rgba(201,169,97,0.10)" strokeWidth="6" />
        <circle cx="40" cy="40" r={radius} fill="none"
                stroke="url(#goldGrad)" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 40 40)"
                style={{ filter: 'drop-shadow(0 0 6px rgba(201,169,97,0.4))' }} />
      </svg>
      <div className="confidence-value">
        <strong>{value}</strong>
        <span>CONFIDENCE</span>
      </div>
    </div>
  );
}

function PersonaColumn({ title, items }) {
  if (!items || items.length === 0) return (
    <div className="persona-col">
      <div className="persona-col-header">
        <span className="persona-col-title">{title}</span>
        <span className="persona-col-count">0</span>
      </div>
      <p className="persona-col-empty">暂无</p>
    </div>
  );
  return (
    <div className="persona-col">
      <div className="persona-col-header">
        <span className="persona-col-title">{title}</span>
        <span className="persona-col-count">{items.length}</span>
      </div>
      <ul>
        {items.map((text, idx) => (
          <li key={idx}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

export default function PersonaHeroCard({
  personaSummary, confidence, confidenceLabel,
  diff, diffLabel, onClearDiff,
}) {
  const { habits = [], traits = [], needs = [], lastEvolvedAt } = personaSummary || {};
  const hasData = habits.length > 0 || traits.length > 0 || needs.length > 0;
  const isDiffMode = !!diff;

  return (
    <section className="persona-hero">
      <div className="hero-top">
        <div>
          <div className="hero-label">
            {isDiffMode ? 'Persona Diff' : 'Current Persona'}
          </div>
          <div className="hero-title">
            {isDiffMode ? '画像对比' : '当前画像'}
          </div>
          <div className="hero-subtitle">
            {isDiffMode
              ? `对比 ${diffLabel} 与当前画像`
              : `最近进化 · ${lastEvolvedAt ? new Date(lastEvolvedAt).toLocaleString('zh-CN') : '未知'} · 来源：与 AI 对话累积`}
          </div>
        </div>
        {!isDiffMode && (
          <ConfidenceRing value={confidence || 0} />
        )}
        {isDiffMode && (
          <button className="hero-clear-diff" onClick={onClearDiff}>×</button>
        )}
      </div>

      {isDiffMode ? (
        <PersonaDiffList diff={diff} />
      ) : hasData ? (
        <div className="persona-cols">
          <PersonaColumn title="用户习惯" items={habits} />
          <PersonaColumn title="用户性格" items={traits} />
          <PersonaColumn title="用户需求" items={needs} />
        </div>
      ) : (
        <div className="hero-empty">
          暂无 AI 画像 · 与 AI 对话累积 3 轮后自动生成
        </div>
      )}
    </section>
  );
}
```

### 3.4 PersonaDiffList

diff 模式下，三栏列表项标 added/removed。

```jsx
// src/components/profile/PersonaDiffList.jsx
// diff 结构（diffPersonaSnapshots 实际返回）:
// { habits: { added: [], removed: [] },
//   traits: { added: [], removed: [] },
//   needs:  { added: [], removed: [] } }
// 注意：原函数不返回 unchanged，diff 视图只展示 added/removed

function DiffColumn({ title, diffCol }) {
  const { added = [], removed = [] } = diffCol || {};
  return (
    <div className="persona-col">
      <div className="persona-col-header">
        <span className="persona-col-title">{title}</span>
        <span className="persona-col-count">
          {added.length > 0 && <span className="count-added">+{added.length}</span>}
          {removed.length > 0 && <span className="count-removed">−{removed.length}</span>}
          {added.length === 0 && removed.length === 0 && <span>无变化</span>}
        </span>
      </div>
      <ul>
        {added.map((t, i) => <li key={`a${i}`} className="added">{t}</li>)}
        {removed.map((t, i) => <li key={`r${i}`} className="removed">{t}</li>)}
      </ul>
    </div>
  );
}

export default function PersonaDiffList({ diff }) {
  return (
    <div className="persona-cols diff-mode">
      <DiffColumn title="用户习惯" diffCol={diff?.habits} />
      <DiffColumn title="用户性格" diffCol={diff?.traits} />
      <DiffColumn title="用户需求" diffCol={diff?.needs} />
    </div>
  );
}
```

### 3.5 BehaviorObservedCard

重命名 LearnedPrefsCard，重写视觉。

```jsx
// src/components/profile/BehaviorObservedCard.jsx
import { normalizeError } from '../../utils/dashboardBuilders.js';

const DEPTH_LABEL = { deep: '深入详细', shallow: '简洁' };
const FORMAT_LABEL = { detailed: '详细', concise: '简洁' };

export default function BehaviorObservedCard({ prefs, loading }) {
  const { topics = [], preferredDepth = '', preferredFormat = '' } = prefs || {};
  return (
    <div className="info-card behavior-card">
      <div className="info-card-header">
        <span className="info-card-title">行为观测</span>
        <span className="info-card-meta">从阅读/收藏自动派生</span>
      </div>
      {loading ? (
        <p className="card-loading">加载中...</p>
      ) : topics.length === 0 && !preferredDepth && !preferredFormat ? (
        <p className="card-empty">暂无行为观测数据</p>
      ) : (
        <>
          {topics.length > 0 && (
            <div className="prefs-tags">
              {topics.map((t, i) => (
                <span key={i} className="pref-tag">{t}</span>
              ))}
            </div>
          )}
          {preferredDepth && (
            <div className="prefs-row">
              <span className="label">偏好深度</span>
              <span className="value">{DEPTH_LABEL[preferredDepth] || preferredDepth}</span>
            </div>
          )}
          {preferredFormat && (
            <div className="prefs-row">
              <span className="label">偏好格式</span>
              <span className="value">{FORMAT_LABEL[preferredFormat] || preferredFormat}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

### 3.6 PreheatCard

包装 PreheatButton。

```jsx
// src/components/profile/PreheatCard.jsx
import PreheatButton from './PreheatButton.jsx';
import { normalizeError } from '../../utils/dashboardBuilders.js';

export default function PreheatCard({ onPreheat, loading, result, error }) {
  const normalizedError = normalizeError(error);
  return (
    <div className="info-card preheat-card">
      <div className="info-card-header">
        <span className="info-card-title">手动重跑预热</span>
      </div>
      <p className="card-desc">触发今日推荐快照重新生成，会调用 LLM，可能耗时 30-60 秒</p>
      <PreheatButton
        onPreheat={onPreheat}
        loading={loading}
        result={result}
        error={normalizedError}
      />
    </div>
  );
}
```

### 3.7 KpiStrip

KPI 细条，4 项均分。

```jsx
// src/components/profile/KpiStrip.jsx
export default function KpiStrip({
  focusCount, readingCount, bookmarkCount, specialFollowCount,
}) {
  const items = [
    { value: focusCount, label: '关注领域' },
    { value: readingCount, label: '阅读点击' },
    { value: bookmarkCount, label: '收藏资讯' },
    { value: specialFollowCount, label: '特别关注' },
  ];
  return (
    <div className="kpi-strip">
      {items.map((item, i) => (
        <div key={i} className="kpi-item">
          <span className="kpi-value">{item.value}</span>
          <span className="kpi-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
```

### 3.8 PersonaEvolutionMiniChart

精简 SVG 折线图，3 条线 + 节点 + 图例。

> **Index 映射关键**：`personaHistory` 是 DESC（最新在前，index 0 = 今日）。`buildPersonaTrendSeries` 内部 reverse 成 ASC（最早在前，最右 = 今日）。所以趋势图节点 j（从左到右）对应 `history[length-1-j]`。点击趋势图节点 j 时，需通过 `onSelectNode(length - 1 - j)` 转换为时间轴 index。

```jsx
// src/components/profile/PersonaEvolutionMiniChart.jsx
import { buildPersonaTrendSeries } from '../../utils/dashboardBuilders.js';
// 注：formatEvolvedAt 已在 buildPersonaTrendSeries 内部使用，这里不需要直接 import

const SERIES_STYLE = [
  { name: '习惯', stroke: '#D4B576', dash: '' },
  { name: '性格', stroke: '#9A7B3F', dash: '3,3' },
  { name: '需求', stroke: 'rgba(201,169,97,0.5)', dash: '' },
];

export default function PersonaEvolutionMiniChart({ history, loading, selectedIdx, onSelectNode }) {
  if (loading) return (
    <section className="evolution-card">
      <div className="info-card-header"><span className="info-card-title">画像进化趋势</span></div>
      <p className="card-loading">加载中...</p>
    </section>
  );
  if (!history || history.length === 0) return null;

  const { labels, series } = buildPersonaTrendSeries(history);
  // labels 和 series.values 都是 ASC（最早→最新，最右 = 今日 = history[0]）

  const W = 400, H = 80, PADDING = 20;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values));
  const stepX = (W - PADDING * 2) / Math.max(1, labels.length - 1);

  const toX = (i) => PADDING + i * stepX;
  const toY = (v) => H - PADDING - (v / maxVal) * (H - PADDING * 2);
  // 趋势图节点 i 对应 history[length - 1 - i]（反向映射）
  const trendIdxToHistoryIdx = (i) => history.length - 1 - i;

  return (
    <section className="evolution-card">
      <div className="info-card-header">
        <span className="info-card-title">画像进化趋势</span>
        <span className="info-card-meta">最近 {history.length} 次进化 · 点击节点查看 diff</span>
      </div>
      <div className="evolution-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[20, 40, 60].map(y => (
            <line key={y} x1="0" y1={y} x2={W} y2={y}
                  stroke="rgba(201,169,97,0.06)" strokeWidth="1" />
          ))}
          {series.map((s, si) => {
            const style = SERIES_STYLE[si];
            const points = s.values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
            return (
              <g key={s.name}>
                <polyline points={points} fill="none"
                          stroke={style.stroke} strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round"
                          strokeDasharray={style.dash} />
                {s.values.map((v, i) => {
                  const historyIdx = trendIdxToHistoryIdx(i);
                  const isActive = selectedIdx === historyIdx;
                  return (
                    <circle key={i} cx={toX(i)} cy={toY(v)}
                            r={isActive ? 4 : 3}
                            fill={style.stroke}
                            stroke="#0B0E11" strokeWidth={isActive ? 2 : 0}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onSelectNode(historyIdx)} />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="evolution-legend">
        {SERIES_STYLE.map((s, i) => (
          <span key={i}>
            <span className="legend-dot" style={{ background: s.stroke }} />
            {s.name}
          </span>
        ))}
      </div>
    </section>
  );
}
```

### 3.9 ProfilePage 调整

ProfilePage 需要：
- 移除对 `PersonaSummaryCard` 的引用（如还在用）
- 传递 `specialFollows` 给 ProfileDashboard（当前未传）

```jsx
// src/components/ProfilePage.jsx 修改 ProfileDashboard 调用处
<ProfileDashboard
  intelligenceProfile={intelligenceProfile}
  bookmarks={bookmarks}
  readingHistory={readingHistory}
  selectedInterests={selectedInterests}
  specialFollows={specialFollows}    // 新增
/>
```

---

## 4. 交互流程

### 4.1 默认视图（当前画像）

1. ProfileDashboard 渲染，`selectedIdx = null`
2. PersonaHeroCard 显示当前 personaSummary + 置信度环
3. PersonaTimelineRail 顶部"今日"节点 active
4. PersonaEvolutionMiniChart 最右节点 active

### 4.2 切换到 diff 视图

1. 用户点击时间轴某节点（如 07-28）或趋势图某节点
2. `setSelectedIdx(idx)` 触发
3. PersonaHeroCard 接收 `diff` + `diffLabel`，切换渲染模式：
   - hero-label 变为 "Persona Diff"
   - hero-title 变为 "画像对比"
   - hero-subtitle 变为 "对比 07-28 与当前画像"
   - 置信度环替换为 `×` 关闭按钮
   - 三栏列表切换为 PersonaDiffList，列表项标 added（绿）/removed（红，删除线）/unchanged（灰）
4. 时间轴对应节点 active，其他节点取消 active
5. 趋势图对应节点放大

### 4.3 取消 diff

- 再次点击同一节点（toggle 行为）
- 或点击 PersonaHeroCard 右上角 `×` 按钮
- 或点击时间轴"今日"节点
- `setSelectedIdx(null)` → 回到默认视图

### 4.4 时间轴与趋势图联动

两者通过共享 `selectedIdx` 状态联动：
- 点击时间轴节点 i → 趋势图节点 i 也 active
- 点击趋势图节点 i → 时间轴节点 i 也 active
- 两者使用同一个 `handleSelectNode` callback

---

## 5. 视觉规范

### 5.1 颜色 token

沿用项目已有的 CSS 变量，不新增：

| Token | 值 | 用途 |
|---|---|---|
| `--bg-primary` | #0B0E11 | 页面背景 |
| `--bg-card-solid` | #14181C | 卡片背景 |
| `--accent` | #C9A961 | 主金色 |
| `--accent-bright` | #D4B576 | 高亮金（数字/标题） |
| `--accent-deep` | #9A7B3F | 深金（次要线条） |
| `--accent-soft` | rgba(201,169,97,.12) | 金色软背景 |
| `--accent-border` | rgba(201,169,97,.3) | 金色边框 |
| `--text-primary` | #EDEFF2 | 主文字 |
| `--text-secondary` | #C4C9D0 | 次文字 |
| `--text-muted` | #8B94A0 | 弱文字 |
| `--text-faint` | #5A6370 | 极弱文字（header label） |
| `--border-color` | rgba(201,169,97,.10) | 默认边框 |
| `--positive` | #6FCF97 | diff added |
| `--negative` | #EB7486 | diff removed |

### 5.2 间距与圆角

- 卡片圆角：`--radius-card` = 14px
- 小元素圆角：8px（chip / stat / 节点 hover bg）
- 卡片内 padding：18-24px
- 区块间距：16px（dashboard-content gap）
- 时间轴节点 padding：8px 0 8px 28px

### 5.3 卡片质感

- **PersonaHeroCard**：渐变叠加（`linear-gradient(135deg, rgba(201,169,97,.10), transparent)`）+ 顶部 1px 金色装饰线 + 右上角径向光晕 + `box-shadow: var(--shadow-card), 0 0 24px rgba(201,169,97,.15)`
- **info-card**：纯背景 + 1px 边框，hover 时边框变金色
- **timeline-rail**：纯背景 + 1px 边框，sticky 顶部
- **kpi-strip**：纯背景 + 顶部装饰金线 + 项间竖向 1px 分隔线

### 5.4 字体层级

| 元素 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 页面标题（"用户画像"） | 24px | 600 | 渐变金 |
| hero-title | 22px | 600 | text-primary |
| hero-label（"Current Persona"） | 10px | 400 | accent，letter-spacing .14em |
| info-card-title | 13px | 600 | text-primary |
| persona-col-title | 12px | 500 | text-secondary |
| persona-col-count | 11px | 600 | accent bg accent-soft |
| kpi-value | 22px | 600 | accent-bright |
| kpi-label | 11px | 400 | text-muted |
| timeline-node-date | 13px | 500 | text-secondary（active 时 accent-bright） |
| delta-chip | 10px | 400 | positive/negative |

---

## 6. 测试策略

### 6.1 保留的测试

- `buildPersonaTrendSeries` 8 个单元测试 - 保留不动
- `diffPersonaSnapshots` 7 个单元测试 - 保留不动
- `buildTrendSeries` 6 个 + `buildAiStatusCounts` 6 个 - 保留不动
- 其他 398 个测试 - 保留不动

总计 425 个测试，全部保留。

### 6.2 新增测试（可选，建议）

为 `PersonaTimelineRail` 内部的 `computeDelta` 纯函数加测试。若实现时将其抽到 `dashboardBuilders.js`，则加 3-5 个测试用例：

- 上一条无 habits/traits/needs → 返回 null
- 三项均增加 1 → 返回 `{ delta: 3, isPositive: true, labels: ['习惯', '性格', '需求'] }`
- 一增一减 → 返回 `{ delta: 0, isPositive: false, labels: ['习惯', '性格'] }` 或 null（看实现选择）

若 `computeDelta` 留在组件内部则不强制加测试，但建议抽到纯函数文件。

### 6.3 不做的测试

- 不做组件渲染测试（项目无组件测试基础设施）
- 不做 E2E 测试

---

## 7. 文件清单

### 新建（8 个）
- `src/components/profile/PersonaTimelineRail.jsx`
- `src/components/profile/PersonaHeroCard.jsx`
- `src/components/profile/PersonaDiffList.jsx`
- `src/components/profile/BehaviorObservedCard.jsx`
- `src/components/profile/PreheatCard.jsx`
- `src/components/profile/KpiStrip.jsx`
- `src/components/profile/PersonaEvolutionMiniChart.jsx`
- `docs/superpowers/specs/2026-07-29-user-profile-dashboard-redesign.md`（本 spec）

### 修改（3 个）
- `src/components/profile/ProfileDashboard.jsx` - 重写容器
- `src/components/ProfilePage.jsx` - 传递 `specialFollows` 给 ProfileDashboard
- `src/styles.css` - 替换 `.profile-dashboard` / `.dashboard-*` / `.persona-*` 区段样式
- `CLAUDE.md` - 更新 Phase 6 完成记录 + 文件清单

### 删除（4 个）
- `src/components/profile/PersonaSummaryCard.jsx`（被 PersonaHeroCard 取代）
- `src/components/profile/LearnedPrefsCard.jsx`（被 BehaviorObservedCard 取代）
- `src/components/profile/PersonaEvolutionSection.jsx`（被 PersonaEvolutionMiniChart 取代）
- `src/components/profile/PersonaDiffCard.jsx`（被 PersonaDiffList 取代）

### 不动
- `src/hooks/useProfileDashboard.js`
- `src/utils/dashboardBuilders.js`
- `src/store/index.js`
- `src/components/profile/PreheatButton.jsx`
- `src/components/profile/PendingSuggestionsSection.jsx`
- `src/components/profile/AgentMemorySection.jsx`
- `src/components/profile/SnapshotHistorySection.jsx`
- `src/components/profile/ProfileDashboard.jsx` 之外的 profile 组件
- 所有测试文件
- 所有后端代码

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `buildPersonaTrendSeries` 返回 ASC（最早→最新），时间轴用 DESC（最新在前） | 不 reverse 数据，而是在 `PersonaEvolutionMiniChart` 内做 index 映射：`historyIdx = length - 1 - trendIdx`（spec 3.8 已说明） |
| `diffPersonaSnapshots` 返回结构 | 已 verify：返回 `{ habits: { added, removed }, traits: { added, removed }, needs: { added, removed } }`，无 unchanged 字段；spec 3.4 已按此实现 |
| `personaHistory` 为空时（新用户）时间轴显得空 | PersonaTimelineRail 显示 "暂无历史快照" empty state；PersonaEvolutionMiniChart 返回 null 不渲染 |
| sticky 时间轴在内容超出视口时的表现 | 时间轴 max-height 限制 + overflow-y: auto，或不用 sticky 而用 normal flow |
| 删除 PersonaSummaryCard 后 ProfilePage 设置 Tab 是否还在引用 | 实施前 grep 检查，若设置 Tab 也用了则只删仪表盘的引用 |
| `formatEvolvedAt` 当前是 dashboardBuilders.js 内部函数未 export | spec 3.2 已标注前置依赖：实施前将其改为 `export function formatEvolvedAt(...)`，零风险 |

---

## 9. 验收标准

1. ProfilePage 默认 Tab = 仪表盘
2. 仪表盘布局为左 220px 时间轴 + 右 1fr 内容区
3. PersonaHeroCard 顶部含置信度环 SVG（金色渐变 stroke + glow）
4. 三栏画像列表，每栏顶部有数量 chip
5. 时间轴每个非今日节点显示 delta chip（+N 绿 / -N 红）
6. 点击时间轴节点 → PersonaHeroCard 切换到 diff 模式，列表项标 added/removed
7. 再次点击同一节点 / 点击 `×` / 点击"今日" → 回到当前画像视图
8. 点击 PersonaEvolutionMiniChart 节点 → 与时间轴联动
9. KPI 细条 4 项均分，项间竖向分隔
10. 行为观测卡显示 topics chips + 偏好深度 + 偏好格式
11. 重跑预热按钮含 loading / success / error 状态
12. 删除 4 个废弃组件文件后，无任何文件 import 它们
13. 425 个测试全部通过
14. dev server 启动无报错
