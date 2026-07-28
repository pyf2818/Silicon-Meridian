# Phase 2 AI 主动学习闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 激活 Phase 1 预留的三个扩展点（pendingSuggestions UI / agent_memories 可见性 / buildSystemPrompt "最近校准"段自动激活），让 AI 主动学习闭环对用户可感知、可操作。

**Architecture:** 三个独立子模块串成闭环——workflow 写入 pendingSuggestions → ProfilePage 顶部卡片展示接受/拒绝 → 接受后写入 specialFollows/domainTiers/sourceTiers 并自动激活 buildSystemPrompt "最近校准"段；AiChat 对话写入 agent_memories 表 → ProfilePage 底部 section 展示完整 CRUD。先消除 buildProfileMemory 双源，再建 UI。

**Tech Stack:** React 19 + Zustand + vitest（纯函数测试，无 @testing-library/react）

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/hooks/useAgentWorkflowRunner.js` | 修改 L212-258 | 删除内联 buildProfileMemory，改调 workflowEngine.js + ctx |
| `src/components/profile/PendingSuggestionCard.jsx` | 新建 | 单条卡片 + SuggestionAcceptEditor + applySuggestionByType 纯函数 |
| `src/components/profile/PendingSuggestionsSection.jsx` | 新建 | 列表容器 + 空状态 + mount 清理 |
| `src/hooks/useAgentMemories.js` | 新建 | agent_memories CRUD hook + buildListQuery/parseListResponse 纯函数 |
| `src/components/profile/AgentMemorySection.jsx` | 新建 | 列表 + 过滤 + 搜索 + 分页 + 删除 |
| `src/components/ProfilePage.jsx` | 修改 | 接入两个 section |
| `src/hooks/__tests__/useAgentMemories.test.js` | 新建 | 纯函数测试 |
| `src/components/profile/__tests__/PendingSuggestionCard.test.js` | 新建 | applySuggestionByType 纯函数测试 |
| `src/styles.css` | 修改 | 新增 section 样式 |
| `CLAUDE.md` | 修改 | 文档更新 |

---

### Task 1: 消除 buildProfileMemory 双源

**Files:**
- Modify: `src/hooks/useAgentWorkflowRunner.js:1-3` (import), `:212-258` (删除内联), `:361` (改调用)

- [ ] **Step 1: 修改 import 添加 buildProfileMemory**

修改 `src/hooks/useAgentWorkflowRunner.js` 顶部 import（L1-L3 区域），在现有 import 后追加：

```js
import { useCallback } from 'react';
import { getWorkflowSkillMeta, WORKFLOW_CONDITION_METRICS } from '../constants/appConstants.jsx';
import { useProfileStore } from '../store';
import { buildProfileMemory } from '../utils/workflowEngine.js';
```

- [ ] **Step 2: 删除内联 buildProfileMemory 函数**

删除 `src/hooks/useAgentWorkflowRunner.js` L212-258 整个 `const buildProfileMemory = () => { ... };` 闭包函数。

- [ ] **Step 3: 修改调用点改用 workflowEngine.js 版本**

修改 `src/hooks/useAgentWorkflowRunner.js` L361 附近的调用点，从：

```js
const profileMemory = buildProfileMemory();
```

改为：

```js
const profileMemory = buildProfileMemory(
  scopedAgentItems,
  intelligenceProfile,
  trackedTerms,
  bookmarks,
  materials,
  {
    addPendingSuggestions: (suggestions) => useProfileStore.getState().addPendingSuggestions(suggestions),
    getCategoryLabel,
  }
);
```

- [ ] **Step 4: 修改 workflowEngine.js 让 buildProfileMemory 支持 ctx.getCategoryLabel**

修改 `src/utils/workflowEngine.js` L97-142 buildProfileMemory 函数：

在 L111 `items.forEach(item => {` 之前加入：

```js
const getCategoryLabel = ctx?.getCategoryLabel || (id => id || '未分类');
```

把 L113 `if (item.category) categoryCount.set(item.category, ...)` 改为：

```js
if (item.category) {
  const label = getCategoryLabel(item.category);
  categoryCount.set(label, (categoryCount.get(label) || 0) + 1);
}
```

把 L125 `topCategories.map(([cat, count]) => ({ ... target: cat, ... }))` 中的 `target: cat` 保持不变（已经是 label）。

- [ ] **Step 5: 运行测试验证**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS（347 tests，与 Phase 1 一致）

- [ ] **Step 6: 跑 build 验证**

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAgentWorkflowRunner.js src/utils/workflowEngine.js
git commit -m "refactor(workflow): unify buildProfileMemory to workflowEngine.js"
```

---

### Task 2: 创建 applySuggestionByType 纯函数 + 测试

**Files:**
- Create: `src/components/profile/PendingSuggestionCard.jsx`
- Create: `src/components/profile/__tests__/PendingSuggestionCard.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/components/profile/__tests__/PendingSuggestionCard.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock showToast before importing the module under test
vi.mock('../../../utils/toast.js', () => ({
  showToast: vi.fn(),
}));

const { applySuggestionByType } = await import('../PendingSuggestionCard.jsx');

describe('applySuggestionByType', () => {
  beforeEach(() => vi.clearAllMocks());

  it('track type adds keyword to specialFollows via updater function', () => {
    const setSpecialFollows = vi.fn();
    const stores = { setSpecialFollows, specialFollows: [] };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU', reason: 'r' },
      { target: 'GPU', note: 'reason' },
      stores
    );
    expect(ok).toBe(true);
    expect(setSpecialFollows).toHaveBeenCalledTimes(1);
    const updater = setSpecialFollows.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    const result = updater([{ id: 'a', type: 'keyword', target: 'CPU', note: '' }]);
    expect(result).toHaveLength(2);
    expect(result[1].target).toBe('GPU');
    expect(result[1].type).toBe('keyword');
    expect(result[1].note).toBe('reason');
    expect(result[1].id).toBeTruthy();
  });

  it('track type rejects duplicate keyword (case-insensitive)', () => {
    const setSpecialFollows = vi.fn();
    const stores = {
      setSpecialFollows,
      specialFollows: [{ id: 'a', type: 'keyword', target: 'GPU' }],
    };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU', reason: 'r' },
      { target: 'gpu', note: '' },
      stores
    );
    expect(ok).toBe(false);
    expect(setSpecialFollows).not.toHaveBeenCalled();
  });

  it('track type rejects empty target', () => {
    const stores = { setSpecialFollows: vi.fn(), specialFollows: [] };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU', reason: 'r' },
      { target: '  ', note: '' },
      stores
    );
    expect(ok).toBe(false);
    expect(stores.setSpecialFollows).not.toHaveBeenCalled();
  });

  it('boost type sets domainTiers[target] to focus via updater', () => {
    const setDomainTiers = vi.fn();
    const stores = { setDomainTiers };
    const ok = applySuggestionByType(
      { type: 'boost', target: 'ai' },
      { tier: 'focus' },
      stores
    );
    expect(ok).toBe(true);
    const updater = setDomainTiers.mock.calls[0][0];
    const result = updater({ web: 'normal' });
    expect(result).toEqual({ web: 'normal', ai: 'focus' });
  });

  it('boost type defaults tier to focus when missing', () => {
    const setDomainTiers = vi.fn();
    const stores = { setDomainTiers };
    applySuggestionByType({ type: 'boost', target: 'ai' }, {}, stores);
    const updater = setDomainTiers.mock.calls[0][0];
    const result = updater({});
    expect(result.ai).toBe('focus');
  });

  it('mute type sets sourceTiers[target] to explore via updater', () => {
    const setSourceTiers = vi.fn();
    const stores = { setSourceTiers };
    const ok = applySuggestionByType(
      { type: 'mute', target: 'src-1' },
      { tier: 'explore' },
      stores
    );
    expect(ok).toBe(true);
    const updater = setSourceTiers.mock.calls[0][0];
    const result = updater({ 'src-2': 'normal' });
    expect(result).toEqual({ 'src-2': 'normal', 'src-1': 'explore' });
  });

  it('unknown type returns false', () => {
    const ok = applySuggestionByType({ type: 'unknown', target: 'x' }, {}, {});
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/components/profile/__tests__/PendingSuggestionCard.test.js`
Expected: FAIL（`Cannot find module '../PendingSuggestionCard.jsx'`）

- [ ] **Step 3: 创建 PendingSuggestionCard.jsx 含 applySuggestionByType 纯函数**

创建 `src/components/profile/PendingSuggestionCard.jsx`：

```jsx
import { useMemo, useState } from 'react';
import { useProfileStore } from '../../store';
import { showToast } from '../../utils/toast.js';

const TYPE_LABELS = { track: '追踪', boost: '强化', mute: '静默' };

function initFormByType(suggestion) {
  if (suggestion.type === 'track') {
    return { target: suggestion.target || '', note: suggestion.reason || '' };
  }
  if (suggestion.type === 'boost') {
    return { tier: 'focus' };
  }
  if (suggestion.type === 'mute') {
    return { tier: 'explore' };
  }
  return {};
}

/**
 * Phase 2 Task 2: applySuggestionByType 纯函数
 *
 * 根据 suggestion.type 写入对应的 store：
 *   track → specialFollows 添加 keyword 项（含大小写不敏感幂等检查）
 *   boost → domainTiers[target] = formState.tier || 'focus'
 *   mute  → sourceTiers[target] = formState.tier || 'explore'
 *
 * @returns {boolean} true 表示写入成功，false 表示幂等检查失败或类型未知
 */
export function applySuggestionByType(suggestion, formState, stores) {
  const { type, target: origTarget } = suggestion;
  const { setSpecialFollows, setDomainTiers, setSourceTiers, specialFollows } = stores;

  if (type === 'track') {
    const target = (formState.target || '').trim();
    if (!target) {
      showToast('请输入关键词');
      return false;
    }
    const duplicate = (specialFollows || []).some(item =>
      item.type === 'keyword' && item.target.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (duplicate) {
      showToast('该关键词已存在');
      return false;
    }
    setSpecialFollows(prev => [...prev, {
      id: globalThis.crypto?.randomUUID?.() || `follow-${Date.now()}`,
      type: 'keyword',
      target,
      note: formState.note || suggestion.reason || '',
    }]);
    return true;
  }

  if (type === 'boost') {
    setDomainTiers(prev => ({ ...prev, [origTarget]: formState.tier || 'focus' }));
    return true;
  }

  if (type === 'mute') {
    setSourceTiers(prev => ({ ...prev, [origTarget]: formState.tier || 'explore' }));
    return true;
  }

  return false;
}

// 主组件和 SuggestionAcceptEditor 在 Task 3 中添加
export default function PendingSuggestionCard() {
  return null;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/components/profile/__tests__/PendingSuggestionCard.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/components/profile/PendingSuggestionCard.jsx src/components/profile/__tests__/PendingSuggestionCard.test.js
git commit -m "feat(profile): add applySuggestionByType pure function with tests"
```

---

### Task 3: 完成 PendingSuggestionCard 组件（含 SuggestionAcceptEditor）

**Files:**
- Modify: `src/components/profile/PendingSuggestionCard.jsx`

- [ ] **Step 1: 完整实现 PendingSuggestionCard**

把 `src/components/profile/PendingSuggestionCard.jsx` 中 `export default function PendingSuggestionCard() { return null; }` 替换为完整实现：

```jsx
function SuggestionAcceptEditor({ suggestion, onCancel, onDone }) {
  const updateSuggestionStatus = useProfileStore(s => s.updateSuggestionStatus);
  const setSpecialFollows = useProfileStore(s => s.setSpecialFollows);
  const setDomainTiers = useProfileStore(s => s.setDomainTiers);
  const setSourceTiers = useProfileStore(s => s.setSourceTiers);
  const specialFollows = useProfileStore(s => s.specialFollows);

  const [formState, setFormState] = useState(() => initFormByType(suggestion));

  const handleSubmit = () => {
    const ok = applySuggestionByType(suggestion, formState, {
      setSpecialFollows, setDomainTiers, setSourceTiers, specialFollows,
    });
    if (!ok) return;
    updateSuggestionStatus(suggestion.id, 'accepted');
    showToast('已接受建议，写入偏好');
    onDone();
  };

  const updateField = (key, value) => setFormState(prev => ({ ...prev, [key]: value }));

  return (
    <div className="suggestion-accept-editor">
      <div className="editor-title">确认写入偏好</div>
      {suggestion.type === 'track' && (
        <>
          <label className="editor-field">
            <span>关键词</span>
            <input
              type="text"
              value={formState.target || ''}
              onChange={e => updateField('target', e.target.value)}
              placeholder="输入追踪关键词"
            />
          </label>
          <label className="editor-field">
            <span>备注</span>
            <input
              type="text"
              value={formState.note || ''}
              onChange={e => updateField('note', e.target.value)}
              placeholder="可选备注"
            />
          </label>
        </>
      )}
      {suggestion.type === 'boost' && (
        <div className="editor-field">
          <span>领域</span>
          <span className="editor-readonly">{suggestion.target}</span>
          <div className="editor-radio-group">
            <label>
              <input
                type="radio"
                name={`tier-boost-${suggestion.id}`}
                checked={formState.tier === 'focus'}
                onChange={() => updateField('tier', 'focus')}
              />
              <span>重点（focus）</span>
            </label>
            <label>
              <input
                type="radio"
                name={`tier-boost-${suggestion.id}`}
                checked={formState.tier === 'normal'}
                onChange={() => updateField('tier', 'normal')}
              />
              <span>常规（normal）</span>
            </label>
          </div>
        </div>
      )}
      {suggestion.type === 'mute' && (
        <div className="editor-field">
          <span>来源</span>
          <span className="editor-readonly">{suggestion.target}</span>
          <div className="editor-radio-group">
            <label>
              <input
                type="radio"
                name={`tier-mute-${suggestion.id}`}
                checked={formState.tier === 'explore'}
                onChange={() => updateField('tier', 'explore')}
              />
              <span>探索（explore）</span>
            </label>
            <label>
              <input
                type="radio"
                name={`tier-mute-${suggestion.id}`}
                checked={formState.tier === 'normal'}
                onChange={() => updateField('tier', 'normal')}
              />
              <span>常规（normal）</span>
            </label>
          </div>
        </div>
      )}
      <div className="editor-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSubmit}>确认写入</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

export default function PendingSuggestionCard({ suggestion }) {
  const [editing, setEditing] = useState(false);
  const updateSuggestionStatus = useProfileStore(s => s.updateSuggestionStatus);

  const handleReject = () => updateSuggestionStatus(suggestion.id, 'rejected');
  const handleAccept = () => setEditing(true);

  const confidencePct = Math.round((suggestion.metadata?.confidence || 0) * 100);
  const typeLabel = TYPE_LABELS[suggestion.type] || suggestion.type;

  if (editing) {
    return (
      <SuggestionAcceptEditor
        suggestion={suggestion}
        onCancel={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="pending-suggestion-card">
      <div className="suggestion-header">
        <span className={`suggestion-type type-${suggestion.type}`}>{typeLabel}</span>
        <span className="suggestion-target">{suggestion.target}</span>
      </div>
      <p className="suggestion-reason">{suggestion.reason}</p>
      <div className="suggestion-confidence">
        <span className="confidence-label">置信度</span>
        <div className="confidence-bar">
          <div className="confidence-fill" style={{ width: `${confidencePct}%` }} />
        </div>
        <span className="confidence-value">{confidencePct}%</span>
      </div>
      <div className="suggestion-actions">
        <button className="btn btn-primary btn-sm" onClick={handleAccept}>接受</button>
        <button className="btn btn-ghost btn-sm" onClick={handleReject}>拒绝</button>
        <button className="btn btn-ghost btn-sm" onClick={handleReject}>稍后</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行测试验证不破坏**

Run: `node node_modules/vitest/vitest.mjs run src/components/profile/__tests__/PendingSuggestionCard.test.js`
Expected: PASS（7 tests，applySuggestionByType 测试不依赖组件渲染）

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/PendingSuggestionCard.jsx
git commit -m "feat(profile): complete PendingSuggestionCard with inline accept editor"
```

---

### Task 4: 创建 PendingSuggestionsSection 容器

**Files:**
- Create: `src/components/profile/PendingSuggestionsSection.jsx`

- [ ] **Step 1: 创建 PendingSuggestionsSection**

创建 `src/components/profile/PendingSuggestionsSection.jsx`：

```jsx
import { useEffect, useMemo } from 'react';
import { useProfileStore } from '../../store';
import PendingSuggestionCard from './PendingSuggestionCard.jsx';

export default function PendingSuggestionsSection() {
  const pending = useProfileStore(s => s.pendingSuggestions);

  const pendingList = useMemo(
    () => (pending || [])
      .filter(s => s.status === 'pending')
      .sort((a, b) => (b.metadata?.confidence || 0) - (a.metadata?.confidence || 0)),
    [pending]
  );

  useEffect(() => {
    try { useProfileStore.getState().pruneExpiredSuggestions(); } catch { /* silent */ }
  }, []);

  return (
    <section className="profile-pending-suggestions">
      <div className="section-header">
        <h2 className="section-title">
          AI 建议待确认
          {pendingList.length > 0 && <span className="pending-count">{pendingList.length}</span>}
        </h2>
        <p className="section-desc">系统从近期阅读中提炼的追踪/强化建议，确认后写入偏好并影响后续对话</p>
      </div>
      {pendingList.length === 0 ? (
        <div className="profile-empty-state">暂无 AI 建议待确认</div>
      ) : (
        <div className="pending-suggestions-grid">
          {pendingList.map(s => <PendingSuggestionCard key={s.id} suggestion={s} />)}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/PendingSuggestionsSection.jsx
git commit -m "feat(profile): add PendingSuggestionsSection container"
```

---

### Task 5: 创建 useAgentMemories hook + 测试

**Files:**
- Create: `src/hooks/useAgentMemories.js`
- Create: `src/hooks/__tests__/useAgentMemories.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/hooks/__tests__/useAgentMemories.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { buildListQuery, parseListResponse } from '../useAgentMemories.js';

describe('buildListQuery', () => {
  it('builds query with page offset and memoryType', () => {
    const q = buildListQuery({ page: 1, pageSize: 10, memoryType: 'user_habit' });
    expect(q).toEqual({ memoryType: 'user_habit', limit: 10, offset: 10 });
  });

  it('omits memoryType when empty string', () => {
    const q = buildListQuery({ page: 0, pageSize: 10, memoryType: '' });
    expect(q.memoryType).toBeUndefined();
  });

  it('omits memoryType when undefined', () => {
    const q = buildListQuery({ page: 0, pageSize: 20, memoryType: undefined });
    expect(q.memoryType).toBeUndefined();
  });

  it('clamps limit to reasonable range', () => {
    const q1 = buildListQuery({ page: 0, pageSize: 0, memoryType: '' });
    expect(q1.limit).toBeGreaterThanOrEqual(1);
    const q2 = buildListQuery({ page: 0, pageSize: 200, memoryType: '' });
    expect(q2.limit).toBeLessThanOrEqual(100);
  });
});

describe('parseListResponse', () => {
  it('extracts memories array and computes hasMore=true when full page', () => {
    const memories = Array(10).fill({ id: 'x', content: 'c' });
    const parsed = parseListResponse({ ok: true, memories }, 10);
    expect(parsed.items).toHaveLength(10);
    expect(parsed.hasMore).toBe(true);
  });

  it('hasMore=false when memories < pageSize', () => {
    const parsed = parseListResponse({ ok: true, memories: [{ id: 'x' }] }, 10);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.hasMore).toBe(false);
  });

  it('returns empty items and hasMore=false on falsy payload', () => {
    const parsed = parseListResponse(null, 10);
    expect(parsed.items).toEqual([]);
    expect(parsed.hasMore).toBe(false);
  });

  it('returns empty items when memories field missing', () => {
    const parsed = parseListResponse({ ok: true }, 10);
    expect(parsed.items).toEqual([]);
    expect(parsed.hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node node_modules/vitest/vitest.mjs run src/hooks/__tests__/useAgentMemories.test.js`
Expected: FAIL（`Cannot find module '../useAgentMemories.js'`）

- [ ] **Step 3: 创建 useAgentMemories.js**

创建 `src/hooks/useAgentMemories.js`：

```js
import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../utils/toast.js';

/**
 * Phase 2 Task 5: buildListQuery 纯函数
 * 构造 GET /api/agent-memory/list 的查询参数
 */
export function buildListQuery({ page, pageSize, memoryType }) {
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = Math.max(0, (Number(page) || 0)) * limit;
  const q = { limit, offset };
  if (memoryType) q.memoryType = memoryType;
  return q;
}

/**
 * Phase 2 Task 5: parseListResponse 纯函数
 * 解析后端响应，通过"满页"判断是否有更多数据
 */
export function parseListResponse(payload, pageSize) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.memories)) {
    return { items: [], hasMore: false };
  }
  const items = payload.memories;
  const hasMore = items.length === pageSize;
  return { items, hasMore };
}

/**
 * Phase 2 Task 5: useAgentMemories hook
 * 封装 agent_memories CRUD 操作
 */
export function useAgentMemories() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);
  const [memoryType, setMemoryType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = buildListQuery({ page, pageSize, memoryType });
      const params = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) });
      if (q.memoryType) params.set('memoryType', q.memoryType);
      const res = await fetch(`/api/agent-memory/list?${params.toString()}`, { credentials: 'include' });
      if (res.status === 401) {
        setItems([]);
        setHasMore(false);
        setError('请先登录');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || '加载失败');
      }
      const { items: parsedItems, hasMore: parsedHasMore } = parseListResponse(payload, pageSize);
      setItems(parsedItems);
      setHasMore(parsedHasMore);
    } catch (err) {
      setError(err.message || '加载失败');
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, memoryType]);

  const search = useCallback(async (q) => {
    const query = (q || '').trim();
    if (!query) {
      setIsSearchMode(false);
      await refresh();
      return;
    }
    setLoading(true);
    setError(null);
    setIsSearchMode(true);
    try {
      const res = await fetch(`/api/agent-memory/search?q=${encodeURIComponent(query)}&limit=20`, { credentials: 'include' });
      if (res.status === 401) {
        setItems([]);
        setHasMore(false);
        setError('请先登录');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || '搜索失败');
      }
      const { items: parsedItems } = parseListResponse(payload, 100);
      setItems(parsedItems);
      setHasMore(false);
    } catch (err) {
      setError(err.message || '搜索失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const remove = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/agent-memory/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || '删除失败');
      }
      showToast('已删除');
      if (isSearchMode) {
        await search(searchQuery);
      } else {
        await refresh();
      }
    } catch (err) {
      showToast(`删除失败：${err.message}`);
    }
  }, [refresh, search, isSearchMode, searchQuery]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    items, loading, error, hasMore,
    page, setPage, pageSize,
    memoryType, setMemoryType,
    searchQuery, setSearchQuery,
    refresh, search, remove,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node node_modules/vitest/vitest.mjs run src/hooks/__tests__/useAgentMemories.test.js`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAgentMemories.js src/hooks/__tests__/useAgentMemories.test.js
git commit -m "feat(profile): add useAgentMemories hook with list/search/delete"
```

---

### Task 6: 创建 AgentMemorySection 组件

**Files:**
- Create: `src/components/profile/AgentMemorySection.jsx`

- [ ] **Step 1: 创建 AgentMemorySection**

创建 `src/components/profile/AgentMemorySection.jsx`：

```jsx
import { useState } from 'react';
import { useAgentMemories } from '../../hooks/useAgentMemories.js';

const MEMORY_TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'user_habit', label: '习惯' },
  { value: 'user_thought', label: '想法' },
  { value: 'user_trait', label: '特质' },
  { value: 'user_need', label: '需求' },
  { value: 'agent_insight', label: '洞察' },
];

const TYPE_LABELS = Object.fromEntries(MEMORY_TYPE_OPTIONS.map(o => [o.value, o.label]));

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return iso; }
}

function MemoryItem({ memory, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const hasEvidence = Array.isArray(memory.evidence) && memory.evidence.length > 0;

  return (
    <div className="memory-item">
      <div className="memory-header">
        <span className={`memory-type-tag type-${memory.memory_type}`}>
          {TYPE_LABELS[memory.memory_type] || memory.memory_type}
        </span>
        <span className="memory-weight">权重 {memory.weight || 1}</span>
        <span className="memory-created">{formatTime(memory.created_at)}</span>
        <button
          className="btn btn-ghost btn-sm memory-delete"
          onClick={() => onDelete(memory.id)}
          aria-label="删除"
        >删除</button>
      </div>
      <div className="memory-content">{memory.content}</div>
      {hasEvidence && (
        <>
          <button
            className="btn btn-ghost btn-sm memory-expand"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? '收起证据' : `查看证据 (${memory.evidence.length})`}
          </button>
          {expanded && (
            <div className="memory-evidence">
              {memory.evidence.map((ev, i) => (
                <div key={i} className="evidence-item">
                  {ev.type && <span className="evidence-type">{ev.type}</span>}
                  <span className="evidence-snippet">{ev.snippet || JSON.stringify(ev)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AgentMemorySection() {
  const {
    items, loading, error, hasMore,
    page, setPage,
    memoryType, setMemoryType,
    searchQuery, setSearchQuery,
    refresh, search, remove,
  } = useAgentMemories();

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    search(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    refresh();
  };

  const handleMemoryTypeChange = (e) => {
    setMemoryType(e.target.value);
    setPage(0);
  };

  return (
    <section className="profile-agent-memory">
      <div className="section-header">
        <h2 className="section-title">AI 跨会话记忆</h2>
        <p className="section-desc">AI 在对话中累积的对你的观察，可搜索/删除以保持记忆准确</p>
      </div>
      <div className="memory-toolbar">
        <select
          className="memory-type-filter"
          value={memoryType}
          onChange={handleMemoryTypeChange}
        >
          {MEMORY_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <form className="memory-search-form" onSubmit={handleSearchSubmit}>
          <input
            type="text"
            className="memory-search-input"
            placeholder="搜索记忆..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-ghost btn-sm">搜索</button>
          {searchQuery && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleClearSearch}>清除</button>
          )}
        </form>
        <button className="btn btn-ghost btn-sm" onClick={refresh}>刷新</button>
      </div>
      {error && <div className="memory-error">{error}</div>}
      {loading && <div className="memory-loading">加载中...</div>}
      {!loading && !error && items.length === 0 && (
        <div className="profile-empty-state">暂无 AI 记忆</div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="memory-list">
          {items.map(m => <MemoryItem key={m.id} memory={m} onDelete={remove} />)}
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="memory-pagination">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >上一页</button>
          <span className="page-indicator">第 {page + 1} 页</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
          >下一页</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/AgentMemorySection.jsx
git commit -m "feat(profile): add AgentMemorySection with full CRUD UI"
```

---

### Task 7: ProfilePage.jsx 接入两个 section

**Files:**
- Modify: `src/components/ProfilePage.jsx:1-10` (import), `:85-87` (插入 PendingSuggestionsSection), `:258` (插入 AgentMemorySection)

- [ ] **Step 1: 添加 import**

修改 `src/components/ProfilePage.jsx` 顶部 import 区域，添加：

```jsx
import PendingSuggestionsSection from './profile/PendingSuggestionsSection.jsx';
import AgentMemorySection from './profile/AgentMemorySection.jsx';
```

- [ ] **Step 2: 插入 PendingSuggestionsSection**

在 `src/components/ProfilePage.jsx` 中找到 profile-hero section 闭合 `</section>`（约 L85）之后、`<BlockGrid columns={3}>` 之前的位置，插入：

```jsx
<PendingSuggestionsSection />
```

- [ ] **Step 3: 插入 AgentMemorySection**

在 `src/components/ProfilePage.jsx` 中找到最后一个 `profile-memory-panel` section 闭合 `</section>`（约 L258）之后，插入：

```jsx
<AgentMemorySection />
```

- [ ] **Step 4: 运行测试验证**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS（362 tests，347 + 7 + 8 = 362）

- [ ] **Step 5: 跑 build 验证**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/ProfilePage.jsx
git commit -m "feat(profile): integrate PendingSuggestions and AgentMemory sections"
```

---

### Task 8: 添加 CSS 样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 在 styles.css 末尾追加样式**

在 `src/styles.css` 文件末尾追加以下样式：

```css
/* Phase 2: AI 主动学习闭环 UI */
.profile-pending-suggestions,
.profile-agent-memory {
  margin: 16px 0;
  padding: 16px;
  border-radius: 12px;
  background: var(--bg-card, rgba(255,255,255,0.04));
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
}
.profile-pending-suggestions .pending-count {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-bg, rgba(255,200,0,0.15));
  color: var(--accent-text, #fbbf24);
  font-size: 12px;
  font-weight: 600;
}
.pending-suggestions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.pending-suggestion-card {
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-elevated, rgba(255,255,255,0.03));
  border: 1px solid var(--border-color, rgba(255,255,255,0.06));
}
.suggestion-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.suggestion-type {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.suggestion-type.type-track { background: rgba(59,130,246,0.15); color: #60a5fa; }
.suggestion-type.type-boost { background: rgba(234,88,12,0.15); color: #fb923c; }
.suggestion-type.type-mute  { background: rgba(100,116,139,0.15); color: #94a3b8; }
.suggestion-target { font-weight: 600; }
.suggestion-reason {
  font-size: 13px;
  color: var(--text-muted, #94a3b8);
  margin: 8px 0;
}
.suggestion-confidence {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 12px;
}
.confidence-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-elevated, rgba(255,255,255,0.06));
  overflow: hidden;
}
.confidence-fill {
  height: 100%;
  background: linear-gradient(90deg, #fbbf24, #f59e0b);
  border-radius: 3px;
}
.suggestion-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.suggestion-accept-editor {
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-elevated, rgba(255,255,255,0.04));
  border: 1px solid var(--accent-border, rgba(251,191,36,0.3));
}
.editor-title { font-weight: 600; margin-bottom: 8px; }
.editor-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.editor-field > span { font-size: 12px; color: var(--text-muted, #94a3b8); }
.editor-field input[type="text"] {
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.1));
  background: var(--bg-input, rgba(0,0,0,0.2));
  color: var(--text-primary, #fff);
}
.editor-readonly {
  font-weight: 600;
  padding: 4px 0;
}
.editor-radio-group {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}
.editor-radio-group label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}
.editor-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.profile-empty-state {
  padding: 24px;
  text-align: center;
  color: var(--text-muted, #94a3b8);
  font-size: 14px;
}

/* AgentMemorySection */
.memory-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.memory-type-filter {
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.1));
  background: var(--bg-input, rgba(0,0,0,0.2));
  color: var(--text-primary, #fff);
}
.memory-search-form {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 200px;
}
.memory-search-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.1));
  background: var(--bg-input, rgba(0,0,0,0.2));
  color: var(--text-primary, #fff);
}
.memory-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.memory-item {
  padding: 12px;
  border-radius: 6px;
  background: var(--bg-elevated, rgba(255,255,255,0.03));
  border: 1px solid var(--border-color, rgba(255,255,255,0.06));
}
.memory-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.memory-type-tag {
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
}
.memory-type-tag.type-user_habit { background: rgba(34,197,94,0.15); color: #4ade80; }
.memory-type-tag.type-user_thought { background: rgba(168,85,247,0.15); color: #c084fc; }
.memory-type-tag.type-user_trait { background: rgba(59,130,246,0.15); color: #60a5fa; }
.memory-type-tag.type-user_need { background: rgba(234,88,12,0.15); color: #fb923c; }
.memory-type-tag.type-agent_insight { background: rgba(251,191,36,0.15); color: #fbbf24; }
.memory-weight, .memory-created {
  color: var(--text-muted, #94a3b8);
}
.memory-delete {
  margin-left: auto;
}
.memory-content {
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 6px;
}
.memory-expand {
  font-size: 12px;
  padding: 2px 8px;
}
.memory-evidence {
  margin-top: 8px;
  padding: 8px;
  border-radius: 4px;
  background: var(--bg-elevated, rgba(0,0,0,0.15));
  border-left: 3px solid var(--accent-border, rgba(251,191,36,0.3));
}
.evidence-item {
  font-size: 12px;
  margin-bottom: 4px;
}
.evidence-type {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.06);
  font-weight: 600;
}
.memory-error, .memory-loading {
  padding: 16px;
  text-align: center;
  color: var(--text-muted, #94a3b8);
}
.memory-error { color: #f87171; }
.memory-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}
.page-indicator { font-size: 13px; color: var(--text-muted, #94a3b8); }

/* 按钮基础样式（若已存在则跳过） */
.btn { cursor: pointer; border: none; border-radius: 4px; padding: 6px 12px; font-size: 13px; transition: opacity 0.15s; }
.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-primary { background: var(--accent-bg, #f59e0b); color: #fff; }
.btn-ghost { background: transparent; color: var(--text-muted, #94a3b8); border: 1px solid var(--border-color, rgba(255,255,255,0.1)); }
```

- [ ] **Step 2: 跑 build 验证**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style(profile): add Phase 2 pending suggestions and agent memory styles"
```

---

### Task 9: 更新 CLAUDE.md 文档

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 src/components/ 章节新增 profile/ 子目录**

在 `CLAUDE.md` 的 `src/components/` 列表中追加（在 `stock/` 之后）：

```
  profile/              Phase 2 用户画像 AI 学习闭环组件
    PendingSuggestionsSection.jsx  AI 建议待确认列表容器（读 useProfileStore.pendingSuggestions）
    PendingSuggestionCard.jsx     单条建议卡片 + SuggestionAcceptEditor + applySuggestionByType 纯函数
    AgentMemorySection.jsx        AI 跨会话记忆列表 + 过滤/搜索/分页/删除
```

- [ ] **Step 2: 更新 src/hooks/ 章节新增 useAgentMemories**

在 `CLAUDE.md` 的 `src/hooks/` 列表中，在 `useProfileSync.js` 之后追加：

```
  useAgentMemories.js          agent_memories CRUD hook（list/search/delete + buildListQuery/parseListResponse 纯函数）
```

- [ ] **Step 3: 更新 Phase 2 完成状态**

在 `CLAUDE.md` 的 "v2 Intelligence Workbench" 章节末尾追加：

```
**Phase 2 AI 主动学习闭环（已完成）**：
- 消除 buildProfileMemory 双源（useAgentWorkflowRunner.js 内联版删除，统一调 workflowEngine.js + ctx）
- ProfilePage 顶部 PendingSuggestionsSection：展示 AI 建议、接受时弹出 inline 编辑器确认后写入偏好、拒绝/稍后映射为 'rejected'
- ProfilePage 底部 AgentMemorySection：完整 CRUD（列表 + memory_type 过滤 + 搜索 + 分页 + 单条删除）
- buildSystemPrompt "最近校准"段自动激活（用户接受建议后，后续对话 prompt 注入近 7 天 accepted 建议）
- applySuggestionByType 纯函数含大小写不敏感幂等检查
- pendingSuggestions 不同步跨设备（agent_memories 已是 PG 跨设备来源）
```

- [ ] **Step 4: 更新测试数量**

把 `CLAUDE.md` 中 "347 unit tests" 改为 "362 unit tests"。

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update for Phase 2 AI learning loop completion"
```

---

### Task 10: 最终验收 + tag

- [ ] **Step 1: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS（362 tests）

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 检查 App.jsx 行数无显著变化**

Run: `(Get-Content src/App.jsx).Count`
Expected: ~2700 行（与 Phase 1 stable-v11 一致或略减，Phase 2 不应增加 App.jsx）

- [ ] **Step 4: Tag stable-v12**

```bash
git tag stable-v12 -m "Phase 2 AI learning loop complete"
```

- [ ] **Step 5: 输出验收清单**

对照 spec §7.3 的 14 项验收清单，确认每项已实现或通过测试覆盖。
