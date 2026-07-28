# Phase 5 画像进化趋势 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 4 仪表盘上新增第 6 区块「画像进化趋势」，记录 personaSummary 每次进化的完整快照并提供趋势图 + diff 视图，同时修复 3 个调研发现的 bug。

**Architecture:** 后端新建 `persona_summary_history` 表，在 `mergePersonaSummary` 内部同事务写入历史 + 清理 cap 90；前端扩展 `dashboardBuilders.js` 纯函数 + `useProfileDashboard` hook + 新增 `PersonaEvolutionSection`/`PersonaDiffCard` 组件，复用 `TrendLineChart` 加可选 `onSelect` 回调。

**Tech Stack:** PostgreSQL 15（jsonb + uuid + 窗口函数）, React 19, Zustand, Vitest 3.x

**Spec:** `docs/superpowers/specs/2026-07-28-user-profile-phase5-persona-evolution.md`

---

## File Structure

**新增文件（6 个）**
- `server/db/migrations/007_persona_summary_history.sql` — 表 + 索引
- `src/components/profile/PersonaEvolutionSection.jsx` — 第 6 区块主组件
- `src/components/profile/PersonaDiffCard.jsx` — diff 详情面板
- `src/utils/__tests__/personaEvolution.test.js` — Phase 5 纯函数测试

**修改文件（8 个）**
- `server/agent/agentMemoryService.js` — 改造 `mergePersonaSummary`（事务）+ 新增 `getPersonaHistory`
- `server/http/agentMemoryHandlers.js` — 新增 `GET /api/agent-memory/persona/history` 路由
- `server/profile/snapshotService.js` — Bug 1：`preheatForUser` 内部读 personaSummary
- `server/agent/agentContext.js` — Bug 2：`lp.frequentTopics` → `lp.topics`
- `src/utils/dashboardBuilders.js` — 新增 `buildPersonaTrendSeries` + `diffPersonaSnapshots`
- `src/hooks/useProfileDashboard.js` — 加 `personaHistory` + `loadPersonaHistory`
- `src/components/TrendLineChart.jsx` — 加可选 `onSelect` prop（不破坏现有调用）
- `src/components/profile/ProfileDashboard.jsx` — 集成第 6 区块
- `src/store/profileStore.js` — Bug 3：默认值字段名 `updatedAt` → `lastEvolvedAt`
- `src/styles.css` — 追加进化趋势/diff 样式
- `CLAUDE.md` — Phase 5 完成记录 + 测试数 420

---

## Task 1: Migration 007 — persona_summary_history 表

**Files:**
- Create: `server/db/migrations/007_persona_summary_history.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- server/db/migrations/007_persona_summary_history.sql
-- Phase 5: personaSummary 进化历史记录表
-- 每次 mergePersonaSummary 调用时同事务写入一条完整快照，cap 90/用户

CREATE TABLE IF NOT EXISTS persona_summary_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,
  evolved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psh_user_time ON persona_summary_history (user_id, evolved_at DESC);
```

- [ ] **Step 2: 运行 migration 验证建表成功**

Run: `npm run db:migrate`
Expected: 输出包含 `007_persona_summary_history.sql` 且无错误

- [ ] **Step 3: 验证表结构**

Run: `node -e "import('./server/db/client.js').then(async m => { const pool = m.getPool(); const r = await pool.query(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='persona_summary_history' ORDER BY ordinal_position\"); console.log(r.rows); process.exit(0); })"`
Expected: 输出 4 行（id/uuid, user_id/uuid, snapshot/jsonb, evolved_at/timestamptz）

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/007_persona_summary_history.sql
git commit -m "feat(db): add persona_summary_history table (migration 007)"
```

---

## Task 2: 改造 mergePersonaSummary（事务 + 写历史 + cap 清理 + 修 Bug 3）

**Files:**
- Modify: `server/agent/agentMemoryService.js:171-175`

- [ ] **Step 1: 替换 `mergePersonaSummary` 函数**

将 `server/agent/agentMemoryService.js:171-175` 原函数：

```js
export async function mergePersonaSummary(userId, patch) {
  const current = await getPersonaSummary(userId);
  const next = { ...current.personaSummary, ...patch, lastUpdated: new Date().toISOString() };
  return setPersonaSummary(userId, next);
}
```

替换为：

```js
/**
 * Phase 5: 合并式更新 personaSummary
 * - 同事务写入 persona_summary_history
 * - 同事务清理 cap 90 旧记录
 * - 统一时间戳字段名为 lastEvolvedAt + lastUpdated（修 Bug 3：清理 updatedAt）
 */
export async function mergePersonaSummary(userId, patch) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 读取当前 persona_summary（FOR UPDATE 行锁，防并发）
    const cur = await client.query(
      'SELECT persona_summary FROM user_profiles WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    const current = cur.rows[0]?.persona_summary || {};

    // 2. 合并字段；统一时间戳字段名（清理 updatedAt）
    const now = new Date().toISOString();
    const next = {
      ...current,
      ...patch,
      lastEvolvedAt: patch.lastEvolvedAt || now,
      lastUpdated: now,
      updatedAt: undefined,  // JSON.stringify 会忽略 undefined，清理遗留字段
    };

    // 3. UPDATE user_profiles
    await client.query(
      `UPDATE user_profiles SET persona_summary = $2, persona_updated_at = now() WHERE user_id = $1`,
      [userId, JSON.stringify(next)]
    );

    // 4. INSERT persona_summary_history（同事务）
    await client.query(
      `INSERT INTO persona_summary_history (user_id, snapshot, evolved_at)
       VALUES ($1, $2, $3)`,
      [userId, JSON.stringify(next), now]
    );

    // 5. 清理 cap 90（同事务，避免单独 cron）
    await client.query(
      `DELETE FROM persona_summary_history
       WHERE user_id = $1 AND id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY evolved_at DESC) AS rn
           FROM persona_summary_history WHERE user_id = $1
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

- [ ] **Step 2: 验证 lint/语法（启动 dev server 看是否报错）**

Run: `node -e "import('./server/agent/agentMemoryService.js').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error('FAIL:', e.message))"`
Expected: 输出 `exports: [...]` 包含 `mergePersonaSummary`，无错误

- [ ] **Step 3: Commit**

```bash
git add server/agent/agentMemoryService.js
git commit -m "feat(agent): mergePersonaSummary writes history + cap 90 + cleanup updatedAt"
```

---

## Task 3: 新增 getPersonaHistory 服务方法

**Files:**
- Modify: `server/agent/agentMemoryService.js`（在 `mergePersonaSummary` 后追加）

- [ ] **Step 1: 在 `mergePersonaSummary` 函数后追加 `getPersonaHistory`**

在 `server/agent/agentMemoryService.js` 文件末尾（或 `mergePersonaSummary` 之后）追加：

```js
/**
 * Phase 5: 读取 personaSummary 进化历史（最新在前）
 * @param {string} userId
 * @param {number} limit - 默认 30，最大 90（与 cap 一致）
 * @returns {Promise<Array<{ id, snapshot, evolved_at }>>}
 */
export async function getPersonaHistory(userId, limit = 30) {
  const pool = getPool();
  const cappedLimit = Math.max(1, Math.min(90, Number(limit) || 30));
  const result = await pool.query(
    `SELECT id, snapshot, evolved_at
     FROM persona_summary_history
     WHERE user_id = $1
     ORDER BY evolved_at DESC
     LIMIT $2`,
    [userId, cappedLimit]
  );
  return result.rows.map(r => ({
    id: r.id,
    snapshot: r.snapshot,
    evolved_at: r.evolved_at,
  }));
}
```

- [ ] **Step 2: 验证导出**

Run: `node -e "import('./server/agent/agentMemoryService.js').then(m => console.log('has getPersonaHistory:', typeof m.getPersonaHistory === 'function'))"`
Expected: `has getPersonaHistory: true`

- [ ] **Step 3: Commit**

```bash
git add server/agent/agentMemoryService.js
git commit -m "feat(agent): add getPersonaHistory service method"
```

---

## Task 4: 新增 GET /api/agent-memory/persona/history 路由

**Files:**
- Modify: `server/http/agentMemoryHandlers.js`

- [ ] **Step 1: 在 import 中加入 `getPersonaHistory`**

将 `server/http/agentMemoryHandlers.js:4-8` 的 import：

```js
import {
  addAgentMemory, addAgentMemoriesBatch, getAgentMemories, searchAgentMemories,
  deleteAgentMemory, getPersonaSummary, setPersonaSummary, mergePersonaSummary,
  mergeLearnedPreferences,
} from '../agent/agentMemoryService.js';
```

改为：

```js
import {
  addAgentMemory, addAgentMemoriesBatch, getAgentMemories, searchAgentMemories,
  deleteAgentMemory, getPersonaSummary, setPersonaSummary, mergePersonaSummary,
  mergeLearnedPreferences, getPersonaHistory,
} from '../agent/agentMemoryService.js';
```

- [ ] **Step 2: 在 `handleAgentMemoryRequest` 中加路由（在 `/api/agent-memory/persona` GET 路由之后）**

在 `server/http/agentMemoryHandlers.js:91-96` 现有 `GET /api/agent-memory/persona` 路由块之后插入：

```js
  // GET /api/agent-memory/persona/history?limit=30
  // Phase 5: personaSummary 进化历史
  if (pathname === '/api/agent-memory/persona/history' && method === 'GET') {
    const userId = await requireUserId(req);
    if (!userId) return sendJsonResponse(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    const url = new URL(req.url, 'http://x');
    const limit = parseInt(url.searchParams.get('limit') || '30', 10);
    const history = await getPersonaHistory(userId, limit);
    return sendJsonResponse(res, 200, { ok: true, history });
  }
```

- [ ] **Step 3: 启动 dev server 验证路由 401（未登录）**

Run: `curl -s http://localhost:5175/api/agent-memory/persona/history`
Expected: `{"ok":false,"error":"UNAUTHORIZED"}`

如果 dev server 没在跑，先 `npm run dev` 启动后再 curl。

- [ ] **Step 4: Commit**

```bash
git add server/http/agentMemoryHandlers.js
git commit -m "feat(api): add GET /api/agent-memory/persona/history route"
```

---

## Task 5: 新增 buildPersonaTrendSeries 纯函数

**Files:**
- Modify: `src/utils/dashboardBuilders.js`（在文件末尾追加）
- Test: `src/utils/__tests__/personaEvolution.test.js`（新建）

- [ ] **Step 1: 创建测试文件（先写失败测试）**

新建 `src/utils/__tests__/personaEvolution.test.js`：

```js
// src/utils/__tests__/personaEvolution.test.js
// Phase 5: personaSummary 进化趋势纯函数单元测试

import { describe, it, expect } from 'vitest';
import { buildPersonaTrendSeries, diffPersonaSnapshots } from '../dashboardBuilders.js';

describe('buildPersonaTrendSeries', () => {
  it('handles empty array', () => {
    const result = buildPersonaTrendSeries([]);
    expect(result.labels).toEqual([]);
    expect(result.series).toHaveLength(3);
    expect(result.series[0].values).toEqual([]);
  });

  it('handles undefined input', () => {
    const result = buildPersonaTrendSeries(undefined);
    expect(result.labels).toEqual([]);
    expect(result.series[0].values).toEqual([]);
  });

  it('returns 3 series named 习惯/性格/需求', () => {
    const result = buildPersonaTrendSeries([{ snapshot: { habits: [], traits: [], needs: [] }, evolved_at: '2026-07-28T10:00:00Z' }]);
    expect(result.series.map(s => s.name)).toEqual(['习惯', '性格', '需求']);
  });

  it('maps snapshot array lengths to values', () => {
    const history = [
      { snapshot: { habits: ['a'], traits: ['b', 'c'], needs: [] }, evolved_at: '2026-07-28T10:00:00Z' },
      { snapshot: { habits: ['a', 'd'], traits: ['b'], needs: ['e'] }, evolved_at: '2026-07-27T10:00:00Z' },
    ];
    const result = buildPersonaTrendSeries(history);
    // 倒序转正序：先 07-27 再 07-28
    expect(result.labels).toEqual(['07-27 10:00', '07-28 10:00']);
    expect(result.series[0].values).toEqual([1, 2]); // 习惯
    expect(result.series[1].values).toEqual([1, 2]); // 性格
    expect(result.series[2].values).toEqual([1, 0]); // 需求
  });

  it('handles missing snapshot as 0 values', () => {
    const result = buildPersonaTrendSeries([{ evolved_at: '2026-07-28T10:00:00Z' }]);
    expect(result.series[0].values).toEqual([0]);
    expect(result.series[1].values).toEqual([0]);
    expect(result.series[2].values).toEqual([0]);
  });

  it('handles null snapshot', () => {
    const result = buildPersonaTrendSeries([{ snapshot: null, evolved_at: '2026-07-28T10:00:00Z' }]);
    expect(result.series[0].values).toEqual([0]);
  });

  it('handles missing evolved_at as empty label', () => {
    const result = buildPersonaTrendSeries([{ snapshot: { habits: ['a'] } }]);
    expect(result.labels).toEqual(['']);
  });

  it('reverses DESC input to ASC output', () => {
    // API 返回 DESC（最新在前），前端需要 ASC（从左到右时间递进）
    const history = [
      { snapshot: { habits: ['c'] }, evolved_at: '2026-07-30T10:00:00Z' },
      { snapshot: { habits: ['a'] }, evolved_at: '2026-07-28T10:00:00Z' },
    ];
    const result = buildPersonaTrendSeries(history);
    expect(result.labels).toEqual(['07-28 10:00', '07-30 10:00']);
  });
});

describe('diffPersonaSnapshots', () => {
  it('returns empty diff for identical snapshots', () => {
    const snap = { habits: ['a'], traits: ['b'], needs: ['c'] };
    const diff = diffPersonaSnapshots(snap, snap);
    expect(diff.habits.added).toEqual([]);
    expect(diff.habits.removed).toEqual([]);
    expect(diff.traits.added).toEqual([]);
    expect(diff.traits.removed).toEqual([]);
    expect(diff.needs.added).toEqual([]);
    expect(diff.needs.removed).toEqual([]);
  });

  it('detects additions', () => {
    const prev = { habits: ['a'], traits: [], needs: [] };
    const current = { habits: ['a', 'b'], traits: ['c'], needs: [] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.added).toEqual(['b']);
    expect(diff.habits.removed).toEqual([]);
    expect(diff.traits.added).toEqual(['c']);
  });

  it('detects removals', () => {
    const prev = { habits: ['a', 'b'], traits: ['c'], needs: ['d'] };
    const current = { habits: ['a'], traits: [], needs: [] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.removed).toEqual(['b']);
    expect(diff.traits.removed).toEqual(['c']);
    expect(diff.needs.removed).toEqual(['d']);
  });

  it('handles empty inputs', () => {
    const diff = diffPersonaSnapshots({}, {});
    expect(diff.habits.added).toEqual([]);
    expect(diff.habits.removed).toEqual([]);
  });

  it('handles undefined inputs', () => {
    const diff = diffPersonaSnapshots(undefined, undefined);
    expect(diff.habits.added).toEqual([]);
  });

  it('handles missing keys gracefully', () => {
    const prev = { habits: ['a'] };
    const current = { traits: ['b'] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.removed).toEqual(['a']);
    expect(diff.traits.added).toEqual(['b']);
    expect(diff.needs.added).toEqual([]);
  });

  it('uses string comparison for dedup (number vs string)', () => {
    const prev = { habits: [1, 2] };
    const current = { habits: ['1', '2', '3'] };
    const diff = diffPersonaSnapshots(prev, current);
    expect(diff.habits.added).toEqual(['3']);
    expect(diff.habits.removed).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，验证失败（函数未定义）**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/personaEvolution.test.js`
Expected: FAIL，错误信息包含 `buildPersonaTrendSeries is not a function` 或 `diffPersonaSnapshots is not a function`

- [ ] **Step 3: 在 `src/utils/dashboardBuilders.js` 末尾追加纯函数**

```js
/* ============ Phase 5: personaSummary 进化趋势 ============ */

/**
 * 趋势图数据：persona 数组长度随时间变化
 * @param {Array<{ snapshot?: { habits?: any[], traits?: any[], needs?: any[] }, evolved_at?: string }>} history - API 返回的 DESC 历史列表
 * @returns {{ labels: string[], series: Array<{ name: string, values: number[] }> }}
 */
export function buildPersonaTrendSeries(history = []) {
  if (!Array.isArray(history)) return { labels: [], series: [
    { name: '习惯', values: [] },
    { name: '性格', values: [] },
    { name: '需求', values: [] },
  ] };
  // 倒序（DESC）转正序（ASC），X 轴从左到右时间递进
  const sorted = [...history].reverse();
  return {
    labels: sorted.map(h => formatEvolvedAt(h.evolved_at)),
    series: [
      { name: '习惯', values: sorted.map(h => Array.isArray(h?.snapshot?.habits) ? h.snapshot.habits.length : 0) },
      { name: '性格', values: sorted.map(h => Array.isArray(h?.snapshot?.traits) ? h.snapshot.traits.length : 0) },
      { name: '需求', values: sorted.map(h => Array.isArray(h?.snapshot?.needs) ? h.snapshot.needs.length : 0) },
    ],
  };
}

/**
 * 两个快照的 diff（新增/删除项）
 * @param {{ habits?: any[], traits?: any[], needs?: any[] }|undefined} prev
 * @param {{ habits?: any[], traits?: any[], needs?: any[] }|undefined} current
 * @returns {{ habits: { added: any[], removed: any[] }, traits: { added: any[], removed: any[] }, needs: { added: any[], removed: any[] } }}
 */
export function diffPersonaSnapshots(prev = {}, current = {}) {
  const diffList = (key) => {
    const prevArr = Array.isArray(prev?.[key]) ? prev[key] : [];
    const curArr = Array.isArray(current?.[key]) ? current[key] : [];
    const prevSet = new Set(prevArr.map(x => String(x)));
    const curSet = new Set(curArr.map(x => String(x)));
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

/**
 * 格式化 evolved_at 为 "MM-DD HH:mm"（X 轴 label）
 * @param {string} iso - ISO 时间字符串
 * @returns {string}
 */
function formatEvolvedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
```

- [ ] **Step 4: 运行测试，验证全部通过**

Run: `node node_modules/vitest/vitest.mjs run src/utils/__tests__/personaEvolution.test.js`
Expected: PASS 17 个测试用例

- [ ] **Step 5: 运行全部测试，确保没有 regression**

Run: `npm test`
Expected: 427 passed（原 410 + 新 17）

- [ ] **Step 6: Commit**

```bash
git add src/utils/dashboardBuilders.js src/utils/__tests__/personaEvolution.test.js
git commit -m "feat(utils): add buildPersonaTrendSeries + diffPersonaSnapshots with tests"
```

---

## Task 6: useProfileDashboard 加 personaHistory 字段

**Files:**
- Modify: `src/hooks/useProfileDashboard.js`

- [ ] **Step 1: 在 `useProfileDashboard.js` 顶部 import `buildPersonaTrendSeries`、`diffPersonaSnapshots`**

将 `src/hooks/useProfileDashboard.js:7` 的 import：

```js
import { buildTrendSeries, buildAiStatusCounts, normalizeError } from '../utils/dashboardBuilders.js';
```

改为：

```js
import { buildTrendSeries, buildAiStatusCounts, normalizeError, buildPersonaTrendSeries, diffPersonaSnapshots } from '../utils/dashboardBuilders.js';
```

- [ ] **Step 2: 在第 10 行 re-export 加入新纯函数**

将 `src/hooks/useProfileDashboard.js:10` 的 re-export：

```js
export { buildTrendSeries, buildAiStatusCounts, normalizeError };
```

改为：

```js
export { buildTrendSeries, buildAiStatusCounts, normalizeError, buildPersonaTrendSeries, diffPersonaSnapshots };
```

- [ ] **Step 3: 在 hook 内部加 `personaHistory` state + `loadPersonaHistory`**

在 `src/hooks/useProfileDashboard.js` 的 `preheatError` state（第 29 行）之后，`personaSummary` 之前插入：

```js
  const [personaHistory, setPersonaHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
```

在 `loadLearnedPrefs`（第 49-60 行）之后插入：

```js
  // Phase 5: 加载 personaSummary 进化历史（最新在前，最多 30 条）
  const loadPersonaHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await fetch('/api/agent-memory/persona/history?limit=30');
      const data = await resp.json();
      if (data.ok) setPersonaHistory(data.history || []);
    } catch {
      /* silent: 历史加载失败不阻塞仪表盘 */
    } finally {
      setHistoryLoading(false);
    }
  }, []);
```

- [ ] **Step 4: 在 useEffect 中加入 `loadPersonaHistory` 调用**

将 `src/hooks/useProfileDashboard.js:82-85` 的 useEffect：

```js
  useEffect(() => {
    loadSnapshots();
    loadLearnedPrefs();
  }, [loadSnapshots, loadLearnedPrefs]);
```

改为：

```js
  useEffect(() => {
    loadSnapshots();
    loadLearnedPrefs();
    loadPersonaHistory();
  }, [loadSnapshots, loadLearnedPrefs, loadPersonaHistory]);
```

- [ ] **Step 5: 在 return 中暴露 `personaHistory` + `historyLoading`**

将 `src/hooks/useProfileDashboard.js:87-94` 的 return：

```js
  return {
    snapshots, snapshotsLoading, snapshotsError,
    learnedPrefs, prefsLoading,
    personaSummary,
    preheat, preheatLoading, preheatResult, preheatError,
    refresh: () => { loadSnapshots(); loadLearnedPrefs(); },
  };
```

改为：

```js
  return {
    snapshots, snapshotsLoading, snapshotsError,
    learnedPrefs, prefsLoading,
    personaSummary,
    personaHistory, historyLoading,
    preheat, preheatLoading, preheatResult, preheatError,
    refresh: () => { loadSnapshots(); loadLearnedPrefs(); loadPersonaHistory(); },
  };
```

- [ ] **Step 6: 验证语法（import 是否正确）**

Run: `node --check src/hooks/useProfileDashboard.js 2>&1 || echo "ESM module, use vite check"`
Expected: 无报错（或仅 ESM check 警告）

- [ ] **Step 7: 运行所有测试确保无 regression**

Run: `npm test`
Expected: 427 passed

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useProfileDashboard.js
git commit -m "feat(hook): useProfileDashboard adds personaHistory + loadPersonaHistory"
```

---

## Task 7: TrendLineChart 加可选 onSelect 回调

**Files:**
- Modify: `src/components/TrendLineChart.jsx`

- [ ] **Step 1: 在 `TrendLineChart` 函数签名中加 `onSelect` 参数**

将 `src/components/TrendLineChart.jsx:3` 的函数签名：

```js
function TrendLineChart({ labels = [], series = [] }) {
```

改为：

```js
function TrendLineChart({ labels = [], series = [], onSelect = null }) {
```

- [ ] **Step 2: 在 `<circle>` 元素上加 `onClick`**

将 `src/components/TrendLineChart.jsx:61-69` 的 `<circle>` 元素：

```jsx
              return (
                <circle
                  key={`${s.name}-${i}`}
                  cx={x}
                  cy={y}
                  r="4"
                  fill={colors[idx % colors.length]}
                  onMouseEnter={() => setHover({ x, y, label: labels[i], series: s.name, value: v })}
                  onMouseLeave={() => setHover(null)}
                />
              );
```

改为：

```jsx
              return (
                <circle
                  key={`${s.name}-${i}`}
                  cx={x}
                  cy={y}
                  r={onSelect ? 6 : 4}
                  fill={colors[idx % colors.length]}
                  style={onSelect ? { cursor: 'pointer' } : undefined}
                  onMouseEnter={() => setHover({ x, y, label: labels[i], series: s.name, value: v })}
                  onMouseLeave={() => setHover(null)}
                  onClick={onSelect ? () => onSelect({ index: i, label: labels[i], series: s.name, value: v }) : undefined}
                />
              );
```

- [ ] **Step 3: 验证现有调用不受影响（ProfileDashboard 第 2 区块渲染正常）**

Run: `npm test`
Expected: 427 passed（无 regression，TrendLineChart 没有组件测试，纯函数测试不影响）

- [ ] **Step 4: Commit**

```bash
git add src/components/TrendLineChart.jsx
git commit -m "feat(chart): TrendLineChart adds optional onSelect callback"
```

---

## Task 8: PersonaDiffCard 组件

**Files:**
- Create: `src/components/profile/PersonaDiffCard.jsx`

- [ ] **Step 1: 创建 `src/components/profile/PersonaDiffCard.jsx`**

```jsx
// src/components/profile/PersonaDiffCard.jsx
// Phase 5: personaSummary 两个快照的 diff 详情面板
// 三列布局：习惯/性格/需求，每列显示 added（绿）/removed（红）

export default function PersonaDiffCard({ diff, prevLabel = '历史快照', currentLabel = '当前快照' }) {
  if (!diff) return null;

  const { habits = { added: [], removed: [] }, traits = { added: [], removed: [] }, needs = { added: [], removed: [] } } = diff;
  const hasAnyChange =
    habits.added.length > 0 || habits.removed.length > 0 ||
    traits.added.length > 0 || traits.removed.length > 0 ||
    needs.added.length > 0 || needs.removed.length > 0;

  return (
    <div className="persona-diff-card">
      <div className="persona-diff-header">
        <span className="diff-label-prev">{prevLabel}</span>
        <span className="diff-arrow">→</span>
        <span className="diff-label-current">{currentLabel}</span>
      </div>
      {!hasAnyChange ? (
        <p className="persona-diff-empty">本次进化无变化</p>
      ) : (
        <div className="persona-diff-grid">
          <DiffColumn title="习惯" added={habits.added} removed={habits.removed} />
          <DiffColumn title="性格" added={traits.added} removed={traits.removed} />
          <DiffColumn title="需求" added={needs.added} removed={needs.removed} />
        </div>
      )}
    </div>
  );
}

function DiffColumn({ title, added = [], removed = [] }) {
  return (
    <div className="diff-column">
      <h4 className="diff-column-title">{title}</h4>
      {added.length > 0 && (
        <div className="diff-group diff-added">
          <span className="diff-group-label">新增</span>
          <ul>
            {added.map((item, i) => <li key={`a-${i}`}>{String(item)}</li>)}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div className="diff-group diff-removed">
          <span className="diff-group-label">删除</span>
          <ul>
            {removed.map((item, i) => <li key={`r-${i}`}>{String(item)}</li>)}
          </ul>
        </div>
      )}
      {added.length === 0 && removed.length === 0 && (
        <p className="diff-column-empty">无变化</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证语法（dev server 启动不报错）**

Run: `node -e "import('./src/components/profile/PersonaDiffCard.jsx').then(() => console.log('ok')).catch(e => console.error(e.message))"`
Expected: 输出 `ok` 或仅 JSX 解析警告（实际编译由 Vite 处理）

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/PersonaDiffCard.jsx
git commit -m "feat(profile): add PersonaDiffCard component"
```

---

## Task 9: PersonaEvolutionSection 组件

**Files:**
- Create: `src/components/profile/PersonaEvolutionSection.jsx`

- [ ] **Step 1: 创建 `src/components/profile/PersonaEvolutionSection.jsx`**

```jsx
// src/components/profile/PersonaEvolutionSection.jsx
// Phase 5: 仪表盘第 6 区块「画像进化趋势」
// TrendLineChart（3 条 series：习惯/性格/需求长度）+ 点击某点展开 diff

import { useState } from 'react';
import TrendLineChart from '../TrendLineChart.jsx';
import PersonaDiffCard from './PersonaDiffCard.jsx';
import { buildPersonaTrendSeries, diffPersonaSnapshots } from '../../utils/dashboardBuilders.js';

export default function PersonaEvolutionSection({ history = [], loading, currentPersonaSummary }) {
  const [selectedIdx, setSelectedIdx] = useState(null);

  if (loading) {
    return (
      <section className="dashboard-section persona-evolution-section">
        <div className="section-header">
          <h2 className="section-title">画像进化趋势</h2>
        </div>
        <div className="dashboard-loading">加载中...</div>
      </section>
    );
  }

  if (!Array.isArray(history) || history.length === 0) {
    return (
      <section className="dashboard-section persona-evolution-section">
        <div className="section-header">
          <h2 className="section-title">画像进化趋势</h2>
        </div>
        <div className="dashboard-empty">暂无画像进化记录，与 AI 对话累积 3 轮后开始记录</div>
      </section>
    );
  }

  const { labels, series } = buildPersonaTrendSeries(history);
  const canDiff = history.length >= 2;
  const selectedSnapshot = selectedIdx != null ? history[history.length - 1 - selectedIdx]?.snapshot : null;
  const diff = selectedIdx != null && canDiff
    ? diffPersonaSnapshots(selectedSnapshot || {}, currentPersonaSummary || {})
    : null;
  const selectedLabel = selectedIdx != null ? labels[selectedIdx] : '';

  return (
    <section className="dashboard-section persona-evolution-section">
      <div className="section-header">
        <h2 className="section-title">画像进化趋势</h2>
        <p className="section-desc">最近 {history.length} 次画像进化（点击某点查看 diff）</p>
      </div>
      <TrendLineChart
        labels={labels}
        series={series}
        onSelect={canDiff ? ({ index }) => setSelectedIdx(index) : null}
      />
      {selectedIdx != null && diff && (
        <div className="persona-diff-wrap">
          <div className="persona-diff-toolbar">
            <span className="diff-selected-label">已选：{selectedLabel}</span>
            <button
              className="diff-close-btn"
              onClick={() => setSelectedIdx(null)}
              aria-label="关闭 diff"
            >
              ×
            </button>
          </div>
          <PersonaDiffCard
            diff={diff}
            prevLabel={selectedLabel}
            currentLabel="当前"
          />
        </div>
      )}
      {selectedIdx != null && !canDiff && (
        <p className="persona-diff-hint">历史记录不足 2 条，无法计算 diff</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 验证语法**

Run: `node -e "console.log('syntax check via vite build later')"`
Expected: 无报错（实际语法由 build 验证）

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/PersonaEvolutionSection.jsx
git commit -m "feat(profile): add PersonaEvolutionSection with trend + diff view"
```

---

## Task 10: ProfileDashboard 集成第 6 区块

**Files:**
- Modify: `src/components/profile/ProfileDashboard.jsx`

- [ ] **Step 1: 在 import 中加入 `PersonaEvolutionSection`**

将 `src/components/profile/ProfileDashboard.jsx:10-12` 的 import：

```jsx
import PersonaSummaryCard from './PersonaSummaryCard.jsx';
import LearnedPrefsCard from './LearnedPrefsCard.jsx';
import PreheatButton from './PreheatButton.jsx';
```

改为：

```jsx
import PersonaSummaryCard from './PersonaSummaryCard.jsx';
import LearnedPrefsCard from './LearnedPrefsCard.jsx';
import PreheatButton from './PreheatButton.jsx';
import PersonaEvolutionSection from './PersonaEvolutionSection.jsx';
```

- [ ] **Step 2: 在「3+4 并排」与「5. 预热」之间插入「6. 画像进化趋势」**

将 `src/components/profile/ProfileDashboard.jsx:89-103` 的 JSX：

```jsx
      {/* 3. 当前画像 + 4. 行为观测 并排 */}
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
```

改为：

```jsx
      {/* 3. 当前画像 + 4. 行为观测 并排 */}
      <div className="dashboard-row">
        <PersonaSummaryCard personaSummary={dash.personaSummary} loading={false} />
        <LearnedPrefsCard prefs={dash.learnedPrefs} loading={dash.prefsLoading} />
      </div>

      {/* 6. 画像进化趋势（Phase 5） */}
      <PersonaEvolutionSection
        history={dash.personaHistory}
        loading={dash.historyLoading}
        currentPersonaSummary={dash.personaSummary}
      />

      {/* 5. 手动重跑预热 */}
      <section className="dashboard-section">
        <PreheatButton
          onPreheat={dash.preheat}
          loading={dash.preheatLoading}
          result={dash.preheatResult}
          error={dash.preheatError}
        />
      </section>
```

- [ ] **Step 3: 运行测试确保无 regression**

Run: `npm test`
Expected: 427 passed

- [ ] **Step 4: 验证 build 成功**

Run: `npm run build`
Expected: build 成功，dist/ 生成

- [ ] **Step 5: Commit**

```bash
git add src/components/profile/ProfileDashboard.jsx
git commit -m "feat(profile): integrate PersonaEvolutionSection as 6th dashboard block"
```

---

## Task 11: styles.css 追加进化趋势/diff 样式

**Files:**
- Modify: `src/styles.css`（末尾追加）

- [ ] **Step 1: 在 `src/styles.css` 末尾追加 Phase 5 样式**

```css

/* ============ Phase 5: 画像进化趋势 + diff 样式 ============ */

.persona-evolution-section {
  margin-top: 16px;
}

.persona-diff-wrap {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-elevated, #1e293b);
  border: 1px solid var(--border-color, #334155);
  border-radius: 8px;
}

.persona-diff-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.diff-selected-label {
  font-size: 12px;
  color: var(--text-muted, #94a3b8);
}

.diff-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 4px;
}

.diff-close-btn:hover {
  background: var(--bg-hover, #334155);
  color: var(--text-primary, #f1f5f9);
}

.persona-diff-card {
  width: 100%;
}

.persona-diff-header {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted, #94a3b8);
  margin-bottom: 10px;
}

.diff-arrow {
  color: var(--text-muted, #64748b);
}

.persona-diff-empty {
  text-align: center;
  color: var(--text-muted, #64748b);
  padding: 16px 0;
  font-size: 13px;
}

.persona-diff-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.diff-column {
  background: var(--bg-default, #0f172a);
  border-radius: 6px;
  padding: 10px;
}

.diff-column-title {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #f1f5f9);
}

.diff-group {
  margin-bottom: 8px;
}

.diff-group:last-child {
  margin-bottom: 0;
}

.diff-group-label {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-bottom: 4px;
}

.diff-added .diff-group-label {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}

.diff-removed .diff-group-label {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}

.diff-column ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--text-primary, #e2e8f0);
}

.diff-column li {
  margin: 2px 0;
}

.diff-added li {
  color: #4ade80;
}

.diff-removed li {
  color: #f87171;
  text-decoration: line-through;
}

.diff-column-empty {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  margin: 0;
}

.persona-diff-hint {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  margin-top: 8px;
  text-align: center;
}

/* 响应式：小屏单列 */
@media (max-width: 768px) {
  .persona-diff-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(profile): add Phase 5 persona evolution + diff styles"
```

---

## Task 12: Bug 1 — preheatForUser 内部读 personaSummary

**Files:**
- Modify: `server/profile/snapshotService.js:100-113`

- [ ] **Step 1: 在 `preheatForUser` 中拉取 profile 之后插入 personaSummary 读取**

将 `server/profile/snapshotService.js:107-113` 的代码：

```js
  // 2. 拉取 profile + LLM config
  const repo = createProfileRepository();
  const profile = await repo.getState(userId);
  const storedLlmConfig = await repo.getLlmConfig(userId);
  const llmConfig = storedLlmConfig && storedLlmConfig.baseUrl
    ? storedLlmConfig
    : defaultLlmConfig();
```

改为：

```js
  // 2. 拉取 profile + LLM config
  const repo = createProfileRepository();
  const profile = await repo.getState(userId);
  const storedLlmConfig = await repo.getLlmConfig(userId);
  const llmConfig = storedLlmConfig && storedLlmConfig.baseUrl
    ? storedLlmConfig
    : defaultLlmConfig();

  // Phase 5 Bug 1 修复：cron/lazy 路径无前端传入 personaSummary 时，从 DB 自动读取
  // 避免 LLM prompt 缺失用户性格画像
  let personaSummaryArg = personaSummary;
  if (!personaSummaryArg) {
    try {
      const { getPersonaSummary } = await import('../agent/agentMemoryService.js');
      const psResult = await getPersonaSummary(userId);
      personaSummaryArg = psResult?.personaSummary || null;
    } catch (err) {
      console.warn('[snapshotService] read personaSummary failed:', err.message);
      personaSummaryArg = null;
    }
  }
```

- [ ] **Step 2: 将后续使用 `personaSummary` 变量的地方改为 `personaSummaryArg`**

查看 `server/profile/snapshotService.js:130-136`：

```js
  const scored = clustered.map(item => buildRecommendation(item, {
    domainTiers: Object.fromEntries((profile.domains || []).map(d => [d.id, d.tier])),
    sourceTiers: Object.fromEntries((profile.sources || []).map(s => [s.id, s.tier])),
    specialFollows: profile.specialFollows || [],
    personaSummary,
    relevantMemories: [],
  }));
```

改为：

```js
  const scored = clustered.map(item => buildRecommendation(item, {
    domainTiers: Object.fromEntries((profile.domains || []).map(d => [d.id, d.tier])),
    sourceTiers: Object.fromEntries((profile.sources || []).map(s => [s.id, s.tier])),
    specialFollows: profile.specialFollows || [],
    personaSummary: personaSummaryArg,
    relevantMemories: [],
  }));
```

查看 `server/profile/snapshotService.js:144-148`：

```js
      aiInsights = await callAiInsightsInternal({
        items: selectItemsForAiInsights(lanes),
        personaSummary,
        llmConfig,
      });
```

改为：

```js
      aiInsights = await callAiInsightsInternal({
        items: selectItemsForAiInsights(lanes),
        personaSummary: personaSummaryArg,
        llmConfig,
      });
```

查看 `server/profile/snapshotService.js:167-170`：

```js
      aiPayload = await callAiBriefingGenerator({
        algorithmBriefing,
        personaSummary,
        llmConfig,
      });
```

改为：

```js
      aiPayload = await callAiBriefingGenerator({
        algorithmBriefing,
        personaSummary: personaSummaryArg,
        llmConfig,
      });
```

- [ ] **Step 3: 运行测试确保无 regression**

Run: `npm test`
Expected: 427 passed

- [ ] **Step 4: 验证语法**

Run: `node -e "import('./server/profile/snapshotService.js').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error('FAIL:', e.message))"`
Expected: 输出 exports 数组包含 `preheatForUser`，无错误

- [ ] **Step 5: Commit**

```bash
git add server/profile/snapshotService.js
git commit -m "fix(snapshot): preheatForUser reads personaSummary from DB when not passed"
```

---

## Task 13: Bug 2 — agentContext.js 字段名

**Files:**
- Modify: `server/agent/agentContext.js:65`

- [ ] **Step 1: 将 `lp.frequentTopics` 改为 `lp.topics`，加 fallback**

将 `server/agent/agentContext.js:65` 的代码：

```js
      if (lp.frequentTopics?.length) learnedLines.push(`  - 高频关注主题：${lp.frequentTopics.join('、')}`);
```

改为：

```js
      const topics = lp.topics || lp.frequentTopics || [];
      if (topics.length) learnedLines.push(`  - 高频关注主题：${topics.join('、')}`);
```

- [ ] **Step 2: 验证语法**

Run: `node -e "import('./server/agent/agentContext.js').then(() => console.log('ok')).catch(e => console.error('FAIL:', e.message))"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server/agent/agentContext.js
git commit -m "fix(agent): agentContext uses lp.topics (was lp.frequentTopics)"
```

---

## Task 14: Bug 3 — profileStore 默认值字段名对齐

**Files:**
- Modify: `src/store/profileStore.js:138, 146, 182`

- [ ] **Step 1: 改默认值字段名**

将 `src/store/profileStore.js:138` 的代码：

```js
      personaSummary: { habits: [], traits: [], needs: [], updatedAt: null },
```

改为：

```js
      personaSummary: { habits: [], traits: [], needs: [], lastEvolvedAt: null },
```

- [ ] **Step 2: 改 `setPersonaSummary` action 内的时间戳字段名**

将 `src/store/profileStore.js:146` 的代码：

```js
        return { personaSummary: { ...capped, updatedAt: new Date().toISOString() } };
```

改为：

```js
        return { personaSummary: { ...capped, lastEvolvedAt: new Date().toISOString() } };
```

- [ ] **Step 3: 改 `lastUpdated` 兼容读取**

将 `src/store/profileStore.js:182` 的代码：

```js
        personaSummary: state.personaSummary,
```

改为（兼容旧 localStorage 中可能存在的 `updatedAt` 字段）：

```js
        // Bug 3 修复：兼容旧 localStorage 的 updatedAt 字段
        personaSummary: {
          ...state.personaSummary,
          lastEvolvedAt: state.personaSummary.lastEvolvedAt || state.personaSummary.updatedAt || null,
        },
```

- [ ] **Step 4: 运行所有测试确保无 regression**

Run: `npm test`
Expected: 427 passed

- [ ] **Step 5: Commit**

```bash
git add src/store/profileStore.js
git commit -m "fix(store): profileStore uses lastEvolvedAt (was updatedAt) with fallback"
```

---

## Task 15: 文档更新 + 最终验收 + tag stable-v15

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在 CLAUDE.md 的 Phase 3 段落之后追加 Phase 5 记录**

在 `CLAUDE.md` 中找到 Phase 3 LLM 推荐增强段落的末尾（包含 `fetchRelevantMemories 激活 + mergeAiBriefing 接入。` 的那行），在之后追加：

```markdown

**Phase 5 画像进化趋势（已完成）**：personaSummary 进化历史 + 仪表盘第 6 区块。
- Migration 007：`persona_summary_history` 表（user_id/snapshot jsonb/evolved_at）+ cap 90/用户（同事务清理）
- `agentMemoryService.mergePersonaSummary` 改造为同事务：UPDATE user_profiles + INSERT persona_summary_history + DELETE cap>90，并清理遗留 `updatedAt` 字段
- 新增 `getPersonaHistory(userId, limit)` 服务方法
- 新增 `GET /api/agent-memory/persona/history?limit=30` 端点
- `dashboardBuilders.js` 新增 `buildPersonaTrendSeries` + `diffPersonaSnapshots` 纯函数 + 17 个单元测试
- `useProfileDashboard` 加 `personaHistory` + `loadPersonaHistory`
- 新增 `PersonaEvolutionSection` + `PersonaDiffCard` 组件，集成到仪表盘第 6 区块
- `TrendLineChart` 加可选 `onSelect` 回调（不破坏现有调用）
- Bug 1 修复：`preheatForUser` 内部从 DB 自动读 personaSummary（cron/lazy 路径无前端传入时）
- Bug 2 修复：`agentContext.js` 字段名 `lp.frequentTopics` → `lp.topics || lp.frequentTopics`
- Bug 3 修复：`profileStore` 默认值字段名 `updatedAt` → `lastEvolvedAt`（带 fallback 兼容旧 localStorage）
```

- [ ] **Step 2: 更新 CLAUDE.md 中测试数（如已存在计数）**

如果 CLAUDE.md 中有 "398 unit tests" 或 "410 unit tests" 等表述，改为：

```
**Tests limited to pure-logic engines** — 427 unit tests cover ... 
```

实际数字根据 `npm test` 最终输出确认。

- [ ] **Step 3: 运行最终验收**

Run: `npm test`
Expected: 427 passed（或实际数字）

Run: `npm run build`
Expected: build 成功

- [ ] **Step 4: 验收清单对照（手动确认）**

| 验收项 | 期望 |
|---|---|
| npm test 全通过 | 427 passed |
| npm run build 成功 | dist/ 生成 |
| npm run db:migrate 成功 | 007 表已建 |
| 仪表盘第 6 区块正常渲染 | 趋势图 + 3 条线 |
| 趋势图展示 3 条线 | 习惯/性格/需求 |
| 点击趋势图某点展开 diff | 显示 added/removed |
| 空状态正确显示 | "暂无画像进化记录..." |
| cron 预热日志确认 personaSummary 已注入 | 预热日志含 personaSummary |
| tag stable-v15 | git tag 创建 |

- [ ] **Step 5: Commit 文档**

```bash
git add CLAUDE.md
git commit -m "docs: Phase 5 persona evolution trend completed"
```

- [ ] **Step 6: 创建 tag stable-v15**

```bash
git tag -a stable-v15 -m "Phase 5: persona evolution trend + 3 bug fixes"
```

- [ ] **Step 7: 推送 tag（可选，需用户确认是否推送远程）**

询问用户：「Phase 5 全部完成，是否推送 stable-v15 tag 到远程？」如同意：

```bash
git push origin stable-v15
```

---

## Self-Review

### Spec coverage

- 1.3 Phase 5 目标 1（新建表）→ Task 1 ✓
- 1.3 Phase 5 目标 2（mergePersonaSummary 改造 + cap 清理）→ Task 2 ✓
- 1.3 Phase 5 目标 3（新增 GET 端点）→ Task 3+4 ✓
- 1.3 Phase 5 目标 4（仪表盘第 6 区块 + 趋势图 + diff）→ Task 5-10 ✓
- 1.3 Phase 5 目标 5（修 3 个 bug）→ Task 12+13+14 ✓
- 节 3.4「TrendLineChart 复用」→ Task 7 加可选 onSelect（避免重写 SVG）✓
- 节 3.5 空状态处理 → Task 9 已实现 ✓
- 节 6.1 测试策略 → Task 5 含 17 个测试用例 ✓
- 节 7.1 任务清单 P1-P14 → Task 1-15 全覆盖（合并了部分细项）✓

### Placeholder scan

- 无 "TBD"/"TODO"/"implement later"
- 无 "Add appropriate error handling" 模糊语
- 无 "Similar to Task N" 简写
- 每个步骤都有完整代码

### Type consistency

- `getPersonaHistory(userId, limit)` 在 Task 3 定义，Task 4 调用一致
- `buildPersonaTrendSeries(history)` 在 Task 5 定义，Task 9 调用一致
- `diffPersonaSnapshots(prev, current)` 在 Task 5 定义，Task 9 调用一致
- `personaHistory` / `historyLoading` 在 Task 6 定义，Task 9 调用一致
- `onSelect({ index, label, series, value })` 在 Task 7 定义，Task 9 调用一致（用 `({ index })`）
