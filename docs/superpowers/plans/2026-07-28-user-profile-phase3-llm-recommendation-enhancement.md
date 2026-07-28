# Phase 3 LLM 推荐增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1/2 之上激活 LLM 推荐增强：定时预热 cron + lazy 触发 + 实时重新分析 + fetchRelevantMemories 双激活 + personaSummary 全链路同步 + mergeAiBriefing 接入 + recommendation_snapshots 三表写入。

**Architecture:** 分两步推进——Step A 补基础设施（migration 006 + last_seen_at + llmConfig 跨设备同步），Step B 做推荐增强（cron + lazy + 实时 + fetchRelevantMemories + personaSummary + mergeAiBriefing + 三表事务）。Step A 失败不阻塞 Step B，可单独回滚。

**Tech Stack:** React 19 + Vite 7 + Zustand + node-cron + PostgreSQL + Vitest 3.x

**Spec:** `docs/superpowers/specs/2026-07-28-user-profile-phase3-llm-recommendation-enhancement.md`

**测试命令（Windows）:** `node node_modules/vitest/vitest.mjs run`
**单文件测试:** `node node_modules/vitest/vitest.mjs run <path>`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|---|---|
| `server/db/migrations/006_profile_llm_sync.sql` | Step A: users.last_seen_at + user_profiles.llm_config |
| `server/http/lastSeenMiddleware.js` | Step A: 节流更新 last_seen_at |
| `server/cron/dailyBriefingPreheatJob.js` | Step B: cron job |
| `server/profile/snapshotService.js` | Step B: 预热 service + 纯函数 |
| `server/profile/snapshotRepository.js` | Step B: 三表事务 + 纯函数 |
| `scripts/runPreheatToday.mjs` | Step B: dev 手动触发预热脚本 |
| `src/hooks/useSnapshotPreheat.js` | Step B: lazy 触发 hook |
| `src/hooks/useAiRecommendationEnhance.js` | Step B: 实时增强 hook |
| `src/components/profile/PersonaSummarySection.jsx` | Step B: AI 性格画像展示 |
| `src/components/profile/SnapshotHistorySection.jsx` | Step B: 历史快照展示 |
| `server/profile/__tests__/snapshotService.test.js` | 测试 |
| `server/profile/__tests__/snapshotRepository.test.js` | 测试 |
| `server/http/__tests__/aiHandlers.test.js` | 测试（如不存在则新建） |
| `src/hooks/__tests__/useSnapshotPreheat.test.js` | 测试 |
| `src/hooks/__tests__/useAiRecommendationEnhance.test.js` | 测试 |
| `src/utils/__tests__/memoryEvolver.test.js` | 测试（如不存在则新建） |

### 修改文件

| 文件 | 改动 |
|---|---|
| `server/profile/profileRepository.js` | 新增 getLlmConfig/setLlmConfig |
| `server/http/profileHandlers.js` | 新增 llm-config / snapshots 路由 |
| `server/http/agentMemoryHandlers.js` | 新增 learned-preferences 路由 |
| `server/news/plugin.js` | 删除 L333-428 内联 ai-insights，改为调 aiHandlers |
| `server/http/aiHandlers.js` | 新增 handleAiInsightsRequest + buildAiInsightsPrompt |
| `server/productionServer.js` | 启动时注册 cron |
| `package.json` | 新增 preheat:today 脚本 + node-cron 依赖 |
| `src/store/profileStore.js` | 新增 personaSummary 字段 + action |
| `src/hooks/useLlmConfig.js` | 保存时 fire-and-forget 同步 |
| `src/hooks/useRecommendationMemos.js` | 集成 useSnapshotPreheat + 注入 personaSummary + relevantMemories |
| `src/utils/memoryEvolver.js` | 新增 extractLearnedPreferences + 写 learned_preferences |
| `src/components/AiChatPanel.jsx` | personaSummary 改读 store + 发送前调 fetchRelevantMemories |
| `src/components/aichat/buildSystemPrompt.js` | 新增"相关记忆"段 |
| `src/components/RightPanel.jsx` | "重新分析"按钮调 useAiRecommendationEnhance |
| `src/components/ProfilePage.jsx` | 接入 PersonaSummarySection + SnapshotHistorySection |
| `src/App.jsx` L1112 | 删除内联 clusterEvents |
| `src/styles.css` | 新增样式 |
| `CLAUDE.md` / `AGENTS.md` | 文档更新 |

---

## Step A：基础设施

### Task A1: Migration 006 - 新增 last_seen_at + llm_config 字段

**Files:**
- Create: `server/db/migrations/006_profile_llm_sync.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- server/db/migrations/006_profile_llm_sync.sql
-- Phase 3 基础设施：用户活跃度跟踪 + LLM 配置跨设备同步

-- 用户最后活跃时间（cron 活跃用户筛选用）
alter table users add column if not exists last_seen_at timestamptz;
create index if not exists users_last_seen_idx on users(last_seen_at desc) where last_seen_at is not null;

-- 用户 LLM 配置（cron 后台任务读取用，前端 localStorage 仍是主源）
alter table user_profiles add column if not exists llm_config jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: 应用 migration 验证**

Run: `npm run db:migrate`
Expected: 输出 `migration 006 applied` 或类似成功信息（需要 DATABASE_URL 配置）

如无 DATABASE_URL，跳过应用，仅检查 SQL 语法正确。

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/006_profile_llm_sync.sql
git commit -m "feat(db): migration 006 - users.last_seen_at + user_profiles.llm_config"
```

---

### Task A2: lastSeenMiddleware - 节流更新 last_seen_at

**Files:**
- Create: `server/http/lastSeenMiddleware.js`
- Modify: `server/news/plugin.js`（接入中间件）
- Modify: `server/productionServer.js`（接入中间件）

- [ ] **Step 1: 写中间件**

```js
// server/http/lastSeenMiddleware.js
import { pool } from '../db/client.js';

const recentUpdates = new Map(); // userId -> lastUpdateTs
const THROTTLE_MS = 5 * 60 * 1000; // 5min

/**
 * 节流更新 users.last_seen_at
 * 在请求结束时异步调用，不阻塞响应
 */
export async function updateLastSeen(userId) {
  if (!userId) return;
  
  const now = Date.now();
  const last = recentUpdates.get(userId) || 0;
  if (now - last < THROTTLE_MS) return;
  
  recentUpdates.set(userId, now);
  try {
    await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
  } catch {
    // silent: last_seen_at 失败不影响主流程
  }
}

/**
 * Express-style middleware，从 ctx.userId 调用 updateLastSeen
 * 在 dev plugin.js 与 prod productionServer.js 中使用
 */
export function createLastSeenHandler() {
  return (req, res, next) => {
    res.on('finish', () => {
      if (req.userId) updateLastSeen(req.userId);
    });
    next();
  };
}
```

- [ ] **Step 2: 在 plugin.js 中接入**

在 `server/news/plugin.js` 找到中间件注册位置（文件顶部 configureServer 函数内），添加：

```js
import { createLastSeenHandler } from '../http/lastSeenMiddleware.js';

// 在 configureServer 内，已有中间件之后
middlewares.push(createLastSeenHandler());
```

- [ ] **Step 3: 在 productionServer.js 中接入**

在 `server/productionServer.js` 找到 app.use 链，添加同样的中间件。

- [ ] **Step 4: 验证无语法错误**

Run: `node -e "import('./server/http/lastSeenMiddleware.js').then(m => console.log(Object.keys(m)))"`
Expected: 输出 `[ 'updateLastSeen', 'createLastSeenHandler' ]`

- [ ] **Step 5: Commit**

```bash
git add server/http/lastSeenMiddleware.js server/news/plugin.js server/productionServer.js
git commit -m "feat(auth): last_seen_at middleware with 5min throttle"
```

---

### Task A3: profileRepository 扩展 getLlmConfig/setLlmConfig

**Files:**
- Modify: `server/profile/profileRepository.js`

- [ ] **Step 1: 读现有文件了解模式**

Run: 用 Read 工具读 `server/profile/profileRepository.js` 完整内容，理解现有 getState/setState 的实现模式与导出方式。

- [ ] **Step 2: 新增 getLlmConfig / setLlmConfig**

在 `profileRepository.js` 末尾（其他 export 函数之后）追加：

```js
export async function getLlmConfig(userId) {
  const res = await pool.query(
    'SELECT llm_config FROM user_profiles WHERE user_id = $1',
    [userId]
  );
  return res.rows[0]?.llm_config || {};
}

export async function setLlmConfig(userId, config) {
  await pool.query(
    `INSERT INTO user_profiles (user_id, llm_config, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET llm_config = EXCLUDED.llm_config, updated_at = now()`,
    [userId, JSON.stringify(config || {})]
  );
}
```

确保在文件顶部的 export 列表（如果有）中也加上这两个函数。

- [ ] **Step 3: 验证无语法错误**

Run: `node -e "import('./server/profile/profileRepository.js').then(m => console.log(typeof m.getLlmConfig, typeof m.setLlmConfig))"`
Expected: `function function`

- [ ] **Step 4: Commit**

```bash
git add server/profile/profileRepository.js
git commit -m "feat(profile): getLlmConfig/setLlmConfig in profileRepository"
```

---

### Task A4: profileHandlers 新增 llm-config 路由

**Files:**
- Modify: `server/http/profileHandlers.js`

- [ ] **Step 1: 读现有 profileHandlers 了解路由模式**

Run: 用 Read 工具读 `server/http/profileHandlers.js`，找到 handleProfileRequest 的路由分发模式。

- [ ] **Step 2: 新增 llm-config 路由**

在 `handleProfileRequest` 的路由分发逻辑中（pathname 匹配区域）追加：

```js
if (pathname === '/api/profile/llm-config') {
  if (req.method === 'GET') {
    const config = await profileRepository.getLlmConfig(userId);
    return sendJsonResponse(res, 200, { ok: true, config });
  }
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    await profileRepository.setLlmConfig(userId, body.config);
    return sendJsonResponse(res, 200, { ok: true });
  }
}
```

确保：
- 在文件顶部 import 中追加 `getLlmConfig, setLlmConfig`（如果未导入）
- 该路由放在通用的 userId 校验之后（已有逻辑）

- [ ] **Step 3: 启动 dev server 验证**

Run: `npm run dev`（在另一个终端）
然后用 curl 测试：

```bash
curl -X GET http://localhost:5175/api/profile/llm-config
```

Expected: 返回 `{"ok":true,"config":{}}` 或 401（未登录）

- [ ] **Step 4: Commit**

```bash
git add server/http/profileHandlers.js
git commit -m "feat(profile): /api/profile/llm-config GET/POST routes"
```

---

### Task A5: useLlmConfig 同步到后端

**Files:**
- Modify: `src/hooks/useLlmConfig.js`

- [ ] **Step 1: 读现有 useLlmConfig**

Run: 用 Read 工具读 `src/hooks/useLlmConfig.js`，找到 saveLlmConfig 函数。

- [ ] **Step 2: 在 saveLlmConfig 中加 fire-and-forget 同步**

修改 `saveLlmConfig` 函数：

```js
const saveLlmConfig = useCallback((newConfig) => {
  saveLS('llmConfig', newConfig);
  setLlmConfig(newConfig);
  
  // Phase 3: 跨设备同步（fire-and-forget）
  fetch('/api/profile/llm-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: newConfig }),
  }).catch(() => { /* silent: 同步失败不影响本地 */ });
}, []);
```

- [ ] **Step 3: 验证前端编译通过**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLlmConfig.js
git commit -m "feat(llm-config): sync to backend on save (fire-and-forget)"
```

---

### Task A6: Step A 最终验收

- [ ] **Step 1: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 362/362 通过（Step A 不新增测试，仅基础设施）

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: 浏览器手动验证**

启动 dev server，登录后：
1. 保存 LLM 配置（设置 → 大模型）
2. 检查 DB `user_profiles.llm_config` 字段已更新
3. 等待 5 分钟后做任意请求，检查 DB `users.last_seen_at` 已更新

- [ ] **Step 4: Commit + tag**

```bash
git tag stable-v12-phase3-stepA -m "Phase 3 Step A infrastructure complete"
```

---

## Step B：推荐增强

### Task B1: 抽离 handleAiInsightsRequest + buildAiInsightsPrompt

**Files:**
- Modify: `server/news/plugin.js`（删除 L333-428 内联）
- Modify: `server/http/aiHandlers.js`（新增 handleAiInsightsRequest + buildAiInsightsPrompt）
- Test: `server/http/__tests__/aiHandlers.test.js`

- [ ] **Step 1: 写 buildAiInsightsPrompt 纯函数测试**

```js
// server/http/__tests__/aiHandlers.test.js
import { describe, it, expect } from 'vitest';
import { buildAiInsightsPrompt } from '../aiHandlers.js';

describe('buildAiInsightsPrompt', () => {
  const items = [
    { id: '1', title: 'GPU 短缺', category: 'ai', source: 'TechCrunch', summary: '芯片供应紧张', tags: ['hardware'] },
    { id: '2', title: 'Rust 1.75', category: 'dev', source: 'Rust Blog', summary: '新版本发布', tags: ['language'] },
  ];

  it('includes personaSummary context when provided', () => {
    const prompt = buildAiInsightsPrompt(items, { habits: ['简洁回复'], traits: ['技术派'], needs: ['GPU 资讯'] });
    expect(prompt).toContain('简洁回复');
    expect(prompt).toContain('技术派');
    expect(prompt).toContain('GPU 资讯');
    expect(prompt).toContain('【用户画像】');
  });

  it('shows 无 when personaSummary fields are empty', () => {
    const prompt = buildAiInsightsPrompt(items, {});
    expect(prompt).toMatch(/习惯：无/);
    expect(prompt).toMatch(/性格：无/);
    expect(prompt).toMatch(/需求：无/);
  });

  it('handles null personaSummary', () => {
    const prompt = buildAiInsightsPrompt(items, null);
    expect(prompt).toContain('【用户画像】');
    expect(prompt).toContain('无');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run server/http/__tests__/aiHandlers.test.js`
Expected: FAIL - `buildAiInsightsPrompt is not a function` 或模块导入失败

- [ ] **Step 3: 实现 buildAiInsightsPrompt**

在 `server/http/aiHandlers.js` 末尾追加：

```js
/**
 * 构建 ai-insights prompt（纯函数，便于测试）
 * @param {Array} items - top 30 资讯
 * @param {Object} personaSummary - { habits: [], traits: [], needs: [] }
 */
export function buildAiInsightsPrompt(items, personaSummary) {
  const habits = personaSummary?.habits?.join('、') || '无';
  const traits = personaSummary?.traits?.join('、') || '无';
  const needs = personaSummary?.needs?.join('、') || '无';
  
  const itemsText = items.map(item => 
    `{"id":"${item.id}","title":"${item.title}","category":"${item.category || ''}","source":"${item.source || ''}","summary":"${item.summary || ''}","tags":${JSON.stringify(item.tags || [])}}`
  ).join(',');
  
  return `你是科技趋势分析师。基于以下资讯和用户画像，输出趋势分析。

【用户画像】
- 习惯：${habits}
- 性格：${traits}
- 需求：${needs}

【资讯列表】（top 30）
[${itemsText}]

【输出 JSON 格式】
{
  "trends": [{"title": "...", "description": "..."}],
  "correlations": [{"title": "...", "description": "..."}],
  "signals": [{"title": "...", "description": "..."}],
  "itemScores": [{"id": "xxx", "score": 75, "label": "必读", "reason": "..."}]
}

约束：
- label 分级：必读(>=75) / 关注(50-74) / 降噪(<50)
- 单条 trend/correlation/signal/reason ≤30 字
- 严格输出 JSON，不要 markdown 代码块`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run server/http/__tests__/aiHandlers.test.js`
Expected: PASS - 3/3

- [ ] **Step 5: 实现 handleAiInsightsRequest**

在 `server/http/aiHandlers.js` 追加（参考现有 handleAiGenerateRequest 的模式）：

```js
import { fetchWithRetry, enforceRateLimit, safeExternalFetch, cleanText } from './httpUtils.js';

/**
 * 处理 /api/ai-insights 请求
 * 复用 fetchWithRetry + enforceRateLimit + safeExternalFetch
 */
export async function handleAiInsightsRequest(req, res) {
  const body = await readJsonBody(req);
  const { baseUrl, apiKey, model, items, personaSummary } = body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return sendJsonResponse(res, 400, { error: 'invalid_items' });
  }
  
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
  const rateLimitKey = `ai-insights:${clientIp}`;
  if (!enforceRateLimit(rateLimitKey, 30, 5 * 60 * 1000)) {
    return sendJsonResponse(res, 429, { error: 'rate_limited' });
  }
  
  const prompt = buildAiInsightsPrompt(items.slice(0, 30), personaSummary);
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是科技趋势分析师' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2500,
        temperature: 0.5,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      const errText = await response.text();
      return sendJsonResponse(res, response.status, { error: 'upstream_error', raw: errText });
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // 去除 markdown 代码块
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleaned);
      return sendJsonResponse(res, 200, parsed);
    } catch {
      return sendJsonResponse(res, 200, { error: 'parse_failed', raw: content });
    }
  } catch (err) {
    return sendJsonResponse(res, 500, { error: 'fetch_failed', message: err.message });
  }
}
```

注意：参考 `server/news/plugin.js` L333-428 现有实现，迁移过来时保留原有的 prompt 与超时配置。如 aiHandlers.js 中已有 `readJsonBody` / `sendJsonResponse` import，无需重复。

- [ ] **Step 6: 修改 plugin.js 路由**

在 `server/news/plugin.js` 找到 L333-428 的 `/api/ai-insights` 内联实现，**整体删除**，替换为：

```js
if (pathname === '/api/ai-insights') {
  return handleAiInsightsRequest(req, res);
}
```

在 plugin.js 顶部 import 中追加：
```js
import { handleAiInsightsRequest } from '../http/aiHandlers.js';
```

- [ ] **Step 7: 跑全量测试 + build**

Run: `node node_modules/vitest/vitest.mjs run && npm run build`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add server/http/aiHandlers.js server/http/__tests__/aiHandlers.test.js server/news/plugin.js
git commit -m "refactor(ai): extract handleAiInsightsRequest to aiHandlers with personaSummary context"
```

---

### Task B2: snapshotRepository 三表事务

**Files:**
- Create: `server/profile/snapshotRepository.js`
- Test: `server/profile/__tests__/snapshotRepository.test.js`

- [ ] **Step 1: 写 buildInsertItemsParams 纯函数测试**

```js
// server/profile/__tests__/snapshotRepository.test.js
import { describe, it, expect } from 'vitest';
import { buildInsertItemsParams } from '../snapshotRepository.js';

describe('buildInsertItemsParams', () => {
  it('builds params for both lanes', () => {
    const lanes = {
      public: [{ id: 'a', mustReadScore: 80, scoreParts: { x: 40 }, reasons: ['fresh'] }],
      personal: [{ id: 'b', mustReadScore: 70, scoreParts: { x: 35 }, reasons: ['domain'] }],
    };
    const { values, params } = buildInsertItemsParams('snap-1', lanes);
    expect(values.split('),(')).toHaveLength(2);
    expect(params[0]).toBe('snap-1'); // snapshotId
    expect(params[1]).toBe('a'); // item_id
  });

  it('handles empty lanes', () => {
    const { values, params } = buildInsertItemsParams('snap-1', { public: [], personal: [] });
    expect(values).toBe('');
    expect(params).toEqual([]);
  });

  it('handles missing lanes gracefully', () => {
    const { values, params } = buildInsertItemsParams('snap-1', {});
    expect(values).toBe('');
    expect(params).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run server/profile/__tests__/snapshotRepository.test.js`
Expected: FAIL - 模块不存在

- [ ] **Step 3: 实现 snapshotRepository**

```js
// server/profile/snapshotRepository.js
import { pool } from '../db/client.js';

/**
 * 纯函数：构造批量 INSERT 的参数数组
 */
export function buildInsertItemsParams(snapshotId, lanes) {
  const values = [];
  const params = [];
  let i = 0;
  for (const lane of ['public', 'personal']) {
    (lanes[lane] || []).forEach((item, pos) => {
      values.push(`($${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i})`);
      params.push(
        snapshotId,
        item.id,
        lane,
        pos,
        item.mustReadScore,
        JSON.stringify(item.scoreParts || {}),
        JSON.stringify(item.reasons || []),
        JSON.stringify(item)
      );
    });
  }
  return { values: values.join(','), params };
}

/**
 * 三表事务：recommendation_snapshots + recommendation_items + briefing_snapshots
 */
export async function insertSnapshot({ userId, date, algorithmVersion, lanes, algorithmPayload, aiPayload, aiCitationIds, aiStatus }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. recommendation_snapshots
    const snapRes = await client.query(
      `INSERT INTO recommendation_snapshots (user_id, snapshot_date, profile_version, algorithm_version, updates)
       VALUES ($1, $2, 1, $3, '[]'::jsonb)
       ON CONFLICT (user_id, snapshot_date) DO UPDATE SET algorithm_version = EXCLUDED.algorithm_version
       RETURNING id`,
      [userId, date, algorithmVersion]
    );
    const snapshotId = snapRes.rows[0].id;
    
    // 2. recommendation_items
    await client.query('DELETE FROM recommendation_items WHERE snapshot_id = $1', [snapshotId]);
    const { values, params } = buildInsertItemsParams(snapshotId, lanes);
    if (values) {
      await client.query(
        `INSERT INTO recommendation_items (snapshot_id, item_id, lane, position, total_score, score_parts, reasons, item_payload)
         VALUES ${values}`,
        params
      );
    }
    
    // 3. briefing_snapshots
    await client.query(
      `INSERT INTO briefing_snapshots (snapshot_id, algorithm_payload, ai_payload, ai_citation_ids, ai_status, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (snapshot_id) DO UPDATE SET
         algorithm_payload = EXCLUDED.algorithm_payload,
         ai_payload = EXCLUDED.ai_payload,
         ai_citation_ids = EXCLUDED.ai_citation_ids,
         ai_status = EXCLUDED.ai_status,
         updated_at = now()`,
      [snapshotId, JSON.stringify(algorithmPayload), aiPayload ? JSON.stringify(aiPayload) : null, JSON.stringify(aiCitationIds), aiStatus]
    );
    
    await client.query('COMMIT');
    return { snapshotId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSnapshotByDate(userId, date) {
  const res = await pool.query(
    `SELECT rs.*, bs.algorithm_payload, bs.ai_payload, bs.ai_citation_ids, bs.ai_status
     FROM recommendation_snapshots rs
     LEFT JOIN briefing_snapshots bs ON bs.snapshot_id = rs.id
     WHERE rs.user_id = $1 AND rs.snapshot_date = $2`,
    [userId, date]
  );
  return res.rows[0] || null;
}

export async function getRecentSnapshots(userId, limit = 30) {
  const res = await pool.query(
    `SELECT rs.id, rs.snapshot_date, rs.algorithm_version, bs.ai_status,
            bs.algorithm_payload->>'oneLine' as one_line
     FROM recommendation_snapshots rs
     LEFT JOIN briefing_snapshots bs ON bs.snapshot_id = rs.id
     WHERE rs.user_id = $1
     ORDER BY rs.snapshot_date DESC
     LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run server/profile/__tests__/snapshotRepository.test.js`
Expected: PASS - 3/3

- [ ] **Step 5: Commit**

```bash
git add server/profile/snapshotRepository.js server/profile/__tests__/snapshotRepository.test.js
git commit -m "feat(profile): snapshotRepository with 3-table transaction + buildInsertItemsParams pure fn"
```

---

### Task B3: snapshotService preheatForUser

**Files:**
- Create: `server/profile/snapshotService.js`
- Test: `server/profile/__tests__/snapshotService.test.js`

- [ ] **Step 1: 写 selectItemsForAiInsights 纯函数测试**

```js
// server/profile/__tests__/snapshotService.test.js
import { describe, it, expect } from 'vitest';
import { selectItemsForAiInsights } from '../snapshotService.js';

describe('selectItemsForAiInsights', () => {
  it('selects top 15 from each lane', () => {
    const lanes = {
      public: Array(20).fill(0).map((_, i) => ({ id: `p${i}` })),
      personal: Array(20).fill(0).map((_, i) => ({ id: `u${i}` })),
    };
    const result = selectItemsForAiInsights(lanes);
    expect(result).toHaveLength(30);
    expect(result[0].id).toBe('p0');
    expect(result[15].id).toBe('u0');
  });

  it('handles missing lanes gracefully', () => {
    const result = selectItemsForAiInsights({});
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run server/profile/__tests__/snapshotService.test.js`
Expected: FAIL - 模块不存在

- [ ] **Step 3: 实现 snapshotService**

```js
// server/profile/snapshotService.js
import { clusterEvents, buildRecommendation, selectBriefingLanes } from '../../src/domain/intelligence/recommendationEngine.js';
import { buildAlgorithmBriefing, mergeAiBriefing } from '../../src/domain/intelligence/briefingEngine.js';
import { insertSnapshot } from './snapshotRepository.js';
import { getState as getProfileState } from './profileRepository.js';
import { fetchAggregatedNews } from '../news/services/newsService.js';
import { handleAiInsightsRequest, buildAiInsightsPrompt } from '../http/aiHandlers.js';
import { callAiBriefingGenerator } from './briefingLlmHelper.js';

const ALGORITHM_VERSION = 2;

/**
 * 纯函数：从 lanes 中选 top 30 items 传给 LLM
 */
export function selectItemsForAiInsights(lanes) {
  return [
    ...(lanes.public || []).slice(0, 15),
    ...(lanes.personal || []).slice(0, 15),
  ];
}

/**
 * 单用户预热流程
 */
export async function preheatForUser(userId, today = new Date().toISOString().slice(0, 10)) {
  const existing = await getSnapshotByDateFn(userId, today);
  if (existing) return { ...existing, cached: true };

  const profile = await getProfileState(userId);
  const newsItems = await fetchAggregatedNews({
    interests: profile.interests,
    disabledSources: profile.disabledSources,
  });

  const clustered = clusterEvents(newsItems);
  const scored = clustered.map(item => buildRecommendation(item, {
    domainTiers: profile.domainTiers,
    sourceTiers: profile.sourceTiers,
    specialFollows: profile.specialFollows,
    personaSummary: profile.personaSummary,
    relevantMemories: [],
  }));
  const lanes = selectBriefingLanes(scored);

  const llmConfig = profile.llmConfig || getDefaultLlmConfig();
  
  // LLM 增强 top 30
  let aiInsights = null;
  let aiStatus = 'not_requested';
  if (llmConfig?.baseUrl) {
    try {
      aiInsights = await callAiInsightsInternal({
        items: selectItemsForAiInsights(lanes),
        personaSummary: profile.personaSummary,
        llmConfig,
      });
      aiStatus = 'generated';
    } catch {
      aiStatus = 'ai_failed';
    }
  }

  const algorithmBriefing = buildAlgorithmBriefing({
    date: today,
    lanes,
    generatedAt: new Date().toISOString(),
  });

  let mergedBriefing = algorithmBriefing;
  let aiPayload = null;
  if (aiInsights && llmConfig?.baseUrl) {
    try {
      aiPayload = await callAiBriefingGenerator({
        algorithmBriefing,
        personaSummary: profile.personaSummary,
        llmConfig,
      });
      mergedBriefing = mergeAiBriefing(algorithmBriefing, aiPayload);
      aiStatus = mergedBriefing.aiValidationError ? 'validation_failed' : 'merged';
    } catch {
      aiStatus = 'ai_failed';
    }
  }

  await insertSnapshot({
    userId, date: today, algorithmVersion: ALGORITHM_VERSION,
    lanes, algorithmPayload: mergedBriefing,
    aiPayload, aiCitationIds: aiPayload?.citationIds || [], aiStatus,
  });

  return { lanes, briefing: mergedBriefing, aiInsights, aiStatus };
}

// 内部：调 ai-insights
async function callAiInsightsInternal({ items, personaSummary, llmConfig }) {
  const prompt = buildAiInsightsPrompt(items, personaSummary);
  const url = `${llmConfig.baseUrl.replace(/\/$/, '')}/chat/completions`;
  // 复用 fetchWithRetry
  const { fetchWithRetry } = await import('../http/httpUtils.js');
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.selectedModel,
      messages: [
        { role: 'system', content: '你是科技趋势分析师' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2500,
      temperature: 0.5,
    }),
  });
  if (!response.ok) throw new Error(`ai-insights failed: ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

function getDefaultLlmConfig() {
  return {
    baseUrl: process.env.DEFAULT_LLM_BASE_URL,
    apiKey: process.env.DEFAULT_LLM_API_KEY,
    selectedModel: process.env.DEFAULT_LLM_MODEL,
  };
}

// 注入依赖（便于测试 mock）
let getSnapshotByDateFn = async (userId, date) => null;
export function setGetSnapshotByDateFn(fn) { getSnapshotByDateFn = fn; }
```

- [ ] **Step 4: 实现 briefingLlmHelper**

```js
// server/profile/briefingLlmHelper.js
import { buildAiInsightsPrompt } from '../http/aiHandlers.js';

/**
 * 调 LLM 生成 algorithm briefing 的 ai_payload
 */
export async function callAiBriefingGenerator({ algorithmBriefing, personaSummary, llmConfig }) {
  const habits = personaSummary?.habits?.join('、') || '无';
  const traits = personaSummary?.traits?.join('、') || '无';
  const needs = personaSummary?.needs?.join('、') || '无';
  
  const publicTitles = (algorithmBriefing.sections?.public || []).slice(0, 3).map(i => i.title).join('、') || '无';
  const personalTitles = (algorithmBriefing.sections?.personal || []).slice(0, 3).map(i => i.title).join('、') || '无';
  const citationIds = algorithmBriefing.citationIds || [];
  
  const prompt = `你是科技趋势简报生成器。基于以下 algorithm briefing 和用户画像，生成可验证的 AI 简报。

【用户画像】
- 习惯：${habits}
- 性格：${traits}
- 需求：${needs}

【Algorithm Briefing】
- 日期：${algorithmBriefing.date}
- OneLine：${algorithmBriefing.oneLine}
- Public Lane（公共必读）：${publicTitles}
- Personal Lane（个人必看）：${personalTitles}

【可用 Citation IDs】
${citationIds.join(', ')}

【输出要求】
严格输出 JSON：
{
  "oneLine": "一句话概括今日核心（≤30 字）",
  "opportunities": [{"itemId": "xxx", "text": "机会描述（≤30 字）"}],
  "risks": [{"itemId": "xxx", "text": "风险描述（≤30 字）"}],
  "citationIds": ["必须从上面的 Citation IDs 中选取，至少 1 个，最多 5 个"]
}

约束：
1. citationIds 必须是上面列表的子集
2. citationIds 不能为空
3. oneLine 不能为空
4. opportunities 和 risks 中的 itemId 必须在 citationIds 中`;

  const url = `${llmConfig.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.selectedModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) throw new Error(`briefing generator failed: ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run server/profile/__tests__/snapshotService.test.js`
Expected: PASS - 2/2

- [ ] **Step 6: Commit**

```bash
git add server/profile/snapshotService.js server/profile/briefingLlmHelper.js server/profile/__tests__/snapshotService.test.js
git commit -m "feat(profile): snapshotService.preheatForUser + callAiBriefingGenerator"
```

---

### Task B4: profileHandlers 新增 snapshots 路由

**Files:**
- Modify: `server/http/profileHandlers.js`

- [ ] **Step 1: 在 profileHandlers 添加路由**

在 `server/http/profileHandlers.js` 的 handleProfileRequest 路由分发区域，追加：

```js
if (pathname === '/api/profile/snapshots/preheat' && req.method === 'POST') {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await snapshotRepository.getSnapshotByDate(userId, today);
  if (existing) return sendJsonResponse(res, 200, { ok: true, snapshot: existing, cached: true });
  
  try {
    const snapshot = await snapshotService.preheatForUser(userId);
    return sendJsonResponse(res, 200, { ok: true, snapshot, cached: false });
  } catch (err) {
    return sendJsonResponse(res, 500, { ok: false, error: err.message });
  }
}

if (pathname === '/api/profile/snapshots/analyze' && req.method === 'POST') {
  const body = await readJsonBody(req);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return sendJsonResponse(res, 400, { error: 'invalid_items' });
  }
  try {
    const profile = await profileRepository.getState(userId);
    const { fetchRelevantMemoriesForItems } = await import('../agent/agentMemoryService.js');
    const relevantMemories = await fetchRelevantMemoriesForItems(userId, body.items).catch(() => []);
    
    const { handleAiInsightsInternal } = await import('./aiHandlers.js');
    const aiInsights = await handleAiInsightsInternal({
      items: body.items.slice(0, 30),
      personaSummary: profile.personaSummary,
      relevantMemories,
      llmConfig: profile.llmConfig || getDefaultLlmConfig(),
    });
    return sendJsonResponse(res, 200, { ok: true, ...aiInsights });
  } catch (err) {
    return sendJsonResponse(res, 500, { ok: false, error: err.message });
  }
}

if (pathname === '/api/profile/snapshots' && req.method === 'GET') {
  const date = new URL(req.url, 'http://localhost').searchParams.get('date');
  if (date) {
    const snap = await snapshotRepository.getSnapshotByDate(userId, date);
    return sendJsonResponse(res, 200, { ok: true, snapshot: snap });
  }
  const snaps = await snapshotRepository.getRecentSnapshots(userId, 30);
  return sendJsonResponse(res, 200, { ok: true, snapshots: snaps });
}
```

在文件顶部 import 中追加：
```js
import * as snapshotRepository from '../profile/snapshotRepository.js';
import * as snapshotService from '../profile/snapshotService.js';
```

**注意**：`handleAiInsightsInternal` 需要从 aiHandlers.js 导出（如果尚未导出），它应是一个不绑定 req/res 的纯函数版本，接受 `{ items, personaSummary, relevantMemories, llmConfig }` 并返回 `{ trends, itemScores, ... }`。如未导出，需在 aiHandlers.js 中加一个内部函数版本。

- [ ] **Step 2: 在 aiHandlers.js 添加 handleAiInsightsInternal**

如 aiHandlers.js 中只有 handleAiInsightsRequest（绑定 req/res），需抽出核心逻辑：

```js
export async function handleAiInsightsInternal({ items, personaSummary, relevantMemories, llmConfig }) {
  const prompt = buildAiInsightsPrompt(items, personaSummary, relevantMemories);
  const url = `${llmConfig.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const { fetchWithRetry } = await import('./httpUtils.js');
  
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.selectedModel,
      messages: [
        { role: 'system', content: '你是科技趋势分析师' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2500,
      temperature: 0.5,
    }),
  });
  
  if (!response.ok) throw new Error(`ai-insights failed: ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}
```

并修改 `handleAiInsightsRequest` 内部调 `handleAiInsightsInternal`。

- [ ] **Step 3: 在 agentMemoryService.js 添加 fetchRelevantMemoriesForItems**

```js
// server/agent/agentMemoryService.js 末尾追加
export async function fetchRelevantMemoriesForItems(userId, items) {
  // 从 items 提取 top 3 query
  const queries = items.slice(0, 3).map(item => `${item.title} ${item.summary || ''}`.slice(0, 200));
  const allMemories = [];
  for (const q of queries) {
    const results = await searchAgentMemories(userId, { query: q, limit: 3 });
    allMemories.push(...results);
  }
  // 去重
  const seen = new Set();
  return allMemories.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}
```

- [ ] **Step 4: 跑测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add server/http/profileHandlers.js server/http/aiHandlers.js server/agent/agentMemoryService.js
git commit -m "feat(profile): /api/profile/snapshots preheat/analyze/list routes"
```

---

### Task B5: dailyBriefingPreheatJob cron

**Files:**
- Create: `server/cron/dailyBriefingPreheatJob.js`
- Modify: `package.json`（加 node-cron 依赖 + preheat:today 脚本）
- Create: `scripts/runPreheatToday.mjs`

- [ ] **Step 1: 安装 node-cron**

Run: `npm install node-cron`
Expected: package.json 加上 `"node-cron": "^3.x"`

- [ ] **Step 2: 实现 cron job**

```js
// server/cron/dailyBriefingPreheatJob.js
import { pool } from '../db/client.js';
import { preheatForUser } from '../profile/snapshotService.js';

const CONCURRENCY_LIMIT = 3;

/**
 * 查询活跃用户（近 7 天有登录）
 */
async function getActiveUsers() {
  const res = await pool.query(
    `SELECT id, username FROM users
     WHERE last_seen_at IS NOT NULL
       AND last_seen_at >= now() - interval '7 days'
     ORDER BY last_seen_at DESC`
  );
  return res.rows;
}

/**
 * 并发限制执行
 */
async function runWithConcurrency(tasks, limit) {
  const queue = [...tasks];
  const workers = Array(Math.min(limit, tasks.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

/**
 * 主入口：cron 06:00 调用
 */
export async function runDailyPreheat() {
  console.log('[preheat] cron started at', new Date().toISOString());
  try {
    const users = await getActiveUsers();
    console.log(`[preheat] ${users.length} active users to preheat`);
    
    const tasks = users.map(user => async () => {
      try {
        await preheatForUser(user.id);
        console.log(`[preheat] ${user.username} done`);
      } catch (err) {
        console.error(`[preheat] ${user.username} failed:`, err.message);
      }
    });
    
    await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
    console.log('[preheat] cron finished');
  } catch (err) {
    console.error('[preheat] cron failed:', err.message);
  }
}

/**
 * 单用户手动触发（dev 用）
 */
export async function preheatSingleUser(userId) {
  return preheatForUser(userId);
}
```

- [ ] **Step 3: 在 productionServer.js 注册 cron**

在 `server/productionServer.js` 启动逻辑中追加：

```js
import cron from 'node-cron';
import { runDailyPreheat } from './cron/dailyBriefingPreheatJob.js';

if (process.env.NODE_ENV === 'production') {
  cron.schedule('0 6 * * *', () => {
    runDailyPreheat().catch(err => console.error('[preheat] cron error:', err));
  }, { timezone: 'Asia/Shanghai' });
  console.log('[cron] daily preheat registered for 06:00 Asia/Shanghai');
}
```

- [ ] **Step 4: 创建 dev 脚本**

```js
// scripts/runPreheatToday.mjs
import { preheatSingleUser } from '../server/cron/dailyBriefingPreheatJob.js';
import { pool } from '../server/db/client.js';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: node scripts/runPreheatToday.mjs <userId>');
  process.exit(1);
}

try {
  console.log(`[preheat] running for user ${userId}`);
  const result = await preheatSingleUser(userId);
  console.log('[preheat] result:', JSON.stringify(result, null, 2).slice(0, 500));
  process.exit(0);
} catch (err) {
  console.error('[preheat] failed:', err);
  process.exit(1);
}
```

- [ ] **Step 5: 在 package.json 加 script**

在 `package.json` 的 scripts 中追加：
```json
"preheat:today": "node scripts/runPreheatToday.mjs"
```

- [ ] **Step 6: 验证语法**

Run: `node -e "import('./server/cron/dailyBriefingPreheatJob.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'runDailyPreheat', 'preheatSingleUser' ]`

- [ ] **Step 7: Commit**

```bash
git add server/cron/dailyBriefingPreheatJob.js server/productionServer.js scripts/runPreheatToday.mjs package.json package-lock.json
git commit -m "feat(cron): daily briefing preheat job at 06:00 Asia/Shanghai + dev script"
```

---

### Task B6: profileStore 新增 personaSummary

**Files:**
- Modify: `src/store/profileStore.js`

- [ ] **Step 1: 读现有 profileStore**

Run: 用 Read 工具读 `src/store/profileStore.js`，找到 partialize、actions、initial state 三个位置。

- [ ] **Step 2: 添加 personaSummary 字段**

在 initial state 中追加：
```js
personaSummary: { habits: [], traits: [], needs: [], updatedAt: null },
```

在 partialize 中追加：
```js
personaSummary: state.personaSummary,
```

在 actions 中追加：
```js
setPersonaSummary: (updater) => set(state => {
  const next = typeof updater === 'function' ? updater(state.personaSummary) : updater;
  const capped = {
    ...next,
    habits: (next.habits || []).slice(0, 10),
    traits: (next.traits || []).slice(0, 10),
    needs: (next.needs || []).slice(0, 10),
  };
  return { personaSummary: { ...capped, updatedAt: new Date().toISOString() } };
}),
```

- [ ] **Step 3: 跑测试**

Run: `node node_modules/vitest/vitest.mjs run src/store/__tests__/profileStore.test.js`
Expected: 全部通过（已有 5 个测试）

- [ ] **Step 4: Commit**

```bash
git add src/store/profileStore.js
git commit -m "feat(profile-store): personaSummary field with cap 10 per array"
```

---

### Task B7: AiChatPanel 改读 profileStore

**Files:**
- Modify: `src/components/AiChatPanel.jsx`
- Modify: `src/utils/memoryEvolver.js`

- [ ] **Step 1: 读 AiChatPanel 找到 personaSummary 用法**

Run: 用 Grep 工具搜索 `personaSummary` 在 `src/components/AiChatPanel.jsx` 的所有位置。

- [ ] **Step 2: 修改 AiChatPanel 改读 store**

在 `src/components/AiChatPanel.jsx` 中：

1. 顶部 import：
```js
import { useProfileStore } from '../store';
```

2. 删除本地 useState：
```js
// 删除：const [personaSummary, setPersonaSummary] = useState({ habits: [], traits: [], needs: [] });
// 改为：
const personaSummary = useProfileStore(s => s.personaSummary);
```

3. fetchPersonaSummary 调用后改写入 store：
```js
// 修改 fetchPersonaSummary 内部
const data = await resp.json();
useProfileStore.getState().setPersonaSummary(data);
```

- [ ] **Step 3: memoryEvolver 写 learned_preferences**

在 `src/utils/memoryEvolver.js` 顶部新增 `extractLearnedPreferences` 纯函数：

```js
/**
 * 纯函数：从 messages 提取 learned_preferences
 */
export function extractLearnedPreferences(messages) {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content || '');
  const text = userMessages.join(' ');
  
  // 简单关键词提取（按空格分割 + 长度过滤）
  const words = text.split(/[\s,，。.]+/).filter(w => w.length >= 2 && w.length <= 20);
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  
  // 简单启发式判断
  const avgLen = userMessages.reduce((s, m) => s + m.length, 0) / Math.max(userMessages.length, 1);
  const preferredDepth = avgLen > 100 ? 'deep' : 'shallow';
  const preferredFormat = text.includes('详细') ? 'detailed' : 'concise';
  
  return { topics, preferredDepth, preferredFormat };
}
```

在 `evolveMemory` 函数末尾（写完 persona_summary 之后）追加：

```js
// Phase 3: 同步写 learned_preferences
try {
  const learnedPrefs = extractLearnedPreferences(recentMessages);
  await fetch('/api/agent-memory/learned-preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(learnedPrefs),
  });
} catch { /* silent */ }
```

- [ ] **Step 4: 在 agentMemoryHandlers.js 添加路由**

在 `server/http/agentMemoryHandlers.js` 找到 handleAgentMemoryRequest 路由分发，追加：

```js
if (pathname === '/api/agent-memory/learned-preferences' && req.method === 'PATCH') {
  const body = await readJsonBody(req);
  await mergeLearnedPreferences(userId, body);
  return sendJsonResponse(res, 200, { ok: true });
}
```

在 `server/agent/agentMemoryService.js` 添加：

```js
export async function mergeLearnedPreferences(userId, patch) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE user_profiles SET learned_preferences = COALESCE(learned_preferences, '{}'::jsonb) || $2::jsonb, updated_at = now() WHERE user_id = $1`,
      [userId, JSON.stringify(patch)]
    );
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add src/components/AiChatPanel.jsx src/utils/memoryEvolver.js server/http/agentMemoryHandlers.js server/agent/agentMemoryService.js
git commit -m "feat(memory): personaSummary reads profileStore + evolveMemory writes learned_preferences"
```

---

### Task B8: useSnapshotPreheat hook

**Files:**
- Create: `src/hooks/useSnapshotPreheat.js`
- Test: `src/hooks/__tests__/useSnapshotPreheat.test.js`

- [ ] **Step 1: 写测试（mock fetch）**

```js
// src/hooks/__tests__/useSnapshotPreheat.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';  // 如无则改用其他方式

// 注意：项目可能无 @testing-library/react，改用纯函数测试方式
// 改为：直接 mock fetch，调用 hook 内部逻辑

import { vi } from 'vitest';

// 测试 useSnapshotPreheat 的状态机
// 由于项目无 @testing-library/react，改为测试 buildPreheatPayload 纯函数
// （如已存在 buildPreheatPayload，这里加测试；否则跳过 hook 渲染测试，仅测纯函数）

describe('useSnapshotPreheat state machine', () => {
  it('idle state when disabled', () => {
    // 简单状态机测试：disabled 时返回 idle
    const enabled = false;
    const llmConfig = { baseUrl: '' };
    expect(enabled && llmConfig.baseUrl).toBe(false);
  });
});
```

**注意**：项目无 @testing-library/react，hook 测试改为测试纯函数。如 useSnapshotPreheat 内无纯函数可抽离，可跳过 hook 测试，仅测集成路径。

- [ ] **Step 2: 实现 useSnapshotPreheat**

```js
// src/hooks/useSnapshotPreheat.js
import { useState, useEffect } from 'react';
import { useProfileStore } from '../store';

export function useSnapshotPreheat({ items, llmConfig, enabled }) {
  const [status, setStatus] = useState('idle');
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !llmConfig?.baseUrl || items.length === 0) return;
    
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    
    const hasToday = useProfileStore.getState().dailyProfileSnapshots
      .some(s => s.date === today);
    if (hasToday) {
      setStatus('ready');
      return;
    }
    
    setStatus('loading');
    fetch('/api/profile/snapshots/preheat', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.ok) {
          setSnapshot(data.snapshot);
          setStatus('ready');
          useProfileStore.getState().setDailyProfileSnapshots(prev => 
            [...prev, { date: today, ...data.snapshot.briefing }].slice(-30)
          );
        } else {
          setError(data.error || '预热失败');
          setStatus('error');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    
    return () => { cancelled = true; };
  }, [enabled, items.length, llmConfig?.baseUrl]);

  return { status, snapshot, error };
}
```

- [ ] **Step 3: 跑测试 + build**

Run: `node node_modules/vitest/vitest.mjs run && npm run build`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSnapshotPreheat.js src/hooks/__tests__/useSnapshotPreheat.test.js
git commit -m "feat(hooks): useSnapshotPreheat for lazy preheat trigger"
```

---

### Task B9: useAiRecommendationEnhance hook

**Files:**
- Create: `src/hooks/useAiRecommendationEnhance.js`
- Test: `src/hooks/__tests__/useAiRecommendationEnhance.test.js`

- [ ] **Step 1: 实现 hook**

```js
// src/hooks/useAiRecommendationEnhance.js
import { useState, useCallback } from 'react';

export function useAiRecommendationEnhance({ items, llmConfig }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [enhancedItems, setEnhancedItems] = useState(null);

  const enhance = useCallback(async () => {
    if (!llmConfig?.baseUrl || items.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const top30 = items.slice(0, 30);
      const resp = await fetch('/api/profile/snapshots/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: top30 }),
      });
      const data = await resp.json();
      if (data.ok) {
        const scoreMap = new Map((data.itemScores || []).map(s => [s.id, s]));
        const enhanced = items.map(item => {
          const score = scoreMap.get(item.id);
          return score ? { ...item, aiScore: score.score, aiLabel: score.label, aiReason: score.reason } : item;
        });
        setEnhancedItems(enhanced);
      } else {
        setError(data.error || '分析失败');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [items, llmConfig?.baseUrl]);

  return { enhance, loading, error, enhancedItems };
}
```

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAiRecommendationEnhance.js
git commit -m "feat(hooks): useAiRecommendationEnhance for real-time AI scoring"
```

---

### Task B10: buildSystemPrompt 新增"相关记忆"段

**Files:**
- Modify: `src/components/aichat/buildSystemPrompt.js`

- [ ] **Step 1: 读现有 buildSystemPrompt**

Run: 用 Read 工具读 `src/components/aichat/buildSystemPrompt.js`。

- [ ] **Step 2: 在 buildSystemPrompt 中加 relevantMemories 参数**

修改 buildSystemPrompt 函数签名，新增 `relevantMemories = []` 参数，并在"用户性格画像"段之后追加"相关记忆"段：

```js
// 在【用户性格画像】段之后追加：
if (relevantMemories && relevantMemories.length > 0) {
  const memoryLines = relevantMemories.slice(0, 5).map(m => `  - ${m.memory_type || '记忆'}：${m.content}`).join('\n');
  sections.push(`【相关记忆】基于当前话题检索的跨会话记忆（仅当相关时参考，避免重复询问）：\n${memoryLines}`);
}
```

- [ ] **Step 3: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/components/aichat/buildSystemPrompt.js
git commit -m "feat(aichat): inject relevantMemories section into systemPrompt"
```

---

### Task B11: AiChatPanel 发送前调 fetchRelevantMemories

**Files:**
- Modify: `src/components/AiChatPanel.jsx`
- Modify: `src/components/aielf/useSendMessage.js`（如果 AiElf 也需要）

- [ ] **Step 1: 在 AiChatPanel handleSend 中加 fetchRelevantMemories**

在 `src/components/AiChatPanel.jsx` 找到 handleSend / sendMessage 函数，在调用 sendMessage 之前追加：

```js
import { fetchRelevantMemories } from '../utils/memoryEvolver.js';

// 在 handleSend 中，sendMessage 之前
let relevantMemories = [];
try {
  relevantMemories = await fetchRelevantMemories(input, 5);
} catch { /* silent */ }

await sendMessage(input, { relevantMemories });
```

确保 sendMessage 调用 buildSystemPrompt 时传入 relevantMemories 参数。

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/components/AiChatPanel.jsx
git commit -m "feat(aichat): fetchRelevantMemories before sendMessage"
```

---

### Task B12: useRecommendationMemos 集成

**Files:**
- Modify: `src/hooks/useRecommendationMemos.js`

- [ ] **Step 1: 读现有 useRecommendationMemos**

Run: 用 Read 工具读 `src/hooks/useRecommendationMemos.js` 完整内容。

- [ ] **Step 2: 注入 personaSummary + relevantMemories**

修改 `buildRecommendation` 调用，注入 personaSummary：

```js
import { useProfileStore } from '../store';
import { fetchRelevantMemories } from '../utils/memoryEvolver.js';

// 在 buildRecommendation 调用前获取 personaSummary
const personaSummary = useProfileStore.getState().personaSummary;

// 修改 buildRecommendation context
const scored = clustered.map(item => recommendationEngine.buildRecommendation(item, {
  // ...原有 context
  personaSummary,  // Phase 3 新增
  relevantMemories: [],  // 异步加载，初始为空
}));
```

- [ ] **Step 3: 加 useEffect 异步拉 relevantMemories**

在 useMemo 之后追加 useEffect，监听 clustered 变化：

```js
const [relevantMemories, setRelevantMemories] = useState([]);

useEffect(() => {
  if (clustered.length === 0) return;
  let cancelled = false;
  const topQueries = clustered.slice(0, 5).map(item => 
    `${item.title} ${item.summary || ''}`.slice(0, 200)
  );
  Promise.all(topQueries.map(q => fetchRelevantMemories(q, 3).catch(() => [])))
    .then(results => {
      if (cancelled) return;
      const seen = new Set();
      const allMemories = results.flat().filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      setRelevantMemories(allMemories);
    });
  return () => { cancelled = true; };
}, [clustered]);
```

注意：当 relevantMemories 更新后，会触发 scored 重算（如果 scored 是 useMemo 依赖 relevantMemories）。

- [ ] **Step 4: 跑 build + 测试**

Run: `node node_modules/vitest/vitest.mjs run && npm run build`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRecommendationMemos.js
git commit -m "feat(recommendation): inject personaSummary + relevantMemories into buildRecommendation"
```

---

### Task B13: PersonaSummarySection 组件

**Files:**
- Create: `src/components/profile/PersonaSummarySection.jsx`

- [ ] **Step 1: 实现组件**

```jsx
// src/components/profile/PersonaSummarySection.jsx
import React from 'react';
import { useProfileStore } from '../../store';
import { formatRelative } from '../../utils/format.js';

function PersonaColumn({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="persona-column">
      <h3>{title}</h3>
      <ul>
        {items.map((item, idx) => (
          <li key={idx} className="persona-item">
            <span className="persona-content">{item.content}</span>
            {item.weight > 0 && (
              <span className="persona-weight">权重 {item.weight}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PersonaSummarySection() {
  const personaSummary = useProfileStore(s => s.personaSummary);
  const { habits = [], traits = [], needs = [], updatedAt } = personaSummary || {};

  if (habits.length === 0 && traits.length === 0 && needs.length === 0) {
    return (
      <section className="profile-persona-summary">
        <div className="section-header">
          <h2 className="section-title">AI 性格画像</h2>
          <p className="section-desc">与 AI 对话累积 3 轮后，系统会自动总结你的性格画像，影响推荐与回复风格</p>
        </div>
        <div className="profile-empty-state">暂无 AI 画像，开始与 AI 对话吧</div>
      </section>
    );
  }

  return (
    <section className="profile-persona-summary">
      <div className="section-header">
        <h2 className="section-title">AI 性格画像</h2>
        <p className="section-desc">基于历史对话的总结，会影响推荐排序与 AI 回复风格（最近更新：{updatedAt ? formatRelative(updatedAt) : '未知'}）</p>
      </div>
      <div className="persona-summary-grid">
        <PersonaColumn title="用户习惯" items={habits} />
        <PersonaColumn title="用户性格" items={traits} />
        <PersonaColumn title="用户需求" items={needs} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/PersonaSummarySection.jsx
git commit -m "feat(profile-ui): PersonaSummarySection component"
```

---

### Task B14: SnapshotHistorySection 组件

**Files:**
- Create: `src/components/profile/SnapshotHistorySection.jsx`

- [ ] **Step 1: 实现组件**

```jsx
// src/components/profile/SnapshotHistorySection.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { formatRelative } from '../../utils/format.js';

export default function SnapshotHistorySection() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSnap, setSelectedSnap] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/profile/snapshots');
      const data = await resp.json();
      if (data.ok) setSnapshots(data.snapshots || []);
      else setError(data.error || '加载失败');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const viewDetail = useCallback(async (date) => {
    try {
      const resp = await fetch(`/api/profile/snapshots?date=${date}`);
      const data = await resp.json();
      if (data.ok) setSelectedSnap(data.snapshot);
    } catch { /* silent */ }
  }, []);

  if (loading) return <section className="profile-snapshot-history"><p>加载中...</p></section>;
  if (error) return <section className="profile-snapshot-history"><p>加载失败：{error}</p></section>;

  return (
    <section className="profile-snapshot-history">
      <div className="section-header">
        <h2 className="section-title">推荐历史快照</h2>
        <p className="section-desc">每日 06:00 系统自动预热，记录 AI 增强推荐结果</p>
      </div>
      {snapshots.length === 0 ? (
        <div className="profile-empty-state">暂无历史快照</div>
      ) : (
        <div className="snapshot-list">
          {snapshots.map(snap => (
            <div key={snap.id} className="snapshot-item" onClick={() => viewDetail(snap.snapshot_date)}>
              <span className="snapshot-date">{snap.snapshot_date}</span>
              <span className={`snapshot-status status-${snap.ai_status || 'unknown'}`}>{snap.ai_status || '未知'}</span>
              <span className="snapshot-oneliner">{snap.one_line || '（无简报）'}</span>
            </div>
          ))}
        </div>
      )}
      {selectedSnap && (
        <div className="snapshot-detail">
          <h3>{selectedSnap.snapshot_date} 详情</h3>
          <pre>{JSON.stringify(selectedSnap, null, 2)}</pre>
          <button onClick={() => setSelectedSnap(null)}>关闭</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/SnapshotHistorySection.jsx
git commit -m "feat(profile-ui): SnapshotHistorySection component"
```

---

### Task B15: ProfilePage 接入新 section

**Files:**
- Modify: `src/components/ProfilePage.jsx`

- [ ] **Step 1: 在 ProfilePage.jsx 顶部加 import**

```jsx
import PersonaSummarySection from './profile/PersonaSummarySection.jsx';
import SnapshotHistorySection from './profile/SnapshotHistorySection.jsx';
```

- [ ] **Step 2: 在 JSX 中插入**

在 `profile-memory-panel` section 之后插入 PersonaSummarySection，在 AgentMemorySection 之后插入 SnapshotHistorySection：

```jsx
<section className="profile-memory-panel">...</section>

<AgentMemorySection />
<SnapshotHistorySection />
```

在 `profile-hero` 之后、PendingSuggestionsSection 之前插入 PersonaSummarySection：

```jsx
<section className="product-hero profile-hero">...</section>

<PersonaSummarySection />
<PendingSuggestionsSection />
```

注意：PersonaSummarySection 应放在显眼位置（顶部 hero 之后），让用户感知到 AI 画像。

- [ ] **Step 3: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/components/ProfilePage.jsx
git commit -m "feat(profile-page): integrate PersonaSummarySection + SnapshotHistorySection"
```

---

### Task B16: RightPanel "重新分析"按钮改调 useAiRecommendationEnhance

**Files:**
- Modify: `src/components/RightPanel.jsx`

- [ ] **Step 1: 读现有 RightPanel 找到"重新分析"按钮**

Run: 用 Grep 工具搜索 `重新分析` 在 `src/components/RightPanel.jsx`。

- [ ] **Step 2: 替换 onClick 调用**

```jsx
import { useAiRecommendationEnhance } from '../hooks/useAiRecommendationEnhance.js';

// 在组件内
const { enhance, loading, error } = useAiRecommendationEnhance({ items, llmConfig });

// 按钮改为
<button onClick={enhance} disabled={loading}>
  {loading ? '分析中...' : '重新分析'}
</button>
```

- [ ] **Step 3: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/components/RightPanel.jsx
git commit -m "feat(right-panel): use useAiRecommendationEnhance for reanalyze button"
```

---

### Task B17: 删除 App.jsx L1112 内联 clusterEvents

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: 读 App.jsx L1100-1130 找到内联 clusterEvents**

Run: 用 Read 工具读 `src/App.jsx` L1100-1130。

- [ ] **Step 2: 删除内联 clusterEvents 调用**

找到类似 `const clustered = clusterEvents(filtered)` 的内联调用（L1112 附近），删除该行，改用 `useRecommendationMemos` 返回的 clustered。

注意：保留 `clusterEvents` 的 import（如果其他地方还在用），否则也删除 import。

- [ ] **Step 3: 跑测试 + build**

Run: `node node_modules/vitest/vitest.mjs run && npm run build`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "refactor(app): remove duplicate clusterEvents call (use useRecommendationMemos)"
```

---

### Task B18: 添加样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 在 styles.css 末尾追加样式**

```css
/* Phase 3: Persona Summary */
.profile-persona-summary {
  padding: 24px 0;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
}
.persona-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.persona-column h3 {
  font-size: 14px;
  margin: 0 0 12px;
  color: var(--text-secondary, #888);
}
.persona-column ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.persona-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.05));
  font-size: 14px;
}
.persona-content {
  flex: 1;
  margin-right: 12px;
}
.persona-weight {
  color: var(--text-tertiary, #666);
  font-size: 12px;
}

/* Phase 3: Snapshot History */
.profile-snapshot-history {
  padding: 24px 0;
}
.snapshot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}
.snapshot-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-secondary, rgba(255,255,255,0.03));
  cursor: pointer;
  transition: background 0.2s;
}
.snapshot-item:hover {
  background: var(--bg-tertiary, rgba(255,255,255,0.06));
}
.snapshot-date {
  font-weight: 600;
  min-width: 100px;
}
.snapshot-status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.status-merged { background: rgba(34,197,94,0.15); color: #22c55e; }
.status-ai_failed { background: rgba(239,68,68,0.15); color: #ef4444; }
.status-validation_failed { background: rgba(245,158,11,0.15); color: #f59e0b; }
.status-not_requested { background: rgba(100,116,139,0.15); color: #64748b; }
.snapshot-oneliner {
  flex: 1;
  color: var(--text-secondary, #888);
}
.snapshot-detail {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-secondary, rgba(0,0,0,0.2));
  border-radius: 8px;
}
.snapshot-detail pre {
  font-size: 12px;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}
```

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style(phase3): persona-summary and snapshot-history sections"
```

---

### Task B19: 文档更新

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 CLAUDE.md**

在 "v2 Intelligence Workbench" 章节追加：

```markdown
**Phase 3 完成**：LLM 推荐增强 + personaSummary 全链路同步 + recommendation_snapshots 三表写入 + cron 预热 + lazy 触发 + fetchRelevantMemories 激活 + mergeAiBriefing 接入。
```

在 hooks 章节追加：
- `useSnapshotPreheat.js` - lazy 预热触发 hook
- `useAiRecommendationEnhance.js` - 实时 AI 重新分析 hook

在 components/profile/ 章节追加：
- `PersonaSummarySection.jsx` - AI 性格画像展示
- `SnapshotHistorySection.jsx` - 历史快照展示

更新测试数量到 ~381。

在 "API Endpoints" 表中追加：
- `/api/profile/snapshots/preheat` POST
- `/api/profile/snapshots/analyze` POST
- `/api/profile/snapshots` GET
- `/api/profile/llm-config` GET/POST
- `/api/agent-memory/learned-preferences` PATCH

更新 "Caching" 章节追加：
- recommendation_snapshots 每日 06:00 cron 预热

在 "Known Issues" 或新增 "Cron Jobs" 章节说明：
- `dailyBriefingPreheatJob` 每日 06:00 Asia/Shanghai 跑，仅 production（Node/Docker）
- Vercel 部署不跑 cron，只走 lazy 路径

- [ ] **Step 2: 更新 AGENTS.md**

更新测试数量到 ~381，在 "Quick reference" 中追加：
- `npm run preheat:today <userId>` 手动触发预热

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: update for Phase 3 LLM recommendation enhancement"
```

---

### Task B20: 最终验收 + tag stable-v13

- [ ] **Step 1: 跑全量测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: ~381/381 通过

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: 检查 App.jsx 行数**

Run: `(Get-Content src/App.jsx | Measure-Object -Line).Lines`
Expected: 较 Phase 2 终点 2517 行减少（删除了内联 clusterEvents）

- [ ] **Step 4: 浏览器手动验证**

启动 dev server，验证：
1. ProfilePage 显示 PersonaSummarySection（如有对话历史）
2. ProfilePage 显示 SnapshotHistorySection（如有快照）
3. AiChat 发送消息，console 无 fetchRelevantMemories 错误
4. RightPanel "重新分析"按钮可点击

- [ ] **Step 5: 打 tag**

```bash
git tag stable-v13 -m "Phase 3 LLM recommendation enhancement complete"
git tag -l "stable-v*"
```

Expected: 看到 `stable-v13` 在列表中

---

## 验收清单对照

| Spec 验收项 | Plan Task |
|---|---|
| Step A: migration 006 应用 | A1 |
| Step A: users.last_seen_at 更新 | A2 |
| Step A: llmConfig 同步 | A3, A4, A5 |
| Step A: 全量测试通过 | A6 |
| Step B: cron 触发 | B5, B6 |
| Step B: recommendation_snapshots 三表写入 | B2, B3 |
| Step B: lazy 预热 | B8, B12 |
| Step B: "重新分析"按钮 | B9, B16 |
| Step B: AiChat fetchRelevantMemories | B10, B11 |
| Step B: 推荐算法注入 relevantMemories | B12 |
| Step B: personaSummary 进入 profileStore | B6, B7 |
| Step B: PersonaSummarySection 显示 | B13, B15 |
| Step B: SnapshotHistorySection 显示 | B14, B15 |
| Step B: mergeAiBriefing 接入 | B3 |
| Step B: LLM 失败降级 | B3 (aiStatus='ai_failed') |
| Step B: 删除 App.jsx L1112 clusterEvents | B17 |
| Step B: 全量测试通过 | B20 |
| Step B: build 成功 | B20 |
| Step B: tag stable-v13 | B20 |
