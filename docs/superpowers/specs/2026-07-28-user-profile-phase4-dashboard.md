# 用户画像模块 Phase 4：画像仪表盘

- **日期**：2026-07-28
- **状态**：待 review
- **作者**：brainstorming 流程产出
- **范围**：在 Phase 3 LLM 推荐增强之上，为 ProfilePage 加 Tab 切换（设置 / 仪表盘），仪表盘纯前端组件聚合现有数据源（snapshots / personaSummary / learned_preferences / preheat API），不新建表、不新建后端端点、不改 cron
- **用户感知**：ProfilePage 默认进入仪表盘 Tab，一眼看到推荐历史趋势、当前画像状态、行为观测、手动重跑预热入口
- **依赖**：Phase 3（stable-v13）

---

## 1. 背景与动机

### 1.1 Phase 3 交付的数据沉淀

Phase 3 完成了 LLM 推荐增强全链路：
- `recommendation_snapshots` 三表已有写入链路（cron + lazy）
- `persona_summary` 全链路同步（AiChat 对话进化 → user_profiles.persona_summary → profileStore）
- `learned_preferences` 字段已有写入方（evolveMemory → PATCH /api/agent-memory/learned-preferences）
- `GET /api/profile/snapshots` + `POST /api/profile/snapshots/preheat` 端点已就绪

### 1.2 问题：数据有，但用户看不见

- 推荐快照表有 30 天历史，但只在 RecommendationDateRail 展示当日 lane，无趋势视图
- personaSummary 在 AiChat 影响回复，但用户无法查看当前画像内容（Phase 3 的 PersonaSummarySection 只在 ProfilePage 底部展示，位置隐蔽）
- learned_preferences 写入了但无任何展示方
- preheat 端点只被 cron + lazy hook 调用，用户无法手动触发

### 1.3 Phase 4 目标

纯前端仪表盘，聚合 Phase 3 已沉淀的数据，让用户一眼看到系统状态：
1. 推荐历史趋势图（每日推荐数 + ai_status 分布）
2. 当前 personaSummary 状态（habits/traits/needs + lastEvolvedAt）
3. 行为观测卡片（learned_preferences 的 topics/preferredDepth/preferredFormat）
4. 手动重跑预热按钮（调 POST /api/profile/snapshots/preheat）
5. KPI 卡片区（关注领域/阅读点击/收藏/画像置信度）

**不做**：
- 不新建 persona_summary_history 表（等用户反馈"想看画像变化"再做）
- 不做 AI 简报编辑能力（独立产品功能，应作为 Phase 5 独立做）
- 不改后端、不改 cron、不新建 migration

---

## 2. 架构总览

### 2.1 数据流

```
[ProfilePage]
    ├── Tab: 设置 (现有所有 section)
    └── Tab: 仪表盘 (新建 ProfileDashboard)
            ├── KPI 卡片区
            │   └── 读 props (intelligenceProfile/bookmarks/readingHistory/dailyProfileSnapshots)
            ├── 推荐历史趋势图
            │   └── useProfileDashboard.snapshots (GET /api/profile/snapshots)
            ├── 当前 personaSummary
            │   └── profileStore.personaSummary + lastEvolvedAt
            ├── 行为观测卡片
            │   └── useProfileDashboard.learnedPrefs (GET /api/agent-memory/learned-preferences)
            └── 手动重跑预热按钮
                └── useProfileDashboard.preheat() (POST /api/profile/snapshots/preheat)
```

### 2.2 模块边界

```
src/hooks/
  useProfileDashboard.js          聚合数据 hook（snapshots/learnedPrefs/preheat）
src/components/profile/
  ProfileDashboard.jsx            仪表盘主组件（5 个区块）
  PersonaSummaryCard.jsx          当前画像卡片（从 PersonaSummarySection 抽取核心展示逻辑）
  LearnedPrefsCard.jsx            行为观测卡片
  PreheatButton.jsx               手动重跑预热按钮
src/components/
  ProfilePage.jsx                 加 Tab 切换 + 集成 ProfileDashboard
src/store/
  index.js                        useUiStore 新增 profileTab 字段（'settings' | 'dashboard'）
src/
  styles.css                      追加 Tab + 仪表盘样式
```

### 2.3 与 Phase 3 边界

| Phase 3 产出 | Phase 4 使用方式 |
|---|---|
| `GET /api/profile/snapshots` | 直接调用，返回 30 天快照列表 |
| `POST /api/profile/snapshots/preheat` | 直接调用，触发今日预热 |
| `profileStore.personaSummary` | 直接读取，展示当前画像 |
| `GET /api/agent-memory/persona` | 直接调用，返回 learnedPreferences 字段（同时返回 personaSummary + personaUpdatedAt） |
| `PersonaSummarySection` | 不改动，仪表盘用独立 `PersonaSummaryCard`（更紧凑展示） |

---

## 3. 详细设计

### 3.1 useProfileDashboard hook

```js
// src/hooks/useProfileDashboard.js
import { useState, useEffect, useCallback } from 'react';
import { useProfileStore } from '../store';

export function useProfileDashboard() {
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState(null);

  const [learnedPrefs, setLearnedPrefs] = useState({ topics: [], preferredDepth: '', preferredFormat: '' });
  const [prefsLoading, setPrefsLoading] = useState(true);

  const [preheatLoading, setPreheatLoading] = useState(false);
  const [preheatResult, setPreheatResult] = useState(null); // { cached, aiStatus } | null
  const [preheatError, setPreheatError] = useState(null);

  const personaSummary = useProfileStore(s => s.personaSummary);

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    setSnapshotsError(null);
    try {
      const resp = await fetch('/api/profile/snapshots');
      const data = await resp.json();
      if (data.ok) setSnapshots(data.snapshots || []);
      else setSnapshotsError(data.error || '加载失败');
    } catch (err) {
      setSnapshotsError(err.message);
    } finally {
      setSnapshotsLoading(false);
    }
  }, []);

  // 复用已有 GET /api/agent-memory/persona 端点（返回 personaSummary + learnedPreferences + personaUpdatedAt）
  // 而非不存在的 GET /api/agent-memory/learned-preferences
  const loadLearnedPrefs = useCallback(async () => {
    setPrefsLoading(true);
    try {
      const resp = await fetch('/api/agent-memory/persona');
      const data = await resp.json();
      if (data.ok) setLearnedPrefs(data.learnedPreferences || {});
    } catch {
      /* silent: 行为观测失败不影响仪表盘 */
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  const preheat = useCallback(async () => {
    setPreheatLoading(true);
    setPreheatError(null);
    setPreheatResult(null);
    try {
      const resp = await fetch('/api/profile/snapshots/preheat', { method: 'POST' });
      const data = await resp.json();
      if (data.ok) {
        setPreheatResult({ cached: data.cached, aiStatus: data.aiStatus });
        if (!data.cached) loadSnapshots(); // 重新拉取列表
      } else {
        setPreheatError(data.error || '预热失败');
      }
    } catch (err) {
      setPreheatError(err.message);
    } finally {
      setPreheatLoading(false);
    }
  }, [loadSnapshots]);

  useEffect(() => {
    loadSnapshots();
    loadLearnedPrefs();
  }, [loadSnapshots, loadLearnedPrefs]);

  return {
    snapshots, snapshotsLoading, snapshotsError,
    learnedPrefs, prefsLoading,
    personaSummary,
    preheat, preheatLoading, preheatResult, preheatError,
    refresh: () => { loadSnapshots(); loadLearnedPrefs(); },
  };
}
```

### 3.2 ProfileDashboard 组件

5 个区块从上到下排列：

```jsx
// src/components/profile/ProfileDashboard.jsx
import { useProfileDashboard } from '../../hooks/useProfileDashboard.js';
import { BlockGrid, BlockStat } from '../../blocks/index.js';
import TrendLineChart from '../TrendLineChart.jsx';
import PersonaSummaryCard from './PersonaSummaryCard.jsx';
import LearnedPrefsCard from './LearnedPrefsCard.jsx';
import PreheatButton from './PreheatButton.jsx';

export default function ProfileDashboard({
  intelligenceProfile, bookmarks, readingHistory, dailyProfileSnapshots, selectedInterests,
}) {
  const dash = useProfileDashboard();

  // 趋势图数据：每日推荐数
  const trendLabels = dash.snapshots.map(s => s.snapshot_date?.slice(5) || '');
  const trendSeries = [{
    name: '每日推荐数',
    values: dash.snapshots.map(s => s.item_count || 0),
  }];

  // ai_status 分布统计
  const aiStatusCounts = dash.snapshots.reduce((acc, s) => {
    const status = s.ai_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="profile-dashboard">
      {/* 1. KPI 卡片区 */}
      <BlockGrid columns={4}>
        <BlockStat variant="card" label="关注领域" value={selectedInterests.length} desc={intelligenceProfile.focusLabels?.slice(0, 3).join('、') || '未设置'} />
        <BlockStat variant="card" label="阅读点击" value={readingHistory.length} desc="近 100 条点击记录" />
        <BlockStat variant="card" label="收藏资讯" value={bookmarks.length} desc="收藏提高相似主题权重" />
        <BlockStat variant="card" label="画像置信度" value={`${intelligenceProfile.confidence || 0}%`} desc={intelligenceProfile.confidenceLabel || '需要校准'} />
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
            <div className="ai-status-distribution">
              {Object.entries(aiStatusCounts).map(([status, count]) => (
                <span key={status} className={`ai-status-badge status-${status}`}>
                  {status}: {count}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 3. 当前 personaSummary + 4. 行为观测 并排 */}
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
```

### 3.3 子组件

#### PersonaSummaryCard

紧凑版 PersonaSummarySection，并排展示 habits/traits/needs 三列：

```jsx
// src/components/profile/PersonaSummaryCard.jsx
export default function PersonaSummaryCard({ personaSummary, loading }) {
  const { habits = [], traits = [], needs = [], lastEvolvedAt } = personaSummary || {};
  const hasData = habits.length > 0 || traits.length > 0 || needs.length > 0;
  return (
    <div className="dashboard-card persona-summary-card">
      <h3 className="card-title">当前画像</h3>
      {loading ? <p className="card-loading">加载中...</p> :
       !hasData ? <p className="card-empty">暂无画像，与 AI 对话累积 3 轮后自动生成</p> :
       (
         <div className="persona-summary-grid">
           <div className="persona-column">
             <h4>习惯</h4>
             <ul>{habits.map((t, i) => <li key={i}>{t}</li>)}</ul>
           </div>
           <div className="persona-column">
             <h4>性格</h4>
             <ul>{traits.map((t, i) => <li key={i}>{t}</li>)}</ul>
           </div>
           <div className="persona-column">
             <h4>需求</h4>
             <ul>{needs.map((t, i) => <li key={i}>{t}</li>)}</ul>
           </div>
         </div>
       )}
      {lastEvolvedAt && <p className="card-meta">最近进化：{new Date(lastEvolvedAt).toLocaleString('zh-CN')}</p>}
    </div>
  );
}
```

#### LearnedPrefsCard

展示行为派生的偏好（topics/preferredDepth/preferredFormat），与 AgentMemorySection 的"记忆"明确区分：

```jsx
// src/components/profile/LearnedPrefsCard.jsx
export default function LearnedPrefsCard({ prefs, loading }) {
  const { topics = [], preferredDepth = '', preferredFormat = '' } = prefs || {};
  return (
    <div className="dashboard-card learned-prefs-card">
      <h3 className="card-title">行为观测</h3>
      {loading ? <p className="card-loading">加载中...</p> :
       topics.length === 0 && !preferredDepth && !preferredFormat ? (
         <p className="card-empty">暂无行为观测数据</p>
       ) : (
         <div className="learned-prefs-content">
           {topics.length > 0 && (
             <div className="prefs-row">
               <span className="prefs-label">高频主题</span>
               <div className="prefs-tags">{topics.map((t, i) => <span key={i} className="prefs-tag">{t}</span>)}</div>
             </div>
           )}
           {preferredDepth && (
             <div className="prefs-row">
               <span className="prefs-label">偏好深度</span>
               <span className="prefs-value">{preferredDepth === 'deep' ? '深入详细' : '简洁'}</span>
             </div>
           )}
           {preferredFormat && (
             <div className="prefs-row">
               <span className="prefs-label">偏好格式</span>
               <span className="prefs-value">{preferredFormat === 'detailed' ? '详细' : '简洁'}</span>
             </div>
           )}
         </div>
       )}
    </div>
  );
}
```

#### PreheatButton

含 loading/error/success 状态：

```jsx
// src/components/profile/PreheatButton.jsx
import { ICONS } from '../../constants/index.jsx';

export default function PreheatButton({ onPreheat, loading, result, error }) {
  return (
    <div className="dashboard-card preheat-card">
      <h3 className="card-title">手动重跑预热</h3>
      <p className="card-desc">触发今日推荐快照重新生成（会调用 LLM，可能耗时 30-60 秒）</p>
      <button
        className="preheat-btn"
        onClick={onPreheat}
        disabled={loading}
      >
        {loading ? '预热中...' : result?.cached ? '已预热（缓存命中）' : '重跑预热'}
      </button>
      {error && <p className="preheat-error">{ICONS.x} {error}</p>}
      {result && !result.cached && (
        <p className="preheat-success">
          预热完成（AI 状态：{result.aiStatus || 'unknown'}）
        </p>
      )}
    </div>
  );
}
```

### 3.4 ProfilePage Tab 切换

useUiStore 新增 `profileTab` 字段（'settings' | 'dashboard'，默认 'dashboard'）：

```js
// src/store/index.js 中 useUiStore
profileTab: 'dashboard',
setProfileTab: (tab) => set({ profileTab: tab }),
```

ProfilePage 顶部加 Tab 切换器：

```jsx
// src/components/ProfilePage.jsx 顶部
import ProfileDashboard from './profile/ProfileDashboard.jsx';
import { useUiStore } from '../store';

export default function ProfilePage({ ... }) {
  const profileTab = useUiStore(s => s.profileTab);
  const setProfileTab = useUiStore(s => s.setProfileTab);

  return (
    <div className="product-page profile-center-page">
      {/* Tab 切换器 */}
      <div className="profile-tabs">
        <button
          className={`profile-tab ${profileTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setProfileTab('dashboard')}
        >
          仪表盘
        </button>
        <button
          className={`profile-tab ${profileTab === 'settings' ? 'active' : ''}`}
          onClick={() => setProfileTab('settings')}
        >
          设置
        </button>
      </div>

      {profileTab === 'dashboard' ? (
        <ProfileDashboard
          intelligenceProfile={intelligenceProfile}
          bookmarks={bookmarks}
          readingHistory={readingHistory}
          dailyProfileSnapshots={dailyProfileSnapshots}
          selectedInterests={selectedInterests}
        />
      ) : (
        <>
          {/* 现有所有 section（hero + PersonaSummarySection + PendingSuggestionsSection + ...） */}
        </>
      )}
    </div>
  );
}
```

### 3.5 样式

styles.css 追加：

```css
/* ============ Phase 4: Profile Dashboard ============ */
.profile-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  margin-bottom: 24px;
}
.profile-tab {
  padding: 10px 20px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary, #888);
  cursor: pointer;
  font-size: 14px;
  transition: color 0.2s, border-color 0.2s;
}
.profile-tab:hover { color: var(--text-primary, #fff); }
.profile-tab.active {
  color: var(--accent-cyan, #22d3ee);
  border-bottom-color: var(--accent-cyan, #22d3ee);
}

.profile-dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.dashboard-section {
  padding: 20px;
  background: var(--bg-secondary, rgba(255,255,255,0.03));
  border-radius: 12px;
}
.dashboard-section .section-header {
  margin-bottom: 16px;
}
.dashboard-section .section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
}
.dashboard-section .section-desc {
  font-size: 12px;
  color: var(--text-muted, #666);
  margin: 0;
}
.dashboard-loading, .dashboard-error, .dashboard-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted, #666);
  font-size: 14px;
}
.dashboard-error { color: #ef4444; }

.dashboard-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 768px) {
  .dashboard-row { grid-template-columns: 1fr; }
}

.dashboard-card {
  padding: 20px;
  background: var(--bg-secondary, rgba(255,255,255,0.03));
  border-radius: 12px;
}
.dashboard-card .card-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
}
.dashboard-card .card-loading, .dashboard-card .card-empty {
  color: var(--text-muted, #666);
  font-size: 13px;
  padding: 16px 0;
}
.dashboard-card .card-meta {
  font-size: 11px;
  color: var(--text-muted, #666);
  margin-top: 12px;
}

.persona-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.persona-column h4 {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin: 0 0 8px;
}
.persona-column ul {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.persona-column li {
  padding: 4px 0;
  line-height: 1.4;
}

.learned-prefs-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.prefs-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.prefs-label {
  font-size: 12px;
  color: var(--text-secondary, #888);
  min-width: 70px;
}
.prefs-value {
  font-size: 13px;
}
.prefs-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.prefs-tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(34,211,238,0.1);
  color: var(--accent-cyan, #22d3ee);
  font-size: 12px;
}

.ai-status-distribution {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.ai-status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.preheat-card .card-desc {
  font-size: 12px;
  color: var(--text-muted, #666);
  margin: 0 0 12px;
}
.preheat-btn {
  padding: 8px 16px;
  background: var(--accent-bg, #f59e0b);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.preheat-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.preheat-error {
  color: #ef4444;
  font-size: 12px;
  margin-top: 8px;
}
.preheat-success {
  color: #22c55e;
  font-size: 12px;
  margin-top: 8px;
}
```

---

## 4. 错误处理与边界

### 4.1 数据加载失败

- snapshots 加载失败：显示错误信息 + 重试按钮（复用 dashboard-error 样式）
- learnedPrefs 加载失败：静默，显示空卡片（不阻塞仪表盘）
- personaSummary 为空：显示"暂无画像"提示

### 4.2 preheat 边界

- preheat 接口返回 cached=true：按钮显示"已预热（缓存命中）"，不刷新列表
- preheat 接口返回 cached=false：按钮显示"预热完成"，自动刷新 snapshots 列表
- preheat 接口失败：显示错误信息，不阻塞其他区块

### 4.3 空状态

- snapshots 为空：趋势图不渲染，显示"暂无历史快照"
- personaSummary 为空：显示"暂无画像，与 AI 对话累积 3 轮后自动生成"
- learnedPrefs 为空：显示"暂无行为观测数据"

---

## 5. 测试策略

### 5.1 纯函数单元测试

`useProfileDashboard` hook 的数据转换逻辑可抽取为纯函数：

```js
// buildTrendSeries.js（抽取自 hook）
export function buildTrendSeries(snapshots) {
  const labels = snapshots.map(s => s.snapshot_date?.slice(5) || '');
  const values = snapshots.map(s => s.item_count || 0);
  return { labels, series: [{ name: '每日推荐数', values }] };
}

export function buildAiStatusCounts(snapshots) {
  return snapshots.reduce((acc, s) => {
    const status = s.ai_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}
```

测试覆盖：
- `buildTrendSeries`：空数组、单条、多条、item_count 缺失
- `buildAiStatusCounts`：空数组、单状态、多状态混合、unknown 状态

### 5.2 测试覆盖目标

新增约 8 个单元测试，总数 398 → 406。

---

## 6. 实施步骤

### 6.1 Phase 4 任务清单

| Task | 内容 | 文件 |
|---|---|---|
| D1 | useProfileDashboard hook + 纯函数抽取 | src/hooks/useProfileDashboard.js |
| D2 | buildTrendSeries/buildAiStatusCounts 纯函数 + 单元测试 | src/hooks/useProfileDashboard.js + __tests__ |
| D3 | PersonaSummaryCard 组件 | src/components/profile/PersonaSummaryCard.jsx |
| D4 | LearnedPrefsCard 组件 | src/components/profile/LearnedPrefsCard.jsx |
| D5 | PreheatButton 组件 | src/components/profile/PreheatButton.jsx |
| D6 | ProfileDashboard 主组件 | src/components/profile/ProfileDashboard.jsx |
| D7 | useUiStore 加 profileTab 字段 | src/store/index.js |
| D8 | ProfilePage Tab 切换 + 集成 | src/components/ProfilePage.jsx |
| D9 | styles.css 样式 | src/styles.css |
| D10 | 文档更新 + 最终验收 + tag stable-v14 | CLAUDE.md + AGENTS.md |

### 6.2 验收清单

- [ ] npm test 全通过（406 tests）
- [ ] npm run build 成功
- [ ] ProfilePage 默认进入仪表盘 Tab
- [ ] 仪表盘 5 个区块正常渲染
- [ ] 趋势图展示 30 天推荐数
- [ ] 手动重跑预热按钮可点击
- [ ] 空状态正确显示
- [ ] tag stable-v14

---

## 7. 关键决策记录

### 7.1 不新建 persona_summary_history 表

**决策**：Phase 4 不做画像进化趋势图，只展示当前 personaSummary 状态。

**理由**：
- personaSummary 由前端 AiChat 对话驱动进化，与 cron 06:00 预热异步
- 趋势图价值是"数组长度变化"，信息密度低
- 新建表 + 改 cron + lazy 检查约 6-8 个文件改动，YAGNI
- 等用户反馈"想看画像变化"再做（Phase 5 候选）

### 7.2 不做 AI 简报编辑能力

**决策**：Phase 4 不做用户编辑 AI 简报功能。

**理由**：
- 编辑器 UI + 保存接口 + 版本对比是独立产品功能
- 强行捆绑会导致 Phase 4 周期长、交付慢
- 应作为 Phase 5 独立做，先验证仪表盘价值再决定

### 7.3 仪表盘用独立 PersonaSummaryCard，不复用 PersonaSummarySection

**决策**：仪表盘用独立的 `PersonaSummaryCard` 组件，不复用 Phase 3 的 `PersonaSummarySection`。

**理由**：
- `PersonaSummarySection` 是竖向全宽布局，适合设置 Tab
- 仪表盘需要紧凑横向布局（与 LearnedPrefsCard 并排）
- 复用会导致样式冲突，独立组件更清晰

### 7.4 ProfilePage 默认 Tab 为 dashboard

**决策**：ProfilePage 默认进入仪表盘 Tab，而非设置 Tab。

**理由**：
- 仪表盘是数据可视化，用户更频繁查看
- 设置是低频操作（调整领域/优先级）
- 数据优先于配置

---

## 8. 后续阶段衔接

| Phase 4 产出 | Phase 5 如何使用 |
|---|---|
| 仪表盘框架 | Phase 5 可加更多区块（画像进化趋势、AI 简报编辑入口） |
| useProfileDashboard hook | Phase 5 可扩展返回更多数据（如 persona_summary_history） |
| Tab 切换机制 | Phase 5 可加第三个 Tab（如"记忆管理"） |
| PreheatButton | Phase 5 可加"手动重跑 + 强制刷新"选项 |
