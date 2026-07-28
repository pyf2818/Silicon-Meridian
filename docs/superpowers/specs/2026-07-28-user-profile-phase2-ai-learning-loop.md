# 用户画像模块 Phase 2：AI 主动学习闭环

- **日期**：2026-07-28
- **状态**：待 review
- **作者**：brainstorming 流程产出
- **范围**：在 Phase 1 数据地基之上，激活 AI 主动学习闭环——pendingSuggestions 接受/拒绝 UI + agent_memories 可见性
- **用户感知**：ProfilePage 新增两个 section（顶部"AI 建议待确认"+ 底部"AI 跨会话记忆"）；workflow 执行后出现的 AI 建议可在 ProfilePage 接受/拒绝，接受后写入用户偏好并自动注入后续对话 prompt
- **依赖**：Phase 1（commit ff414e9 stable-v10 + 后续 Phase 1.3/1.4/1.5 commits，截至 stable-v11）

---

## 1. 背景与动机

### 1.1 Phase 1 交付的扩展点

Phase 1 完成了"数据地基重构"，为 AI 主动学习闭环预留了三个扩展点：

1. **`pendingSuggestions` store**（[src/store/profileStore.js](file:///e:/VStudio_Project/Silicon%20Meridian/src/store/profileStore.js#L92-L134)）
   - 含去重（cap=20）/ 冷却（1h）/ 审计保留（30d）机制
   - 写入方已通：`buildProfileMemory`（workflowEngine.js + useAgentWorkflowRunner.js 双源）
   - **读取/UI 完全缺失**：ProfilePage 不消费 pendingSuggestions，无接受/拒绝组件

2. **buildSystemPrompt "最近校准"段**（[src/components/aichat/buildSystemPrompt.js](file:///e:/VStudio_Project/Silicon%20Meridian/src/components/aichat/buildSystemPrompt.js#L106-L117)）
   - 直接读 `useProfileStore.getState().pendingSuggestions`，过滤 `status==='accepted'` 且近 7 天的
   - **当前是 dead code**（pendingSuggestions 永远没有 accepted 项），等 UI 接入后自动激活
   - 无需修改此文件

3. **agent_memories 表 + 全链路**（[server/db/migrations/004_agent_autonomy.sql](file:///e:/VStudio_Project/Silicon%20Meridian/server/db/migrations/004_agent_autonomy.sql#L13-L27)）
   - DB → service（[server/agent/agentMemoryService.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/agent/agentMemoryService.js)）→ handler（[server/http/agentMemoryHandlers.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/http/agentMemoryHandlers.js)）→ 路由（[server/news/plugin.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/news/plugin.js#L117-L118)）→ 前端 `memoryEvolver.js`
   - 写入已通：AiChat 对话后异步调 `evolveMemory` 批量写入
   - **前端无读取 UI**：`memoryEvolver.js` 提供 `fetchRelevantMemories` 但无人调用；ProfilePage 不展示 agent_memories

### 1.2 Phase 2 目标

把上述三个扩展点从"接口就绪、UI 缺失"激活为"用户可感知、可操作的 AI 学习闭环"：

1. **消除 buildProfileMemory 双源**——删除 `useAgentWorkflowRunner.js` L212-258 内联版，统一调 `workflowEngine.js` 版本
2. **ProfilePage 顶部新增 PendingSuggestionsSection**——展示 AI 建议、用户接受/拒绝，接受时弹出 inline 编辑器让用户确认或修改后写入偏好
3. **ProfilePage 底部新增 AgentMemorySection**——完整 CRUD：列表 + 分页 + memory_type 过滤 + 搜索 + 单条删除，让用户看到 AI 跨会话累积的观察
4. **buildSystemPrompt "最近校准"段自动激活**——用户接受建议后，后续对话 prompt 自动贴合

### 1.3 用户故事

- **故事 1**：用户运行"今日简报"workflow，5 分钟后回到 ProfilePage，看到顶部出现 3 张 AI 建议卡片（追踪关键词"GPU"、强化领域"AI"、追踪关键词"Rust"）。用户点击"接受" GPU 卡片，弹出编辑器预填"GPU"，用户确认后写入 specialFollows（type=keyword）。下次与 AI 对话时，AI 主动贴合"GPU"相关话题。
- **故事 2**：用户与 AI 对话一周后，回到 ProfilePage 底部"AI 跨会话记忆"section，看到 20+ 条 agent_memories 列表（memory_type=user_habit/need/trait/...）。用户用搜索框输入"夜间"，过滤出 2 条相关记忆，决定删除其中 1 条过时的。
- **故事 3**：用户拒绝"强化领域 Rust"建议，suggestion.status 变为 'rejected'。后续 AI 不再主动推荐 Rust 相关内容。

---

## 2. 架构总览

### 2.1 数据流（重构后）

```
[Workflow 执行]
  └─ runAgentWorkflow()
      └─ buildProfileMemory()  ← workflowEngine.js 唯一版本
          └─ ctx.addPendingSuggestions(suggestions)
              ↓
      [profileStore.pendingSuggestions]  ← 去重/冷却/审计
          ↓
[ProfilePage 顶部]
  └─ PendingSuggestionsSection
      ├─ PendingSuggestionCard (单条卡片)
      │   ├─ 接受按钮 → 弹出 SuggestionAcceptEditor
      │   │   ├─ type='track' → 编辑 target + note → 写入 specialFollows
      │   │   ├─ type='boost' → 选择 tier (focus/normal) → 写入 domainTiers
      │   │   └─ type='mute'  → 选择 tier (explore/normal) → 写入 sourceTiers
      │   ├─ 拒绝按钮 → updateSuggestionStatus(id, 'rejected')
      │   └─ 稍后按钮 → updateSuggestionStatus(id, 'rejected')（轻量）
      └─ mount 时调 pruneExpiredSuggestions()

[AI 对话]
  └─ evolveMemory() → agent_memories 表
      ↓
[ProfilePage 底部]
  └─ AgentMemorySection
      ├─ useAgentMemories hook
      │   ├─ list(page, pageSize, memoryType) → GET /api/agent-memory/list
      │   ├─ search(query) → GET /api/agent-memory/search
      │   └─ delete(id) → DELETE /api/agent-memory/delete
      ├─ 顶部：memory_type 下拉 + 搜索框
      ├─ 列表：memory_type 标签 + content + created_at + 可展开 evidence
      ├─ 单条删除按钮
      └─ 分页控件

[接受后自动激活]
  └─ buildSystemPrompt "最近校准"段（无需修改）
      └─ 读 pendingSuggestions.filter(status==='accepted' && 近 7 天)
          → 注入"【最近校准】用户在过去 7 天接受了以下 AI 建议..."
```

### 2.2 模块边界

```
src/components/profile/
  PendingSuggestionsSection.jsx   列表容器 + 空状态 + mount 清理
  PendingSuggestionCard.jsx       单条卡片 + 接受编辑器 + 拒绝/稍后
  AgentMemorySection.jsx          列表 + 过滤 + 搜索 + 分页 + 删除

src/hooks/
  useAgentMemories.js             agent_memories CRUD hook

src/hooks/__tests__/
  useAgentMemories.test.js        纯函数测试（buildQuery / parseResponse）

src/store/
  profileStore.js                 无需修改（pendingSuggestions actions 已在 Phase 1 完成）

src/utils/
  workflowEngine.js               无需修改（buildProfileMemory 已在 Phase 1 完成）
  memoryEvolver.js                无需修改（fetchRelevantMemories 已有，本次不接入 AiChat）

src/hooks/
  useAgentWorkflowRunner.js       删除 L212-258 内联 buildProfileMemory，改调 workflowEngine.js

src/components/
  ProfilePage.jsx                 插入两个 section

src/components/aichat/
  buildSystemPrompt.js            无需修改（"最近校准"段自动激活）
```

### 2.3 与 Phase 1 边界

| 子问题 | Phase 1 | Phase 2 |
|---|---|---|
| buildProfileMemory 双源 | 都在但 useAgentWorkflowRunner 内联版调 store | 删除内联版，统一调 workflowEngine.js + ctx |
| pendingSuggestions 写入 | 已通 | 无变化 |
| pendingSuggestions 读取/UI | 完全缺失 | **本次交付** |
| agent_memories 写入 | 已通（AiChat evolveMemory） | 无变化 |
| agent_memories 读取/UI | 完全缺失 | **本次交付** |
| buildSystemPrompt "最近校准"段 | dead code | **自动激活**（无需修改） |
| 跨设备同步 pendingSuggestions | 不同步 | **不做**（spec §6.6 明确 Phase 1 不做，Phase 2 也保持） |
| AiChat 接入 fetchRelevantMemories | 无人调用 | **不做**（保留 Phase 3+） |
| personaSummary 在 workflow 触发 | 仅 AiChat 触发 | **不做**（保持现状） |

---

## 3. 详细设计

### 3.1 PendingSuggestionsSection

**文件**：`src/components/profile/PendingSuggestionsSection.jsx`（新建）

**职责**：
- 直接读 `useProfileStore(s => s.pendingSuggestions)`
- 过滤 `status==='pending'`，按 `metadata.confidence` 倒序
- mount 时调 `useProfileStore.getState().pruneExpiredSuggestions()` 清理过期项
- 渲染 `PendingSuggestionCard` 列表
- 空状态：`<div className="profile-empty-state">暂无 AI 建议待确认</div>`

**Props**（无 props，直接读 store）：

```jsx
export default function PendingSuggestionsSection() {
  const pending = useProfileStore(s => s.pendingSuggestions);
  const pendingList = useMemo(
    () => pending.filter(s => s.status === 'pending')
      .sort((a, b) => (b.metadata?.confidence || 0) - (a.metadata?.confidence || 0)),
    [pending]
  );

  useEffect(() => {
    useProfileStore.getState().pruneExpiredSuggestions();
  }, []);

  if (pendingList.length === 0) {
    return (
      <section className="profile-pending-suggestions">
        <div className="section-header">
          <h2 className="section-title">AI 建议待确认</h2>
          <p className="section-desc">系统从近期阅读中提炼的追踪/强化建议，确认后写入偏好并影响后续对话</p>
        </div>
        <div className="profile-empty-state">暂无 AI 建议待确认</div>
      </section>
    );
  }

  return (
    <section className="profile-pending-suggestions">
      <div className="section-header">
        <h2 className="section-title">AI 建议待确认 <span className="pending-count">{pendingList.length}</span></h2>
        <p className="section-desc">系统从近期阅读中提炼的追踪/强化建议，确认后写入偏好并影响后续对话</p>
      </div>
      <div className="pending-suggestions-grid">
        {pendingList.map(s => <PendingSuggestionCard key={s.id} suggestion={s} />)}
      </div>
    </section>
  );
}
```

### 3.2 PendingSuggestionCard

**文件**：`src/components/profile/PendingSuggestionCard.jsx`（新建）

**职责**：
- 显示 type 图标 / target / reason / confidence 进度条
- 三个操作按钮：接受 / 拒绝 / 稍后
- 接受时切换到 inline 编辑模式（`SuggestionAcceptEditor`），让用户确认或修改后写入

**Props**：

```jsx
export default function PendingSuggestionCard({ suggestion }) {
  const [editing, setEditing] = useState(false);
  const updateSuggestionStatus = useProfileStore(s => s.updateSuggestionStatus);

  const handleReject = () => updateSuggestionStatus(suggestion.id, 'rejected');
  const handleAccept = () => setEditing(true);

  if (editing) {
    return <SuggestionAcceptEditor suggestion={suggestion} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="pending-suggestion-card">
      <div className="suggestion-header">
        <span className={`suggestion-type type-${suggestion.type}`}>{typeLabel(suggestion.type)}</span>
        <span className="suggestion-target">{suggestion.target}</span>
      </div>
      <p className="suggestion-reason">{suggestion.reason}</p>
      <div className="suggestion-confidence">
        <span className="confidence-label">置信度</span>
        <div className="confidence-bar">
          <div className="confidence-fill" style={{ width: `${(suggestion.metadata?.confidence || 0) * 100}%` }} />
        </div>
        <span className="confidence-value">{Math.round((suggestion.metadata?.confidence || 0) * 100)}%</span>
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

### 3.3 SuggestionAcceptEditor（内联在 PendingSuggestionCard.jsx）

**职责**：
- 根据 suggestion.type 渲染不同的编辑表单
- 用户确认后调用对应的 store action 写入偏好，并调 `updateSuggestionStatus(id, 'accepted')`
- 取消则回到卡片模式（不修改 status）

**type='track' 表单**：
- 字段：target（关键词，预填 suggestion.target）、note（备注，预填 suggestion.reason）
- 提交：调 `setSpecialFollows(prev => [...prev, { id: uuid, type: 'keyword', target, note }])`
- 幂等检查：如果 specialFollows 中已存在相同 type=keyword 且 target（小写）相同的项，提示"该关键词已存在"，不写入

**type='boost' 表单**：
- 字段：target（领域，预填 suggestion.target，只读）、tier（单选：focus / normal，默认 focus）
- 提交：调 `setDomainTiers(prev => ({ ...prev, [target]: tier }))`

**type='mute' 表单**：
- 字段：target（来源，预填 suggestion.target，只读）、tier（单选：explore / normal，默认 explore）
- 提交：调 `setSourceTiers(prev => ({ ...prev, [target]: tier }))`

**通用流程**：
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
    if (!ok) return; // 幂等检查失败，提示已存在
    updateSuggestionStatus(suggestion.id, 'accepted');
    showToast('已接受建议，写入偏好');
    onDone();
  };

  return (
    <div className="suggestion-accept-editor">
      {/* 按 type 渲染不同表单字段 */}
      <div className="editor-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSubmit}>确认写入</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
```

**applySuggestionByType 纯函数**（抽离到同文件顶部，便于测试）：

```js
export function applySuggestionByType(suggestion, formState, stores) {
  const { type, target: origTarget } = suggestion;
  const { setSpecialFollows, setDomainTiers, setSourceTiers, specialFollows } = stores;

  if (type === 'track') {
    const target = (formState.target || '').trim();
    if (!target) { showToast('请输入关键词'); return false; }
    const duplicate = specialFollows.some(item =>
      item.type === 'keyword' && item.target.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (duplicate) { showToast('该关键词已存在'); return false; }
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
```

### 3.4 useAgentMemories hook

**文件**：`src/hooks/useAgentMemories.js`（新建）

**职责**：封装 agent_memories 的 CRUD 操作，返回响应式状态

**API**：

```js
export function useAgentMemories() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [memoryType, setMemoryType] = useState(''); // '' = all
  const [searchQuery, setSearchQuery] = useState('');

  const refresh = useCallback(async () => { /* GET /api/agent-memory/list */ }, [page, pageSize, memoryType]);
  const search = useCallback(async (q) => { /* GET /api/agent-memory/search */ }, []);
  const remove = useCallback(async (id) => { /* DELETE /api/agent-memory/delete */ }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    items, total, loading, error,
    page, setPage, pageSize,
    memoryType, setMemoryType,
    searchQuery, setSearchQuery,
    refresh, search, remove,
  };
}
```

**响应数据格式**（来自 [server/agent/agentMemoryService.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/agent/agentMemoryService.js#L57-L85)）：

```js
// GET /api/agent-memory/list?agentId=&memoryType=&limit=20&offset=0
{
  ok: true,
  memories: [
    {
      id: 'uuid',
      agent_id: 'orchestrator',
      session_id: 'sess-xxx' | null,
      memory_type: 'user_habit',
      content: '用户偏好简洁回复',
      evidence: [{ type: 'message', snippet: '...' }],
      weight: 3,
      created_at: '2026-07-28T10:00:00Z',
      expires_at: null,
    }
  ]
}
```

**注意**：当前后端 `getAgentMemories` 不返回 total 字段，前端需通过 `memories.length < pageSize` 判断是否最后一页（hasMore = memories.length === pageSize）。

### 3.5 AgentMemorySection

**文件**：`src/components/profile/AgentMemorySection.jsx`（新建）

**职责**：
- 调用 `useAgentMemories` hook
- 顶部工具栏：memory_type 下拉过滤（5 类）+ 搜索框（输入后调 search）
- 列表渲染：每条 memory 显示 memory_type 标签 + content + created_at + 可展开 evidence
- 单条删除按钮
- 分页控件（上一页 / 下一页 / 第 N 页）

**memory_type 选项**（来自 [server/http/agentMemoryHandlers.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/http/agentMemoryHandlers.js#L11)）：
- 全部
- 习惯（user_habit）
- 想法（user_thought）
- 特质（user_trait）
- 需求（user_need）
- 洞察（agent_insight）

### 3.6 useAgentWorkflowRunner.js 双源消除

**文件**：`src/hooks/useAgentWorkflowRunner.js`（修改 L212-258）

**改动**：
1. 删除内联 `const buildProfileMemory = () => { ... }`（L212-258）
2. 顶部 import：`import { buildProfileMemory } from '../utils/workflowEngine.js'`
3. 调用点（原 L361）改为：
   ```js
   const ctx = {
     addPendingSuggestions: (suggestions) => useProfileStore.getState().addPendingSuggestions(suggestions),
     getCategoryLabel, // 原 useAgentWorkflowRunner 内部已有的 helper
   };
   const profileMemory = buildProfileMemory(scopedAgentItems, intelligenceProfile, trackedTerms, bookmarks, materials, ctx);
   ```

**注意**：`workflowEngine.js` 版本 L97-142 已经处理了 `ctx.addPendingSuggestions` 调用，逻辑与内联版等价。差异点：
- workflowEngine.js 版用 `items.forEach` 提取 category，内联版用 `scopedAgentItems.forEach`——实际是同一份数据
- workflowEngine.js 版的 reason 文案与内联版一致

消除后，`buildProfileMemory` 唯一权威实现在 `workflowEngine.js`，便于未来扩展（如新增 type='mute' 写入逻辑）。

---

## 4. ProfilePage.jsx 集成

### 4.1 插入位置

**PendingSuggestionsSection**：在 `profile-hero` section（[L85](file:///e:/VStudio_Project/Silicon%20Meridian/src/components/ProfilePage.jsx#L85) 闭合 `</section>`）之后、`BlockGrid`（[L87](file:///e:/VStudio_Project/Silicon%20Meridian/src/components/ProfilePage.jsx#L87)）之前。

**AgentMemorySection**：在 `profile-memory-panel`（[L240-L258](file:///e:/VStudio_Project/Silicon%20Meridian/src/components/ProfilePage.jsx#L240-L258)）之后，作为页面底部最后一个 section。

### 4.2 import 与调用

```jsx
// src/components/ProfilePage.jsx 顶部新增 import
import PendingSuggestionsSection from './profile/PendingSuggestionsSection.jsx';
import AgentMemorySection from './profile/AgentMemorySection.jsx';

// JSX 中插入
<section className="product-hero profile-hero">...</section>

<PendingSuggestionsSection />  {/* 新增 */}

<BlockGrid columns={3}>...</BlockGrid>
...

<section className="profile-memory-panel">...</section>

<AgentMemorySection />  {/* 新增 */}
```

无需新增 props——两个 section 都直接读 store 或调用 hook。

---

## 5. 错误处理与边界

### 5.1 PendingSuggestionsSection

- pendingSuggestions 为空：显示 empty state
- 全部已 accepted/rejected（无 pending）：同 empty state
- pruneExpiredSuggestions 失败：静默忽略（store action 本身不会抛错）

### 5.2 PendingSuggestionCard

- suggestion.metadata 缺失：confidence 显示 0%
- suggestion.type 未知：不渲染操作按钮，仅展示内容
- 接受时幂等检查失败：toast 提示"该关键词已存在"，不写入、不改 status

### 5.3 useAgentMemories

- 未登录（401）：显示"请先登录"提示，不发起请求
- 网络错误：显示错误条 + 重试按钮
- 空列表：显示"暂无 AI 记忆"
- 删除失败：toast 提示，列表保持原状
- 搜索空字符串：等价于 refresh（拉列表）

### 5.4 跨设备同步

- pendingSuggestions **不同步**（spec §6.6 明确）。每台设备的 pendingSuggestions 是独立的，因为 AI 建议是设备本地 workflow 产生的
- agent_memories **已同步**（PG 表，跨设备一致）

---

## 6. 测试策略

### 6.1 单元测试（纯函数）

**applySuggestionByType 测试**（在 PendingSuggestionCard.jsx 同文件或独立 test 文件）：

```js
describe('applySuggestionByType', () => {
  it('track type adds keyword to specialFollows', () => {
    const stores = { setSpecialFollows: vi.fn(), specialFollows: [] };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU' },
      { target: 'GPU', note: 'reason' },
      stores
    );
    expect(ok).toBe(true);
    expect(stores.setSpecialFollows).toHaveBeenCalledWith(expect.any(Function));
  });

  it('track type rejects duplicate keyword (case-insensitive)', () => {
    const stores = {
      setSpecialFollows: vi.fn(),
      specialFollows: [{ type: 'keyword', target: 'GPU' }],
    };
    const ok = applySuggestionByType(
      { type: 'track', target: 'GPU' },
      { target: 'gpu', note: '' },
      stores
    );
    expect(ok).toBe(false);
    expect(stores.setSpecialFollows).not.toHaveBeenCalled();
  });

  it('boost type sets domainTiers[target] to focus', () => {
    const stores = { setDomainTiers: vi.fn() };
    const ok = applySuggestionByType(
      { type: 'boost', target: 'ai' },
      { tier: 'focus' },
      stores
    );
    expect(ok).toBe(true);
    expect(stores.setDomainTiers).toHaveBeenCalled();
  });

  it('mute type sets sourceTiers[target] to explore', () => {
    const stores = { setSourceTiers: vi.fn() };
    const ok = applySuggestionByType(
      { type: 'mute', target: 'src-1' },
      { tier: 'explore' },
      stores
    );
    expect(ok).toBe(true);
    expect(stores.setSourceTiers).toHaveBeenCalled();
  });

  it('unknown type returns false', () => {
    const ok = applySuggestionByType({ type: 'unknown', target: 'x' }, {}, {});
    expect(ok).toBe(false);
  });
});
```

### 6.2 useAgentMemories hook 测试

抽离纯函数 `buildListQuery(params)` 和 `parseListResponse(payload)` 进行测试：

```js
describe('buildListQuery', () => {
  it('builds query with all params', () => {
    const q = buildListQuery({ page: 1, pageSize: 10, memoryType: 'user_habit' });
    expect(q).toEqual({ agentId: undefined, memoryType: 'user_habit', limit: 10, offset: 10 });
  });

  it('omits memoryType when empty', () => {
    const q = buildListQuery({ page: 0, pageSize: 10, memoryType: '' });
    expect(q.memoryType).toBeUndefined();
  });
});

describe('parseListResponse', () => {
  it('extracts memories array and computes hasMore', () => {
    const parsed = parseListResponse({ ok: true, memories: Array(10).fill({}) }, 10);
    expect(parsed.items).toHaveLength(10);
    expect(parsed.hasMore).toBe(true);
  });

  it('hasMore is false when memories < pageSize', () => {
    const parsed = parseListResponse({ ok: true, memories: [{}] }, 10);
    expect(parsed.hasMore).toBe(false);
  });
});
```

### 6.3 测试范围

- 纯函数：`applySuggestionByType`（5 用例）+ `buildListQuery`/`parseListResponse`（4 用例）
- 现有 store 测试：Phase 1 已覆盖 pendingSuggestions actions（addPendingSuggestions 去重/冷却/容量/状态转换/过期清理）
- 不做组件渲染测试（无 @testing-library/react 依赖）

---

## 7. 实施步骤、风险与回滚

### 7.1 实施步骤（按依赖顺序）

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 1 | `src/hooks/useAgentWorkflowRunner.js` | 删除内联 buildProfileMemory，改调 workflowEngine.js | 无 |
| 2 | `src/components/profile/PendingSuggestionCard.jsx` | 新建，含 SuggestionAcceptEditor + applySuggestionByType 纯函数 | 1 |
| 3 | `src/components/profile/PendingSuggestionsSection.jsx` | 新建 | 2 |
| 4 | `src/components/ProfilePage.jsx` | 接入 PendingSuggestionsSection | 3 |
| 5 | `src/hooks/useAgentMemories.js` | 新建 | 无 |
| 6 | `src/components/profile/AgentMemorySection.jsx` | 新建 | 5 |
| 7 | `src/components/ProfilePage.jsx` | 接入 AgentMemorySection | 6 |
| 8 | `CLAUDE.md` | 文档更新 | 全部 |

### 7.2 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 删除 useAgentWorkflowRunner 内联版后 workflow 写入 pendingSuggestions 失效 | AI 建议不再生成 | ctx.addPendingSuggestions 传引用，与原逻辑等价；测试覆盖 |
| 接受建议写入 specialFollows 时幂等检查漏掉 | 重复写入 | applySuggestionByType 含大小写不敏感的 duplicate 检查 + 单测覆盖 |
| AgentMemorySection 拉取大量数据导致卡顿 | UI 卡顿 | pageSize=10 + 分页 + 搜索走服务端 |
| 后端 agent_memories 接口 401（未登录） | section 显示错误 | 显示"请先登录"提示，不阻塞页面其他 section |

**回滚**：每个 step 独立 commit，可 `git revert` 单个 commit 回滚。

### 7.3 验收清单

- [ ] 1. workflow 执行后 pendingSuggestions 出现新条目
- [ ] 2. ProfilePage 顶部看到 PendingSuggestionsSection 卡片
- [ ] 3. 接受 track 建议 → specialFollows 新增 keyword 项
- [ ] 4. 接受 boost 建议 → domainTiers[target] 升级
- [ ] 5. 接受 mute 建议 → sourceTiers[target] 降级
- [ ] 6. 拒绝建议 → status='rejected'，卡片消失
- [ ] 7. 接受后与 AI 对话，prompt 中包含"【最近校准】"段
- [ ] 8. ProfilePage 底部 AgentMemorySection 显示 agent_memories 列表
- [ ] 9. memory_type 过滤正常工作
- [ ] 10. 搜索功能正常工作
- [ ] 11. 单条删除后列表刷新
- [ ] 12. 分页正常工作（上一页/下一页）
- [ ] 13. 全量测试通过（347 + ~9 新增 = ~356）
- [ ] 14. build 成功

---

## 8. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 接受建议时是否直接写入 | 弹窗确认后写入 | 用户主权原则——AI 建议 ≠ 用户决定，需用户确认或修改后才生效 |
| 拒绝 vs 稍后 | 都映射为 'rejected' | 简化状态机；'稍后'语义上等价于'本次不接受'，避免新增 'later' 状态 |
| agent_memories 展示形态 | 完整 CRUD | 用户要求看到 AI 对自己的累积观察并可控，需删除能力以保障用户主权 |
| pendingSuggestions 跨设备同步 | 不同步 | AI 建议是设备本地 workflow 产生，跨设备同步语义复杂；agent_memories 已是跨设备来源 |
| AiChat 接入 fetchRelevantMemories | 不做 | 范围控制；保留 Phase 3 与推荐算法 LLM 增强一起做 |
| personaSummary 在 workflow 触发 | 不做 | 范围控制；保持 AiChat 路径单一触发源，避免 personaSummary 频繁更新 |
| AgentMemorySection 分页判断 | hasMore = items.length === pageSize | 后端不返回 total，前端通过"满页"判断 |
| 测试策略 | 纯函数单测 | 项目无 @testing-library/react 依赖，遵循 Phase 1 模式（抽离纯函数测试） |

---

## 9. 后续阶段衔接

| Phase 2 产出 | Phase 3 如何使用 |
|---|---|
| pendingSuggestions 接受 UI 激活 | LLM 推荐增强读 accepted suggestions 作为上下文 |
| agent_memories 可见性 | 用户可清理错误记忆，提升 personaSummary 质量 |
| buildProfileMemory 双源消除 | Phase 3 可扩展 buildProfileMemory 生成 type='mute' 建议 |
| useAgentMemories hook | Phase 3 可在推荐算法中调 fetchRelevantMemories 注入 LLM prompt |
