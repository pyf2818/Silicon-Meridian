# 用户画像模块 Phase 5：画像进化趋势

- **日期**：2026-07-28
- **状态**：待 review
- **作者**：brainstorming 流程产出
- **范围**：在 Phase 4 仪表盘之上，新增第 6 区块「画像进化趋势」，记录 personaSummary 每次进化的完整快照，让用户看到画像从空白到丰满的进化过程
- **用户感知**：仪表盘能看到习惯/性格/需求三条趋势线随对话轮数增长，点击某点展开 diff 看具体新增/删除项
- **依赖**：Phase 4（stable-v14）

---

## 1. 背景与动机

### 1.1 Phase 4 交付的仪表盘

Phase 4 完成了纯前端仪表盘，聚合 Phase 3 已沉淀数据：
- KPI 卡片 / 推荐历史趋势 / 当前画像 / 行为观测 / 手动重跑预热
- 但 personaSummary 只展示当前快照，看不到"画像是怎么进化过来的"

### 1.2 问题：进化过程无痕迹

- `user_profiles.persona_summary` jsonb 每次 PATCH 用 spread 合并覆盖，旧值丢失
- 用户对话 3 轮后画像开始进化，但无法回看"第 10 轮时画像是什么样"
- 没有任何历史表，进化过程完全无痕迹

### 1.3 Phase 5 目标

1. 新建 `persona_summary_history` 表，记录 personaSummary 每次进化的完整快照
2. 在 `mergePersonaSummary` 内部同事务写入历史 + 自动清理 cap 90
3. 新增 `GET /api/agent-memory/persona/history` 端点
4. 仪表盘新增第 6 区块「画像进化趋势」，趋势图 + diff 详情
5. 顺手修 3 个调研发现的 bug

**不做**：
- 不做画像编辑器（独立产品功能，Phase 6 候选）
- 不做画像版本回滚（YAGNI，等用户反馈"想回到某个版本"再做）
- 不做画像对比导出（YAGNI）

---

## 2. 架构总览

### 2.1 数据流

```
[AiChat 对话] → [memoryEvolver] → [PATCH /api/agent-memory/persona]
                                          ↓
                                   [mergePersonaSummary]
                                          ↓
                            事务：UPDATE user_profiles
                                  + INSERT persona_summary_history
                                  + DELETE cap>90 旧记录
                                          ↓
[ProfileDashboard 第 6 区块]
    └── useProfileDashboard.personaHistory
            └── GET /api/agent-memory/persona/history?limit=30
                    └── persona_summary_history 表
```

### 2.2 模块边界

```
server/db/migrations/
  007_persona_summary_history.sql   新建表 + 索引 + cap 清理函数
server/agent/
  agentMemoryService.js            mergePersonaSummary 改造（事务）+ 新增 getPersonaHistory
server/http/
  agentMemoryHandlers.js           新增 GET /api/agent-memory/persona/history 路由
server/profile/
  snapshotService.js               修 Bug 1：preheatForUser 内部读 personaSummary
server/agent/
  agentContext.js                  修 Bug 2：lp.frequentTopics → lp.topics
src/utils/
  dashboardBuilders.js             新增 buildPersonaTrendSeries + diffPersonaSnapshots 纯函数
src/hooks/
  useProfileDashboard.js           加 personaHistory + loadPersonaHistory
src/components/profile/
  PersonaEvolutionSection.jsx      第 6 区块主组件（趋势图 + diff 展开）
  PersonaDiffCard.jsx              diff 详情面板（added/removed 三列）
  ProfileDashboard.jsx            集成第 6 区块
src/store/
  profileStore.js                  修 Bug 3：默认值字段名对齐
src/
  styles.css                       追加进化趋势/diff 样式
```

### 2.3 与 Phase 4 边界

| Phase 4 产出 | Phase 5 使用方式 |
|---|---|
| ProfileDashboard 主组件 | 新增第 6 区块，位置在「当前画像+行为观测」下方、「预热按钮」上方 |
| useProfileDashboard hook | 扩展返回 personaHistory + loadPersonaHistory |
| TrendLineChart 组件 | 复用，传 3 条 series（习惯/性格/需求长度） |
| dashboardBuilders 纯函数 | 新增 2 个纯函数到同一文件 |

---

## 3. 详细设计

### 3.1 数据库表（migration 007）

```sql
-- server/db/migrations/007_persona_summary_history.sql
CREATE TABLE IF NOT EXISTS persona_summary_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,
  evolved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psh_user_time ON persona_summary_history (user_id, evolved_at DESC);
```

**保留策略**：每用户 cap 90 条（约 3 个月，日均 5 次进化）。不依赖定时清理任务，在每次 INSERT 后同事务触发清理（见 3.2）。

**字段决策**：
- `snapshot` 存完整 `{habits, traits, needs, lastEvolvedAt}` jsonb，前端按需计算长度 + diff
- 不拆 `habits_count/traits_count/needs_count` 三列——完整快照既能看趋势又能看内容对比
- 不存 `trigger_source`（AiChat/cron/manual）——YAGNI

### 3.2 写入链路（mergePersonaSummary 改造）

**单一写入点**：`server/agent/agentMemoryService.js` 的 `mergePersonaSummary`。

```js
export async function mergePersonaSummary(userId, patch) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 读取当前 persona_summary（FOR UPDATE 行锁，防并发）
    const cur = await client.query(
      'SELECT persona_summary FROM user_profiles WHERE user_id=$1 FOR UPDATE',
      [userId]
    );
    const current = cur.rows[0]?.persona_summary || {};

    // 2. 统一时间戳字段名（顺手修 Bug 3）
    const now = new Date().toISOString();
    const next = {
      ...current,
      ...patch,
      lastEvolvedAt: patch.lastEvolvedAt || now,
      lastUpdated: now,
      updatedAt: undefined,  // 清理遗留旧字段
    };

    // 3. UPDATE user_profiles
    await client.query(
      `UPDATE user_profiles SET persona_summary=$2, persona_updated_at=now() WHERE user_id=$1`,
      [userId, JSON.stringify(next)]
    );

    // 4. INSERT persona_summary_history（同事务）
    await client.query(
      `INSERT INTO persona_summary_history (user_id, snapshot, evolved_at)
       VALUES ($1, $2, $3)`,
      [userId, JSON.stringify(next), now]
    );

    // 5. 清理 cap 90（同事务）
    await client.query(
      `DELETE FROM persona_summary_history
       WHERE user_id=$1 AND id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY evolved_at DESC) AS rn
           FROM persona_summary_history WHERE user_id=$1
         ) t WHERE rn > 90
       )`,
      [userId]
    );

    await client.query('COMMIT');
    return { personaSummary: next };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

**关键决策**：
- **不动 `setPersonaSummary`**（PUT 整体覆盖路径）——用户手动重置画像不算"进化"，不写历史
- **只动 `mergePersonaSummary`**（PATCH 增量进化路径）——AiChat 对话进化只走这条
- **同事务清理 cap 90**——避免单独跑 cron，写入路径天然触发清理
- **顺手修字段名不统一**：清理 `updatedAt` 旧字段，统一为 `lastEvolvedAt`（patch 写入时）+ `lastUpdated`（合并时）

**性能影响**：
- persona 进化本身不频繁（每 3 轮对话一次），单用户日均 < 5 次
- 同事务多 2 条 SQL（INSERT + DELETE），约 2ms 开销
- 清理 SQL 用 ROW_NUMBER 窗口函数，cap 90 范围内性能稳定

**回滚保障**：事务包裹，任一 SQL 失败全部回滚，不影响现有 personaSummary 写入。

### 3.3 读取端点

复用现有 `/api/agent-memory/persona` handler 前缀，新增 GET 子路径：

```
GET /api/agent-memory/persona/history?limit=30
```

**返回结构**：
```json
{
  "ok": true,
  "history": [
    {
      "id": "uuid",
      "snapshot": { "habits": [...], "traits": [...], "needs": [...], "lastEvolvedAt": "..." },
      "evolved_at": "2026-07-28T15:30:00Z"
    },
    ...
  ]
}
```

**Query 参数**：
- `limit`：默认 30，最大 90（与 cap 一致）

**实现位置**：`server/http/agentMemoryHandlers.js` 加一条路由，调 `agentMemoryService.getPersonaHistory(userId, limit)`。

**注意**：不复用 `/api/profile/snapshots` 端点——那是推荐快照，与 persona 无关。复用 `/api/agent-memory/persona` 前缀语义更准确。

### 3.4 前端可视化

在仪表盘新增第 6 个区块「画像进化趋势」，位置：**当前画像卡片下方、行为观测卡片下方、预热按钮上方**。

```
┌─────────────────────────────────────────┐
│ 6. 画像进化趋势                          │
│                                          │
│ [趋势图] 习惯/性格/需求 三条线          │
│   Y轴 = 数组长度                         │
│   X轴 = evolved_at (MM-DD HH:mm)        │
│                                          │
│ [点击某点] → 展开该时刻完整快照 diff     │
│   左列：该时刻快照                       │
│   右列：当前快照                         │
│   高亮：新增项（绿）/ 删除项（红）       │
└─────────────────────────────────────────┘
```

**纯函数抽取**（新增到 `src/utils/dashboardBuilders.js`）：

```js
// 趋势图数据：persona 数组长度随时间变化
export function buildPersonaTrendSeries(history = []) {
  const sorted = [...history].reverse(); // 倒序转正序
  return {
    labels: sorted.map(h => formatEvolvedAt(h.evolved_at)),
    series: [
      { name: '习惯', values: sorted.map(h => h.snapshot?.habits?.length || 0) },
      { name: '性格', values: sorted.map(h => h.snapshot?.traits?.length || 0) },
      { name: '需求', values: sorted.map(h => h.snapshot?.needs?.length || 0) },
    ],
  };
}

// 两个快照的 diff（新增/删除项）
export function diffPersonaSnapshots(prev = {}, current = {}) {
  const diffList = (key) => {
    const prevArr = prev[key] || [];
    const curArr = current[key] || [];
    const prevSet = new Set(prevArr.map(String));
    const curSet = new Set(curArr.map(String));
    return {
      added: curArr.filter(x => !prevSet.has(String(x))),
      removed: prevArr.filter(x => !curSet.has(String(x))),
    };
  };
  return {
    habits: diffList('habits'),
    traits: diffList('traits'),
    needs: diffList('needs'),
  };
}

function formatEvolvedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
```

**TrendLineChart 复用**：现有组件已支持多 series（`colors` 数组 5 色），直接传 3 条 series 即可，无需改 TrendLineChart。

**diff 视图交互**：
- 趋势图点击某点 → 展开 inline 详情面板（不弹 modal，避免打断）
- 详情面板用三列布局展示 habits/traits/needs 的 added/removed
- 默认收起，点击切换展开

**子组件拆分**：
```
src/components/profile/
  PersonaEvolutionSection.jsx    主区块（趋势图 + diff 详情）
  PersonaDiffCard.jsx            diff 详情面板（纯展示）
```

**hook 扩展**：`useProfileDashboard.js` 新增 `personaHistory` + `loadPersonaHistory`：

```js
const [personaHistory, setPersonaHistory] = useState([]);
const [historyLoading, setHistoryLoading] = useState(true);

const loadPersonaHistory = useCallback(async () => {
  setHistoryLoading(true);
  try {
    const resp = await fetch('/api/agent-memory/persona/history?limit=30');
    const data = await resp.json();
    if (data.ok) setPersonaHistory(data.history || []);
  } catch {
    /* silent */
  } finally {
    setHistoryLoading(false);
  }
}, []);

useEffect(() => {
  loadSnapshots();
  loadLearnedPrefs();
  loadPersonaHistory();
}, [loadSnapshots, loadLearnedPrefs, loadPersonaHistory]);
```

**preheat 触发后不刷新 personaHistory**——preheat 不影响 personaSummary（只影响推荐快照），无需联动。

### 3.5 空状态处理

- 历史为空（用户从未对话）：显示「暂无画像进化记录，与 AI 对话累积 3 轮后开始记录」
- 历史只有 1 条：趋势图渲染单点，diff 视图禁用（无可对比项）
- 历史多条但今天无变化：趋势图照常渲染，无新点添加

---

## 4. 附带 bug 修复

### 4.1 Bug 1：cron/lazy 预热未注入 personaSummary

**现状**：
- `server/cron/dailyBriefingPreheatJob.js:64` 调 `preheatForUser({ userId: user.id })`，未传 personaSummary
- `server/http/profileHandlers.js:31` lazy 路径同样未传
- 结果：cron/lazy 预热时 LLM prompt 中无用户性格画像，推荐打分也跳过 persona 加权

**修复**：在 `preheatForUser` 内部（`snapshotService.js` 拉取 profile 之后）自动从 DB 读 personaSummary：

```js
// snapshotService.js preheatForUser 内部
const profile = await repo.getState(userId);
const storedLlmConfig = await repo.getLlmConfig(userId);

// 新增：从 DB 读 personaSummary（cron/lazy 路径无前端传入）
let personaSummary = personaSummaryArg;
if (!personaSummary) {
  const { getPersonaSummary } = await import('../agent/agentMemoryService.js');
  const psResult = await getPersonaSummary(userId);
  personaSummary = psResult?.personaSummary || null;
}
```

**改动点**：`preheatForUser` 签名不变（保持 `personaSummary = null` 可选参数），但内部自动读取，调用方无需改。

**影响**：仅 cron/lazy 路径行为变化（之前无 persona 注入，现在有），实时分析路径行为不变。

### 4.2 Bug 2：agentContext.js 字段名小 bug

**现状**：`server/agent/agentContext.js:65` 读 `lp.frequentTopics`，但实际 `learned_preferences` 中存的是 `topics`（见 `agentMemoryService.js:200`），定时任务构建 systemPrompt 时该段会失效。

**修复**：`agentContext.js:65` 改 `lp.frequentTopics` → `lp.topics`，加 fallback：

```js
const topics = lp.topics || lp.frequentTopics || [];
```

**改动**：1 行代码，无副作用。

### 4.3 Bug 3：jsonb 内时间戳字段名不统一

**现状**：同一 jsonb 中并存三种时间戳字段名：
- `updatedAt`（前端 profileStore 默认值）
- `lastEvolvedAt`（memoryEvolver 写入 patch）
- `lastUpdated`（后端 mergePersonaSummary 合并写入）

**修复**：
1. `mergePersonaSummary` 合并时清理 `updatedAt`（3.2 伪代码已含）
2. `memoryEvolver.js` patch 写入时统一用 `lastEvolvedAt`（已是）
3. `profileStore.js` 默认值字段名对齐为 `lastEvolvedAt`（而非 `updatedAt`）

```js
// profileStore.js 默认值
personaSummary: { habits: [], traits: [], needs: [], lastEvolvedAt: null },
```

**风险**：现有用户 localStorage 中可能有 `updatedAt`，需在 `mergePersonaSummary` 后端清理 + `fetchPersonaSummary` 前端兼容读取（`lastEvolvedAt || updatedAt`）。

---

## 5. 错误处理与边界

### 5.1 数据加载失败

- personaHistory 加载失败：静默，显示空卡片（不阻塞仪表盘其他区块）
- diff 计算失败：fallback 显示原始快照内容，不显示 added/removed

### 5.2 写入失败

- mergePersonaSummary 事务失败：全部回滚，personaSummary 不更新，历史不写入
- 不影响现有 AiChat 对话流程（进化本身是 fire-and-forget）

### 5.3 空状态

- personaHistory 为空：显示「暂无画像进化记录，与 AI 对话累积 3 轮后开始记录」
- personaHistory 只有 1 条：趋势图渲染单点，diff 视图禁用
- personaHistory 多条但今天无变化：趋势图照常渲染

---

## 6. 测试策略

### 6.1 纯函数单元测试

新增约 10 个单元测试到 `src/utils/__tests__/dashboardBuilders.test.js`（或新文件）：

**buildPersonaTrendSeries**：
- 空数组 → 空 labels + 3 条空 values
- 单条 → 1 个 label + 3 个值
- 多条 → 按时间正序
- 倒序输入 → 正序输出
- 字段缺失（snapshot 为 null）→ values 为 0

**diffPersonaSnapshots**：
- 完全相同 → 三列 added/removed 全空
- 全新增 → added 全满，removed 全空
- 全删除 → added 全空，removed 全满
- 部分变化 → added/removed 各有部分
- 字段缺失 → 返回空 added/removed

### 6.2 测试覆盖目标

新增约 10 个单元测试，总数 410 → 420。

---

## 7. 实施步骤

### 7.1 Phase 5 任务清单

| Task | 内容 | 文件 |
|---|---|---|
| P1 | migration 007 persona_summary_history 表 | server/db/migrations/007_persona_summary_history.sql |
| P2 | mergePersonaSummary 改造（事务 + INSERT 历史 + cap 清理 + 修 Bug 3） | server/agent/agentMemoryService.js |
| P3 | 新增 getPersonaHistory 服务方法 | server/agent/agentMemoryService.js |
| P4 | 新增 GET /api/agent-memory/persona/history 路由 | server/http/agentMemoryHandlers.js |
| P5 | buildPersonaTrendSeries + diffPersonaSnapshots 纯函数 + 单元测试 | src/utils/dashboardBuilders.js + __tests__ |
| P6 | useProfileDashboard 加 personaHistory 字段 + loadPersonaHistory | src/hooks/useProfileDashboard.js |
| P7 | PersonaDiffCard 组件 | src/components/profile/PersonaDiffCard.jsx |
| P8 | PersonaEvolutionSection 组件（趋势图 + diff 展开） | src/components/profile/PersonaEvolutionSection.jsx |
| P9 | ProfileDashboard 集成第 6 区块 | src/components/profile/ProfileDashboard.jsx |
| P10 | styles.css 追加进化趋势/diff 样式 | src/styles.css |
| P11 | 修 Bug 1：preheatForUser 内部读 personaSummary | server/profile/snapshotService.js |
| P12 | 修 Bug 2：agentContext.js 字段名 | server/agent/agentContext.js |
| P13 | 修 Bug 3：profileStore 默认值字段名对齐 | src/store/profileStore.js |
| P14 | 文档更新 + 最终验收 + tag stable-v15 | CLAUDE.md + AGENTS.md |

### 7.2 验收清单

- [ ] npm test 全通过（420 tests，新增 10 个纯函数测试）
- [ ] npm run build 成功
- [ ] npm run db:migrate 成功创建表
- [ ] 仪表盘第 6 区块正常渲染
- [ ] 趋势图展示习惯/性格/需求三条线
- [ ] 点击趋势图某点展开 diff 详情
- [ ] 空状态正确显示
- [ ] cron 预热日志确认 personaSummary 已注入
- [ ] tag stable-v15

---

## 8. 关键决策记录

### 8.1 每次进化全快照，不存长度指标

**决策**：`snapshot` jsonb 存完整 `{habits, traits, needs, lastEvolvedAt}`，不拆三列存长度。

**理由**：
- 完整快照既能看长度趋势，又能看内容对比，一份数据两种用法
- 拆三列只能看数量趋势，价值低一半
- jsonb 查询性能足够，cap 90 范围内无压力

### 8.2 同事务清理 cap 90，不跑 cron

**决策**：在 `mergePersonaSummary` 同事务内 DELETE cap>90 旧记录，不跑独立 cron。

**理由**：
- persona 进化本身不频繁（每 3 轮对话一次），写入路径天然触发清理
- 独立 cron 需要新增定时任务 + 错误处理 + 日志，复杂度高
- 同事务保证原子性，避免历史表无限增长

### 8.3 只动 mergePersonaSummary，不动 setPersonaSummary

**决策**：只在 `mergePersonaSummary`（PATCH 路径）写历史，不动 `setPersonaSummary`（PUT 路径）。

**理由**：
- PATCH 是"进化"语义，每次进化都应留痕
- PUT 是"手动重置"语义，重置不算进化，不写历史
- 区分清晰，避免误触发

### 8.4 复用 /api/agent-memory/persona 前缀，不复用 /api/profile/snapshots

**决策**：新增 `GET /api/agent-memory/persona/history`，不复用 `/api/profile/snapshots`。

**理由**：
- `/api/profile/snapshots` 是推荐快照，与 persona 无关
- `/api/agent-memory/persona` 是 personaSummary 的专属端点，语义准确
- 复用现有 handler 前缀，路由注册零改动

### 8.5 顺手修 3 个 bug

**决策**：Phase 5 一起修调研发现的 3 个 bug（cron/lazy persona 注入缺失、agentContext 字段名、时间戳字段名不统一）。

**理由**：
- 3 个 bug 都与 personaSummary 相关，与 Phase 5 主线强相关
- 修 Bug 3（字段名统一）需要改 mergePersonaSummary，与 P2 改造同文件，省一次改动
- 修 Bug 1（cron/lazy persona 注入）让预热真正生效，与 Phase 5 "让用户看到画像价值"目标一致
- Bug 2 是 1 行改动，顺手修

---

## 9. 后续阶段衔接

| Phase 5 产出 | Phase 6 如何使用 |
|---|---|
| persona_summary_history 表 | Phase 6 可加画像版本回滚（恢复到某个历史快照） |
| 进化趋势图框架 | Phase 6 可加更细粒度可视化（如按 habits/traits/needs 分 tab） |
| diff 视图 | Phase 6 可加"撤销某次进化"按钮 |
| Bug 1 修复后 cron 注入 personaSummary | Phase 6 可验证推荐质量提升 |
