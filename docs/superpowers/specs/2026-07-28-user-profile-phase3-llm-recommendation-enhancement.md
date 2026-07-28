# 用户画像模块 Phase 3：推荐算法 LLM 增强

- **日期**：2026-07-28
- **状态**：待 review
- **作者**：brainstorming 流程产出
- **范围**：在 Phase 1 数据地基 + Phase 2 AI 学习闭环之上，激活 LLM 推荐增强——定时预热 cron + lazy 触发 + 实时重新分析 + fetchRelevantMemories 激活 + personaSummary 全链路同步 + mergeAiBriefing 接入 + recommendation_snapshots 三表写入
- **用户感知**：每日 06:00 后登录即见 AI 增强的早报；"重新分析"按钮产生个性化评分；AiChat 对话有"相关记忆"上下文；ProfilePage 展示 AI 性格画像与历史快照
- **依赖**：Phase 1（stable-v11）+ Phase 2（stable-v12）

---

## 1. 背景与动机

### 1.1 Phase 1/2 交付的扩展点

Phase 1 完成数据地基重构，Phase 2 完成 AI 主动学习闭环 UI。Phase 3 需激活以下"接口就绪、链路缺失"的扩展点：

1. **recommendationEngine**（[src/domain/intelligence/recommendationEngine.js](file:///e:/VStudio_Project/Silicon%20Meridian/src/domain/intelligence/recommendationEngine.js)）
   - 纯本地规则评分（publicScore + personalScore + mustReadScore）
   - **未注入 personaSummary / relevantMemories**——评分维度仅靠规则，缺乏 LLM 个性化
   - **未持久化**——lanes 结果仅在 useMemo 临时存在

2. **/api/ai-insights 端点**（[server/news/plugin.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/news/plugin.js) L333-428）
   - 96 行内联实现，与 aiHandlers.js 抽离方向不一致
   - 未复用 fetchWithRetry / enforceRateLimit / safeExternalFetch
   - prompt 不含用户画像

3. **recommendation_snapshots 三表**（[server/db/migrations/001_platform.sql](file:///e:/VStudio_Project/Silicon%20Meridian/server/db/migrations/001_platform.sql) L52-54）
   - 表已建，索引已加
   - **全代码库零 INSERT**——profileRepository.getState 仅 SELECT JOIN 读取（读到空表）
   - 无任何 service / handler 处理写入

4. **personaSummary**（[server/db/migrations/004_agent_autonomy.sql](file:///e:/VStudio_Project/Silicon%20Meridian/server/db/migrations/004_agent_autonomy.sql) L8）
   - 写入链路已闭环（AiChat evolveMemory → user_profiles.persona_summary）
   - **仅在 AiChatPanel 本地 state**——未进入 profileStore，跨页面不可见
   - 未注入推荐算法，未在 ProfilePage 展示

5. **memoryEvolver.fetchRelevantMemories**（[src/utils/memoryEvolver.js](file:///e:/VStudio_Project/Silicon%20Meridian/src/utils/memoryEvolver.js)）
   - 后端 `/api/agent-memory/search` 已就绪
   - **前端无任何调用方**——Phase 2 spec 明确"保留 Phase 3 与推荐算法 LLM 增强一起做"

6. **briefingEngine.mergeAiBriefing**（[src/domain/intelligence/briefingEngine.js](file:///e:/VStudio_Project/Silicon%20Meridian/src/domain/intelligence/briefingEngine.js)）
   - 纯函数：校验 LLM 返回的 citationIds 是否为 algorithmBriefing.citationIds 子集
   - **生产代码无任何调用方**（仅测试调）

7. **learned_preferences 字段**（[server/db/migrations/004_agent_autonomy.sql](file:///e:/VStudio_Project/Silicon%20Meridian/server/db/migrations/004_agent_autonomy.sql)）
   - agentContext.js 会读取
   - **全代码库零写入方**——dead field

8. **users.last_seen_at 字段**：不存在，cron 活跃用户筛选需要

9. **user_profiles.llm_config 字段**：不存在，LLM 配置仅在前端 localStorage，cron 无法访问

### 1.2 Phase 3 目标

激活上述 9 个扩展点，让"AI 推荐增强"从"接口就绪、链路缺失"变为"用户可感知、可操作、可解释"：

1. **Step A（基础设施）**：补 migration 006（users.last_seen_at + user_profiles.llm_config）+ 前端 useLlmConfig 同步 + 后端 llm-config 路由 + last_seen_at 更新中间件
2. **Step B（推荐增强）**：
   - 定时预热 cron（活跃用户）+ lazy 触发（冷用户）+ 实时重新分析
   - recommendationEngine 注入 personaSummary + relevantMemories
   - fetchRelevantMemories 在 AiChat + 推荐算法激活
   - mergeAiBriefing 在预热时自动调，失败降级
   - recommendation_snapshots 三表写入链路全通
   - personaSummary 进入 profileStore + ProfilePage 展示
   - 删除 App.jsx L1112 内联 clusterEvents（与 useRecommendationMemos 重复）

### 1.3 用户故事

- **故事 1**：用户每日 06:00 后登录，首页直接显示 AI 增强的早报（oneLine 由 LLM 生成 + opportunities + risks），无需等待
- **故事 2**：用户与 AI 对话时，AI 主动引用历史记忆："上次你提到关注 GPU 短缺，这条新闻与此相关"
- **故事 3**：用户点"重新分析"按钮，看到 top 30 资讯出现 AI 个性化评分（"必读" / "关注" / "降噪"），排序变化
- **故事 4**：用户在 ProfilePage 看到"AI 性格画像"section，显示系统总结的习惯/性格/需求；点击历史快照查看某天的推荐内容

---

## 2. 架构总览

### 2.1 三条数据流

```
[流 A：定时预热（活跃用户）]
  cron 06:00 Asia/Shanghai
    └─ server/cron/dailyBriefingPreheatJob.js（新增）
        ├─ SELECT users WHERE last_seen_at >= now() - interval '7 days'
        ├─ for each user（并发限制 3）:
        │   ├─ profileService.getState(userId) → {domainTiers, sourceTiers, specialFollows, briefingConfig, personaSummary, llmConfig}
        │   ├─ newsService.fetchAggregatedNews({ interests, disabledSources })
        │   ├─ recommendationEngine.clusterEvents + buildRecommendation + selectBriefingLanes（注入 personaSummary）
        │   ├─ LLM 增强 top 30（POST /api/ai-insights，含 personaSummary context）
        │   ├─ briefingEngine.buildAlgorithmBriefing + LLM 生成 oneLine/risks/opportunities + mergeAiBriefing
        │   └─ profileService.saveSnapshot(userId, date, algorithm_version, lanes, algorithm_payload, ai_payload)
        └─ 失败 → 静默降级到 lazy 路径（用户登录时触发）

[流 B：用户登录/打开首页 lazy 触发]
  前端 useSnapshotPreheat 检测今日快照缺失
    └─ POST /api/profile/snapshots/preheat
        ├─ 幂等检查：今日已存在则返回 cached
        └─ 同流 A 单用户预热逻辑 → 返回结果前端 setItems

[流 C：用户点"重新分析"按钮]
  RightPanel "重新分析" 按钮 onClick
    └─ POST /api/profile/snapshots/analyze（实时增强，不写库）
        ├─ 仅调 LLM 个性化评分（注入 personaSummary + relevantMemories）
        └─ 返回 itemScores 前端 setItems 重排
```

### 2.2 模块边界

```
后端新增（Step A 基础设施）：
  server/db/migrations/006_profile_llm_sync.sql     新增 users.last_seen_at + user_profiles.llm_config
  server/http/lastSeenMiddleware.js                 请求中间件节流更新 last_seen_at（5min 内不重复）
  server/profile/profileRepository.js 扩展          getLlmConfig / setLlmConfig
  server/http/profileHandlers.js 扩展               POST/GET /api/profile/llm-config

后端新增（Step B 推荐增强）：
  server/cron/dailyBriefingPreheatJob.js            cron job：遍历活跃用户 + 并发限制 3 + 失败降级
  server/profile/snapshotService.js                 快照预热 service（preheatForUser + 纯函数）
  server/profile/snapshotRepository.js              PG 三表事务：insertSnapshot + 查询函数
  server/http/profileHandlers.js 扩展               POST /snapshots/preheat + POST /snapshots/analyze + GET /snapshots

后端抽离：
  server/news/plugin.js L333-428 → server/http/aiHandlers.js
    /api/ai-insights 抽到 handleAiInsightsRequest，复用 fetchWithRetry + enforceRateLimit + safeExternalFetch

前端新增：
  src/hooks/useSnapshotPreheat.js                   检测今日快照缺失 + lazy 触发 + 状态管理
  src/hooks/useAiRecommendationEnhance.js           "重新分析"按钮包装
  src/components/profile/PersonaSummarySection.jsx   ProfilePage 展示 personaSummary
  src/components/profile/SnapshotHistorySection.jsx ProfilePage 展示历史 recommendation_snapshots

前端修改：
  src/store/profileStore.js                         新增 personaSummary 字段 + setPersonaSummary action（持久化，cap 10/字段）
  src/hooks/useLlmConfig.js                         保存时同步 POST /api/profile/llm-config（fire-and-forget）
  src/components/aichat/buildSystemPrompt.js         新增"相关记忆"段（fetchRelevantMemories 结果）
  src/components/AiChatPanel.jsx                    personaSummary 改读 profileStore；发送前调 fetchRelevantMemories
  src/utils/memoryEvolver.js                        evolveMemory 同步写 learned_preferences（补 dead field）
  src/hooks/useRecommendationMemos.js               集成 useSnapshotPreheat + 注入 personaSummary + relevantMemories
  src/components/RightPanel.jsx                     "重新分析"按钮调 useAiRecommendationEnhance
  src/App.jsx L1112                                 删除内联 clusterEvents（与 useRecommendationMemos L99 重复）
  src/styles.css                                    新增 .profile-persona-summary / .profile-snapshot-history 等样式
```

### 2.3 与 Phase 1/2 边界

| 模块 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| buildProfileMemory | 双源消除 → workflowEngine.js | 无改动 | 无改动 |
| pendingSuggestions | store 扩展点 | UI 接受/拒绝闭环 | 作为 context 注入 LLM 评分 |
| agent_memories | 表 + 全链路 | ProfilePage CRUD 可见 | fetchRelevantMemories 激活 + learned_preferences 写入 |
| buildSystemPrompt "最近校准"段 | dead code | accepted suggestions 注入 | 新增"相关记忆"段 |
| recommendationEngine | 纯本地规则 | 无改动 | context 增加 personaSummary + relevantMemories |
| briefingEngine.mergeAiBriefing | dead code | dead code | 预热时自动调 + 失败降级 |
| recommendation_snapshots 三表 | 表已建无写入 | 表已建无写入 | 写入 + 查询链路全通 |
| personaSummary | 字段已建 | AiChatPanel 本地闭环 | 进入 profileStore + ProfilePage + 推荐算法 |
| fetchRelevantMemories | 后端就绪 | 主动保留 Phase 3 | AiChat + 推荐算法双激活 |
| learned_preferences | 字段已建 | 字段已建 | evolveMemory 写入 |

---

## 3. Step A 详细设计：基础设施

### 3.1 Migration 006

**文件**：`server/db/migrations/006_profile_llm_sync.sql`（新建）

```sql
-- Phase 3 基础设施：用户活跃度跟踪 + LLM 配置跨设备同步

-- 用户最后活跃时间（cron 活跃用户筛选用）
alter table users add column if not exists last_seen_at timestamptz;
create index if not exists users_last_seen_idx on users(last_seen_at desc) where last_seen_at is not null;

-- 用户 LLM 配置（cron 后台任务读取用，前端 localStorage 仍是主源）
alter table user_profiles add column if not exists llm_config jsonb not null default '{}'::jsonb;
```

### 3.2 last_seen_at 更新中间件

**文件**：`server/http/lastSeenMiddleware.js`（新建）

**职责**：在请求结束时异步更新 users.last_seen_at，节流 5min 内不重复

```js
const recentUpdates = new Map(); // userId -> lastUpdateTs

export function attachLastSeen(app) {
  app.use(async (ctx, next) => {
    await next();
    const userId = ctx.userId;
    if (!userId) return;
    
    const now = Date.now();
    const last = recentUpdates.get(userId) || 0;
    if (now - last < 5 * 60 * 1000) return;  // 5min 节流
    
    recentUpdates.set(userId, now);
    // 异步更新，不阻塞响应
    pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]).catch(() => {});
  });
}
```

### 3.3 LLM 配置同步

#### 3.3.1 后端 handler

**路由**：
- `GET /api/profile/llm-config` → 返回 `user_profiles.llm_config`
- `POST /api/profile/llm-config` → 写入 `user_profiles.llm_config`

```js
async function handleLlmConfig(req, res) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const config = await profileRepository.getLlmConfig(userId);
    return res.json({ ok: true, config });
  }

  if (req.method === 'POST') {
    const { config } = await readJsonBody(req);
    await profileRepository.setLlmConfig(userId, config);
    return res.json({ ok: true });
  }
}
```

#### 3.3.2 前端同步

**文件**：`src/hooks/useLlmConfig.js` 修改

在 `saveLlmConfig` 时 fire-and-forget 调 POST /api/profile/llm-config：

```js
const saveLlmConfig = useCallback((newConfig) => {
  saveLS('llmConfig', newConfig);
  setLlmConfig(newConfig);
  
  // Phase 3 新增：跨设备同步（fire-and-forget）
  fetch('/api/profile/llm-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: newConfig }),
  }).catch(() => { /* silent */ });
}, []);
```

### 3.4 Step A 验收

- [ ] Migration 006 应用成功
- [ ] 用户登录后 users.last_seen_at 更新
- [ ] 前端保存 LLM 配置后 user_profiles.llm_config 同步
- [ ] /api/profile/llm-config GET/POST 正常
- [ ] 全量测试通过

---

## 4. Step B 详细设计：推荐增强

### 4.1 /api/ai-insights 抽离

**改动**：`server/news/plugin.js` L333-428 → `server/http/aiHandlers.js` 新增 `handleAiInsightsRequest`

**抽离目的**：
1. 复用 `fetchWithRetry`（429/5xx 自动重试）
2. 复用 `enforceRateLimit`（统一限速策略）
3. 复用 `safeExternalFetch`（SSRF 防护）
4. 让 cron 与 lazy 路径都能直接调 service 层

**Prompt 增强**：新增 personaSummary context 段

```
你是科技趋势分析师。基于以下资讯和用户画像，输出趋势分析。

【用户画像】
- 习惯：{personaSummary.habits.join('、') || '无'}
- 性格：{personaSummary.traits.join('、') || '无'}
- 需求：{personaSummary.needs.join('、') || '无'}

【资讯列表】（top 30）
{items JSON}

【输出 JSON 格式】
{
  "trends": [...],
  "correlations": [...],
  "signals": [...],
  "itemScores": [{"id": "xxx", "score": 75, "label": "必读", "reason": "..."}]
}
```

### 4.2 snapshotRepository 三表事务

**文件**：`server/profile/snapshotRepository.js`（新建）

```js
export async function insertSnapshot({ userId, date, algorithmVersion, lanes, algorithmPayload, aiPayload, aiCitationIds, aiStatus }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. recommendation_snapshots（ON CONFLICT 支持重跑）
    const snapRes = await client.query(
      `INSERT INTO recommendation_snapshots (user_id, snapshot_date, profile_version, algorithm_version, updates)
       VALUES ($1, $2, 1, $3, '[]'::jsonb)
       ON CONFLICT (user_id, snapshot_date) DO UPDATE SET algorithm_version = EXCLUDED.algorithm_version
       RETURNING id`,
      [userId, date, algorithmVersion]
    );
    const snapshotId = snapRes.rows[0].id;
    
    // 2. recommendation_items（先删后插）
    await client.query('DELETE FROM recommendation_items WHERE snapshot_id = $1', [snapshotId]);
    const { values, params } = buildInsertItemsParams(snapshotId, lanes);
    if (values) {
      await client.query(
        `INSERT INTO recommendation_items (snapshot_id, item_id, lane, position, total_score, score_parts, reasons, item_payload)
         VALUES ${values}`,
        params
      );
    }
    
    // 3. briefing_snapshots（upsert）
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

// 纯函数：构造批量 INSERT 参数
export function buildInsertItemsParams(snapshotId, lanes) {
  const values = [];
  const params = [];
  let i = 0;
  for (const lane of ['public', 'personal']) {
    (lanes[lane] || []).forEach((item, pos) => {
      values.push(`($${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i})`);
      params.push(
        snapshotId, item.id, lane, pos, item.mustReadScore,
        JSON.stringify(item.scoreParts || {}), JSON.stringify(item.reasons || []), JSON.stringify(item)
      );
    });
  }
  return { values: values.join(','), params };
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
    `SELECT rs.id, rs.snapshot_date, rs.algorithm_version, bs.ai_status, bs.algorithm_payload->>'oneLine' as one_line
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

### 4.3 snapshotService 预热流程

**文件**：`server/profile/snapshotService.js`（新建）

```js
export async function preheatForUser(userId) {
  // 1. 幂等检查
  const today = new Date().toISOString().slice(0, 10);
  const existing = await snapshotRepository.getSnapshotByDate(userId, today);
  if (existing) return existing;

  // 2. 拉用户 profile（含 personaSummary + llmConfig）
  const profile = await profileService.getState(userId);

  // 3. 拉资讯
  const newsItems = await newsService.fetchAggregatedNews({
    interests: profile.interests,
    disabledSources: profile.disabledSources,
  });

  // 4. 聚类 + 评分（注入 personaSummary）
  const clustered = recommendationEngine.clusterEvents(newsItems);
  const scored = clustered.map(item => recommendationEngine.buildRecommendation(item, {
    domainTiers: profile.domainTiers,
    sourceTiers: profile.sourceTiers,
    specialFollows: profile.specialFollows,
    personaSummary: profile.personaSummary,
    relevantMemories: [],  // cron 无对话 query
  }));
  const lanes = recommendationEngine.selectBriefingLanes(scored);

  // 5. LLM 增强 top 30
  let aiInsights = null;
  let aiStatus = 'not_requested';
  const llmConfig = profile.llmConfig || getDefaultLlmConfig();
  if (llmConfig?.baseUrl) {
    try {
      aiInsights = await callAiInsights({
        items: selectItemsForAiInsights(lanes),
        personaSummary: profile.personaSummary,
        llmConfig,
      });
      aiStatus = 'generated';
    } catch (err) {
      aiStatus = 'ai_failed';
    }
  }

  // 6. algorithm briefing
  const algorithmBriefing = briefingEngine.buildAlgorithmBriefing({
    date: today,
    lanes,
    generatedAt: new Date().toISOString(),
  });

  // 7. LLM 生成 oneLine/risks/opportunities + mergeAiBriefing
  let mergedBriefing = algorithmBriefing;
  let aiPayload = null;
  if (aiInsights && llmConfig?.baseUrl) {
    try {
      aiPayload = await callAiBriefingGenerator({ algorithmBriefing, personaSummary: profile.personaSummary, llmConfig });
      mergedBriefing = briefingEngine.mergeAiBriefing(algorithmBriefing, aiPayload);
      aiStatus = mergedBriefing.aiValidationError ? 'validation_failed' : 'merged';
    } catch (err) {
      aiStatus = 'ai_failed';
    }
  }

  // 8. 写入三表
  await snapshotRepository.insertSnapshot({
    userId, date: today, algorithmVersion: 2,
    lanes, algorithmPayload: mergedBriefing,
    aiPayload, aiCitationIds: aiPayload?.citationIds || [], aiStatus,
  });

  return { lanes, briefing: mergedBriefing, aiInsights, aiStatus };
}

// 纯函数：选 top 30 items 传给 LLM
export function selectItemsForAiInsights(lanes) {
  return [...(lanes.public || []).slice(0, 15), ...(lanes.personal || []).slice(0, 15)];
}
```

### 4.4 callAiBriefingGenerator 实现

**位置**：`server/profile/snapshotService.js` 内部函数

**Prompt 模板**：

```
你是科技趋势简报生成器。基于以下 algorithm briefing 和用户画像，生成可验证的 AI 简报。

【用户画像】
- 习惯：{personaSummary.habits.join('、') || '无'}
- 性格：{personaSummary.traits.join('、') || '无'}
- 需求：{personaSummary.needs.join('、') || '无'}

【Algorithm Briefing】
- 日期：{algorithmBriefing.date}
- OneLine：{algorithmBriefing.oneLine}
- Public Lane（公共必读）：{public items 前 3 条 title}
- Personal Lane（个人必看）：{personal items 前 3 条 title}

【可用 Citation IDs】
{algorithmBriefing.citationIds.join(', ')}

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
4. opportunities 和 risks 中的 itemId 必须在 citationIds 中
```

**调用**：通过 `handleAiGenerateRequest` 的 chat action（传 messages 数组），强制 JSON 输出。

### 4.5 ai_status 状态机

| 状态 | 含义 | 触发场景 |
|---|---|---|
| `not_requested` | 未请求 LLM | 用户未配置 LLM 且无兜底 |
| `generated` | LLM 已生成但未校验 | 不会出现在快照中（中间态） |
| `merged` | LLM 生成 + 校验通过 + 已合并 | 正常路径 |
| `validation_failed` | LLM 生成但 citationIds 校验失败 | 用 algorithm 模式 + 标记 |
| `ai_failed` | LLM 调用失败（429/5xx/超时） | 降级到 algorithm 模式 |

前端 ProfilePage 显示快照时展示 ai_status（让用户知道 AI 增强是否生效）。

### 4.6 HTTP 路由

**文件**：`server/http/profileHandlers.js` 扩展

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/profile/snapshots/preheat` | POST | lazy 触发预热（幂等：今日已存在则返回 cached） |
| `/api/profile/snapshots/analyze` | POST | 实时 LLM 个性化评分（不写库） |
| `/api/profile/snapshots` | GET | 查询历史快照（带 `?date=YYYY-MM-DD` 查特定日期） |

**preheat 实现**：

```js
async function handlePreheat(req, res) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await snapshotRepository.getSnapshotByDate(userId, today);
    if (existing) return res.json({ ok: true, snapshot: existing, cached: true });
    
    const snapshot = await snapshotService.preheatForUser(userId);
    return res.json({ ok: true, snapshot, cached: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
```

**analyze 实现**：

```js
async function handleAnalyze(req, res) {
  const userId = req.userId;
  const { items } = await readJsonBody(req);
  
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'invalid_items' });
  }

  try {
    const profile = await profileService.getState(userId);
    const relevantMemories = await fetchRelevantMemoriesForUser(userId, items);
    
    const aiInsights = await callAiInsights({
      items: items.slice(0, 30),
      personaSummary: profile.personaSummary,
      relevantMemories,
      llmConfig: profile.llmConfig || getDefaultLlmConfig(),
    });

    return res.json({ ok: true, ...aiInsights });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
```

**超时保护**：preheatForUser 含 LLM 调用，可能耗时 5-15s，需设置 30s 超时。Vercel serverless 函数需配置 `maxDuration: 30`。

### 4.7 cron job

**文件**：`server/cron/dailyBriefingPreheatJob.js`（新建）

**触发**：`node-cron` 注册，每日 06:00 Asia/Shanghai

**production 启动注册**（`server/productionServer.js`）：

```js
import cron from 'node-cron';
import { runDailyPreheat } from './cron/dailyBriefingPreheatJob.js';

if (process.env.NODE_ENV === 'production') {
  cron.schedule('0 6 * * *', () => runDailyPreheat(), { timezone: 'Asia/Shanghai' });
}
```

**dev 手动触发**（`package.json`）：

```json
"preheat:today": "node scripts/runPreheatToday.mjs"
```

**Vercel 不跑 cron**：Vercel serverless 按请求计费，只走 lazy 路径。

**runDailyPreheat 实现**：

```js
export async function runDailyPreheat() {
  try {
    // 1. 查活跃用户（近 7 天有登录）
    const activeUsers = await pool.query(
      `SELECT id, username FROM users
       WHERE last_seen_at IS NOT NULL
         AND last_seen_at >= now() - interval '7 days'
       ORDER BY last_seen_at DESC`
    );

    // 2. 并发限制 3
    const limit = 3;
    const queue = [...activeUsers.rows];
    const workers = Array(limit).fill().map(async () => {
      while (queue.length > 0) {
        const user = queue.shift();
        try {
          await snapshotService.preheatForUser(user.id);
          console.log(`[preheat] ${user.username} done`);
        } catch (err) {
          console.error(`[preheat] ${user.username} failed:`, err.message);
          // 单用户失败不阻塞其他用户
        }
      }
    });

    await Promise.all(workers);
  } catch (err) {
    console.error('[preheat] cron failed:', err.message);
    // 整体失败不影响 lazy 路径
  }
}
```

### 4.8 useSnapshotPreheat hook

**文件**：`src/hooks/useSnapshotPreheat.js`（新建）

```js
export function useSnapshotPreheat({ items, llmConfig, enabled }) {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !llmConfig?.baseUrl || items.length === 0) return;
    
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    
    // 先查本地 profileStore.dailyProfileSnapshots 是否有今日
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

### 4.9 useAiRecommendationEnhance hook

**文件**：`src/hooks/useAiRecommendationEnhance.js`（新建）

```js
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
        const scoreMap = new Map(data.itemScores.map(s => [s.id, s]));
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

### 4.10 personaSummary 进入 profileStore

**文件**：`src/store/profileStore.js` 修改

```js
// partialize 加入 personaSummary
partialize: (state) => ({
  domainTiers: state.domainTiers,
  sourceTiers: state.sourceTiers,
  specialFollows: state.specialFollows,
  dailyProfileSnapshots: state.dailyProfileSnapshots,
  briefingConfig: state.briefingConfig,
  pendingSuggestions: state.pendingSuggestions,
  personaSummary: state.personaSummary,  // Phase 3 新增
}),

// actions 新增
setPersonaSummary: (updater) => set(state => {
  const next = typeof updater === 'function' ? updater(state.personaSummary) : updater;
  // cap：每字段最多 10 条，避免 QuotaExceededError
  const capped = {
    ...next,
    habits: (next.habits || []).slice(0, 10),
    traits: (next.traits || []).slice(0, 10),
    needs: (next.needs || []).slice(0, 10),
  };
  return { personaSummary: { ...capped, updatedAt: new Date().toISOString() } };
}),
```

**初始值**：
```js
personaSummary: { habits: [], traits: [], needs: [], updatedAt: null },
```

### 4.11 AiChatPanel 改读 profileStore

**文件**：`src/components/AiChatPanel.jsx` 修改

1. 删除本地 `useState` 的 `personaSummary`
2. 改读 `useProfileStore(s => s.personaSummary)`
3. `fetchPersonaSummary` 调用后调 `useProfileStore.getState().setPersonaSummary(data)`
4. `evolveMemory` 完成后调 `fetchPersonaSummary()` 刷新 store

### 4.12 fetchRelevantMemories 激活

#### 4.12.1 AiChat 接入

**文件**：`src/components/AiChatPanel.jsx` + `src/components/aichat/buildSystemPrompt.js` 修改

发送消息前异步调 `fetchRelevantMemories(input, 5)`，把结果作为 `relevantMemories` 参数传给 buildSystemPrompt。

buildSystemPrompt 在 `【用户性格画像】` 段之后新增 `【相关记忆】` 段：

```
【相关记忆】基于当前话题检索的跨会话记忆（仅当相关时参考，避免重复询问）：
  - 用户习惯：xxx
  - 历史需求：xxx
```

仅当 `relevantMemories.length > 0` 时输出。

#### 4.12.2 推荐算法注入

**文件**：`src/hooks/useRecommendationMemos.js` 修改

useMemo 同步计算 + useEffect 异步拉记忆，两阶段：

```js
// 阶段 1：同步聚类 + 评分（无 relevantMemories）
const clustered = useMemo(() => recommendationEngine.clusterEvents(items), [items]);
const [scored, setScored] = useState([]);
const [relevantMemories, setRelevantMemories] = useState([]);

useMemo(() => {
  const initial = clustered.map(item => recommendationEngine.buildRecommendation(item, {
    domainTiers, sourceTiers, specialFollows,
    personaSummary: useProfileStore.getState().personaSummary,
    relevantMemories: [],
  }));
  setScored(initial);
}, [clustered, domainTiers, sourceTiers, specialFollows]);

// 阶段 2：异步拉 top 5 query 的 relevantMemories，重算
useEffect(() => {
  if (clustered.length === 0) return;
  let cancelled = false;
  const topQueries = clustered.slice(0, 5).map(item => 
    `${item.title} ${item.summary || ''}`.slice(0, 200)
  );
  Promise.all(topQueries.map(q => fetchRelevantMemories(q, 3).catch(() => [])))
    .then(results => {
      if (cancelled) return;
      const allMemories = results.flat();
      setRelevantMemories(allMemories);
      // 触发重算
      const rescored = clustered.map(item => recommendationEngine.buildRecommendation(item, {
        domainTiers, sourceTiers, specialFollows,
        personaSummary: useProfileStore.getState().personaSummary,
        relevantMemories: allMemories,
      }));
      setScored(rescored);
    });
  return () => { cancelled = true; };
}, [clustered, domainTiers, sourceTiers, specialFollows]);
```

### 4.13 evolveMemory 同步写 learned_preferences

**文件**：`src/utils/memoryEvolver.js` 修改

在 evolveMemory 写完 agent_memories + persona_summary 后，同时 PATCH `/api/agent-memory/learned-preferences`：

```js
// 抽取 top 关键词/主题作为 learned_preferences
const learnedPrefs = extractLearnedPreferences(messages);
await fetch('/api/agent-memory/learned-preferences', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(learnedPrefs),
}).catch(() => {});
```

**后端 handler**：在 [server/http/agentMemoryHandlers.js](file:///e:/VStudio_Project/Silicon%20Meridian/server/http/agentMemoryHandlers.js) 新增路由 `PATCH /api/agent-memory/learned-preferences` → `mergeLearnedPreferences(userId, patch)` 合并写入 `user_profiles.learned_preferences`（不属于 §4.6 profileHandlers 路由表，属于 agentMemoryHandlers）。

**`extractLearnedPreferences` 纯函数**（在 memoryEvolver.js 顶部导出，便于测试）：从 messages 数组中提取 top 关键词/主题，输出 `{ topics: string[], preferredDepth: 'shallow'|'deep', preferredFormat: 'concise'|'detailed' }` 结构。

### 4.14 PersonaSummarySection 组件

**文件**：`src/components/profile/PersonaSummarySection.jsx`（新建）

展示 AI 性格画像：用户习惯 / 用户性格 / 用户需求三栏，每栏最多 10 条。空状态显示"开始与 AI 对话累积画像"。

**集成位置**：在 `profile-memory-panel` 之后、`AgentMemorySection` 之前。

### 4.15 SnapshotHistorySection 组件

**文件**：`src/components/profile/SnapshotHistorySection.jsx`（新建）

展示历史 recommendation_snapshots：
- 顶部：日期 + ai_status 标签 + 简报 oneLine
- 点击单条展开看 lanes 详情（public + personal）
- 调 `GET /api/profile/snapshots`（最近 30 天）+ `GET /api/profile/snapshots?date=YYYY-MM-DD`（单日详情）

**集成位置**：在 `AgentMemorySection` 之后（页面底部）。

### 4.16 删除 App.jsx 重复 clusterEvents

**文件**：`src/App.jsx` L1112 修改

删除内联 `clusterEvents(filtered)` 调用，统一由 `useRecommendationMemos` 处理。

---

## 5. 错误处理与边界

### 5.1 cron job 失败处理

| 失败点 | 影响 | 处理 |
|---|---|---|
| `users.last_seen_at` 查询失败 | 整个 cron 不跑 | 记 log，下次 cron 触发重试 |
| 单用户 profile.getState 失败 | 该用户跳过 | 记 log + 继续下一个用户 |
| newsService.fetchAggregatedNews 失败 | 该用户跳过 | 同上 |
| callAiInsights 429/5xx | 该用户 LLM 增强失败 | 降级到 algorithm 模式，aiStatus='ai_failed'，仍写库 |
| callAiBriefingGenerator 失败 | 该用户 briefing LLM 失败 | 降级到 algorithmBriefing，aiStatus='ai_failed' |
| snapshotRepository.insertSnapshot 失败 | 整个用户预热失败 | 记 log，lazy 路径接管 |
| 整体 cron 抛错 | 全部用户未预热 | 记 log + 不影响 lazy 路径自动触发 |

**核心原则**：cron 失败永远不阻塞用户使用，lazy 路径作为兜底。

### 5.2 lazy 触发失败

| 失败点 | 影响 | 处理 |
|---|---|---|
| 401 未登录 | 不能预热 | 前端 useSnapshotPreheat 状态 idle，不显示 loading |
| 30s 超时（Vercel 限制） | 预热未完成 | 前端 status='error'，降级到本地 recommendationEngine 计算 + 显示"AI 增强失败，使用算法推荐"提示 |
| 后端 500 | 同上 | 同上 |
| 网络断开 | 同上 | 同上 |

### 5.3 实时增强失败

| 失败点 | 影响 | 处理 |
|---|---|---|
| items 为空 | 不发起请求 | 前端 hook 直接 return |
| LLM 429 | 评分失败 | 显示 toast"AI 限流，请稍后再试"，items 不重排 |
| LLM 超时 | 同上 | 同上 |
| itemScores 为空 | 不重排 | 显示 toast"AI 未返回评分" |

### 5.4 fetchRelevantMemories 失败

**核心原则**：fetchRelevantMemories 永远是"锦上添花"，失败时静默降级到无记忆模式，绝不阻塞主流程。

- AiChat 发送消息前失败：`relevantMemories = []`，buildSystemPrompt 不输出"相关记忆"段
- 推荐算法注入失败：`relevantMemories = []`，buildRecommendation 不影响评分

### 5.5 三表事务失败

`snapshotRepository.insertSnapshot` 已包含 ROLLBACK，事务失败时整个用户预热失败，lazy 路径接管。

### 5.6 边界情况

- **用户在 06:00 前登录**：cron 还未跑，lazy 路径触发，正常预热
- **用户在 06:00 同时登录**：cron 与 lazy 同时触发，ON CONFLICT 策略保证幂等，先到先写
- **用户禁用 LLM 配置**：callAiInsights/callAiBriefingGenerator 跳过，仅写 algorithm mode 快照
- **冷启动用户（无 readingHistory）**：recommendationEngine 输出空 lanes，仍写快照（items 空数组），aiStatus='not_requested'

---

## 6. 测试策略

### 6.1 纯函数单元测试

**snapshotService 纯函数**：

```js
describe('selectItemsForAiInsights', () => {
  it('selects top 15 from each lane', () => {
    const lanes = { public: Array(20).fill({id: 1}), personal: Array(20).fill({id: 2}) };
    const result = selectItemsForAiInsights(lanes);
    expect(result).toHaveLength(30);
  });

  it('handles missing lanes gracefully', () => {
    const result = selectItemsForAiInsights({});
    expect(result).toEqual([]);
  });
});
```

**snapshotRepository 纯函数**：

```js
describe('buildInsertItemsParams', () => {
  it('builds params for both lanes', () => {
    const lanes = { public: [{id: 'a', mustReadScore: 80}], personal: [{id: 'b', mustReadScore: 70}] };
    const { values, params } = buildInsertItemsParams('snap-1', lanes);
    expect(values.split(',')).toHaveLength(2);
    expect(params[0]).toBe('snap-1');
  });

  it('handles empty lanes', () => {
    const { values, params } = buildInsertItemsParams('snap-1', { public: [], personal: [] });
    expect(values).toBe('');
    expect(params).toEqual([]);
  });
});
```

**aiHandlers 纯函数**：

```js
describe('buildAiInsightsPrompt', () => {
  it('includes personaSummary context', () => {
    const prompt = buildAiInsightsPrompt(items, { habits: ['简洁回复'], traits: [], needs: [] });
    expect(prompt).toContain('简洁回复');
    expect(prompt).toContain('【用户画像】');
  });

  it('handles empty personaSummary', () => {
    const prompt = buildAiInsightsPrompt(items, {});
    expect(prompt).toContain('无');
  });
});
```

### 6.2 测试覆盖目标

| 模块 | 测试文件 | 用例数 |
|---|---|---|
| `selectItemsForAiInsights` | `server/profile/__tests__/snapshotService.test.js` | 2 |
| `buildInsertItemsParams` | `server/profile/__tests__/snapshotRepository.test.js` | 3 |
| `buildAiInsightsPrompt` | `server/http/__tests__/aiHandlers.test.js` | 3 |
| `useSnapshotPreheat` 状态机 | `src/hooks/__tests__/useSnapshotPreheat.test.js` | 5 |
| `useAiRecommendationEnhance` 状态机 | `src/hooks/__tests__/useAiRecommendationEnhance.test.js` | 4 |
| `extractLearnedPreferences` 纯函数 | `src/utils/__tests__/memoryEvolver.test.js` | 2 |
| **小计** | | **~19 新增** |

**目标**：测试数从 362 增至 ~381。

**不做**：组件渲染测试、E2E 测试（项目无 @testing-library/react 依赖，遵循 Phase 1/2 模式）。

---

## 7. 实施步骤

### 7.1 Step A（基础设施）

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| A1 | `server/db/migrations/006_profile_llm_sync.sql` | 新增字段 + 索引 | 无 |
| A2 | `server/http/lastSeenMiddleware.js` | 新建中间件 | A1 |
| A3 | `server/profile/profileRepository.js` | 扩展 getLlmConfig / setLlmConfig | A1 |
| A4 | `server/http/profileHandlers.js` | 新增 POST/GET /api/profile/llm-config | A3 |
| A5 | `src/hooks/useLlmConfig.js` | 保存时 fire-and-forget 同步 | A4 |
| A6 | 测试 + 验收 | 验证 last_seen_at 更新 + llmConfig 同步 | 全部 |

### 7.2 Step B（推荐增强）

| 步骤 | 文件 | 改动 | 依赖 |
|---|---|---|---|
| B1 | `server/http/aiHandlers.js` | 抽离 handleAiInsightsRequest + buildAiInsightsPrompt 纯函数 | 无 |
| B2 | `server/profile/snapshotRepository.js` | 新建：三表事务 + buildInsertItemsParams 纯函数 | 无 |
| B3 | `server/profile/snapshotService.js` | 新建：preheatForUser + selectItemsForAiInsights 纯函数 | B2 |
| B4 | `server/http/profileHandlers.js` | 新增 preheat / analyze / list 路由 | B3 |
| B5 | `server/cron/dailyBriefingPreheatJob.js` | 新建：cron + 并发限制 | B3 |
| B6 | `server/productionServer.js` | 启动注册 cron | B5 |
| B7 | `src/store/profileStore.js` | 新增 personaSummary 字段 + action | 无 |
| B8 | `src/components/AiChatPanel.jsx` + `memoryEvolver.js` | personaSummary 改读 store + 写 learned_preferences | B7 |
| B9 | `src/hooks/useSnapshotPreheat.js` | 新建 | B4 |
| B10 | `src/hooks/useAiRecommendationEnhance.js` | 新建 | B4 |
| B11 | `src/hooks/useRecommendationMemos.js` | 集成 useSnapshotPreheat + 注入 personaSummary + relevantMemories | B9 |
| B12 | `src/utils/memoryEvolver.js` + `AiChatPanel.jsx` + `buildSystemPrompt.js` | 激活 fetchRelevantMemories | 无 |
| B13 | `src/hooks/useRecommendationMemos.js` | 推荐算法注入 relevantMemories（useMemo + useEffect 拆分） | B12 |
| B14 | `src/components/profile/PersonaSummarySection.jsx` | 新建 | B7 |
| B15 | `src/components/profile/SnapshotHistorySection.jsx` | 新建 | B4 |
| B16 | `src/components/ProfilePage.jsx` | 接入两个新 section | B14, B15 |
| B17 | `src/components/RightPanel.jsx` | "重新分析"按钮改调 useAiRecommendationEnhance | B10 |
| B18 | `src/App.jsx` L1112 | 删除内联 clusterEvents | B11 |
| B19 | `src/styles.css` | 新增样式 | 无 |
| B20 | `CLAUDE.md` / `AGENTS.md` | 文档更新 | 全部 |
| B21 | 测试 + 验收 + tag stable-v13 | | 全部 |

### 7.3 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| cron 跑挂导致大量 LLM 调用 | 额度爆炸 | 并发限制 3 + 活跃用户筛选 + 单用户失败不重试 |
| lazy 触发 30s 超时 | 用户等待体验差 | SkeletonCard 占位 + 失败降级到本地算法 |
| mergeAiBriefing 校验过严导致 aiBrief 频繁失败 | LLM 调用浪费 | aiStatus='validation_failed'，仍写 algorithm 模式，下次 cron 自动重试 |
| personaSummary 同步到 localStorage 撑爆 | QuotaExceededError | 持久化时 cap：habits/traits/needs 各最多 10 条 |
| fetchRelevantMemories 性能 | 推荐算法变慢 | 仅对 top 5 query 拉记忆，并发 + 失败静默 |
| Step A 后端 llmConfig 同步失败影响 Step B | Step B 无 LLM 配置可用 | Step A fire-and-forget，前端 fallback 到 localStorage，Step B 优先读 PG 失败时读 localStorage |

**回滚策略**：每个 step 独立 commit，Step A 与 Step B 完全分离，可单独 revert。

### 7.4 验收清单

**Step A 验收**：
- [ ] 1. 数据库 migration 006 应用成功
- [ ] 2. 用户登录后 users.last_seen_at 更新
- [ ] 3. 前端保存 LLM 配置后 user_profiles.llm_config 同步
- [ ] 4. /api/profile/llm-config GET/POST 正常
- [ ] 5. 全量测试通过

**Step B 验收**：
- [ ] 6. cron 06:00 触发，活跃用户被预热（手动 npm run preheat:today 验证）
- [ ] 7. recommendation_snapshots 三表写入
- [ ] 8. 用户首次登录触发 lazy 预热
- [ ] 9. "重新分析"按钮调 /api/profile/snapshots/analyze
- [ ] 10. AiChat 发送消息前调 fetchRelevantMemories，prompt 含"相关记忆"段
- [ ] 11. 推荐算法注入 relevantMemories
- [ ] 12. personaSummary 进入 profileStore，ProfilePage 显示 PersonaSummarySection
- [ ] 13. ProfilePage 显示 SnapshotHistorySection
- [ ] 14. mergeAiBriefing 在预热时被调用，ai_status='merged' 写入
- [ ] 15. LLM 失败时降级到 algorithm 模式，ai_status='ai_failed'
- [ ] 16. App.jsx L1112 内联 clusterEvents 已删除
- [ ] 17. 全量测试通过（~381）
- [ ] 18. build 成功
- [ ] 19. 打 tag stable-v13

---

## 8. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 触发模式 | 混合（cron + lazy） | 活跃用户开箱即用 + 冷用户按需付费，工程最优 |
| cron 频率 | 每日 1 次（06:00 Asia/Shanghai） | 平衡 token 消耗与实时性，与"每日早报"语义一致 |
| 实时增强范围 | Top 30 个性化评分 | 保留现有 ai-insights 范围，仅加 personaSummary 注入 |
| fetchRelevantMemories 激活范围 | AiChat + 推荐算法 | 全面覆盖，AiChat 发送前 + 推荐评分前都注入 |
| recommendation_snapshots 写入时机 | 仅定时写入 | 避免数据湖，跨设备可查历史 |
| personaSummary 同步范围 | 全链路 | profileStore + 推荐算法 + ProfilePage 展示 |
| mergeAiBriefing 接入时机 | 预热时自动调 | 用户无感，失败降级到 algorithm 模式 |
| Phase 3 UI 边界 | 最小 UI | 仅加 PersonaSummary + SnapshotHistory，仪表盘重构留 Phase 4 |
| 分步推进 | Step A（基础设施）+ Step B（推荐增强）独立交付 | Step A 失败不阻塞 Step B，可单独回滚 |
| users.last_seen_at 节流 | 5min 内不重复更新 | 避免高频请求导致 DB 写入压力 |
| user_profiles.llm_config 同步策略 | fire-and-forget | 前端 localStorage 仍是主源，PG 仅作 cron 兜底读取 |
| 三表事务 ON CONFLICT 策略 | 重跑覆盖 | 支持幂等，cron 与 lazy 同时触发不冲突 |
| personaSummary localStorage cap | habits/traits/needs 各 10 条 | 避免 QuotaExceededError |
| Vercel 部署不跑 cron | 只走 lazy 路径 | serverless 按请求计费，cron 不适用 |
| 测试策略 | 纯函数单测 | 项目无 @testing-library/react，遵循 Phase 1/2 模式 |

---

## 9. 后续阶段衔接

| Phase 3 产出 | Phase 4 如何使用 |
|---|---|
| recommendation_snapshots 写入链路 | 仪表盘视图直接查表展示历史趋势 |
| personaSummary 全链路同步 | 仪表盘画像 Tab 直接读 profileStore.personaSummary |
| fetchRelevantMemories 激活 | Phase 4 可在更多场景调用（如画像编辑时推荐关联记忆） |
| mergeAiBriefing 接入 | Phase 4 可加"用户编辑 AI 简报"功能 |
| learned_preferences 字段写入 | Phase 4 画像 Tab 展示 learned preferences |
| snapshotService.preheatForUser | Phase 4 可加"手动重跑预热"按钮 |
