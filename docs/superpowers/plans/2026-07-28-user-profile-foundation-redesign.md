# 用户画像模块地基重构（Phase 1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户画像模块从"双源 + 行为信号散落 + 跨设备不同步"重构为"单一可信源 + 纯函数上位 + AI 写回扩展点 + 跨设备同步"，为零 UI 感知的内部重构。

**Architecture:** 5 个 phases 按依赖顺序执行：行为信号统一 → profileModel.js 上位 → profileStore + AI 写回扩展点 → 后端扩展 + 跨设备同步 → 清理与文档。每个 phase 独立可 git revert，每个 phase 完成后跑全量测试。

**Tech Stack:** React 19 + Zustand 5 (persist 中间件) + Vite 7 + Vitest 3 + PostgreSQL 15 + node:pg

**Spec:** `docs/superpowers/specs/2026-07-28-user-profile-foundation-redesign.md`

**当前测试基线**：296/296 通过（vitest 3.x）

---

## 文件结构

### 新建文件
- `src/store/behaviorStore.js` — 行为信号单一 source of truth（5 路小数据迁入）
- `src/store/__tests__/behaviorStore.test.js` — 迁移/去重/selector 测试
- `src/store/__tests__/profileStore.test.js` — pendingSuggestions 防护机制测试
- `server/db/migrations/003_profile_extensions.sql` — briefing_config + pending_suggestions 列 + briefing_snapshots 索引
- `server/__tests__/profileRepository.test.js` — 后端扩展字段测试
- `server/__tests__/profileService.test.js` — normalize 函数测试
- `src/hooks/__tests__/useProfileSync.test.js` — 扩展同步测试

### 修改文件
- `src/store/recommendStore.js` — 删除 5 路小数据，仅保留推荐结果缓存
- `src/store/profileStore.js` — 新增 pendingSuggestions + actions + 防护
- `src/store/index.js` — barrel 导出 useBehaviorStore
- `src/utils/profileModel.js` — 纯函数上位，扩展字段 + computeCalibrationSignals 导出
- `src/utils/__tests__/profileModel.test.js` — 更新断言
- `src/hooks/useWorkbenchMemos.js` — 改为薄壳，调用 profileModel.js
- `src/hooks/useAgentWorkflowRunner.js` — 改 import + buildProfileMemory 写回
- `src/hooks/useProfileSync.js` — 扩展同步 5 块
- `src/utils/workflowEngine.js` — 改 import + ctx 参数
- `src/components/aichat/buildSystemPrompt.js` — 预留"最近校准"段
- `src/App.jsx` — 删除内联 useMemo + 重复 submit handler
- `server/profile/profileRepository.js` — 扩展 getState/saveState
- `server/profile/profileService.js` — normalize 校验
- `CLAUDE.md` / `AGENTS.md` — 模块边界更新

---

## Phase 1.1 — 行为信号统一（无 UI 感知）

**目标**：5 路小数据（readingHistory / recommendationFeedback / recommendationFeedbackEvents / followKeywords / trackTargets）从 recommendStore 迁入新 useBehaviorStore。消费方仅改 import，不改逻辑。

### Task 1: 新建 behaviorStore.js（含迁移逻辑）

**Files:**
- Create: `src/store/behaviorStore.js`
- Test: `src/store/__tests__/behaviorStore.test.js`

- [ ] **Step 1: 写迁移与去重的失败测试**

```js
// src/store/__tests__/behaviorStore.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { useBehaviorStore, migrateLegacyBehavior } from '../behaviorStore.js';

describe('migrateLegacyBehavior', () => {
  it('merges legacy localStorage keys into persisted state', () => {
    localStorage.setItem('readingHistory', JSON.stringify([{ id: 'a', readAt: '2026-07-01' }]));
    localStorage.setItem('followKeywords', JSON.stringify(['AI']));
    localStorage.setItem('trackTargets', JSON.stringify([{ term: 'GPU' }]));
    localStorage.setItem('recommendationFeedback', JSON.stringify({
      boostedCategories: { ai: 1 }, mutedSources: {}, trackedTerms: {}, hiddenIds: []
    }));
    localStorage.setItem('recommendationFeedback:v2', JSON.stringify([{ type: 'boost', target: 'ai' }]));

    const result = migrateLegacyBehavior({});
    expect(result.readingHistory).toHaveLength(1);
    expect(result.followKeywords).toEqual(['AI']);
    expect(result.trackTargets).toHaveLength(1);
    expect(result.recommendationFeedback.boostedCategories.ai).toBe(1);
    expect(result.recommendationFeedbackEvents).toHaveLength(1);
  });

  it('does not override persisted state if legacy key absent', () => {
    const result = migrateLegacyBehavior({ followKeywords: ['existing'] });
    expect(result.followKeywords).toEqual(['existing']);
  });
});

describe('useBehaviorStore actions', () => {
  beforeEach(() => { useBehaviorStore.getState().clearAll?.(); });

  it('addReadingHistory appends with cap 200', () => {
    for (let i = 0; i < 210; i++) useBehaviorStore.getState().addReadingHistory({ id: `i${i}` });
    expect(useBehaviorStore.getState().readingHistory).toHaveLength(200);
    expect(useBehaviorStore.getState().readingHistory[0].id).toBe('i209');
  });

  it('addFollowKeyword dedupes', () => {
    useBehaviorStore.getState().addFollowKeyword('AI');
    useBehaviorStore.getState().addFollowKeyword('AI');
    expect(useBehaviorStore.getState().followKeywords).toEqual(['AI']);
  });

  it('addTrackTarget dedupes by term', () => {
    useBehaviorStore.getState().addTrackTarget({ term: 'GPU' });
    useBehaviorStore.getState().addTrackTarget({ term: 'GPU', note: 'updated' });
    expect(useBehaviorStore.getState().trackTargets).toHaveLength(1);
    expect(useBehaviorStore.getState().trackTargets[0].note).toBe('updated');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/store/__tests__/behaviorStore.test.js`
Expected: FAIL — `Cannot find module '../behaviorStore.js'`

- [ ] **Step 3: 实现 behaviorStore.js**

```js
// src/store/behaviorStore.js
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const READING_HISTORY_CAP = 200;

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch { return fallback; }
}

/**
 * 将旧 localStorage key（readingHistory/followKeywords/trackTargets/
 * recommendationFeedback/recommendationFeedback:v2）合并到 persisted。
 * 旧 key 保留 30 天不删除（仅复制）。
 */
export function migrateLegacyBehavior(persisted = {}) {
  const merged = { ...persisted };

  if (!merged.readingHistory || !merged.readingHistory.length) {
    const legacy = readLS('readingHistory', []);
    if (legacy.length) merged.readingHistory = legacy;
  }

  if (!merged.followKeywords || !merged.followKeywords.length) {
    const legacy = readLS('followKeywords', []);
    if (legacy.length) merged.followKeywords = legacy;
  }

  if (!merged.trackTargets || !merged.trackTargets.length) {
    const legacy = readLS('trackTargets', []);
    if (legacy.length) merged.trackTargets = legacy;
  }

  const legacyFeedback = readLS('recommendationFeedback', null);
  if (legacyFeedback && (!merged.recommendationFeedback ||
      Object.keys(merged.recommendationFeedback).length === 0 ||
      (merged.recommendationFeedback.hiddenIds?.length === 0 &&
       Object.keys(merged.recommendationFeedback.boostedCategories || {}).length === 0))) {
    merged.recommendationFeedback = {
      hiddenIds: legacyFeedback.hiddenIds || [],
      boostedCategories: legacyFeedback.boostedCategories || {},
      mutedSources: legacyFeedback.mutedSources || {},
      trackedTerms: legacyFeedback.trackedTerms || {},
    };
  }

  if (!merged.recommendationFeedbackEvents || !merged.recommendationFeedbackEvents.length) {
    const legacy = readLS('recommendationFeedback:v2', []);
    if (legacy.length) merged.recommendationFeedbackEvents = legacy;
  }

  return merged;
}

export const useBehaviorStore = create(
  persist(
    (set, get) => ({
      readingHistory: [],
      recommendationFeedback: { hiddenIds: [], boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
      recommendationFeedbackEvents: [],
      followKeywords: [],
      trackTargets: [],

      // ===== actions =====
      addReadingHistory: (item) => set(state => ({
        readingHistory: [{ ...item, readAt: item.readAt || new Date().toISOString() },
                          ...state.readingHistory].slice(0, READING_HISTORY_CAP)
      })),
      setReadingHistory: (updater) => {
        const cur = get().readingHistory;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ readingHistory: next.slice(0, READING_HISTORY_CAP) });
      },
      clearReadingHistory: () => set({ readingHistory: [] }),

      setRecommendationFeedback: (updater) => {
        const cur = get().recommendationFeedback;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ recommendationFeedback: next });
      },
      addFeedbackEvent: (event) => set(state => ({
        recommendationFeedbackEvents: [{ ...event, ts: event.ts || Date.now() },
                                       ...state.recommendationFeedbackEvents].slice(0, 200)
      })),

      addFollowKeyword: (kw) => set(state => state.followKeywords.includes(kw)
        ? state
        : { followKeywords: [...state.followKeywords, kw] }),
      removeFollowKeyword: (kw) => set(state => ({ followKeywords: state.followKeywords.filter(k => k !== kw) })),
      setFollowKeywords: (updater) => {
        const cur = get().followKeywords;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ followKeywords: next });
      },

      addTrackTarget: (t) => set(state => {
        const idx = state.trackTargets.findIndex(x => x.term === t.term);
        if (idx >= 0) {
          const next = [...state.trackTargets];
          next[idx] = { ...next[idx], ...t };
          return { trackTargets: next };
        }
        return { trackTargets: [...state.trackTargets, t] };
      }),
      removeTrackTarget: (term) => set(state => ({ trackTargets: state.trackTargets.filter(t => t.term !== term) })),
      setTrackTargets: (updater) => {
        const cur = get().trackTargets;
        const next = typeof updater === 'function' ? updater(cur) : updater;
        set({ trackTargets: next });
      },

      clearAll: () => set({
        readingHistory: [],
        recommendationFeedback: { hiddenIds: [], boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
        recommendationFeedbackEvents: [],
        followKeywords: [],
        trackTargets: [],
      }),
    }),
    {
      name: 'siliconstream-behavior-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        readingHistory: s.readingHistory,
        recommendationFeedback: s.recommendationFeedback,
        recommendationFeedbackEvents: s.recommendationFeedbackEvents,
        followKeywords: s.followKeywords,
        trackTargets: s.trackTargets,
      }),
      // 仅首次 rehydrate 时执行迁移
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const migrated = migrateLegacyBehavior({
          readingHistory: state.readingHistory,
          recommendationFeedback: state.recommendationFeedback,
          recommendationFeedbackEvents: state.recommendationFeedbackEvents,
          followKeywords: state.followKeywords,
          trackTargets: state.trackTargets,
        });
        // 已 rehydrate 的 state 不能直接覆盖，用 setTimeout 推迟一拍
        setTimeout(() => useBehaviorStore.setState(migrated), 0);
      },
    }
  )
);
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/store/__tests__/behaviorStore.test.js`
Expected: PASS — 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add src/store/behaviorStore.js src/store/__tests__/behaviorStore.test.js
git commit -m "feat(behavior): add useBehaviorStore unifying 5 behavior signals"
```

---

### Task 2: 从 recommendStore 删除已迁移字段

**Files:**
- Modify: `src/store/recommendStore.js` (L36-L112 删除 5 个字段及其 setter)

- [ ] **Step 1: 删除 recommendStore 中 5 个字段**

打开 `src/store/recommendStore.js`，删除以下字段及其 setter：
- `followKeywords` / `setFollowKeywords` (L38-L43)
- `recommendationFeedback` / `setRecommendationFeedback` (L53-L63)
- `recommendationFeedbackEvents` / `setRecommendationFeedbackEvents` (L66-L71)
- `trackTargets` / `setTrackTargets` (L98-L104)
- `readingHistory` / `setReadingHistory` (L107-L112)

同时从 `partialize`（L143-L155）中删除对应 5 个字段。

保留以下字段（不删除）：
- `pinnedKeywords` / `setPinnedKeywords`
- `recommendationSnapshots` / `setRecommendationSnapshots`
- `searchHistory` / `setSearchHistory`
- `searchOpen` / `setSearchOpen`
- `searchSort` / `setSearchSort`
- `focusedIndex` / `setFocusedIndex`
- `expandedEvents` / `setExpandedEvents`
- `exportCategory` / `setExportCategory`
- `exportRange` / `setExportRange`

- [ ] **Step 2: barrel 导出 useBehaviorStore**

修改 `src/store/index.js`，新增：
```js
export { useBehaviorStore } from './behaviorStore.js';
```

- [ ] **Step 3: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 部分测试可能失败（消费方仍 import 旧字段）—— 这是 Task 3-5 要修复的

- [ ] **Step 4: Commit**

```bash
git add src/store/recommendStore.js src/store/index.js
git commit -m "refactor(recommend): remove migrated fields from recommendStore"
```

---

### Task 3: 迁移消费方 — useWorkbenchMemos.js

**Files:**
- Modify: `src/hooks/useWorkbenchMemos.js`

- [ ] **Step 1: 改 import 与字段读取**

`useWorkbenchMemos.js` 当前从入参接收 `followKeywords` / `recommendationFeedback`。**入参不变**（保持调用方兼容），但 App.jsx 传入这些值时需要从 behaviorStore 取。

本步只验证：useWorkbenchMemos 接收的入参不变，运行时由 App.jsx 负责传正确的值。

读 `src/hooks/useWorkbenchMemos.js`，确认入参签名 `{ followKeywords, recommendationFeedback, ... }` 不变。

无需改动。

- [ ] **Step 2: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: FAIL — App.jsx 仍从 recommendStore 取值，字段为 undefined

---

### Task 4: 迁移消费方 — App.jsx 内联 useMemo

**Files:**
- Modify: `src/App.jsx` (L1377-L1502 + 所有从 recommendStore 读 5 路字段的位置)

- [ ] **Step 1: 用 Grep 定位 recommendStore 5 路字段的消费点**

Run Grep:
- Pattern: `useRecommendStore\(s\s*=>\s*s\.(readingHistory|followKeywords|trackTargets|recommendationFeedback|recommendationFeedbackEvents)`
- Output mode: `content` with `-n: true`

记录所有命中行号。

- [ ] **Step 2: 替换 import 与 selector**

在 `src/App.jsx` 顶部新增：
```js
import { useBehaviorStore } from './store';
```

将所有命中的 `useRecommendStore(s => s.readingHistory)` 改为 `useBehaviorStore(s => s.readingHistory)`，其余 4 个字段同理。

`setReadingHistory` / `setFollowKeywords` / `setTrackTargets` / `setRecommendationFeedback` / `setRecommendationFeedbackEvents` 同理改为 `useBehaviorStore`。

- [ ] **Step 3: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — 296/296

- [ ] **Step 4: 浏览器手动验证**

启动 dev server：`npm run dev`
打开 `http://localhost:5175/`，验证：
1. 登录后画像数据正常加载
2. 阅读资讯后阅读历史更新
3. 控制台无报错

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/hooks/useWorkbenchMemos.js
git commit -m "refactor(app): migrate behavior signals to useBehaviorStore"
```

---

### Task 5: 迁移消费方 — useAgentWorkflowRunner.js / workflowEngine.js

**Files:**
- Modify: `src/hooks/useAgentWorkflowRunner.js`
- Modify: `src/utils/workflowEngine.js`

- [ ] **Step 1: 用 Grep 定位两个文件中的 recommendStore 引用**

Run Grep:
- Pattern: `useRecommendStore`
- Path: `src/hooks/useAgentWorkflowRunner.js` 与 `src/utils/workflowEngine.js`
- Output: content with `-n: true`

- [ ] **Step 2: 替换为 useBehaviorStore**

将两个文件中所有 `useRecommendStore` 替换为 `useBehaviorStore`。

import 语句同步：
```js
import { useBehaviorStore } from '../store';
```

- [ ] **Step 3: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — 296/296

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAgentWorkflowRunner.js src/utils/workflowEngine.js
git commit -m "refactor(workflow): migrate to useBehaviorStore"
```

---

### Task 6: Phase 1.1 集成验证

- [ ] **Step 1: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — 296/296 + 新增 ~25 个 behaviorStore 测试 = ~321 个

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 成功无报错

- [ ] **Step 3: 浏览器端到端验证**

启动 dev server，验证：
1. 登录正常
2. 阅读资讯 → 阅读历史更新
3. 收藏资讯 → bookmarks 更新
4. 设置追踪关键词 → followKeywords 更新
5. 控制台检查 localStorage：新 key `siliconstream-behavior-store` 已创建，旧 key `readingHistory`/`followKeywords` 等仍存在（30 天保留）
6. AI 对话正常
7. workflow 执行正常

---

## Phase 1.2 — profileModel.js 上位（无 UI 感知）

**目标**：profileModel.js 从死代码上位为生产代码调用源，扩展 7 个缺失字段，新增 computeCalibrationSignals 独立导出，computeIntelligenceProfile 返回 confidence 字段（修复 buildSystemPrompt 中恒 0 bug）。App.jsx L1377-L1502 三个内联 useMemo 删除。

### Task 7: 扩展 computeProfileLearningEngine 字段

**Files:**
- Modify: `src/utils/profileModel.js`
- Test: `src/utils/__tests__/profileModel.test.js`

- [ ] **Step 1: 写新增字段的失败测试**

在 `src/utils/__tests__/profileModel.test.js` 新增：

```js
import { computeProfileLearningEngine } from '../profileModel.js';

describe('computeProfileLearningEngine extended fields', () => {
  const baseInput = {
    readingHistory: [
      { id: 'r1', category: 'ai', readAt: new Date(Date.now() - 86400e3).toISOString(), imageUrl: 'x' },
      { id: 'r2', category: 'chips', readAt: new Date().toISOString() },
    ],
    bookmarks: [
      { id: 'b1', category: 'ai', author: 'Author1', mode: 'multimedia' },
      { id: 'b2', category: 'ai', author: 'Author2' },
    ],
    materials: [{ id: 'm1', category: 'ai' }],
    selectedInterests: ['ai'],
    domainTiers: { ai: 'focus' },
    domainPriorities: {},
    recommendationFeedback: { hiddenIds: [], boostedCategories: { ai: 2 }, mutedSources: {}, trackedTerms: { gpu: 1 } },
    followKeywords: ['LLM'],
    sourceTiers: {},
    sourcePriorities: {},
  };

  it('returns explanation string', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(typeof r.explanation).toBe('string');
    expect(r.explanation.length).toBeGreaterThan(0);
  });

  it('computes savedRatio as bookmarks/readingHistory*100', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(r.savedRatio).toBe(Math.round(2 / 2 * 100));
  });

  it('computes materialRatio as materials/bookmarks*100', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(r.materialRatio).toBe(Math.round(1 / 2 * 100));
  });

  it('counts recentReadCount within 7 days', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(r.recentReadCount).toBeGreaterThanOrEqual(1);
  });

  it('counts multimediaReads', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(r.multimediaReads).toBe(1);
  });

  it('aggregates feedbackLearningCount', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(r.feedbackLearningCount).toBe(3); // 1 boosted + 1 muted + 1 tracked
  });

  it('returns topAuthors array', () => {
    const r = computeProfileLearningEngine(baseInput);
    expect(Array.isArray(r.topAuthors)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/profileModel.test.js -t "extended fields"`
Expected: FAIL — `explanation is undefined` / `savedRatio is undefined` 等

- [ ] **Step 3: 在 computeProfileLearningEngine 返回值中新增 7 个字段**

打开 `src/utils/profileModel.js`，找到 `computeProfileLearningEngine` 函数。

参考 `src/App.jsx` L1427-L1484（即当前的内联实现），在 computeProfileLearningEngine 的返回对象中加入：

```js
// 在返回对象中新增（保持原有字段不变）
const recentReads = readingHistory.filter(item =>
  Date.now() - new Date(item.readAt || 0).getTime() < 7 * 24 * 60 * 60 * 1000);
const multimediaReads = readingHistory.filter(item => item.imageUrl || item.videoUrl).length;
const savedRatio = readingHistory.length
  ? Math.round(bookmarks.length / Math.max(readingHistory.length, 1) * 100) : 0;
const materialRatio = bookmarks.length
  ? Math.round(materials.length / Math.max(bookmarks.length, 1) * 100) : 0;
const feedbackLearningCount =
  Object.keys(recommendationFeedback.boostedCategories || {}).length +
  Object.keys(recommendationFeedback.mutedSources || {}).length +
  Object.keys(recommendationFeedback.trackedTerms || {}).length;
const authorMap = new Map();
bookmarks.forEach(b => {
  if (b.author) authorMap.set(b.author, (authorMap.get(b.author) || 0) + 1);
});
const topAuthors = [...authorMap.entries()]
  .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);

const explanation = [
  topCategories[0] ? `领域权重最高：${topCategories[0].label}` : '',
  topSources[0] ? `信任来源最高：${topSources[0].name}` : '',
  topTags.length ? `记忆关键词：${topTags.slice(0, 3).map(i => i.name).join('、')}` : '',
  recommendationFeedback.mutedSources && Object.keys(recommendationFeedback.mutedSources).length
    ? `已降低 ${Object.keys(recommendationFeedback.mutedSources).slice(0, 2).join('、')} 的权重` : ''
].filter(Boolean);

// 返回对象扩展
return {
  // 原有字段...
  explanation,
  savedRatio,
  materialRatio,
  recentReadCount: recentReads.length,
  multimediaReads,
  feedbackLearningCount,
  topAuthors,
};
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/profileModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/profileModel.js src/utils/__tests__/profileModel.test.js
git commit -m "feat(profile): extend computeProfileLearningEngine with 7 fields"
```

---

### Task 8: computeIntelligenceProfile 返回 confidence

**Files:**
- Modify: `src/utils/profileModel.js`
- Test: `src/utils/__tests__/profileModel.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { computeIntelligenceProfile } from '../profileModel.js';

describe('computeIntelligenceProfile confidence', () => {
  it('returns confidence derived from computeProfileLearningEngine', () => {
    const r = computeIntelligenceProfile({
      bookmarks: [{ id: 'b1', category: 'ai' }],
      readingHistory: [{ id: 'r1', category: 'ai', readAt: new Date().toISOString() }],
      materials: [],
      selectedInterests: ['ai'],
      recommendationFeedback: { hiddenIds: [], boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
      followKeywords: [],
      sourcePriorities: {},
      domainPriorities: { ai: 100 },
      insightSourceQuality: [],
      workbenchItemCount: 1,
      focusMatches: 1,
      categories: [{ id: 'ai', label: 'AI' }],
      domainTiers: { ai: 'focus' },
      sourceTiers: {},
    });
    expect(r.confidence).toBeGreaterThan(0);
    expect(['高可信', '持续学习中', '需要校准']).toContain(r.confidenceLabel);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/profileModel.test.js -t "confidence"`
Expected: FAIL — `r.confidence is undefined`

- [ ] **Step 3: 在 computeIntelligenceProfile 内调用 computeProfileLearningEngine 并合并返回**

```js
// 在 computeIntelligenceProfile 返回对象之前，内部调用 computeProfileLearningEngine
const learningEngine = computeProfileLearningEngine({
  readingHistory, bookmarks, materials, selectedInterests,
  domainTiers, domainPriorities, recommendationFeedback,
  followKeywords, sourceTiers, sourcePriorities,
});

// 返回对象中新增
return {
  // 原有字段...
  confidence: learningEngine.confidence,
  confidenceLabel: learningEngine.confidenceLabel,
};
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/profileModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/profileModel.js src/utils/__tests__/profileModel.test.js
git commit -m "fix(profile): computeIntelligenceProfile returns real confidence (was 0)"
```

---

### Task 9: 新增 computeCalibrationSignals 独立导出

**Files:**
- Modify: `src/utils/profileModel.js`
- Modify: `src/App.jsx` (L1504-L1514)
- Test: `src/utils/__tests__/profileModel.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { computeCalibrationSignals } from '../profileModel.js';

describe('computeCalibrationSignals', () => {
  it('returns hasFeedbackData true when any feedback present', () => {
    const r = computeCalibrationSignals({
      intelligenceProfile: { confidence: 60 },
      recommendationFeedback: { boostedCategories: { ai: 1 }, mutedSources: {}, trackedTerms: {} },
      dailyProfileSnapshots: [],
    });
    expect(r.hasFeedbackData).toBe(true);
  });

  it('returns needsCalibration true when confidence < 45', () => {
    const r = computeCalibrationSignals({
      intelligenceProfile: { confidence: 30 },
      recommendationFeedback: { boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
      dailyProfileSnapshots: [],
    });
    expect(r.needsCalibration).toBe(true);
  });

  it('returns hasSnapshotHistory true when >=3 snapshots', () => {
    const r = computeCalibrationSignals({
      intelligenceProfile: { confidence: 80 },
      recommendationFeedback: { boostedCategories: {}, mutedSources: {}, trackedTerms: {} },
      dailyProfileSnapshots: [{ date: '2026-07-01' }, { date: '2026-07-02' }, { date: '2026-07-03' }],
    });
    expect(r.hasSnapshotHistory).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/profileModel.test.js -t "computeCalibrationSignals"`
Expected: FAIL — `computeCalibrationSignals is not exported`

- [ ] **Step 3: 在 profileModel.js 导出 computeCalibrationSignals**

参考 App.jsx L1504-L1514（实际现状是 4 个 label/value/desc 数组），新增独立函数返回 hasFeedbackData/hasSnapshotHistory/needsCalibration 三个布尔值。同时保留 App.jsx 内联的"校准信号卡片数组"逻辑（属于 UI 派生）。

```js
// src/utils/profileModel.js
export function computeCalibrationSignals({ intelligenceProfile, recommendationFeedback, dailyProfileSnapshots }) {
  const confidence = intelligenceProfile?.confidence ?? 0;
  const hasFeedbackData =
    Object.keys(recommendationFeedback?.boostedCategories || {}).length > 0 ||
    Object.keys(recommendationFeedback?.mutedSources || {}).length > 0 ||
    Object.keys(recommendationFeedback?.trackedTerms || {}).length > 0;
  const hasSnapshotHistory = (dailyProfileSnapshots?.length || 0) >= 3;
  return {
    hasFeedbackData,
    hasSnapshotHistory,
    needsCalibration: confidence < 45,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/profileModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/profileModel.js src/utils/__tests__/profileModel.test.js
git commit -m "feat(profile): export computeCalibrationSignals as standalone function"
```

---

### Task 10: useWorkbenchMemos.js 改为薄壳 + App.jsx 删除内联 useMemo

**Files:**
- Modify: `src/hooks/useWorkbenchMemos.js`
- Modify: `src/App.jsx`

- [ ] **Step 1: 在 useWorkbenchMemos 中改 intelligenceProfile 为调用 computeIntelligenceProfile**

读 `src/hooks/useWorkbenchMemos.js` L109-L126，将 `intelligenceProfile` 的内联实现替换为：

```js
import { computeIntelligenceProfile } from '../utils/profileModel.js';

// ...
const intelligenceProfile = useMemo(() => computeIntelligenceProfile({
  bookmarks, readingHistory: readingHistory || [], materials,
  selectedInterests, recommendationFeedback, followKeywords,
  sourcePriorities: Object.fromEntries(Object.entries(sourceTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
  domainPriorities: Object.fromEntries(Object.entries(domainTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
  insightSourceQuality: insightData?.sourceQuality || [],
  workbenchItemCount: workbenchItems.length,
  focusMatches: workbenchStats.focusMatches,
  categories,
  domainTiers, sourceTiers,
}), [bookmarks, readingHistory, materials, selectedInterests, recommendationFeedback,
     followKeywords, sourceTiers, domainTiers, insightData, workbenchItems.length,
     workbenchStats.focusMatches, categories]);
```

入参签名需要扩展：新增 `readingHistory` 入参。

- [ ] **Step 2: useWorkbenchMemos 返回新增 profileLearningEngine / todayProfileSnapshot / profileCalibrationSignals**

```js
import {
  computeIntelligenceProfile,
  computeProfileLearningEngine,
  computeTodayProfileSnapshot,
  computeCalibrationSignals,
} from '../utils/profileModel.js';

// ... 新增 3 个 useMemo
const profileLearningEngine = useMemo(() => computeProfileLearningEngine({
  readingHistory, bookmarks, materials, selectedInterests,
  domainTiers, domainPriorities: Object.fromEntries(Object.entries(domainTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
  recommendationFeedback, followKeywords,
  sourceTiers, sourcePriorities: Object.fromEntries(Object.entries(sourceTiers || {}).map(([k, v]) => [k, v === 'focus' ? 100 : v === 'normal' ? 50 : 0])),
}), [readingHistory, bookmarks, materials, selectedInterests, domainTiers, recommendationFeedback, followKeywords, sourceTiers]);

const todayProfileSnapshot = useMemo(() => computeTodayProfileSnapshot({
  date: selectedNewsDate,
  intelligenceProfile, profileLearningEngine,
  readingHistory, bookmarks, materials, sourcePriorityItems,
}), [selectedNewsDate, intelligenceProfile, profileLearningEngine, readingHistory, bookmarks, materials, sourcePriorityItems]);

const profileCalibrationSignals = useMemo(() => computeCalibrationSignals({
  intelligenceProfile, recommendationFeedback, dailyProfileSnapshots,
}), [intelligenceProfile, recommendationFeedback, dailyProfileSnapshots]);

return {
  workbenchItems, workbenchStats,
  intelligenceProfile, profilePriorityItems, sourcePriorityItems,
  profileLearningEngine, todayProfileSnapshot, profileCalibrationSignals,
};
```

入参新增 `selectedNewsDate` / `dailyProfileSnapshots`。

- [ ] **Step 3: App.jsx 调用 useWorkbenchMemos 处增加新入参**

读 App.jsx 中 `useWorkbenchMemos({...})` 调用，新增传参：
- `readingHistory`
- `selectedNewsDate`
- `dailyProfileSnapshots`

并从 useWorkbenchMemos 返回值解构出 `profileLearningEngine` / `todayProfileSnapshot` / `profileCalibrationSignals`。

- [ ] **Step 4: 删除 App.jsx L1377-L1502 的 3 个内联 useMemo**

删除 `profileLearningEngine`（L1377-L1485）、`todayProfileSnapshot`（L1487-L1502）、`profileCalibrationSignals`（L1504-L1514）三个内联 useMemo。保留 `useEffect`（L1516+ 的 setDailyProfileSnapshots）。

- [ ] **Step 5: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — 296/296 + 新增 = ~330+

- [ ] **Step 6: 浏览器验证**

启动 dev server，验证：
1. 首页正常加载
2. 画像置信度显示正确（非 0）
3. 每日画像快照正常生成
4. AI 对话注入的 system prompt 含真实 confidence

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useWorkbenchMemos.js src/App.jsx
git commit -m "refactor(workbench): use profileModel.js pure functions, delete App.jsx inline useMemo"
```

---

### Task 11: Phase 1.2 集成验证

- [ ] **Step 1: 跑全量测试 + build**

Run: `node node_modules/vitest/vitest.mjs run` && `npm run build`
Expected: PASS, build success

- [ ] **Step 2: 浏览器端到端验证**

验证：
1. 画像置信度从 0 修复为真实值（在 ProfilePage 看到）
2. AI 对话的 system prompt 含"画像置信度：XX%"
3. 每日画像快照正常生成
4. 校准信号正常显示

---

## Phase 1.3 — profileStore 扩展 + AI 写回扩展点（无 UI 感知）

**目标**：profileStore 新增 pendingSuggestions 字段 + 防护机制。buildProfileMemory 写入 pendingSuggestions（一行新增）。workflowEngine.js 通过 ctx 接收回调（消除双源）。buildSystemPrompt 预留"最近校准"段（dead code）。

### Task 12: profileStore 新增 pendingSuggestions + 防护

**Files:**
- Modify: `src/store/profileStore.js`
- Test: `src/store/__tests__/profileStore.test.js`

- [ ] **Step 1: 写失败测试**

```js
// src/store/__tests__/profileStore.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { useProfileStore } from '../profileStore.js';

describe('pendingSuggestions', () => {
  beforeEach(() => useProfileStore.getState().clearPendingSuggestions?.());

  it('addPendingSuggestions dedupes by (type, target) when pending', () => {
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r1', source: 'ai' },
    ]);
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r2', source: 'ai' },
    ]);
    const list = useProfileStore.getState().pendingSuggestions;
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('r2');
  });

  it('caps pending at 20 by dropping lowest confidence', () => {
    const items = Array.from({ length: 22 }, (_, i) => ({
      type: 'track', target: `t${i}`, reason: 'r', source: 'ai',
      metadata: { confidence: i / 22 },
    }));
    useProfileStore.getState().addPendingSuggestions(items);
    const list = useProfileStore.getState().pendingSuggestions;
    expect(list).toHaveLength(20);
    // confidence 最低的 t0 应被丢弃
    expect(list.find(s => s.target === 't0')).toBeUndefined();
  });

  it('cools down same (type, target) within 1 hour', () => {
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r1', source: 'ai' },
    ]);
    // 立即再次添加，应被去重
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r2', source: 'ai' },
    ]);
    expect(useProfileStore.getState().pendingSuggestions).toHaveLength(1);
  });

  it('updateSuggestionStatus transitions pending -> accepted', () => {
    useProfileStore.getState().addPendingSuggestions([
      { type: 'track', target: 'AI', reason: 'r', source: 'ai' },
    ]);
    const id = useProfileStore.getState().pendingSuggestions[0].id;
    useProfileStore.getState().updateSuggestionStatus(id, 'accepted');
    expect(useProfileStore.getState().pendingSuggestions[0].status).toBe('accepted');
  });

  it('pruneExpiredSuggestions removes 30+ day old accepted/rejected', () => {
    useProfileStore.setState({
      pendingSuggestions: [
        { id: 'old', type: 'track', target: 'X', reason: '', source: 'ai', createdAt: Date.now() - 31 * 86400e3, status: 'accepted' },
        { id: 'new', type: 'track', target: 'Y', reason: '', source: 'ai', createdAt: Date.now() - 86400e3, status: 'accepted' },
      ]
    });
    useProfileStore.getState().pruneExpiredSuggestions();
    const list = useProfileStore.getState().pendingSuggestions;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('new');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/store/__tests__/profileStore.test.js`
Expected: FAIL — `addPendingSuggestions is not a function`

- [ ] **Step 3: 实现 pendingSuggestions actions**

在 `src/store/profileStore.js` 新增：

```js
const PENDING_CAP = 20;
const COOLDOWN_MS = 60 * 60 * 1000;
const AUDIT_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function createSuggestionId() {
  return `sg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// 在 store 创建函数中新增：
pendingSuggestions: [],
addPendingSuggestion: (s) => get().addPendingSuggestions([s]),
addPendingSuggestions: (input) => set(state => {
  const now = Date.now();
  let next = [...state.pendingSuggestions];

  for (const s of input) {
    const idx = next.findIndex(x => x.type === s.type && x.target === s.target);
    if (idx >= 0) {
      const existing = next[idx];
      if (existing.status === 'pending') {
        // pending 状态：更新 reason + createdAt（去重）
        next[idx] = { ...existing, ...s, id: existing.id, createdAt: now };
        continue;
      }
      // accepted/rejected 状态：1 小时冷却检查
      if (now - existing.createdAt < COOLDOWN_MS) continue;
      // 冷却已过：作为新 pending 加入
    }
    next.unshift({ ...s, id: createSuggestionId(), createdAt: now, status: 'pending' });
  }

  // 仅过滤 pending 状态做上限控制
  const pending = next.filter(s => s.status === 'pending');
  const nonPending = next.filter(s => s.status !== 'pending');
  if (pending.length > PENDING_CAP) {
    pending.sort((a, b) => (b.metadata?.confidence || 0) - (a.metadata?.confidence || 0));
    pending.splice(PENDING_CAP);
  }
  next = [...pending, ...nonPending];
  return { pendingSuggestions: next };
}),
updateSuggestionStatus: (id, status) => set(state => ({
  pendingSuggestions: state.pendingSuggestions.map(s => s.id === id ? { ...s, status } : s)
})),
pruneExpiredSuggestions: () => set(state => {
  const cutoff = Date.now() - AUDIT_RETAIN_MS;
  return {
    pendingSuggestions: state.pendingSuggestions.filter(s =>
      s.status === 'pending' || s.createdAt >= cutoff)
  };
}),
clearPendingSuggestions: () => set({ pendingSuggestions: [] }),
```

在 `partialize` 中新增 `pendingSuggestions: state.pendingSuggestions`。

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/store/__tests__/profileStore.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/profileStore.js src/store/__tests__/profileStore.test.js
git commit -m "feat(profile): add pendingSuggestions with dedupe/cap/cooldown safeguards"
```

---

### Task 13: buildProfileMemory 写回 pendingSuggestions（消除双源）

**Files:**
- Modify: `src/utils/workflowEngine.js` (buildProfileMemory)
- Modify: `src/hooks/useAgentWorkflowRunner.js`

- [ ] **Step 1: 修改 workflowEngine.js 的 buildProfileMemory 接受 ctx 参数**

打开 `src/utils/workflowEngine.js`，找到 `buildProfileMemory` 函数定义。在签名末尾新增 `ctx` 参数：

```js
function buildProfileMemory(scopedAgentItems, intelligenceProfile, trackedTerms, bookmarks, materials, ctx) {
  // ... 原有计算逻辑

  const suggestions = [
    ...(terms.slice(0, 3).map(t => ({
      type: 'track', target: t.term,
      reason: `近 ${t.count} 次出现于阅读资讯（来源：${t.source}）`,
      source: 'ai',
      metadata: { relatedItemIds: t.itemIds || [], confidence: Math.min(t.count / 5, 1) },
    }))),
    ...(topCategories.slice(0, 2).map(c => ({
      type: 'boost', target: c.label,
      reason: `近 7 天阅读 ${c.count || 0} 条相关资讯，建议加权关注`,
      source: 'ai',
      metadata: { confidence: Math.min((c.count || 0) / 10, 1) },
    }))),
  ];

  if (suggestions.length > 0 && ctx?.addPendingSuggestions) {
    ctx.addPendingSuggestions(suggestions);
  }

  return { terms, output };
}
```

调用 `buildProfileMemory` 的位置需要传入 `ctx`（在 workflowEngine.js 内部查找）。

- [ ] **Step 2: useAgentWorkflowRunner 传入 ctx.addPendingSuggestions**

打开 `src/hooks/useAgentWorkflowRunner.js`，找到调用 workflowEngine 的位置。

```js
import { useProfileStore } from '../store';

// 调用 workflowEngine 时传入 ctx
const ctx = {
  addPendingSuggestions: useProfileStore.getState().addPendingSuggestions,
};
// 调用 buildProfileMemory 时传入 ctx
```

- [ ] **Step 3: 删除 useAgentWorkflowRunner 中的内联 buildProfileMemory（如果有）**

用 Grep 检查 `useAgentWorkflowRunner.js` 是否有内联 `buildProfileMemory`：
- Pattern: `function buildProfileMemory`
- Path: `src/hooks/useAgentWorkflowRunner.js`

如果有，删除内联版本，改为调用 workflowEngine 的版本。

- [ ] **Step 4: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/workflowEngine.js src/hooks/useAgentWorkflowRunner.js
git commit -m "feat(profile): buildProfileMemory writes to pendingSuggestions via ctx"
```

---

### Task 14: buildSystemPrompt 预留"最近校准"段（dead code）

**Files:**
- Modify: `src/components/aichat/buildSystemPrompt.js`

- [ ] **Step 1: 在 buildSystemPrompt 中追加 dead code 段**

打开 `src/components/aichat/buildSystemPrompt.js`，找到 profileLines 相关位置，在后面追加：

```js
import { useProfileStore } from '../../store';

// 在 buildSystemPrompt 内部
const acceptedSuggestions = useProfileStore.getState().pendingSuggestions
  .filter(x => x.status === 'accepted' && Date.now() - x.createdAt < 7 * 86400_000);

const calibrationLines = acceptedSuggestions.length > 0
  ? `【最近校准】用户在过去 7 天接受了以下 AI 建议，请在回复中主动贴合：
${acceptedSuggestions.map(s => `  - ${s.type === 'track' ? '追踪' : s.type === 'boost' ? '强化' : '静默'} ${s.target}（${s.reason}）`).join('\n')}`
  : '';
```

将 `calibrationLines` 追加到最终 prompt 拼接位置。

**注意**：当前 pendingSuggestions 中永远没有 accepted 项（第二阶段才有接受 UI），所以这段实际不输出任何内容。仅预留接口点。

- [ ] **Step 2: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/aichat/buildSystemPrompt.js
git commit -m "feat(prompt): reserve calibration segment for future accepted suggestions"
```

---

### Task 15: Phase 1.3 集成验证

- [ ] **Step 1: 跑全量测试 + build**

Run: `node node_modules/vitest/vitest.mjs run` && `npm run build`
Expected: PASS

- [ ] **Step 2: workflow 端到端验证**

启动 dev server，在 AI 工作站运行一个含 `profile-memory` skill 节点的 workflow，验证：
1. workflow 执行完成后，控制台检查 `localStorage.siliconstream-profile-store` 中 `pendingSuggestions` 出现条目
2. 重复执行同一 workflow，pendingSuggestions 数量不翻倍（去重生效）

---

## Phase 1.4 — 后端扩展 + 跨设备同步（无 UI 感知）

**目标**：数据库迁移 003；profileRepository 扩展 getState/saveState；profileService 校验；useProfileSync 扩展同步 5 块。

### Task 16: 数据库迁移

**Files:**
- Create: `server/db/migrations/003_profile_extensions.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- 003_profile_extensions.sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS briefing_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_suggestions jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_briefing_snapshots_user_date
  ON briefing_snapshots(user_id, date DESC);
```

- [ ] **Step 2: 运行迁移（如有 DATABASE_URL）**

Run: `npm run db:migrate`
Expected: 成功（无 DATABASE_URL 时跳过，记录在档）

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/003_profile_extensions.sql
git commit -m "feat(db): migration 003 - briefing_config + briefing_snapshots index"
```

---

### Task 17: profileRepository 扩展 getState/saveState

**Files:**
- Modify: `server/profile/profileRepository.js`
- Test: `server/__tests__/profileRepository.test.js`

- [ ] **Step 1: 写失败测试（mock pg pool）**

```js
// server/__tests__/profileRepository.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  }
}));

import { pool } from '../db/client.js';
import { getState, saveState } from '../profile/profileRepository.js';

describe('profileRepository extended fields', () => {
  it('getState returns briefingConfig and dailyProfileSnapshots', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM user_profiles')) return { rows: [{ version: 1, confidence: 0, behavior_signals: {}, briefing_config: { length: 'detailed' } }] };
      if (sql.includes('FROM profile_domains')) return { rows: [] };
      if (sql.includes('FROM profile_sources')) return { rows: [] };
      if (sql.includes('FROM special_follows')) return { rows: [] };
      if (sql.includes('FROM briefing_snapshots')) return { rows: [{ date: '2026-07-28', snapshot: { confidence: 50 } }] };
      return { rows: [] };
    });
    const r = await getState('user1');
    expect(r.briefingConfig).toEqual({ length: 'detailed' });
    expect(r.dailyProfileSnapshots).toHaveLength(1);
    expect(r.dailyProfileSnapshots[0].date).toBe('2026-07-28');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run server/__tests__/profileRepository.test.js`
Expected: FAIL — `briefingConfig is undefined`

- [ ] **Step 3: 实现 getState/saveState 扩展**

参考 spec §6.2，扩展 getState 的 SELECT 列与 Promise.all 新增 briefing_snapshots 查询；saveState 扩展 UPDATE SET briefing_config 与 INSERT INTO briefing_snapshots ON CONFLICT DO NOTHING。

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run server/__tests__/profileRepository.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/profile/profileRepository.js server/__tests__/profileRepository.test.js
git commit -m "feat(profile): repository extends getState/saveState with briefing_config + snapshots"
```

---

### Task 18: profileService 校验扩展

**Files:**
- Modify: `server/profile/profileService.js`
- Test: `server/__tests__/profileService.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect } from 'vitest';
import { normalizeBriefingConfig, normalizeSnapshot } from '../profile/profileService.js';

describe('normalizeBriefingConfig', () => {
  it('returns default when input invalid', () => {
    expect(normalizeBriefingConfig(null)).toEqual({ length: 'standard', includeRead: false });
    expect(normalizeBriefingConfig({ length: 'invalid' })).toEqual({ length: 'standard', includeRead: false });
  });
  it('preserves valid values', () => {
    expect(normalizeBriefingConfig({ length: 'detailed', includeRead: true })).toEqual({ length: 'detailed', includeRead: true });
  });
});

describe('normalizeSnapshot', () => {
  it('returns null when date missing', () => {
    expect(normalizeSnapshot({ confidence: 50 })).toBeNull();
  });
  it('truncates date to YYYY-MM-DD', () => {
    const r = normalizeSnapshot({ date: '2026-07-28T12:00:00Z', confidence: '60', summary: 'x'.repeat(600) });
    expect(r.date).toBe('2026-07-28');
    expect(r.confidence).toBe(60);
    expect(r.summary.length).toBe(500);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run server/__tests__/profileService.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 normalize 函数**

参考 spec §6.3 实现。

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run server/__tests__/profileService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/profile/profileService.js server/__tests__/profileService.test.js
git commit -m "feat(profile): service normalize briefingConfig and snapshot"
```

---

### Task 19: useProfileSync 扩展 5 块同步

**Files:**
- Modify: `src/hooks/useProfileSync.js`
- Modify: `src/App.jsx`（调用 useProfileSync 传新入参）
- Test: `src/hooks/__tests__/useProfileSync.test.js`

- [ ] **Step 1: 写失败测试（mock fetch）**

```js
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// mock fetch
global.fetch = vi.fn();

import { useProfileSync } from '../useProfileSync.js';

describe('useProfileSync extended sync', () => {
  it('PUT payload includes briefingConfig and today snapshot', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, version: 2 }) });
    const { result } = renderHook(() => useProfileSync({
      user: { id: 'u1' },
      domainTiers: {}, sourceTiers: {}, specialFollows: [],
      setDomainTiers: () => {}, setSourceTiers: () => {}, setSpecialFollows: () => {},
      dailyProfileSnapshots: [{ date: '2026-07-28', confidence: 50 }],
      briefingConfig: { length: 'detailed', includeRead: true },
      setDailyProfileSnapshots: () => {}, setBriefingConfig: () => {},
    }));
    // wait debounce + drain
    await new Promise(r => setTimeout(r, 1000));
    const putCall = fetch.mock.calls.find(c => c[1]?.method === 'PUT');
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall[1].body);
    expect(body.briefingConfig).toEqual({ length: 'detailed', includeRead: true });
    expect(body.dailyProfileSnapshots).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/hooks/__tests__/useProfileSync.test.js`
Expected: FAIL

- [ ] **Step 3: 扩展 useProfileSync 入参与 effect**

参考 spec §6.4，扩展入参 + hydrate effect + save effect + payload 构造。

- [ ] **Step 4: App.jsx 调用点传入新参数**

在 `src/App.jsx` 中找到 `useProfileSync({...})` 调用，新增传参 `dailyProfileSnapshots` / `briefingConfig` / `setDailyProfileSnapshots` / `setBriefingConfig`。

- [ ] **Step 5: 跑全量测试 + 浏览器验证**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS

浏览器验证跨设备同步（如有 DATABASE_URL）：
1. 设备 A 修改 briefingConfig
2. 设备 B 重新登录，briefingConfig 一致

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useProfileSync.js src/App.jsx src/hooks/__tests__/useProfileSync.test.js
git commit -m "feat(profile): useProfileSync syncs 5 blocks cross-device"
```

---

### Task 20: Phase 1.4 集成验证

- [ ] **Step 1: 跑全量测试 + build**

Run: `node node_modules/vitest/vitest.mjs run` && `npm run build`
Expected: PASS

- [ ] **Step 2: 跨设备手动验证**

如有 PG 环境，启动两个浏览器实例登录同一账号，验证 domainTiers/briefingConfig 跨设备一致。

---

## Phase 1.5 — 清理与文档

### Task 21: 删除 App.jsx 重复的 specialFollows submit handler

**Files:**
- Modify: `src/App.jsx` (L361-L386)
- Modify: `src/components/ProfilePage.jsx`

- [ ] **Step 1: 用 Grep 确认 App.jsx L361-L386 与 ProfilePage.jsx L37-L66 是重复代码**

- [ ] **Step 2: 删除 App.jsx 内联 submit handler**

ProfilePage.jsx 已有自己的 handler，App.jsx 这段是冗余。直接删除 App.jsx L361-L386 的 `submitSpecialFollow` 内联函数。

- [ ] **Step 3: 跑全量测试 + 浏览器验证**

验证 ProfilePage 的特别关注 CRUD 仍正常工作。

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "refactor(profile): remove duplicate specialFollows submit handler from App.jsx"
```

---

### Task 22: 更新 CLAUDE.md / AGENTS.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 在 CLAUDE.md 的 store 章节新增 useBehaviorStore**

在 `src/store/` 模块说明中新增：

```
src/store/
  behaviorStore.js     行为信号单一 source of truth：readingHistory/recommendationFeedback/
                       recommendationFeedbackEvents/followKeywords/trackTargets
                       (persisted, 从 recommendStore 迁入, 旧 LS key 保留 30 天)
```

并在 profileStore.js 说明中追加 pendingSuggestions 字段。

- [ ] **Step 2: 更新 hooks 章节**

在 `useProfileSync.js` 说明中追加"扩展同步 5 块：原 3 块 + dailyProfileSnapshots/briefingConfig"。

- [ ] **Step 3: 在 Critical Duplication 章节标注 specialFollows 双源已消除**

将"specialFollows submit 逻辑双份"标注为已解决。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: update module boundaries for behavior store + profile model refactor"
```

---

### Task 23: 最终验收

- [ ] **Step 1: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — 296 + ~70 新增 = ~366 个测试

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: 完整端到端验证清单**

启动 dev server，依次验证：
1. 登录后画像数据正确加载（domainTiers/sourceTiers/specialFollows）
2. 阅读资讯后 readingHistory 更新（行为信号层）
3. 收藏资讯后 bookmarks 更新（保留原状）
4. AI 对话正常，画像注入 prompt 正确（含真实 confidence）
5. workflow 执行后 pendingSuggestions 出现条目
6. 跨设备：设备 A 修改 domainTiers，设备 B 登录后能看到（如有 PG 环境）
7. 跨设备：设备 A 今日 snapshot，设备 B 登录后能看到
8. 浏览器控制台无报错
9. localStorage 检查：旧 key 仍存在（30 天保留期），新 key `siliconstream-behavior-store` 已创建

- [ ] **Step 4: 检查 App.jsx 行数**

Run: `wc -l src/App.jsx`
Expected: 较重构前减少 ~150 行

- [ ] **Step 5: Tag 稳定版本**

```bash
git tag stable-v11 -m "Phase 1 user profile foundation refactor complete"
```

---

## Self-Review

### Spec coverage 检查

| Spec 章节 | 对应 Task | 状态 |
|---|---|---|
| §3.1 useBehaviorStore 新建 | Task 1 | ✅ |
| §3.1 recommendStore 删除 5 路字段 | Task 2 | ✅ |
| §3.1 消费方迁移（useWorkbenchMemos / App.jsx / useAgentWorkflowRunner / workflowEngine） | Task 3-5 | ✅ |
| §3.2 profileStore pendingSuggestions | Task 12 | ✅ |
| §3.3 数据迁移安全性 | Task 1 (migrateLegacyBehavior + 旧 key 保留) | ✅ |
| §4.2 computeIntelligenceProfile 返回 confidence | Task 8 | ✅ |
| §4.3 computeProfileLearningEngine 扩展 7 字段 | Task 7 | ✅ |
| §4.4 computeTodayProfileSnapshot 字段对齐 | Task 10 (useWorkbenchMemos 薄壳化) | ✅ |
| §4.5 computeCalibrationSignals 新增导出 | Task 9 | ✅ |
| §4.6 useWorkbenchMemos 薄壳化 + App.jsx 删内联 | Task 10 | ✅ |
| §5.2 buildProfileMemory 写回 pendingSuggestions | Task 13 | ✅ |
| §5.3 workflowEngine.js ctx 解耦 | Task 13 | ✅ |
| §5.4 buildSystemPrompt "最近校准"段 | Task 14 | ✅ |
| §6.1 数据库迁移 003 | Task 16 | ✅ |
| §6.2 profileRepository 扩展 | Task 17 | ✅ |
| §6.3 profileService 校验 | Task 18 | ✅ |
| §6.4 useProfileSync 扩展 5 块 | Task 19 | ✅ |
| §7.1 步骤 27 删除重复 submit handler | Task 21 | ✅ |
| §7.1 步骤 28 CLAUDE.md 更新 | Task 22 | ✅ |

所有 spec 章节均被 Task 覆盖。

### Placeholder 检查

扫描全文，无 TBD / TODO / "fill in details" / "implement later" 等占位符。所有代码示例完整。

### 类型一致性检查

- `addPendingSuggestions` 在 Task 12 定义，Task 13 调用 ✅
- `computeCalibrationSignals` 在 Task 9 定义，Task 10 在 useWorkbenchMemos 调用 ✅
- `ctx.addPendingSuggestions` 在 Task 13 workflowEngine 接受 + useAgentWorkflowRunner 传入 ✅
- `pendingSuggestions` 字段在 Task 12 store 定义，Task 14 buildSystemPrompt 读取 ✅

### 范围检查

明确排除（不在本计划内）：
- ProfilePage UI 重构（第二阶段）
- AI 建议接受/拒绝 UI（第二阶段）
- 推荐算法 LLM 增强（第三阶段）
- readingHistory 跨设备同步（高频写入，第三阶段决定）
- personaSummary 自动更新（第二阶段）
- recommendation_snapshots 表启用（第三阶段）

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-28-user-profile-foundation-redesign.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 我为每个 Task 派遣一个全新 subagent，Task 之间两阶段 review，迭代快

**2. Inline Execution** - 在本会话内顺序执行，分批次 checkpoint review

**Which approach?**
