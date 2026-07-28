# 用户画像页面视觉重构（Phase 6）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户画像仪表盘从"方块堆叠"重构为左侧时间轴叙事 + 右侧画像主卡聚焦的双栏布局，支持点击节点切换 diff 视图。

**Architecture:** ProfileDashboard 容器管理 `selectedIdx` 状态，左侧 PersonaTimelineRail 与底部 PersonaEvolutionMiniChart 共享该状态联动；右侧 PersonaHeroCard 根据 `selectedIdx` 切换 current/diff 两种渲染模式。8 个新建子组件 + 4 个删除 + 3 个修改，纯前端重构，不动 hook/纯函数/后端。

**Tech Stack:** React 19 + Vite 7 + 原生 CSS（CSS 变量 + grid/flex），SVG 手绘折线图与置信度环。

**Spec:** `docs/superpowers/specs/2026-07-29-user-profile-dashboard-redesign.md`

---

## 文件结构

### 新建（8 个组件 + 0 个测试）

| 文件 | 职责 |
|---|---|
| `src/components/profile/PersonaTimelineRail.jsx` | 左侧时间轴，节点显示日期 + delta chip，点击触发 onSelectNode(idx) |
| `src/components/profile/PersonaHeroCard.jsx` | 右侧主画像卡，current/diff 两种模式，含置信度环 SVG |
| `src/components/profile/PersonaDiffList.jsx` | diff 模式下的三栏列表，added/removed 标记 |
| `src/components/profile/BehaviorObservedCard.jsx` | 行为观测卡，重命名自 LearnedPrefsCard |
| `src/components/profile/PreheatCard.jsx` | 包装 PreheatButton，加 info-card 样式 |
| `src/components/profile/KpiStrip.jsx` | KPI 细条，4 项均分 |
| `src/components/profile/PersonaEvolutionMiniChart.jsx` | 精简 SVG 进化趋势，3 条折线 + 节点 + 图例 |

### 修改（3 个文件）

| 文件 | 改动 |
|---|---|
| `src/components/profile/ProfileDashboard.jsx` | 重写容器，引入双栏布局 + selectedIdx 状态 |
| `src/components/ProfilePage.jsx` | 传递 `specialFollows` 给 ProfileDashboard |
| `src/styles.css` | 替换 L19240-L19576 的 Phase 4/5 样式块为 Phase 6 新样式 |
| `CLAUDE.md` | 更新 Phase 6 完成记录 + 文件清单 |

### 删除（4 个文件）

| 文件 | 被谁取代 |
|---|---|
| `src/components/profile/PersonaSummaryCard.jsx` | PersonaHeroCard |
| `src/components/profile/LearnedPrefsCard.jsx` | BehaviorObservedCard |
| `src/components/profile/PersonaEvolutionSection.jsx` | PersonaEvolutionMiniChart |
| `src/components/profile/PersonaDiffCard.jsx` | PersonaDiffList |

### 不动

- `src/hooks/useProfileDashboard.js`（已有 personaHistory / learnedPrefs / preheat / snapshots）
- `src/utils/dashboardBuilders.js`（buildPersonaTrendSeries / diffPersonaSnapshots / formatEvolvedAt）
- `src/store/index.js`（useUiStore.profileTab 已有）
- `src/components/profile/PreheatButton.jsx`（被 PreheatCard 包装）
- `src/components/TrendLineChart.jsx`（仪表盘不再用，但其他地方可能用）
- 所有测试文件（425 个测试保留）
- 所有后端代码

### 前置依赖（Task 1 处理）

`formatEvolvedAt` 当前是 `dashboardBuilders.js` 的内部函数（L103），未 export。需先改为 `export function`。

---

## Task 1: 前置 — export formatEvolvedAt

**Files:**
- Modify: `src/utils/dashboardBuilders.js` (L103 附近)

- [ ] **Step 1: Read 当前 formatEvolvedAt 定义**

Run: `Read src/utils/dashboardBuilders.js` 找到 `function formatEvolvedAt(iso)` 行（约 L103）。

- [ ] **Step 2: 改为 export**

将 `function formatEvolvedAt(iso) {` 改为 `export function formatEvolvedAt(iso) {`。其他逻辑不动。

```js
// Before
function formatEvolvedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // ...
}

// After
export function formatEvolvedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // ...（其余逻辑保持不变）
}
```

- [ ] **Step 3: 验证测试不破**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/dashboardBuilders.test.js`
Expected: PASS（formatEvolvedAt 是纯函数，export 不影响已有调用）

- [ ] **Step 4: Commit**

```bash
git add src/utils/dashboardBuilders.js
git commit -m "refactor(profile): export formatEvolvedAt for Phase 6 timeline"
```

---

## Task 2: KpiStrip 组件

最简单的组件，无依赖，先做。

**Files:**
- Create: `src/components/profile/KpiStrip.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/KpiStrip.jsx
// Phase 6: KPI 细条，4 项均分，项间竖向分隔
export default function KpiStrip({
  focusCount = 0,
  readingCount = 0,
  bookmarkCount = 0,
  specialFollowCount = 0,
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

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/KpiStrip.jsx
git commit -m "feat(profile): add KpiStrip component for Phase 6 dashboard"
```

---

## Task 3: PreheatCard 组件

包装 PreheatButton，加 info-card 样式。

**Files:**
- Create: `src/components/profile/PreheatCard.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/PreheatCard.jsx
// Phase 6: 包装 PreheatButton，加 info-card 样式 + normalizeError
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

注意：PreheatButton 内部本身有 `<div className="dashboard-card preheat-card">` 包装，会和 PreheatCard 的 `.info-card.preheat-card` 重复。Task 7 写 styles.css 时会处理：PreheatButton 内的 div 样式继承不冲突（info-card 提供外框，PreheatButton 的 .preheat-card 只控制按钮 + 状态文本）。

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/PreheatCard.jsx
git commit -m "feat(profile): add PreheatCard wrapper for Phase 6 dashboard"
```

---

## Task 4: BehaviorObservedCard 组件

重命名 LearnedPrefsCard，重写视觉。

**Files:**
- Create: `src/components/profile/BehaviorObservedCard.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/BehaviorObservedCard.jsx
// Phase 6: 行为观测卡（重命名自 LearnedPrefsCard）
// 展示 learnedPreferences 的 topics/preferredDepth/preferredFormat
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

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/BehaviorObservedCard.jsx
git commit -m "feat(profile): add BehaviorObservedCard for Phase 6 dashboard"
```

---

## Task 5: PersonaDiffList 组件

diff 模式下，三栏列表项标 added/removed。

**Files:**
- Create: `src/components/profile/PersonaDiffList.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/PersonaDiffList.jsx
// Phase 6: diff 模式下的三栏列表
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
          {added.length === 0 && removed.length === 0 && <span className="count-none">无变化</span>}
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

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/PersonaDiffList.jsx
git commit -m "feat(profile): add PersonaDiffList component for Phase 6 diff view"
```

---

## Task 6: PersonaHeroCard 组件

主画像卡，含置信度环 SVG + current/diff 两种模式。

**Files:**
- Create: `src/components/profile/PersonaHeroCard.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/PersonaHeroCard.jsx
// Phase 6: 主画像卡，current/diff 两种模式，含置信度环 SVG
import PersonaDiffList from './PersonaDiffList.jsx';

function ConfidenceRing({ value }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const offset = circumference * (1 - safeValue / 100);
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
        <strong>{safeValue}</strong>
        <span>CONFIDENCE</span>
      </div>
    </div>
  );
}

function PersonaColumn({ title, items }) {
  if (!items || items.length === 0) {
    return (
      <div className="persona-col">
        <div className="persona-col-header">
          <span className="persona-col-title">{title}</span>
          <span className="persona-col-count">0</span>
        </div>
        <p className="persona-col-empty">暂无</p>
      </div>
    );
  }
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
  personaSummary,
  confidence,
  diff,
  diffLabel,
  onClearDiff,
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
              ? `对比 ${diffLabel || '历史快照'} 与当前画像`
              : `最近进化 · ${lastEvolvedAt ? new Date(lastEvolvedAt).toLocaleString('zh-CN') : '未知'} · 来源：与 AI 对话累积`}
          </div>
        </div>
        {!isDiffMode && (
          <ConfidenceRing value={confidence} />
        )}
        {isDiffMode && (
          <button
            type="button"
            className="hero-clear-diff"
            onClick={onClearDiff}
            aria-label="关闭 diff 视图"
          >
            ×
          </button>
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

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/PersonaHeroCard.jsx
git commit -m "feat(profile): add PersonaHeroCard with confidence ring and diff mode"
```

---

## Task 7: PersonaTimelineRail 组件

左侧时间轴。注意 computeDelta 是组件内部函数（不抽到纯函数文件，spec 6.2 说"可选"，YAGNI）。

**Files:**
- Create: `src/components/profile/PersonaTimelineRail.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/PersonaTimelineRail.jsx
// Phase 6: 左侧时间轴，节点显示日期 + delta chip
// history 是 DESC（最新在前，index 0 = 今日）
import { formatEvolvedAt } from '../../utils/dashboardBuilders.js';

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
  const labels = [
    currH !== prevH && '习惯',
    currT !== prevT && '性格',
    currN !== prevN && '需求',
  ].filter(Boolean);
  return {
    delta,
    isPositive: delta > 0,
    labels,
  };
}

export default function PersonaTimelineRail({ history, loading, selectedIdx, onSelectNode }) {
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
            const prev = history[idx + 1];
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectNode(idx);
                  }
                }}
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

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/PersonaTimelineRail.jsx
git commit -m "feat(profile): add PersonaTimelineRail with delta chips"
```

---

## Task 8: PersonaEvolutionMiniChart 组件

精简 SVG 折线图。注意 index 映射：personaHistory DESC（index 0 = 今日），buildPersonaTrendSeries 内部 reverse 成 ASC，趋势图节点 j 对应 history[length-1-j]。

**Files:**
- Create: `src/components/profile/PersonaEvolutionMiniChart.jsx`

- [ ] **Step 1: 写组件**

```jsx
// src/components/profile/PersonaEvolutionMiniChart.jsx
// Phase 6: 精简 SVG 进化趋势图，3 条折线 + 节点 + 图例
// Index 映射：personaHistory 是 DESC（最新在前，index 0 = 今日）
// buildPersonaTrendSeries 内部 reverse 成 ASC（最早→最新，最右 = 今日 = history[0]）
// 所以趋势图节点 j（从左到右）对应 history[length-1-j]
import { buildPersonaTrendSeries } from '../../utils/dashboardBuilders.js';

const SERIES_STYLE = [
  { name: '习惯', stroke: '#D4B576', dash: '' },
  { name: '性格', stroke: '#9A7B3F', dash: '3,3' },
  { name: '需求', stroke: 'rgba(201,169,97,0.5)', dash: '' },
];

export default function PersonaEvolutionMiniChart({ history, loading, selectedIdx, onSelectNode }) {
  if (loading) {
    return (
      <section className="evolution-card">
        <div className="info-card-header">
          <span className="info-card-title">画像进化趋势</span>
        </div>
        <p className="card-loading">加载中...</p>
      </section>
    );
  }
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

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/PersonaEvolutionMiniChart.jsx
git commit -m "feat(profile): add PersonaEvolutionMiniChart with trend/history index mapping"
```

---

## Task 9: 重写 ProfileDashboard 容器

**Files:**
- Modify: `src/components/profile/ProfileDashboard.jsx`（整个文件重写）

- [ ] **Step 1: 写新容器**

```jsx
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
```

- [ ] **Step 2: Commit（先不验证，等 Task 10 改完 ProfilePage 再跑 dev）**

```bash
git add src/components/profile/ProfileDashboard.jsx
git commit -m "feat(profile): rewrite ProfileDashboard with two-column layout and selectedIdx state"
```

---

## Task 10: ProfilePage 传递 specialFollows

**Files:**
- Modify: `src/components/ProfilePage.jsx`（ProfileDashboard 调用处）

- [ ] **Step 1: 找到 ProfileDashboard 调用**

Run: `Grep "ProfileDashboard" src/components/ProfilePage.jsx` 找到调用处（约 L119）。

- [ ] **Step 2: 加 specialFollows prop**

```jsx
// Before
<ProfileDashboard
  intelligenceProfile={intelligenceProfile}
  bookmarks={bookmarks}
  readingHistory={readingHistory}
  selectedInterests={selectedInterests}
/>

// After
<ProfileDashboard
  intelligenceProfile={intelligenceProfile}
  bookmarks={bookmarks}
  readingHistory={readingHistory}
  selectedInterests={selectedInterests}
  specialFollows={specialFollows}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ProfilePage.jsx
git commit -m "feat(profile): pass specialFollows to ProfileDashboard for KpiStrip"
```

---

## Task 11: 替换 styles.css Phase 4/5 样式块

**Files:**
- Modify: `src/styles.css`（L19240-L19576 替换为新 Phase 6 样式）

- [ ] **Step 1: 定位需要替换的范围**

Run: `Grep -n "Phase 4: Profile Dashboard" src/styles.css` 找到起始行（约 L19240）。
Run: `Grep -n "Phase 5: 画像进化趋势" src/styles.css` 找到 Phase 5 区段。
Run: `Grep -n ".diff-removed li" src/styles.css` 找到 Phase 5 最后一条规则。

Phase 4/5 总范围：约 L19240-L19576（336 行）。

- [ ] **Step 2: 用 Edit 替换整个区段**

old_string（从 `/* ============ Phase 4: Profile Dashboard ============ */` 到 `.diff-removed li { ... text-decoration: line-through; }` 整段）→ new_string（Phase 6 新样式）。

新样式（替换整个 Phase 4 + Phase 5 区段）：

```css
/* ============ Phase 6: Profile Dashboard Redesign ============ */

/* 顶部 Tab 切换器（保留 Phase 4 但调整样式） */
.profile-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-card-solid, #14181C);
  border: 1px solid var(--border-color, rgba(201,169,97,0.10));
  border-radius: 8px;
  padding: 3px;
  margin: 0 0 20px;
  width: fit-content;
}
.profile-tab {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-muted, #8B94A0);
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  background: transparent;
  font-family: inherit;
}
.profile-tab:hover { color: var(--text-secondary, #C4C9D0); }
.profile-tab.active {
  background: var(--accent-soft, rgba(201,169,97,0.12));
  color: var(--accent-bright, #D4B576);
  font-weight: 500;
}

/* 双栏布局 */
.profile-dashboard-v2 .dashboard-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 960px) {
  .profile-dashboard-v2 .dashboard-layout {
    grid-template-columns: 1fr;
  }
}
.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.dashboard-row-2 {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
@media (max-width: 960px) {
  .dashboard-row-2 { grid-template-columns: 1fr; }
}

/* ===== 时间轴 ===== */
.timeline-rail {
  background: var(--bg-card-solid, #14181C);
  border: 1px solid var(--border-color, rgba(201,169,97,0.10));
  border-radius: 14px;
  padding: 20px 16px;
  position: sticky;
  top: 24px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
}
.timeline-header {
  font-size: 11px;
  color: #5A6370;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, rgba(201,169,97,0.10));
}
.timeline-loading,
.timeline-empty {
  padding: 16px 0;
  text-align: center;
  color: var(--text-muted, #8B94A0);
  font-size: 12px;
}
.timeline-list {
  position: relative;
  padding-left: 4px;
}
.timeline-list::before {
  content: "";
  position: absolute;
  left: 11px;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background: linear-gradient(180deg, transparent, rgba(201,169,97,0.3) 10%, rgba(201,169,97,0.3) 90%, transparent);
}
.timeline-node {
  position: relative;
  padding: 8px 0 8px 28px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 6px;
}
.timeline-node:hover { background: rgba(201,169,97,0.06); }
.timeline-node::before {
  content: "";
  position: absolute;
  left: 7px;
  top: 14px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--bg-card-solid, #14181C);
  border: 2px solid #5A6370;
  transition: all 0.2s ease;
  z-index: 1;
}
.timeline-node:hover::before { border-color: var(--accent, #C9A961); }
.timeline-node.active::before {
  background: var(--accent, #C9A961);
  border-color: var(--accent, #C9A961);
  box-shadow: 0 0 0 4px rgba(201,169,97,0.18), 0 0 12px rgba(201,169,97,0.5);
}
.timeline-node-date {
  font-size: 13px;
  color: var(--text-secondary, #C4C9D0);
  font-weight: 500;
}
.timeline-node.active .timeline-node-date {
  color: var(--accent-bright, #D4B576);
  font-weight: 600;
}
.timeline-node-meta {
  font-size: 11px;
  color: #5A6370;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.timeline-node.active .timeline-node-meta { color: var(--text-muted, #8B94A0); }
.delta-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(201,169,97,0.12);
  color: var(--accent, #C9A961);
  font-weight: 500;
}
.delta-chip.positive { background: rgba(111,207,151,0.12); color: #6FCF97; }
.delta-chip.negative { background: rgba(235,116,134,0.12); color: #EB7486; }
.timeline-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, rgba(201,169,97,0.10));
  font-size: 11px;
  color: #5A6370;
  text-align: center;
}

/* ===== Persona Hero Card ===== */
.persona-hero {
  background: var(--bg-card-solid, #14181C);
  background-image:
    linear-gradient(135deg, rgba(201,169,97,0.10), transparent 50%),
    linear-gradient(180deg, var(--bg-card-solid, #14181C), rgba(20,24,28,0.95));
  border: 1px solid var(--accent-border, rgba(201,169,97,0.3));
  border-radius: 14px;
  padding: 24px 28px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(0,0,0,0.5), 0 0 24px rgba(201,169,97,0.15);
}
.persona-hero::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent, #C9A961), transparent);
}
.persona-hero::after {
  content: "";
  position: absolute;
  top: -50%;
  right: -20%;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(201,169,97,0.10), transparent 70%);
  pointer-events: none;
}
.hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
  position: relative;
  z-index: 1;
}
.hero-label {
  font-size: 10px;
  color: var(--accent, #C9A961);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.hero-label::before {
  content: "";
  width: 14px;
  height: 1px;
  background: var(--accent, #C9A961);
}
.hero-title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary, #EDEFF2);
}
.hero-subtitle {
  font-size: 12px;
  color: var(--text-muted, #8B94A0);
  margin-top: 4px;
}
.hero-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted, #8B94A0);
  font-size: 13px;
  position: relative;
  z-index: 1;
}
.hero-clear-diff {
  background: transparent;
  border: 1px solid var(--border-color, rgba(201,169,97,0.10));
  color: var(--text-muted, #8B94A0);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 6px 10px;
  border-radius: 6px;
  transition: all 0.2s ease;
  font-family: inherit;
}
.hero-clear-diff:hover {
  background: rgba(201,169,97,0.08);
  color: var(--accent, #C9A961);
  border-color: var(--accent-border, rgba(201,169,97,0.3));
}

/* 置信度环 */
.confidence-ring {
  width: 76px;
  height: 76px;
  position: relative;
  flex-shrink: 0;
}
.confidence-ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.confidence-value {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.confidence-value strong {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent-bright, #D4B576);
  line-height: 1;
}
.confidence-value span {
  font-size: 9px;
  color: #5A6370;
  margin-top: 2px;
  letter-spacing: 0.08em;
}

/* 三栏画像 */
.persona-cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  position: relative;
  z-index: 1;
}
.persona-col {
  position: relative;
  padding-left: 14px;
}
.persona-col::before {
  content: "";
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: linear-gradient(180deg, var(--accent, #C9A961), transparent);
  border-radius: 1px;
  opacity: 0.6;
}
.persona-col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border-color, rgba(201,169,97,0.10));
}
.persona-col-title {
  font-size: 12px;
  color: var(--text-secondary, #C4C9D0);
  font-weight: 500;
  letter-spacing: 0.04em;
}
.persona-col-count {
  font-size: 11px;
  color: var(--accent, #C9A961);
  background: var(--accent-soft, rgba(201,169,97,0.12));
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.count-added {
  background: rgba(111,207,151,0.18);
  color: #6FCF97;
  padding: 1px 5px;
  border-radius: 3px;
}
.count-removed {
  background: rgba(235,116,134,0.18);
  color: #EB7486;
  padding: 1px 5px;
  border-radius: 3px;
}
.count-none {
  color: #5A6370;
  background: rgba(255,255,255,0.04);
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 400;
}
.persona-col-empty {
  font-size: 12px;
  color: #5A6370;
  margin: 0;
}
.persona-col ul {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12.5px;
}
.persona-col li {
  padding: 4px 0;
  line-height: 1.45;
  color: var(--text-primary, #EDEFF2);
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.persona-col li::before {
  content: "·";
  color: var(--accent, #C9A961);
  font-weight: 700;
  flex-shrink: 0;
}
.persona-col li.added {
  color: #6FCF97;
}
.persona-col li.added::before { content: "+"; color: #6FCF97; }
.persona-col li.removed {
  color: #EB7486;
  text-decoration: line-through;
  opacity: 0.7;
}
.persona-col li.removed::before { content: "−"; color: #EB7486; }

/* ===== 通用 info-card ===== */
.info-card {
  background: var(--bg-card-solid, #14181C);
  border: 1px solid var(--border-color, rgba(201,169,97,0.10));
  border-radius: 14px;
  padding: 18px 20px;
  transition: border-color 0.2s ease;
}
.info-card:hover { border-color: var(--accent-border, rgba(201,169,97,0.3)); }
.info-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.info-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #EDEFF2);
  display: flex;
  align-items: center;
  gap: 6px;
}
.info-card-title::before {
  content: "";
  width: 3px;
  height: 12px;
  background: var(--accent, #C9A961);
  border-radius: 2px;
}
.info-card-meta {
  font-size: 11px;
  color: #5A6370;
}
.card-loading,
.card-empty,
.card-desc {
  font-size: 12px;
  color: var(--text-muted, #8B94A0);
  margin: 0 0 12px;
  line-height: 1.5;
}
.card-loading, .card-empty { padding: 8px 0; }

/* 行为观测卡 */
.prefs-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.pref-tag {
  background: var(--accent-soft, rgba(201,169,97,0.12));
  color: var(--accent, #C9A961);
  border: 1px solid var(--accent-border, rgba(201,169,97,0.3));
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
}
.prefs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-top: 1px solid rgba(255,255,255,0.04);
  font-size: 12px;
}
.prefs-row:first-of-type { border-top: none; }
.prefs-row .label { color: var(--text-muted, #8B94A0); }
.prefs-row .value {
  color: var(--accent, #C9A961);
  font-weight: 500;
  background: var(--accent-soft, rgba(201,169,97,0.12));
  padding: 2px 8px;
  border-radius: 4px;
}

/* PreheatCard 内嵌的 PreheatButton 样式覆盖 */
.preheat-card .preheat-btn {
  width: 100%;
  background: linear-gradient(135deg, rgba(201,169,97,0.18), rgba(201,169,97,0.06));
  border: 1px solid var(--accent-border, rgba(201,169,97,0.3));
  color: var(--accent-bright, #D4B576);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}
.preheat-card .preheat-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(201,169,97,0.28), rgba(201,169,97,0.12));
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(201,169,97,0.2);
}
.preheat-card .preheat-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.preheat-card .preheat-error {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(235,116,134,0.08);
  color: #EB7486;
  border: 1px solid rgba(235,116,134,0.2);
}
.preheat-card .preheat-success {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(111,207,151,0.08);
  color: #6FCF97;
  border: 1px solid rgba(111,207,151,0.2);
}

/* ===== KPI 细条 ===== */
.kpi-strip {
  background: var(--bg-card-solid, #14181C);
  border: 1px solid var(--border-color, rgba(201,169,97,0.10));
  border-radius: 14px;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 16px;
  position: relative;
}
.kpi-strip::before {
  content: "";
  position: absolute;
  top: 0;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent-border, rgba(201,169,97,0.3)), transparent);
}
.kpi-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  justify-content: center;
  position: relative;
}
.kpi-item:not(:last-child)::after {
  content: "";
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 18px;
  background: var(--border-color, rgba(201,169,97,0.10));
}
.kpi-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--accent-bright, #D4B576);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.kpi-label {
  font-size: 11px;
  color: var(--text-muted, #8B94A0);
  letter-spacing: 0.04em;
}

/* ===== 进化趋势 mini chart ===== */
.evolution-card {
  background: var(--bg-card-solid, #14181C);
  border: 1px solid var(--border-color, rgba(201,169,97,0.10));
  border-radius: 14px;
  padding: 18px 20px;
}
.evolution-chart {
  height: 80px;
  position: relative;
  margin-top: 8px;
}
.evolution-chart svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.evolution-legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted, #8B94A0);
}
.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style(profile): replace Phase 4/5 dashboard styles with Phase 6 redesign"
```

---

## Task 12: 删除 4 个废弃组件

**Files:**
- Delete: `src/components/profile/PersonaSummaryCard.jsx`
- Delete: `src/components/profile/LearnedPrefsCard.jsx`
- Delete: `src/components/profile/PersonaEvolutionSection.jsx`
- Delete: `src/components/profile/PersonaDiffCard.jsx`

- [ ] **Step 1: 确认无外部引用**

Run: `Grep "PersonaSummaryCard|LearnedPrefsCard|PersonaEvolutionSection|PersonaDiffCard" src/`

Expected: 只在 4 个文件内部互相引用（PersonaEvolutionSection import PersonaDiffCard），ProfileDashboard.jsx 已在 Task 9 不再 import。如果发现其他文件还在引用，先处理引用再删除。

- [ ] **Step 2: 删除 4 个文件**

使用 DeleteFile 工具删除上述 4 个文件。

- [ ] **Step 3: Commit**

```bash
git add -A src/components/profile/
git commit -m "refactor(profile): remove deprecated Phase 4/5 components (PersonaSummaryCard, LearnedPrefsCard, PersonaEvolutionSection, PersonaDiffCard)"
```

---

## Task 13: 启动 dev 验证

**Files:** 无（仅运行验证）

- [ ] **Step 1: 启动 dev server**

Run: `npm run dev`（blocking: false, wait_ms_before_async: 5000）

- [ ] **Step 2: 打开浏览器访问 ProfilePage**

访问 `http://localhost:5175`，登录后切到「用户画像」页面，确认：
- 仪表盘 Tab 默认选中
- 左侧时间轴显示（如果有 personaHistory 数据）
- 右侧 PersonaHeroCard 渲染（含置信度环）
- 三栏画像列表显示
- KPI 细条 4 项均分
- 行为观测卡 + 重跑预热卡并排
- 进化趋势图在最底部

- [ ] **Step 3: 交互验证**

- 点击时间轴非今日节点 → PersonaHeroCard 切换到 diff 模式（标题变"画像对比"，列表项标 added/removed 绿/红）
- 点击时间轴"今日"节点 → 回到当前画像视图
- 再次点击同一节点 → 取消 diff（toggle 行为）
- 点击 PersonaHeroCard 右上角 × → 取消 diff
- 点击进化趋势图节点 → 时间轴对应节点也 active（联动）

- [ ] **Step 4: 检查 Console 无报错**

打开浏览器 DevTools Console，刷新页面，确认无 React 报错（特别留意 "Objects are not valid as a React child" 不再出现）。

- [ ] **Step 5: Stop dev server**

如果 dev server 在后台运行，用 StopCommand 停止。

---

## Task 14: 跑测试套件验证无回归

**Files:** 无（仅运行测试）

- [ ] **Step 1: 跑全部测试**

Run: `node node_modules/vitest/vitest.mjs run`

Expected: 425 个测试全部 PASS。

如果有 FAIL：
- 若是 dashboardBuilder 测试失败 → 检查 Task 1 的 formatEvolvedAt export 是否破坏了什么
- 若是 useProfileSync / useSnapshotPreheat 测试失败 → 与本次重构无关，可能是环境问题
- 若是其他测试失败 → 检查是否误删了某个还在被引用的文件

- [ ] **Step 2: Commit（如有修复）**

如果测试发现了问题并修复，提交修复：

```bash
git add -A
git commit -m "test(profile): verify Phase 6 redesign passes all 425 tests"
```

如果一切顺利无需修复，跳过 commit。

---

## Task 15: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 找到 Phase 5 完成记录下方**

Run: `Grep -n "Phase 5 画像进化趋势" CLAUDE.md` 找到 Phase 5 区段末尾。

- [ ] **Step 2: 在 Phase 5 区段后追加 Phase 6 记录**

```markdown
**Phase 6 仪表盘视觉重构（已完成）**：从"方块堆叠"重构为左侧时间轴叙事 + 右侧画像主卡聚焦的双栏布局。
- `src/components/profile/ProfileDashboard.jsx`：重写容器，引入双栏布局 + `selectedIdx` 状态联动时间轴与趋势图
- `src/components/profile/PersonaTimelineRail.jsx`：左侧时间轴，节点显示日期 + delta chip（+N 绿 / -N 红）
- `src/components/profile/PersonaHeroCard.jsx`：主画像卡，current/diff 两种模式，含置信度环 SVG（金色渐变 stroke + glow）
- `src/components/profile/PersonaDiffList.jsx`：diff 模式下的三栏列表，added/removed 标记
- `src/components/profile/BehaviorObservedCard.jsx`：行为观测卡（重命名自 LearnedPrefsCard）
- `src/components/profile/PreheatCard.jsx`：包装 PreheatButton，加 info-card 样式
- `src/components/profile/KpiStrip.jsx`：KPI 细条，4 项均分，项间竖向分隔
- `src/components/profile/PersonaEvolutionMiniChart.jsx`：精简 SVG 进化趋势，3 条折线 + 节点 + 图例，index 映射 history[length-1-trendIdx]
- 删除：PersonaSummaryCard / LearnedPrefsCard / PersonaEvolutionSection / PersonaDiffCard（被新组件取代）
- `src/utils/dashboardBuilders.js`：`formatEvolvedAt` 改为 export（Phase 6 前置依赖）
- `src/components/ProfilePage.jsx`：传递 `specialFollows` 给 ProfileDashboard
- `src/styles.css`：替换 L19240-L19576 的 Phase 4/5 样式块为 Phase 6 新样式（双栏布局 + 时间轴 + 主画像卡 + KPI 细条 + 趋势图）
- 交互：点击时间轴节点 / 趋势图节点 → PersonaHeroCard 切换 diff 模式；再次点击 / 点击 × / 点击"今日" → 回到当前画像视图
- 测试：425 个测试全部通过（无新增测试，computeDelta 留在组件内部未抽纯函数）
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 6 dashboard redesign completion"
```

---

## 验收清单

实施完成后逐项确认：

- [ ] ProfilePage 默认 Tab = 仪表盘
- [ ] 仪表盘布局为左 220px 时间轴 + 右 1fr 内容区
- [ ] PersonaHeroCard 顶部含置信度环 SVG（金色渐变 stroke + glow）
- [ ] 三栏画像列表，每栏顶部有数量 chip
- [ ] 时间轴每个非今日节点显示 delta chip（+N 绿 / -N 红）
- [ ] 点击时间轴节点 → PersonaHeroCard 切换到 diff 模式，列表项标 added/removed
- [ ] 再次点击同一节点 / 点击 × / 点击"今日" → 回到当前画像视图
- [ ] 点击 PersonaEvolutionMiniChart 节点 → 与时间轴联动
- [ ] KPI 细条 4 项均分，项间竖向分隔
- [ ] 行为观测卡显示 topics chips + 偏好深度 + 偏好格式
- [ ] 重跑预热按钮含 loading / success / error 状态
- [ ] 删除 4 个废弃组件文件后，无任何文件 import 它们
- [ ] 425 个测试全部通过
- [ ] dev server 启动无报错
- [ ] Console 无 "Objects are not valid as a React child" 错误
