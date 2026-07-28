# 用户画像模块地基重构（Phase 1）

- **日期**：2026-07-28
- **状态**：待 review
- **作者**：brainstorming 流程产出
- **范围**：用户画像模块的"数据地基重构"，为后续 AI 主动学习闭环（Phase 2）与推荐算法 LLM 增强（Phase 3）铺路
- **用户感知**：零（内部重构，UI 行为不变）

---

## 1. 背景与动机

### 1.1 用户画像的战略地位

用户画像是 Silicon Meridian 的核心主题——"让平台越来越懂你"的原子表达。它连接：
- **精准推荐**：基于画像分层（focus/normal/explore）的个性化打分
- **AI 工作站**：workflow 通过 `buildWorkbenchContext` 把画像喂给 LLM
- **AI 对话**：`buildSystemPrompt` / `buildPersonalContext` 注入画像让 AI 贴合用户
- **用户主权**：用户可实时调整 domainTiers/sourceTiers/specialFollows

### 1.2 现状核心矛盾（从第一性原理反推）

画像的"原子"是：**用户主动声明的偏好 + 行为沉淀 + 主动校准**。三者目前都是断的：

1. **双套画像逻辑并存**
   - `src/utils/profileModel.js` 定义了纯函数（被测试覆盖但**生产代码不调用**）
   - `src/hooks/useWorkbenchMemos.js` + `src/App.jsx` L1377-L1502 内联 `useMemo`（实际运行）
   - 同一概念两份近似实现，字段还不一致（如 `confidence` 在 prompt 里被引用但实际恒为 0）

2. **AI 是"看完即忘"的**
   - `profile-memory` skill 在 workflow 中输出"建议追踪/强化领域"
   - **只读不写**——AI 给了建议，store 不更新，用户必须手动到 ProfilePage 调整
   - 这是"AI 越来越懂你"最关键的断点

3. **行为信号散落 5 处**
   - `bookmarks` / `materials` / `readingHistory` / `recommendationFeedback` / `followKeywords`
   - 分布在 5 个不同 localStorage key 与 store 中
   - `computeProfileLearningEngine` 各自加权打分但**没有统一行为日志模型**，新增信号源要改多处

4. **推荐算法是静态加权**
   - `buildRecommendation` = freshness×0.5 + corroboration×6.25 + sourceQuality + trend×15 + domain/source tier + specialFollow + behavior + novelty
   - **LLM 完全没参与推荐决策**，只在事后 `mergeAiBriefing` 改写文案

5. **PG 表建了不用**
   - `recommendation_snapshots` / `briefing_snapshots` 已建表
   - 前端走 localStorage，跨设备不同步
   - `useProfileSync` 也只同步三块（domainTiers/sourceTiers/specialFollows），不同步 dailyProfileSnapshots/briefingConfig/selectedInterests/followKeywords/readingHistory/bookmarks/materials/recommendationFeedback

6. **ProfilePage 是"展示+CRUD 杂烩"**
   - 261 行做了 6 件事（统计卡/学习引擎面板/领域分层/源分层/特别关注 CRUD/校准信号/每日快照）
   - 编辑入口单一，**没有"现在我应该调什么"的引导**

7. **specialFollows submit 逻辑双份**
   - `App.jsx` L361-L386 与 `ProfilePage.jsx` L37-L66 是同一份代码的两份拷贝

### 1.3 本阶段定位

用户重构诉求涉及 5 个相互关联的子问题。本 spec 聚焦**数据地基重构**，其他子问题在后续阶段处理：

| 子问题 | 阶段 |
|---|---|
| 数据地基重构（双源消除+行为信号统一+跨设备同步） | **Phase 1（本 spec）** |
| AI 主动学习闭环（profile-memory 写回 + personaSummary 自动更新 + 接受/拒绝 UI） | Phase 2 |
| 推荐算法 LLM 增强（top 30 语义聚类 + 盲区主动探索 + 可解释推荐） | Phase 3 |
| 前端 UI 重构（仪表盘视图 + 快速调权滑块 + 设置面板画像 Tab） | Phase 4 |

---

## 2. 架构总览

### 2.1 模块边界（重构后）

```
┌─────────────────────────────────────────────────────────────────┐
│  行为信号层（source of truth）                                  │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │ useBehaviorStore     │  │ useBookmarkMaterial (保留)       │  │
│  │ - readingHistory     │  │ - bookmarks (含图片附件, 不动)   │  │
│  │ - recommendationFB   │  │ - materials  (含图片附件, 不动)   │  │
│  │ - followKeywords     │  └──────────────────────────────────┘  │
│  │ - trackTargets       │                                        │
│  │ - feedbackEvents     │  ← 5 路小数据迁入新 store              │
│  └──────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓ 派生聚合
┌─────────────────────────────────────────────────────────────────┐
│  画像计算层（纯函数, 测试覆盖）                                  │
│  src/utils/profileModel.js                                       │
│  - computeIntelligenceProfile  (上位为生产代码调用源)            │
│  - computeReadingProfile                                       │
│  - computeProfileLearningEngine  (字段合并: confidence/feedback) │
│  - computeTodayProfileSnapshot                                  │
│  - computeCalibrationSignals   (新增导出)                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓ 唯一调用方
┌─────────────────────────────────────────────────────────────────┐
│  React 集成层（薄壳）                                            │
│  src/hooks/useWorkbenchMemos.js  ← 删除内联 useMemo, 调用纯函数   │
│  App.jsx L1377-L1502 内联代码全部删除                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  偏好与快照层（持久化 + 跨设备同步）                             │
│  src/store/profileStore.js                                       │
│  - domainTiers / sourceTiers / specialFollows (原有)             │
│  - dailyProfileSnapshots / briefingConfig (扩展同步)             │
│  - pendingSuggestions (新增, AI 写回扩展点, 仅存储)               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  同步层                                                          │
│  src/hooks/useProfileSync.js  ← 扩展同步 5 块 (+1 待确认区)      │
│  server/profile/*  ← briefing_snapshots 表启用                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键边界

- **行为信号（输入）与画像计算（派生）严格分离**
- **画像计算是纯函数**，零 React 依赖，可被 workflow engine / agent loop / 推荐引擎任意复用
- **profileStore 的 `pendingSuggestions` 是 AI 写回扩展点**，本阶段只建存储和写入接口，不做接受/拒绝 UI
- **用户感知**：零。本阶段为内部重构，UI 行为不变

---

## 3. 数据模型

### 3.1 useBehaviorStore（新建）

**文件**：`src/store/behaviorStore.js`

**职责**：聚合 5 路小数据行为信号为单一 source of truth。`bookmarks`/`materials` 因含图片附件、由 `useBookmarkMaterial` 管理大文件，**保留原状**——useBehaviorStore 通过 `useBookmarkMaterial` 暴露的 getter 派生聚合视图，不内部复制。

**状态结构**：

```js
{
  // 持久化字段
  readingHistory: [],              // 从 recommendStore 迁入 (localStorage key 'readingHistory')
  recommendationFeedback: {       // 从 recommendStore 迁入 (key 'recommendationFeedback')
    boostedCategories: [],
    mutedSources: [],
    trackedTerms: [],
  },
  recommendationFeedbackEvents: [], // 从 recommendStore 迁入 (key 'recommendationFeedback:v2')
  followKeywords: [],              // 从 recommendStore 迁入 (key 'followKeywords')
  trackTargets: [],                // 从 recommendStore 迁入 (key 'trackTargets')
}
```

**actions**：
- `addReadingHistory(item)` / `clearReadingHistory()`
- `setRecommendationFeedback(patch)` / `addFeedbackEvent(event)`
- `addFollowKeyword(kw)` / `removeFollowKeyword(kw)`
- `addTrackTarget(t)` / `removeTrackTarget(t)`

**派生 selector**（zustand selector）：
- `selectAllSignals(state)` — 返回扁平化数组，按时间倒序
- `selectRecentSignals(state, days)` — 过滤 N 天内
- `selectFeedbackSignalsByType(state, type)` — 'boost' | 'mute' | 'track'

**迁移逻辑**（store 初始化时执行一次）：

```js
function migrateLegacyBehavior(persisted) {
  // 从旧 localStorage key 读出数据，合并到 persisted
  // 合并策略：按 id 去重，冲突取较新的
  // 旧 key 保留 30 天不删除（仅复制到新 store，出问题可手动回滚）
}
```

**persist key**：`siliconstream-behavior-store`

**消费方迁移**（仅改 import，不改逻辑）：
- `useWorkbenchMemos.js`、`profileModel.js`、`App.jsx L1377-L1502 内联`、`useAgentWorkflowRunner.js`、`workflowEngine.js` — 全部从 `recommendStore` 改为 `behaviorStore`

**遗留**：
- `recommendStore.js` 仅保留 `recommendedItems` / `feedCache` / 推荐结果缓存，删除行为信号部分
- `useBookmarkMaterial.js` 不动，但其返回的 `bookmarks` / `materials` 通过 `useBehaviorStore` 的派生 selector 与其他信号一起暴露给画像计算

### 3.2 profileStore 扩展

**文件**：`src/store/profileStore.js`

**新增字段**：

```js
{
  // ... 原有 domainTiers/sourceTiers/specialFollows/dailyProfileSnapshots/briefingConfig

  // 新增：AI 建议待确认区（持久化，第二阶段做接受/拒绝 UI）
  pendingSuggestions: [],  // Suggestion[]
}
```

**Suggestion 结构**：

```ts
type Suggestion = {
  id: string;                    // 唯一 id（timestamp + random）
  type: 'track' | 'boost' | 'mute' | 'follow_source' | 'follow_author';
  target: string;               // 关键词/源名/作者名
  reason: string;                // AI 给出的理由（如"近 7 天阅读了 4 条相关资讯"）
  source: 'ai' | 'manual';      // 来源（首阶段仅 ai，预留 manual 扩展）
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
  metadata?: {                   // 可选元数据
    relatedItemIds?: string[];   // 触发该建议的资讯 id
    confidence?: number;        // AI 给出的置信度 0-1
  };
};
```

**新增 actions**：
- `addPendingSuggestion(suggestion)` — 单条添加
- `addPendingSuggestions(suggestions)` — 批量添加（去重逻辑：`(type, target)` 已存在且 `status === 'pending'` 时，仅更新 `reason` 和 `createdAt`，不新增）
- `updateSuggestionStatus(id, status)` — 'accepted' / 'rejected'（不删除，保留审计轨迹 30 天）
- `pruneExpiredSuggestions()` — 清理 30 天前的 accepted/rejected 项

**防护机制**（在 `addPendingSuggestions` 内置）：
1. **去重**：`(type, target)` 已存在且 `status === 'pending'` 时，仅更新 `reason` 和 `createdAt`，不新增
2. **上限**：pending 状态的 suggestions 最多 20 条，超过则丢弃 confidence 最低的
3. **冷却**：同一 `(type, target)` 在 1 小时内不重复添加（即使已被接受/拒绝）
4. **AI 不可直接修改用户偏好**：addPendingSuggestions 只能往 pendingSuggestions 写，**没有任何 action 直接修改 domainTiers/sourceTiers/specialFollows**——只有用户在 UI 上操作才能改

**partialize 更新**（持久化白名单）：

```js
partialize: (s) => ({
  domainTiers: s.domainTiers,
  sourceTiers: s.sourceTiers,
  specialFollows: s.specialFollows,
  dailyProfileSnapshots: s.dailyProfileSnapshots,
  briefingConfig: s.briefingConfig,
  pendingSuggestions: s.pendingSuggestions,  // 新增
})
```

### 3.3 数据迁移安全性

**localStorage key 迁移**（旧 → 新）：
- `readingHistory` → useBehaviorStore 内部字段（persist key: `siliconstream-behavior-store`）
- `recommendationFeedback` / `recommendationFeedback:v2` → 同上
- `followKeywords` / `trackTargets` → 同上

**迁移时机**：useBehaviorStore 的 `onRehydrateStorage` 钩子，仅首次加载时执行一次。

**回滚策略**：旧 key 保留 30 天不删除（仅复制到新 store），出问题可手动回滚。

**兼容性**：
- 旧代码若仍 import `recommendStore`，会看到行为信号字段为空——这是预期的，因为所有消费方都会在本次重构中迁移到 useBehaviorStore
- 不存在"新代码 vs 旧代码"长期共存场景，迁移一次性完成

---

## 4. 画像计算层 — profileModel.js 上位与字段统一

### 4.1 现状的字段差异

**profileModel.js（死代码版本）** `computeProfileLearningEngine` 返回：
```
confidence, confidenceLabel, behaviorDepth, topCategories, topSources,
topTags, blindSpots, nextActions, summary
```

**App.jsx L1377-L1502 内联版本** 多出：
```
explanation, savedRatio, materialRatio, recentReadCount,
multimediaReads, feedbackLearningCount, topAuthors
```

**修复方向**：profileModel.js 缺失的字段全部合入纯函数返回值，让两者完全等价。

### 4.2 computeIntelligenceProfile 修复

**问题**：`buildSystemPrompt.js` L56 引用 `profile.confidence`，但 `useWorkbenchMemos` 的 `intelligenceProfile` 不返回该字段，恒为 0。

**修复**：`computeIntelligenceProfile` 返回值新增 `confidence` 字段（从 `computeProfileLearningEngine` 派生），让 prompt 注入真实置信度。

**新签名**：

```js
computeIntelligenceProfile({
  bookmarks, readingHistory, materials, selectedInterests,
  recommendationFeedback, followKeywords, sourcePriorities,
  domainPriorities, insightSourceQuality, workbenchItemCount, focusMatches,
}) → {
  // 原有字段
  focusLabels: string[],
  boosted: string[],
  muted: string[],
  tracked: string[],
  depth: 'deep-focus' | 'standard' | 'exploration',
  outputGoal: string,
  // 新增字段
  confidence: number,           // 0-96, 从 computeProfileLearningEngine 派生
  confidenceLabel: string,      // '高可信' | '持续学习中' | '需要校准'
}
```

**实现**：内部调用 `computeProfileLearningEngine`（不暴露给外部，作为内部依赖），把其 confidence/confidenceLabel 合并到自身返回值。

### 4.3 computeProfileLearningEngine 字段合并

**扩展签名**（新增入参 + 新增返回字段）：

```js
computeProfileLearningEngine({
  // 原有入参
  readingHistory, bookmarks, materials, selectedInterests,
  domainTiers, domainPriorities, recommendationFeedback,
  followKeywords, sourceTiers, sourcePriorities,
}) → {
  // 原有返回
  confidence, confidenceLabel, behaviorDepth,
  topCategories, topSources, topTags, blindSpots, nextActions, summary,
  // 新增返回（从 App.jsx 内联合入）
  explanation: string,          // 一句话画像说明
  savedRatio: number,           // 阅读收藏率 (bookmarks/readingHistory * 100)
  materialRatio: number,        // 资产沉淀率 (materials/bookmarks * 100)
  recentReadCount: number,     // 7 日内阅读数
  multimediaReads: number,     // 含图/视频的阅读数
  feedbackLearningCount: number, // 反馈学习次数
  topAuthors: string[],        // top 作者
}
```

**新增计算逻辑**（从 App.jsx L1420-L1480 抽出）：
- `savedRatio`：`bookmarks.length / Math.max(readingHistory.length, 1) * 100`
- `materialRatio`：`materials.length / Math.max(bookmarks.length, 1) * 100`
- `recentReadCount`：`readingHistory` 中 7 日内条目数
- `multimediaReads`：`bookmarks` 中 `mode === 'multimedia'` 的条目数
- `feedbackLearningCount`：`boostedCategories.length + mutedSources.length + trackedTerms.length`
- `topAuthors`：从 `bookmarks` 聚合 `author` 字段，取 top 5
- `explanation`：基于以上字段的一句话模板，如"近 7 天阅读 12 条，收藏率 25%，资产沉淀型，建议加强 focus 领域"

### 4.4 computeTodayProfileSnapshot 字段对齐

**现状**：`profileModel.js` 版本依赖 `intelligenceProfile` + `profileLearningEngine` + `readingHistory` + `bookmarks` + `materials` + `sourcePriorityItems`。

**App.jsx 内联版本**多消费 `profileCalibrationSignals`（L1504-L1514）。

**修复**：把 `profileCalibrationSignals` 作为入参传入，统一返回结构。

**新签名**：

```js
computeTodayProfileSnapshot({
  date, intelligenceProfile, profileLearningEngine,
  readingHistory, bookmarks, materials, sourcePriorityItems,
  calibrationSignals,  // 新增入参
}) → {
  date, confidence, confidenceLabel, behaviorDepth,
  readCount, savedCount, materialCount,
  topCategories, topSources, topTags, topAuthors,
  blindSpots, nextActions, summary, explanation,
  calibrationSignals,  // 新增返回
}
```

### 4.5 computeCalibrationSignals 新增导出

**从 App.jsx L1504-L1514 抽出独立函数**：

```js
function computeCalibrationSignals({ intelligenceProfile, recommendationFeedback, dailyProfileSnapshots }) {
  return {
    hasFeedbackData: recommendationFeedback.boostedCategories.length > 0
                    || recommendationFeedback.mutedSources.length > 0
                    || recommendationFeedback.trackedTerms.length > 0,
    hasSnapshotHistory: dailyProfileSnapshots.length >= 3,
    needsCalibration: confidence < 45,
    lastCalibrationDays: ...,
  };
}
```

作为 profileModel.js 的独立导出函数。

### 4.6 useWorkbenchMemos.js 改造为薄壳

**现状**：L29-L160 自行实现 `intelligenceProfile` / `profilePriorityItems` / `sourcePriorityItems` 等 useMemo。

**改造后**：

```js
import {
  computeIntelligenceProfile,
  computeReadingProfile,
  computeProfileLearningEngine,
  computeTodayProfileSnapshot,
  computeCalibrationSignals,
} from '../utils/profileModel.js';

export function useWorkbenchMemos({ /* 入参不变 */ }) {
  // ... 原有数据加载逻辑保留

  const intelligenceProfile = useMemo(
    () => computeIntelligenceProfile({ bookmarks, readingHistory, materials, ... }),
    [bookmarks, readingHistory, materials, ...]
  );

  const profileLearningEngine = useMemo(
    () => computeProfileLearningEngine({ readingHistory, bookmarks, materials, ... }),
    [readingHistory, bookmarks, materials, ...]
  );

  const todayProfileSnapshot = useMemo(
    () => computeTodayProfileSnapshot({ ... }),
    [...]
  );

  const profileCalibrationSignals = useMemo(
    () => computeCalibrationSignals({ ... }),
    [...]
  );

  // profilePriorityItems / sourcePriorityItems 保留（属于 UI 派生，不属于画像核心）
  return { intelligenceProfile, profileLearningEngine, todayProfileSnapshot,
           profileCalibrationSignals, profilePriorityItems, sourcePriorityItems,
           workbenchItems, workbenchStats };
}
```

**删除的内容**：
- L109-L126 的 `intelligenceProfile` 内联实现
- App.jsx L1377-L1502 的 `profileLearningEngine` / `todayProfileSnapshot` / `profileCalibrationSignals` 三个内联 useMemo（全部由 useWorkbenchMemos 统一出口）

### 4.7 测试影响与新增

**现有 70 个 profileModel.test.js 测试**：
- 字段扩展后，部分断言会失败（如 `expect(result).toEqual({...})` 缺少新字段）
- 修复：更新断言加入新字段，或改用 `expect(result.confidence).toBeGreaterThan(0)` 等部分匹配

**新增测试**：
- `computeIntelligenceProfile` 返回 `confidence` 字段（从 0 修复为实际值）
- `computeProfileLearningEngine` 新增 7 个字段的计算正确性
- `computeTodayProfileSnapshot` 含 `calibrationSignals`
- `computeCalibrationSignals` 独立测试

### 4.8 兼容性保证

**对外接口不变**：
- `useWorkbenchMemos` 返回值结构兼容（含新增字段，但原有字段不变）
- App.jsx 消费方零改动（删除内联 useMemo 即可）
- `buildSystemPrompt.js` / `buildPersonalContext` 消费的 `intelligenceProfile` 结构兼容，且 `confidence` 字段从恒 0 修复为真实值

**回滚策略**：
- profileModel.js 的改动是新增字段 + 内部实现，不破坏现有签名
- 若出问题，把 useWorkbenchMemos.js 改回内联即可（git revert）

---

## 5. AI 写回扩展点 — profile-memory skill + pendingSuggestions 接口

### 5.1 现状的"看完即忘"断点

**现状流程**（`src/hooks/useAgentWorkflowRunner.js` L211-L221）：

```
workflow 节点 skillId='profile-memory'
  ↓
buildProfileMemory() 读取 intelligenceProfile.tracked + top5 资讯 tags + top3 category labels
  ↓
返回 { terms: [...], output: "建议追踪: xxx\n建议强化领域: yyy\n本次行为依据: zzz" }
  ↓
写入 structured.profileTerms，供后续节点使用
  ↓
workflow 结束，output 文本展示给用户
  ↓
❌ store 不更新，AI 建议消失在风里
```

**修复后流程**：

```
buildProfileMemory()
  ↓ 同上计算
  ↓ 返回 { terms, output }
  ↓
新增一行：useProfileStore.getState().addPendingSuggestions(
  terms.map(t => ({ type: 'track', target: t.term, reason: t.reason, source: 'ai' }))
)
  ↓
pendingSuggestions 落到 store（持久化 + 30 天审计）
  ↓
第二阶段 ProfilePage 顶部卡片展示，用户点"接受"才写入 specialFollows
```

**关键边界**：本阶段**只写 pendingSuggestions，不写 specialFollows/domainTiers/sourceTiers**。AI 的建议进入"待确认区"，用户主权完整保留。

### 5.2 buildProfileMemory 改造

**文件**：`src/hooks/useAgentWorkflowRunner.js` L211-L221

**改造后**：

```js
function buildProfileMemory() {
  const trackedTerms = intelligenceProfile.tracked || [];
  // ... 同上计算

  const suggestions = [
    // 来自 terms：建议追踪关键词
    ...terms.slice(0, 3).map(t => ({
      type: 'track',
      target: t.term,
      reason: `近 ${t.count} 次出现于阅读资讯（来源：${t.source}）`,
      source: 'ai',
      metadata: { relatedItemIds: t.itemIds, confidence: Math.min(t.count / 5, 1) },
    })),
    // 来自 topCategories：建议强化领域
    ...topCategories.slice(0, 2).map(c => ({
      type: 'boost',
      target: c.label,
      reason: `近 7 天阅读 ${c.count} 条相关资讯，建议加权关注`,
      source: 'ai',
      metadata: { confidence: Math.min(c.count / 10, 1) },
    })),
  ];

  // ★ 唯一新增的一行：写入 pendingSuggestions
  if (suggestions.length > 0) {
    useProfileStore.getState().addPendingSuggestions(suggestions);
  }

  return { terms, output };  // 返回值不变，保持兼容
}
```

### 5.3 workflowEngine.js 平行版本同步改造

**文件**：`src/utils/workflowEngine.js` L227

由于 workflowEngine 是纯函数无 React 依赖，需要把 `addPendingSuggestions` 作为 ctx 入参传入（解耦）：

```js
// workflowEngine.js L227
function buildProfileMemory(scopedAgentItems, intelligenceProfile, trackedTerms, bookmarks, materials, ctx) {
  // ... 计算 suggestions
  if (suggestions.length > 0 && ctx?.addPendingSuggestions) {
    ctx.addPendingSuggestions(suggestions);
  }
  return { terms, output };
}
```

**两个版本的统一**：useAgentWorkflowRunner 调用 workflowEngine 时传入 `ctx.addPendingSuggestions = useProfileStore.getState().addPendingSuggestions`，让 workflowEngine 内部版本成为唯一实现，useAgentWorkflowRunner 的内联版本删除。**这是顺手消除双源**。

### 5.4 AiChat 对话后的画像更新（轻量版）

**现状**：AiChat 每轮对话后不更新画像，personaSummary 来自服务端 `persona_summary`（已有但何时更新未明确）。

**本阶段改动**：仅在 system prompt 注入"用户最近接受的 AI 建议"作为强化信号（第二阶段实现接受 UI 后才有数据）。

**首阶段不实现**：
- AiChat 每轮对话后异步更新 personaSummary（需要 LLM 调用，成本高，放第二阶段）
- 实时把用户对话中的偏好信号写入 pendingSuggestions（需要 NLP 抽取，放第三阶段）

**唯一变化**：`src/components/aichat/buildSystemPrompt.js` 在 profileLines 后追加一段（仅当 pendingSuggestions 中有 accepted 项时）：

```js
const acceptedSuggestions = useProfileStore(s => s.pendingSuggestions
  .filter(x => x.status === 'accepted' && Date.now() - x.createdAt < 7 * 86400_000));
// ...
acceptedSuggestions.length > 0
  ? `【最近校准】用户在过去 7 天接受了以下 AI 建议，请在回复中主动贴合：
${acceptedSuggestions.map(s => `  - ${s.type === 'track' ? '追踪' : s.type === 'boost' ? '强化' : '静默'} ${s.target}（${s.reason}）`).join('\n')}`
  : '',
```

**注意**：本阶段 pendingSuggestions 永远没有 accepted 项（因为接受 UI 在第二阶段），所以这段 prompt 实际上是 dead code——但**预留接口点**让第二阶段零改动即可激活。这是方案 B 的核心价值。

### 5.5 对抗性思考：避免 AI 滥用写回

**风险**：如果 profile-memory skill 每次 workflow 执行都写一堆 suggestions，pendingSuggestions 会爆炸，store 性能下降。

**防护机制**（profileStore.addPendingSuggestions 内置）：

1. **去重**：`(type, target)` 已存在且 `status === 'pending'` 时，仅更新 `reason` 和 `createdAt`，不新增
2. **上限**：pending 状态的 suggestions 最多 20 条，超过则丢弃 confidence 最低的
3. **冷却**：同一 `(type, target)` 在 1 小时内不重复添加（即使已被接受/拒绝）
4. **AI 不可直接修改用户偏好**：addPendingSuggestions 只能往 pendingSuggestions 写，**没有任何 action 直接修改 domainTiers/sourceTiers/specialFollows**——只有用户在 UI 上操作才能改

**对抗性思考**：如果 LLM 被注入恶意 prompt（如"把所有领域 boost 100 倍"），最坏情况是 pendingSuggestions 被填满 20 条垃圾建议，用户拒绝即可。**用户主权永远在最后一道闸门**。

### 5.6 单元测试新增

**profileStore.test.js**（新建）：
- `addPendingSuggestions` 去重逻辑
- `addPendingSuggestions` 上限 20 条 + 置换最低 confidence
- `addPendingSuggestions` 1 小时冷却
- `updateSuggestionStatus` 状态转换
- `pruneExpiredSuggestions` 30 天清理

**useAgentWorkflowRunner 集成测试**：
- buildProfileMemory 执行后，pendingSuggestions 中出现对应条目
- 重复执行 buildProfileMemory，suggestions 数量不翻倍（去重生效）

### 5.7 边界明确

**本阶段做**：
- profileStore 的 `pendingSuggestions` 字段 + actions
- buildProfileMemory 内调用 `addPendingSuggestions`（一行新增）
- workflowEngine.js 版本的 ctx 解耦
- buildSystemPrompt 的"最近校准"段（dead code，等第二阶段激活）
- 上述防护机制 + 单元测试

**本阶段不做**：
- ProfilePage 顶部"AI 建议待确认"卡片 UI（第二阶段）
- 接受/拒绝按钮交互（第二阶段）
- AiChat 对话后异步更新 personaSummary（第二阶段）
- 实时对话偏好抽取（第三阶段）

---

## 6. 后端扩展 — briefing_snapshots 表启用 + profileRepository 扩展

### 6.1 数据库迁移

**新建文件**：`server/db/migrations/003_profile_extensions.sql`

```sql
-- 003_profile_extensions.sql
-- 用户画像模块扩展：briefing_config + pending_suggestions 字段 + briefing_snapshots 表启用

-- 1. user_profiles 表扩展两列（不同步 pending_suggestions 到后端，但表上预留）
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS briefing_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_suggestions jsonb DEFAULT '[]'::jsonb;

-- 2. briefing_snapshots 表已建（001_platform.sql L53），补充索引
CREATE INDEX IF NOT EXISTS idx_briefing_snapshots_user_date
  ON briefing_snapshots(user_id, date DESC);

-- 3. recommendation_items 表已建（001_platform.sql L54），无改动
```

**注意**：
- `briefing_config` / `pending_suggestions` 用 jsonb 而非关系型，因为字段结构可能演变（YAGNI：不强求规范化）
- `pending_suggestions` 虽然首阶段不同步到后端，但列预留——第二阶段决定是否启用，避免再次迁移表结构
- 不创建新表，仅启用已建的 `briefing_snapshots`

### 6.2 profileRepository 扩展

**文件**：`server/profile/profileRepository.js`

**getState 扩展**（L20-L35）：

```js
async function getState(userId) {
  // 原有：并行查 user_profiles/profile_domains/profile_sources/special_follows
  // 新增：查 briefing_snapshots（最近 30 条）
  const [profileRes, domainRes, sourceRes, specialRes, snapshotRes] = await Promise.all([
    pool.query('SELECT version, confidence, behavior_signals, briefing_config FROM user_profiles WHERE user_id = $1', [userId]),
    pool.query('SELECT domain_id, tier FROM profile_domains WHERE user_id = $1', [userId]),
    pool.query('SELECT source_id, tier FROM profile_sources WHERE user_id = $1', [userId]),
    pool.query('SELECT id, type, target, note, created_at FROM special_follows WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
    pool.query('SELECT date, snapshot FROM briefing_snapshots WHERE user_id = $1 ORDER BY date DESC LIMIT 30', [userId]),
  ]);

  return {
    version: profileRes.rows[0]?.version ?? 1,
    confidence: profileRes.rows[0]?.confidence ?? 0,
    behaviorSignals: profileRes.rows[0]?.behavior_signals ?? {},
    briefingConfig: profileRes.rows[0]?.briefing_config ?? {},          // 新增
    pendingSuggestions: profileRes.rows[0]?.pending_suggestions ?? [],   // 新增（同步字段，但首阶段不同步）
    domains: domainRes.rows.map(r => ({ id: r.domain_id, tier: r.tier })),
    sources: sourceRes.rows.map(r => ({ id: r.source_id, tier: r.tier })),
    specialFollows: specialRes.rows.map(r => ({
      id: r.id, type: r.type, target: r.target, note: r.note, createdAt: r.created_at,
    })),
    dailyProfileSnapshots: snapshotRes.rows.map(r => ({       // 新增
      date: r.date,
      ...r.snapshot,
    })),
  };
}
```

**saveState 扩展**（L36-L53）：

```js
async function saveState(userId, state, expectedVersion) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 更新 user_profiles（含 briefing_config）
    const profileRes = await client.query(
      `UPDATE user_profiles
       SET version = version + 1,
           confidence = $2,
           behavior_signals = $3,
           briefing_config = $4
       WHERE user_id = $1
         AND ($5::integer IS NULL OR version = $5)
       RETURNING version`,
      [userId, state.confidence ?? 0, JSON.stringify(state.behaviorSignals ?? {}),
       JSON.stringify(state.briefingConfig ?? {}), expectedVersion ?? null]
    );

    if (profileRes.rows.length === 0) {
      // 用户首次保存：INSERT 而非 UPDATE
      // 或版本冲突：抛 PROFILE_VERSION_CONFLICT
      // ... (原有逻辑)
    }

    // 2-4. 原有：先 delete 再 insert 三个子表（profile_domains / profile_sources / special_follows）

    // 5. 新增：briefing_snapshots 增量同步（只写入今日 snapshot）
    if (state.dailyProfileSnapshots && state.dailyProfileSnapshots.length > 0) {
      const todaySnapshot = state.dailyProfileSnapshots[0]; // 数组按 date 倒序
      await client.query(
        `INSERT INTO briefing_snapshots (user_id, date, snapshot)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, date) DO NOTHING`,  -- 远端已有则跳过
        [userId, todaySnapshot.date, JSON.stringify(todaySnapshot)]
      );
    }

    await client.query('COMMIT');
    return { version: profileRes.rows[0].version };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

### 6.3 profileService 校验扩展

**文件**：`server/profile/profileService.js`

**新增校验**（L7-L28）：

```js
function normalizeBriefingConfig(config) {
  if (!config || typeof config !== 'object') return { length: 'standard', includeRead: false };
  return {
    length: ['concise', 'standard', 'detailed'].includes(config.length) ? config.length : 'standard',
    includeRead: Boolean(config.includeRead),
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || !snapshot.date) return null;
  return {
    date: String(snapshot.date).slice(0, 10),  // YYYY-MM-DD
    confidence: Number(snapshot.confidence) || 0,
    behaviorDepth: String(snapshot.behaviorDepth || '').slice(0, 30),
    summary: String(snapshot.summary || '').slice(0, 500),
    // 其他字段保留原样（jsonb 存储不严格校验）
  };
}
```

**saveState 调用前**：对 `briefingConfig` 和 `dailyProfileSnapshots[0]` 调用 normalize 函数。

### 6.4 useProfileSync 扩展

**文件**：`src/hooks/useProfileSync.js`

**入参扩展**（L17）：

```js
export function useProfileSync({
  user,
  // 原有三块
  domainTiers, sourceTiers, specialFollows,
  setDomainTiers, setSourceTiers, setSpecialFollows,
  // 新增两块
  dailyProfileSnapshots, briefingConfig,
  setDailyProfileSnapshots, setBriefingConfig,
}) {
```

**hydrate effect 扩展**（L56-L77）：

```js
// user.id 变化时 GET
if (remote.version > 0) {
  skipSave.current = true;
  setDomainTiers(...);
  setSourceTiers(...);
  setSpecialFollows(...);
  // 新增：合并远端 snapshots（远端有则覆盖本地，本地新于远端的保留）
  if (remote.dailyProfileSnapshots?.length > 0) {
    setDailyProfileSnapshots(prev => {
      const merged = [...prev];
      for (const remoteSnap of remote.dailyProfileSnapshots) {
        const localIdx = merged.findIndex(s => s.date === remoteSnap.date);
        if (localIdx < 0) merged.push(remoteSnap);
        // 不覆盖本地新于远端的（避免本地今日 snapshot 被远端旧版本覆盖）
      }
      return merged.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    });
  }
  if (remote.briefingConfig) {
    setBriefingConfig(remote.briefingConfig);
  }
}
```

**save effect 扩展**（L79-L86）：

```js
// 监听 5 块状态变化（原有 3 + 新增 2）
// debounce 600ms 后 drain
// drain.current: PUT /api/profile/state 带 expectedVersion
// payload 新增：briefingConfig + dailyProfileSnapshots[0]（仅今日）
```

**payload 构造**：

```js
{
  version: expectedVersion,
  confidence,  // 由 profileModel 派生（前端计算后传入，或后端 GET 时已有）
  behaviorSignals: {},  // 暂留空，第二阶段扩展
  briefingConfig,
  domains: [...],
  sources: [...],
  specialFollows: [...],
  dailyProfileSnapshots: [todaySnapshot],  // 仅传今日，避免全量传输
}
```

**冲突处理**：
- 409 PROFILE_VERSION_CONFLICT：原有逻辑（GET 最新 + 提示"画像在其他窗口或设备发生变化"）保留
- briefingConfig 冲突：取"最后写入胜"（乐观锁 + 用户重新编辑）
- dailyProfileSnapshots 冲突：`ON CONFLICT DO NOTHING`，远端有则跳过

### 6.5 数据流总览（重构后）

```
[前端] useBehaviorStore + useBookmarkMaterial + profileStore
    ↓ 派生
[前端] profileModel.js (纯函数) → useWorkbenchMemos (薄壳) → App.jsx
    ↓ 同步（debounce 600ms）
[前端] useProfileSync → PUT /api/profile/state
    ↓
[后端] profileHandlers.js → profileService.js → profileRepository.js
    ↓
[PG] user_profiles / profile_domains / profile_sources / special_follows / briefing_snapshots
    ↓ 跨设备
[设备 B] GET /api/profile/state → hydrate 到 profileStore + behaviorStore
```

### 6.6 边界明确

**本阶段做**：
- 数据库迁移 003_profile_extensions.sql
- profileRepository 扩展 getState/saveState
- profileService 校验扩展
- useProfileSync 扩展 5 块同步
- briefing_snapshots 表启用（仅今日增量同步）

**本阶段不做**：
- pending_suggestions 后端同步（前端已预留 jsonb 列，但首阶段不同步）
- recommendation_snapshots 表启用（推荐算法升级在第三阶段）
- 完整的 dailyProfileSnapshots 历史同步（仅同步今日，历史按需拉取）

---

## 7. 实施步骤、风险与回滚、测试策略

### 7.1 实施步骤（按依赖顺序）

**Phase 1.1 — 行为信号统一（无 UI 感知）**

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 1 | `src/store/behaviorStore.js` | 新建，迁移 5 路小数据 + migrateLegacyBehavior | 无 |
| 2 | `src/store/recommendStore.js` | 删除 readingHistory/recommendationFeedback/followKeywords/trackTargets 字段，仅保留 recommendedItems/feedCache | 1 |
| 3 | `src/hooks/useWorkbenchMemos.js` | 改 import 从 recommendStore → behaviorStore | 1, 2 |
| 4 | `src/hooks/useAgentWorkflowRunner.js` | 改 import + 调用点 | 1, 2 |
| 5 | `src/utils/workflowEngine.js` | 改 import | 1, 2 |
| 6 | `src/App.jsx` L1377-L1502 | 改 import（内联 useMemo 删除前的过渡，先改 import 不删内联） | 1, 2 |
| 7 | 全量回归测试 | 296 个测试 + 浏览器手动验证 | 1-6 |

**Phase 1.2 — profileModel.js 上位（无 UI 感知）**

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 8 | `src/utils/profileModel.js` | computeProfileLearningEngine 等扩展字段 + 新增 computeCalibrationSignals + computeIntelligenceProfile 返回 confidence | 1.1 完成 |
| 9 | `src/utils/__tests__/profileModel.test.js` | 更新断言（部分匹配 vs 完整重新断言） | 8 |
| 10 | `src/hooks/useWorkbenchMemos.js` | 改为薄壳，调用 profileModel.js 纯函数 | 8 |
| 11 | `src/App.jsx` L1377-L1502 | 删除 profileLearningEngine/todayProfileSnapshot/profileCalibrationSignals 内联 useMemo | 10 |
| 12 | `src/components/aichat/buildSystemPrompt.js` | confidence 字段从恒 0 修复为真实值（无改动，仅数据源修复） | 10 |
| 13 | 全量回归测试 | | 8-12 |

**Phase 1.3 — profileStore 扩展 + AI 写回扩展点（无 UI 感知）**

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 14 | `src/store/profileStore.js` | 新增 pendingSuggestions 字段 + actions + 去重/上限/冷却防护 | 1.2 完成 |
| 15 | `src/store/__tests__/profileStore.test.js` | 新建，覆盖 addPendingSuggestions 防护机制 | 14 |
| 16 | `src/hooks/useAgentWorkflowRunner.js` L211-L221 | buildProfileMemory 内新增一行 addPendingSuggestions；删除内联版本，调用 workflowEngine.js 版本（消除双源） | 14 |
| 17 | `src/utils/workflowEngine.js` L227 | buildProfileMemory 接受 ctx.addPendingSuggestions 参数 | 14 |
| 18 | `src/components/aichat/buildSystemPrompt.js` | 预留"最近校准"段（dead code，等第二阶段激活） | 14 |
| 19 | 全量回归测试 | | 14-18 |

**Phase 1.4 — 后端扩展 + 跨设备同步（无 UI 感知）**

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 20 | `server/db/migrations/003_profile_extensions.sql` | 新建迁移文件 | 1.3 完成 |
| 21 | `server/profile/profileRepository.js` | getState/saveState 扩展 briefing_config + briefing_snapshots | 20 |
| 22 | `server/profile/profileService.js` | normalizeBriefingConfig + normalizeSnapshot 校验 | 21 |
| 23 | `server/__tests__/profileRepository.test.js`（如存在）或新建 | 后端测试 | 21, 22 |
| 24 | `src/hooks/useProfileSync.js` | 扩展同步 5 块 + hydrate 合并策略 | 21, 22 |
| 25 | `src/App.jsx` useProfileSync 调用点（L325） | 传入 dailyProfileSnapshots/briefingConfig/setBriefingConfig | 24 |
| 26 | 全量回归测试 + 跨设备手动验证 | | 20-25 |

**Phase 1.5 — 清理与文档**

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 27 | `src/App.jsx` L361-L386 | 删除 specialFollows submit 内联代码（与 ProfilePage.jsx L37-L66 重复），改用 ProfilePage 内统一 handler | 1.4 完成 |
| 28 | `CLAUDE.md` / `AGENTS.md` | 更新模块边界说明（双源消除、behaviorStore 新建、profileModel.js 上位） | 27 |

### 7.2 风险与回滚

**风险矩阵**：

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| localStorage 迁移失败导致行为信号丢失 | 低 | 高 | 旧 key 保留 30 天不删；migrateLegacyBehavior 仅复制不删；store 初始化失败时回退到空数组（不崩） |
| profileModel.js 字段扩展后与 App.jsx 内联版本字段不一致 | 中 | 中 | Phase 1.2 步骤 11 删除内联前必须确认所有字段已合入纯函数；单元测试断言完整覆盖 |
| workflowEngine.js 接受 ctx 参数后调用方未传 | 中 | 中 | ctx?.addPendingSuggestions 可选链保护；现有调用方 useAgentWorkflowRunner 必传 |
| 后端迁移失败（briefing_config 列添加失败） | 低 | 高 | ALTER TABLE 用 IF NOT EXISTS；迁移前后均能运行（后端读到 null 列时返回默认值） |
| useProfileSync 扩展后 hydrate 死循环（远端 → 本地 → 同步 → 远端…） | 中 | 中 | 保留 skipSave.current 机制；hydrate 时设 skipSave=true 防止回写；新增字段同样遵循此规则 |
| pendingSuggestions 滥用（AI 写入过多） | 低 | 低 | addPendingSuggestions 内置去重 + 上限 20 + 1 小时冷却；最坏情况用户清空即可 |

**回滚策略**：

- 每个 Phase 独立可回滚（git revert 单个 commit）
- Phase 1.1 回滚：恢复 recommendStore 字段 + 还原 useBehaviorStore 仅为空壳
- Phase 1.2 回滚：恢复 useWorkbenchMemos.js 内联实现 + 还原 profileModel.js 字段
- Phase 1.3 回滚：删除 pendingSuggestions 字段 + 还原 buildProfileMemory
- Phase 1.4 回滚：恢复 useProfileSync 同步 3 块 + 后端迁移向后兼容（新列有默认值，旧代码不读不写即可）

**关键安全网**：
- 每个 Phase 完成后跑全量 296 测试
- 每个 Phase 完成后浏览器手动验证：登录/登出/阅读/收藏/AI 对话/workflow 执行/跨设备同步

### 7.3 测试策略

**单元测试**（vitest）：

| 文件 | 覆盖范围 | 新增/修改 |
|---|---|---|
| `src/utils/__tests__/profileModel.test.js` | 70 个现有测试 + 新字段断言 | 修改 30 个断言 + 新增 15 个 |
| `src/store/__tests__/behaviorStore.test.js` | 新建：迁移逻辑/去重/selector | 新建 ~25 个 |
| `src/store/__tests__/profileStore.test.js` | 新建：addPendingSuggestions 防护 | 新建 ~10 个 |
| `server/__tests__/profileRepository.test.js` | 后端 getState/saveState 扩展字段 | 新建 ~8 个 |
| `server/__tests__/profileService.test.js` | normalizeBriefingConfig/normalizeSnapshot | 新建 ~6 个 |
| `src/hooks/__tests__/useProfileSync.test.js` | 扩展同步 5 块 + hydrate 合并 | 新建 ~5 个 |

**目标**：296 → ~365 个测试，全部通过。

**手动验证清单**（每个 Phase 后执行）：

1. 登录后画像数据正确加载（domainTiers/sourceTiers/specialFollows）
2. 阅读资讯后 readingHistory 更新（行为信号层）
3. 收藏资讯后 bookmarks 更新（保留原状）
4. AI 对话正常，画像注入 prompt 正确
5. workflow 执行后 pendingSuggestions 出现条目（Phase 1.3 后）
6. 跨设备：设备 A 修改 domainTiers，设备 B 登录后能看到（Phase 1.4 后）
7. 跨设备：设备 A 今日 snapshot，设备 B 登录后能看到（Phase 1.4 后）
8. 浏览器控制台无报错
9. localStorage 检查：旧 key 仍存在（30 天保留期），新 key `siliconstream-behavior-store` 已创建

### 7.4 完成定义（Definition of Done）

- [ ] 296 + ~70 新增 = ~366 个测试全部通过
- [ ] `npm run build` 成功
- [ ] 浏览器手动验证清单 9 项全过
- [ ] 跨设备同步手动验证（Phase 1.4 后）
- [ ] App.jsx 净减少 ~150 行（删除内联 useMemo + 重复 submit handler）
- [ ] CLAUDE.md 更新模块边界说明

### 7.5 不在本阶段范围

明确排除（避免 scope creep）：

- ProfilePage UI 重构（第二阶段）
- AI 建议接受/拒绝 UI（第二阶段）
- 推荐算法 LLM 增强（第三阶段）
- readingHistory 跨设备同步（高频写入，第三阶段决定）
- personaSummary 自动更新（第二阶段）
- recommendation_snapshots 表启用（第三阶段）

### 7.6 后续阶段衔接

本阶段交付的扩展点，后续阶段如何激活：

| 本阶段产出 | 第二阶段如何使用 | 第三阶段如何使用 |
|---|---|---|
| `useBehaviorStore` 统一信号源 | personaSummary 计算直接读 | LLM 推荐增强读 recentSignals |
| `profileModel.js` 纯函数上位 | personaSummary 调用 computeIntelligenceProfile | LLM 推荐增强调用 computeProfileLearningEngine |
| `pendingSuggestions` 存储扩展点 | ProfilePage 顶部卡片 + 接受/拒绝 UI | — |
| `buildSystemPrompt` "最近校准"段 | 接受后立即激活（dead code → live） | — |
| `briefing_snapshots` 表启用 | 跨设备查看历史画像 | recommendation_snapshots 同模式启用 |
| `briefing_config` 跨设备同步 | 多设备一致偏好设置 | — |

---

## 8. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 首阶段范围 | 数据地基重构（A） | 后续一切的地基，2-3 天可交付，无 UI 变化用户无感知 |
| 行为信号统一策略 | 混合方案（C） | 小数据迁移风险低，大文件（bookmarks/materials）保留原状避开风险 |
| profileModel.js 处理 | 纯函数上位（A） | 架构清晰，迁移点明确，保留可测试性 |
| PG 同步范围 | 偏好+快照同步（B） | 跨设备一致的用户偏好与画像快照，高频行为数据本地保留性能好 |
| 实施方案 | 方案 B（数据地基+AI 写回扩展点） | 为第二阶段预留接口点，避免重复重构 profileStore |
| pendingSuggestions 上限 | 20 条 + 1 小时冷却 + 30 天审计 | 平衡 AI 学习能力与用户主权，最坏情况可控 |
| briefing_config 存储 | user_profiles.jsonb 列 | 字段结构可能演变，不强求规范化 |
| dailyProfileSnapshots 同步 | 仅今日增量 | 避免全量传输，历史按需拉取 |
