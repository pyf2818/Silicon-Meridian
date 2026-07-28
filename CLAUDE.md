# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                              # Install dependencies
npm run dev                              # Dev server on 0.0.0.0:5175 (with API middleware)
npm run build                            # Production build -> dist/
npm start                                # Production Node server (dist + full API, default port 3000)
npm run preview                          # Preview production build (static only, no API)
npm test                                 # Run unit tests (vitest) — 410 tests across src/utils, src/store, src/domain, src/hooks/__tests__, src/components/profile/__tests__, server/
npm run test:watch                       # Watch mode
node node_modules/vitest/vitest.mjs run <file>  # Run a single test file (bin symlink not created on Windows)
npm run db:migrate
python scrapling_server.py               # Flask API on port 5000 (optional, for Scrapling scraping)
```

No lint, typecheck, or formatter commands exist.

**Important**: `vite preview` only serves static files — it does NOT run `server/newsPlugin.js`. Use `npm run dev` for a working instance with API endpoints. The `vite.config.js` port is **5175**, not the default 5173.

**Vitest on Windows**: `npx vitest` fails (bin symlink not created); use `node node_modules/vitest/vitest.mjs run` instead. If esbuild throws `EBUSY`, kill stale processes: `taskkill //F //IM esbuild.exe`. Vitest 4.x triggers rolldown native binding failures — pin to **vitest 3.x**.

## Architecture

**Tech Stack**: React 19 + Vite 7 + Tailwind CSS 3 + Three.js (react-globe.gl) + klinecharts (stock charts)

**Data Flow**: Vite middleware plugin (`server/news/plugin.js`) intercepts `/api/*` routes at dev-server level. Frontend uses native `fetch` to call these APIs. There is no Express/Koa — the plugin registers middleware directly on the Vite dev server.

**v2 Direction**: See `docs/wanban-silicon-valley-v2-blueprint.md`. The product is migrating from "news aggregator" to a "personal intelligence & creation OS" centered on daily briefing, user profile, materials library, agent workflows, and content creation. Current branch `codex/intelligence-workbench-redesign` implements this.

### Frontend (`src/`)

- **`App.jsx`** (~2789 lines) - Main component with routing logic, settings modal, and page composition. State progressively extracted into Zustand stores (`src/store/`) and custom hooks. Topbar JSX extracted to `src/components/Topbar.jsx`. Workflow runner logic in `src/hooks/useAgentWorkflowRunner.js`, workflow actions in `src/hooks/useWorkflowActions.js`.
- **`AiElf.jsx`** (643 lines) - AI assistant with multi-Agent conversation, drag-to-analyze, history management. Uses localStorage per-agent (50 messages, 20 sessions max). Lazy-loaded via `React.lazy`. SendMessage logic extracted to `src/components/aielf/useSendMessage.js`, agent loop in `src/components/aielf/runElfAgentLoop.js`, sub-components in `src/components/aielf/` (Sidebar, ChatHeader, MessageList, InputArea).
- **`GlobeView.jsx`** (999 lines) - 3D globe via `react-globe.gl`/Three.js. Fullscreen uses `createPortal` to `document.body`. Canvas needs `min-height: 420px`. Lazy-loaded.
- **`main.jsx`** - Mounts `<App />` inside `<ErrorBoundary>` + `<React.StrictMode>`.
- **`styles.css`** (16052 lines) - CSS custom properties for dark/light themes. Tailwind config only sets content paths - no Tailwind utilities used in practice.
- **`themes.css`** (884 lines) - Multi-palette theme definitions.

#### Code Splitting

`GlobeView`, `AiElf`, and `StockPage` are loaded via `React.lazy` + `Suspense` (see top of App.jsx) so Three.js / klinecharts stay out of the first-screen bundle.

#### UI Architecture: Shell -> Page -> Block (in progress)

A Feishu-inspired three-layer refactor is underway. Block = reusable building-block system; Shell = global surfaces; Pages are being migrated incrementally (P1-P4 done, P5 page migration pending).

```
src/shell/
  CommandPalette.jsx    Global Ctrl+K / Cmd+K palette: page nav (9 main routes), news search, quick actions. Controlled component (open/onClose/onNavigate/onSearch/recentVisits props). Toggled via Ctrl/Cmd+K in App.jsx (~line 4117).
src/blocks/
  index.js              Barrel: exports BlockGrid, BlockPanel, BlockList, BlockToolbar, BlockStat
  BlockGrid.jsx         Grid container with .Card sub-component (<BlockGrid columns={3}><BlockGrid.Card .../></BlockGrid>)
  BlockPanel.jsx        Titled panel with optional action slot
  BlockList.jsx         List block
  BlockToolbar.jsx      Toolbar with .Pills sub-component; <BlockToolbar hidden> renders visually hidden
  BlockStat.jsx         Stat block (value/label/desc/size/variant/trendDir)
```

App.jsx consumes `BlockGrid, BlockPanel, BlockStat, BlockToolbar` from `./blocks/index.js` and `CommandPalette` from `./shell/CommandPalette.jsx`.

#### Global State: Zustand Stores (`src/store/`)

State progressively extracted from App.jsx `useState` into Zustand stores. Each slice is a separate file; `src/store/index.js` re-exports them. Persistence via `persist` middleware replaces hand-written `saveLS` effects.

```
src/store/
  index.js              Barrel: exports useUiStore, useLightboxStore, useWorkflowStore, useMaterialsStore, useProfileStore, useBehaviorStore
  workflowStore.js      智能体工作流：draft/templates/activeId/selectedNodeId/run/result/history/actions (persisted)
  materialsStore.js     素材库 UI：filter/search/tags/timeRange/sourceFilter/spaceFilter/showSpaceForm/showAddMaterial (non-persisted)
  profileStore.js       用户画像：domainTiers/sourceTiers/specialFollows/dailyProfileSnapshots/briefingConfig/pendingSuggestions (persisted) + profileForm/specialFollowForm/editingSpecialFollowId (non-persisted)
                        pendingSuggestions 含去重(cap=20)、冷却(1h)、审计保留(30d) 机制
  behaviorStore.js      行为信号单一 source of truth：readingHistory/recommendationFeedback/
                        recommendationFeedbackEvents/followKeywords/trackTargets
                        (persisted, 从 recommendStore 迁入, 旧 LS key 保留 30 天)
```

UI Store (`useUiStore`) and Lightbox Store (`useLightboxStore`) are defined inline in `src/store/index.js`. Usage:
```js
import { useWorkflowStore } from './store';
const draft = useWorkflowStore(s => s.agentWorkflowDraft);
const setDraft = useWorkflowStore(s => s.setAgentWorkflowDraft);
```

Setters support both direct value and updater function (React `setState` style): `setAgentWorkflowDraft(prev => ({ ...prev, name }))`.

#### Extracted Modules (Phase 1-3 refactoring)

State has been progressively moved into hooks. Some logic (e.g. `generateDailyBriefing`, `intelligenceProfile` derivation, `buildWorkbenchContext`) still lives inline in App.jsx as `useMemo`s rather than standalone page modules.

**Standalone component files (actual, in `src/components/`):**
```
src/components/
  Topbar.jsx            顶部栏（从 App.jsx 抽离，~280 行）
  SettingsModal.jsx     (~234 lines, 拆分为 settings/ 子目录)
  ArticleEditor.jsx     Markdown article editor
  StockPage.jsx         股市动向三栏行情终端（967 lines; 分时/K线/五档/AI诊断）
  AiChatPanel.jsx       AI chat panel（780 lines，已拆出 aichat/ 子目录）
  SourceOpsPanel.jsx    Source operations panel
  NewsItem.jsx          资讯卡片（已从 App.jsx 抽离为独立文件）
  ColorfulBubbles.jsx   Decorative bubble animation
  WorkflowNodeCard.jsx  画布节点卡片
  WorkflowEdge.jsx      画布连线
  AiBriefingHome.jsx    AI 早报首页（基于 briefingEngine 的 lane 渲染）
  TodayNewspaper.jsx    今日情报报页
  RecommendationTimeline.jsx  推荐时间轴
  CommunityPage.jsx     社区广场页（nav='square'，发帖/评论/点赞/收藏/关注）
  CommunityPostDetail.jsx    社区帖子详情（被 CommunityPage 使用）
  settings/             SettingsModal 子标签页
    SourcesTab.jsx      信息源标签页（900 lines）
    AgentsTab.jsx       Agent 管理标签页
    LlmTab.jsx          大模型配置标签页
    CustomToolsPanel.jsx 自定义 HTTP 工具
    SandboxPanel.jsx    沙箱配置
  aielf/                AiElf 子组件
    Sidebar.jsx, ChatHeader.jsx, MessageList.jsx, InputArea.jsx
    ElfToolCard.jsx, prompts.js, markdown.js
    runElfAgentLoop.js  Agent 工具调用循环
    useSendMessage.js   发送消息 hook
  aichat/               AiChatPanel 子组件
    ToolCards.jsx, buildSystemPrompt.js, buildQuickActions.js
    buildMaterialContext.js, runAgentLoop.js, useInputHistory.js
  stock/
    KLineChart.jsx      K线图（klinecharts v10）
    ResearchTools.jsx   研究工具
  profile/             Phase 2 用户画像 AI 学习闭环组件
    PendingSuggestionsSection.jsx  AI 建议待确认列表容器（读 useProfileStore.pendingSuggestions）
    PendingSuggestionCard.jsx     单条建议卡片 + SuggestionAcceptEditor + applySuggestionByType 纯函数
    AgentMemorySection.jsx        AI 跨会话记忆列表 + 过滤/搜索/分页/删除
    PersonaSummarySection.jsx     Phase 3 AI 性格画像展示（habits/traits/needs 三栏，读 profileStore.personaSummary）
    SnapshotHistorySection.jsx    Phase 3 历史快照展示（GET /api/profile/snapshots 列表 + ?date= 详情）
    ProfileDashboard.jsx         Phase 4 仪表盘主组件（5 区块：KPI / 趋势 / 画像 / 行为观测 / 预热）
    PersonaSummaryCard.jsx       Phase 4 紧凑画像卡片（habits/traits/needs 三栏并排，仪表盘专用）
    LearnedPrefsCard.jsx         Phase 4 行为观测卡片（topics/preferredDepth/preferredFormat）
    PreheatButton.jsx            Phase 4 手动重跑预热按钮（loading/error/success 状态）
```

**NOT separate files (inline in App.jsx or located elsewhere):**
- `SkeletonCard`, `GithubRepoCard` are **inline functions** in App.jsx.
- `ThemePicker.jsx` lives at `src/ThemePicker.jsx` (NOT `src/components/`); exports default `ThemePicker` + named `PALETTES`.
- `HexRadarChart`, `TrendLineChart` are not present as files; rendering is inline.

**Utility / hook / constant files (actual):**
```
src/utils/
  localStorage.js       loadLS/saveLS/clearStaleLS
  format.js             formatTime/formatRelative/formatStars + getGradeColors/hexToRgba
  toast.js              showToast DOM notification
  markdown.jsx          renderMarkdown/renderMarkdownWithImages/renderBriefMarkdown/renderInline
  repoInsight.js        deriveRepoInsight (本地规则派生 GitHub 项目情报)
  githubMaterial.js     buildGithubMaterial (construct material from GitHub repo)
  workflowEngine.js     Pure-logic DAG executor. LLM nodes call POST /api/ai-generate (chat action); local nodes (input/classifier/condition/skill/output/reply) run synchronously with no React dependency. Condition nodes halt the rest of the chain on failure.
  profileModel.js       computeIntelligenceProfile / computeReadingProfile / computeProfileLearningEngine / computeTodayProfileSnapshot - derive profile from bookmarks, reading history, materials, interests
  dashboardBuilders.js Phase 4 仪表盘纯函数（buildTrendSeries / buildAiStatusCounts）
src/constants/
  appConstants.jsx      权威常量源：PRODUCT_NAME, NAV_ITEMS, FALLBACK_CATEGORIES, CATEGORY_GROUPS, VERTICAL_CHANNELS, LLM_PRESETS, SCROLLING_NEWS_ITEMS, AGENT_categories, MODES, VIEW_MODES, TRENDING_TYPES, GITHUB_LANGS/PERIODS, REGION_MAP, MODE_MAP, MATERIAL_TYPES, ARTICLE_STATUS/TEMPLATES/TEMPLATE_CONTENT, WEEKDAYS, MONTHS, ICONS, WORKFLOW_SKILL_CATALOG, WORKFLOW_CONDITION_METRICS/OPERATORS, getWorkflowSkillMeta, isWorkflowSkillId, formatWorkflowNodeConfig
  index.jsx             兼容 shim（92 行）：re-export appConstants.jsx 的 22 个常量，保留死代码 NAV_GROUPS/CATEGORIES/DEFAULT_AGENTS 供历史引用。新代码应直接 import appConstants.jsx
  workflowConstants.js  DEFAULT_AGENT_WORKFLOW, WORKFLOW_NODE_TYPES, WORKFLOW_SKILL_CATALOG, WORKFLOW_CONDITION_METRICS, WORKFLOW_TEMPLATE_LIBRARY (3 templates: daily-briefing / github-evaluator / material-to-article) + template instance/normalize/validate helpers
src/hooks/
  useLocalStorage.js    Auto-syncing localStorage hook
  useAuth.js            认证与用户会话（user/token/auth表单/interests + 持久化 + handler）
  useLlmConfig.js       LLM配置与模型管理（config/models/test + allLlmModels useMemo）
  useTrending.js        热门榜单 + GitHub trending（items/loading/filter/page + loadTrending/loadGithub）
  useSourceManager.js   信息源管理（customSources/disabledSources/health/verify/discovery + 4 handler）
  useCustomUrl.js       自定义URL抓取（input/result/loading/error/mode + fetchCustomUrl）
  useCalendar.js        日历管理（calendarDate/events/eventForm + addEvent/removeEvent）
  useUI.js              纯UI开关（showFollowDropdown/mobileMenuOpen/showBackToTop/moreNavOpen）
  useStockWatchlist.js  股票自选列表（localStorage 持久化，add/remove/toggle/move）
  useStockAi.js         股市AI智能模块（诊断/早报/监控，联动LLM）
  useWorkflowEngine.js  React wrapper over WorkflowEngine: run/result/history/actions state, persists to localStorage `agentWorkflowHistory` (max 12)
  useCommunity.js       社区广场数据（posts/comments/likes，调用 /api/community/*）
  useProfileSync.js     画像分层同步：扩展同步 5 块（domainTiers/sourceTiers/specialFollows + dailyProfileSnapshots/briefingConfig）<-> /api/profile/state。
                        含纯函数 buildSavePayload（构造 PUT 请求体，仅传今日 snapshot）和 mergeSnapshots（远端+本地合并，本地优先，cap 30）
  useAgentMemories.js          agent_memories CRUD hook（list/search/delete + buildListQuery/parseListResponse 纯函数）
  useAgentWorkflowRunner.js  智能体工作流运行器（runAgentWorkflow，从 App.jsx 抽离，~578 行）
  useWorkflowActions.js     工作流行动队列（createWorkflowActions/executeWorkflowAction，从 App.jsx 抽离）
  useBriefingOps.js          早报操作（从 App.jsx 抽离）
  useGithubInsight.js        GitHub 情报（从 App.jsx 抽离）
  useRecommendationFeedback.js 推荐反馈（从 App.jsx 抽离）
  useCalendarMemos.js        日历备注（从 App.jsx 抽离）
  useSnapshotPreheat.js      Phase 3 lazy 预热触发 hook（用户登录且今日 snapshot 缺失时触发，30s 超时 + 算法降级）
  useAiRecommendationEnhance.js Phase 3 实时 AI 重新分析 hook（调 /api/profile/snapshots/analyze，不写库）
  useProfileDashboard.js    Phase 4 仪表盘聚合 hook（snapshots/learnedPreferences/personaSummary/preheat 触发）
```

#### Domain Layer (`src/domain/`)

Pure-logic domain engines (no React, no HTTP), unit-tested in-place. App.jsx imports these directly.

```
src/domain/intelligence/
  profileTiers.js          PROFILE_TIERS (focus/normal/explore), SPECIAL_FOLLOW_TYPES, tier migration/score helpers
  recommendationEngine.js  buildRecommendation, selectBriefingLanes, clusterEvents, freshnessScore, matchSpecialFollow
  briefingEngine.js        buildAlgorithmBriefing (lane-based), mergeAiBriefing
  snapshotStore.js         createSnapshotStore (localStorage-backed daily recommendation/briefing snapshots)
src/domain/stock/
  indicators.js            simpleMovingAverage, annualizedVolatility, supportResistance, volumeTrend, priceMomentum
  algorithmAnalysis.js     analyzeStock (local technical analysis, no-LLM fallback for stock diagnosis)
```

#### v2 Intelligence Workbench (inline in App.jsx)

The v2 features described in `docs/wanban-silicon-valley-v2-blueprint.md` are wired into App.jsx (imported at top, used via `workflowEngine` hook and `useMemo`-derived briefing/profile data), NOT as separate page files. The engines themselves live in `src/utils/workflowEngine.js` + `src/utils/profileModel.js` + `src/constants/workflowConstants.js` (see above).

**Workflow node types**: `input`, `llm`, `skill`, `condition`, `classifier`, `reply`, `output`. Each node has `inputKey`/`outputKey` forming a variable chain; the first node's input is `buildWorkbenchContext()` (today's recommended items + profile + tracked terms + saved materials). `skill` nodes map to local builders: `evidence-pack`, `media-audit`, `material-extractor`, `profile-memory`, `article-outline`, `github-evaluator`.

**Phase 2 AI 主动学习闭环（已完成）**：
- 消除 buildProfileMemory 双源（useAgentWorkflowRunner.js 内联版删除，统一调 workflowEngine.js + ctx）
- ProfilePage 顶部 PendingSuggestionsSection：展示 AI 建议、接受时弹出 inline 编辑器确认后写入偏好、拒绝/稍后映射为 'rejected'
- ProfilePage 底部 AgentMemorySection：完整 CRUD（列表 + memory_type 过滤 + 搜索 + 分页 + 单条删除）
- buildSystemPrompt "最近校准"段自动激活（用户接受建议后，后续对话 prompt 注入近 7 天 accepted 建议）
- applySuggestionByType 纯函数含大小写不敏感幂等检查
- pendingSuggestions 不同步跨设备（agent_memories 已是 PG 跨设备来源）

**Phase 3 LLM 推荐增强（已完成）**：LLM 推荐增强 + personaSummary 全链路同步 + recommendation_snapshots 三表写入 + cron 预热 + lazy 触发 + fetchRelevantMemories 激活 + mergeAiBriefing 接入。
- Migration 006：`users.last_seen_at` + `user_profiles.llm_config`（跨设备同步 LLM 设置）
- `server/cron/dailyBriefingPreheatJob.js`：每日 06:00 Asia/Shanghai 预热（仅 production Node/Docker；Vercel 走 lazy 路径），仅对最近 7 天活跃用户、并发上限 3
- `server/profile/snapshotService.js`：`preheatForUser` 共享 cron + lazy 路径，三表事务（`recommendation_snapshots` + `briefing_snapshots` + `recommendation_items`）+ ON CONFLICT 策略
- `src/hooks/useSnapshotPreheat.js`：用户登录且今日 snapshot 缺失时 lazy 触发，30s 超时 + 算法模式降级
- `src/hooks/useAiRecommendationEnhance.js`：实时 AI 重新分析，调 `/api/profile/snapshots/analyze`（不写库）
- `src/utils/memoryEvolver.js`：新增 `extractLearnedPreferences` 纯函数 + 写 `learned_preferences`；persona_summary 合并式更新（habits/traits/needs 各 cap 10）
- `src/hooks/useRecommendationMemos.js`：注入 personaSummary + relevantMemories；暴露 `eventClusters`（替代 App.jsx L1112 内联 `clusterEvents(filtered)` 调用）
- `src/components/AiChatPanel.jsx`：服务端 agent_memories 异步检索（debounce 500ms，失败静默）；personaSummary 改读 profileStore
- `src/components/aichat/buildSystemPrompt.js`：新增"相关记忆"段（agent_memories）+"用户性格画像"段（personaSummary）
- `src/components/profile/PersonaSummarySection.jsx`：读 profileStore.personaSummary，展示用户习惯/性格/需求三栏
- `src/components/profile/SnapshotHistorySection.jsx`：调 GET /api/profile/snapshots 列表 + ?date= 详情，含原始 JSON 折叠
- `src/components/RightPanel.jsx`："重新分析"按钮调 `useAiRecommendationEnhance`，初始展示仍用 legacy `/api/ai-insights` 自动加载，enhance 后切换到 `/api/profile/snapshots/analyze` 视图

**Phase 4 画像仪表盘（已完成）**：纯前端仪表盘聚合 Phase 3 已沉淀数据，零后端改动，零新表/端点/cron。ProfilePage 默认进入仪表盘 Tab，5 个区块一目了然。
- `src/components/profile/ProfileDashboard.jsx`：主组件，5 个区块（KPI 卡片 / 推荐历史趋势 / 当前画像 / 行为观测 / 手动重跑预热）
- `src/hooks/useProfileDashboard.js`：聚合 hook，加载 snapshots + learnedPreferences + personaSummary，暴露 `preheat()` 触发今日预热
- `src/utils/dashboardBuilders.js`：纯函数 `buildTrendSeries` + `buildAiStatusCounts`（无副作用，可单元测试）
- `src/components/profile/PersonaSummaryCard.jsx`：紧凑版画像卡片，habits/traits/needs 三栏并排（区别于 PersonaSummarySection 的全宽布局）
- `src/components/profile/LearnedPrefsCard.jsx`：行为观测卡片，展示高频主题/偏好深度/偏好格式
- `src/components/profile/PreheatButton.jsx`：手动重跑预热按钮，含 loading/error/success 状态
- `src/store/index.js` `useUiStore` 新增 `profileTab` 字段（'dashboard' | 'settings'，默认 'dashboard'，非持久化）
- `src/components/ProfilePage.jsx`：顶部加 Tab 切换器，dashboard 渲染 ProfileDashboard，settings 渲染原有所有 section（hero 公共保留）
- `src/styles.css` 追加 `.profile-tabs` / `.profile-dashboard` / `.dashboard-card` / `.ai-status-badge` / `.preheat-btn` 等样式
- 数据源：复用 `GET /api/profile/snapshots` + `GET /api/agent-memory/persona`（learnedPreferences 字段）+ `POST /api/profile/snapshots/preheat`，不新建端点
- 测试：新增 12 个纯函数单元测试（buildTrendSeries 6 + buildAiStatusCounts 6），总测试数 398 → 410

### Stock Market Module (股市动向)

Three-column quote terminal (`src/components/StockPage.jsx`): left list (watchlist/hot tabs) | center chart (timeline/K-line) | right orderbook + metrics. AI diagnosis panel below the three columns.

```
src/components/StockPage.jsx   Three-column terminal: TimelineChart (SVG) + KLineChart (klinecharts) + OrderBook + AI panel
src/hooks/useStockWatchlist.js localStorage watchlist (add/remove/toggle/move)
src/hooks/useStockAi.js        AI modules: diagnoseStock / generateMorningBrief / checkAlerts (calls /api/ai-generate)
server/news/services/stockService.js  East Money (primary) + Tencent (fallback) data source
```

**Data source failover**: `getRealtime`/`getRealtimeBatch` try East Money `push2.eastmoney.com` first; on empty/error fall back to Tencent `qt.gtimg.cn` (GBK encoded, decoded via `TextDecoder('gbk')`). Tencent returns 88 `~`-separated fields; correct indices: 1=name 2=code 3=price 4=prevClose 5=open 6=volume 9-18=bids 19-28=asks 30=time 31=change 32=changePct 33=high 34=low.

**klinecharts v10 API**: `init(el, options)` -> Chart; use `chart.setSymbol()` + `chart.setPeriod()` + `chart.setDataLoader({ getBars })` (v10 removed `applyNewData`). Main pane stacks MA(5/10/20), VOL as sub-pane. A-share colors: red up / green down.

**AI compliance**: system prompts forbid buy/sell advice; all outputs suffixed with "仅供参考，不构成投资建议". No-LLM config shows a "配置大模型" guide (no algorithmic fallback for signals).

**localStorage keys**: `stockWatchlist` (array of {code,name,secid,market}), `stockAlertConditions` (map of code->conditionId).

### Backend (`server/news/`)


The backend has been modularized. `server/newsPlugin.js` is now a **16-line re-export shim** that points to `server/news/plugin.js`. All real logic lives in the `server/news/` tree:

```
server/newsPlugin.js          Re-export shim (16 lines)
server/news/
  plugin.js                   Vite plugin: registers middleware, routes /api/* requests (450 lines)
  config/
    constants.js              MEDIA_CONFIG, SOURCE_WEIGHTS, SOURCE_GRADES, DEFAULT_SOURCES (~52KB)
    sourceGrades.js           Source grade lookup utilities
  services/
    newsService.js            News aggregation, feed fetching, caching
    trendingService.js        Trending + GitHub trending (10min/30min caches)
    externalFetchers.js       Source fetching logic
    sourceDiscovery.js        Auto-discover RSS feeds from websites
  images/
    imageProcessing.js        Image extraction, scoring, validation (~21KB)
    imageResolver.js          Image resolution pipeline with Scrapling fallback (~21KB). Returns { imageUrl, videoUrl, images[] } - images is top-4 scored article images for grid display
  parsing/
    feedParser.js             RSS/Atom feed parsing and normalization
  utils/
    httpUtils.js              SSRF protection (isSafeUrl), sendJson, parseBody
    textProcessing.js         Text processing helpers
```

> **Note**: Auth no longer lives under `server/news/` - it moved to the platform layer (`server/auth/` + `server/http/authHandlers.js`). The old `server/news/auth/userAuth.js` was deleted.

**Route handling**: `plugin.js` uses `if (pathname === '/api/xxx')` pattern for each endpoint. When adding new API routes, add the handler in `plugin.js` and import services from the appropriate module.

**Production API**: `api/*.js` contains Vercel serverless functions. `api/meta.js` and `api/news.js` reuse `server/news/config/constants.js`. `api/auth/[action].js`, `api/community/[...path].js`, `api/profile/[...path].js` delegate to the **same** `server/http/*Handlers.js` as the dev plugin (no manual copy). `api/stock/[action].js` reuses `server/news/services/stockService.js` directly. When changing API behavior, prefer updating the shared handler/service; only `api/news.js`-style files that hand-copy plugin logic need both-side updates.

### Platform Backend (server/auth, server/community, server/profile, server/db, server/http)

PostgreSQL-backed platform layer (users, sessions, profiles, community, recommendation/briefing snapshots). Separate from the news-only `server/news/` tree. Requires `DATABASE_URL` + `npm run db:migrate`.

```
server/db/
  client.js                  pg Pool (reads DATABASE_URL and DATABASE_SSL)
  migrate.js                 Runs migrations (npm run db:migrate)
  migrations/001_platform.sql  Schema: users, sessions, user_profiles, profile_domains,
    profile_sources, special_follows, posts, comments, post_likes, post_bookmarks,
    user_follows, recommendation_snapshots, recommendation_items, briefing_snapshots,
    creation_assets, creation_documents, creation_versions
  migrations/002_runtime_indexes.sql  Runtime indexes for feeds, sessions, social counts, and creation assets
server/http/                 Shared HTTP handlers (used by BOTH dev plugin.js and api/ serverless)
  httpUtils.js               sendJsonResponse, readJsonBody, parseCookies, sessionCookie, routeError
  authHandlers.js            handleAuthRequest - register/login/logout/me/profile/interests
  communityHandlers.js       handleCommunityRequest - posts/comments/likes/bookmarks/follows
  profileHandlers.js         handleProfileRequest - profile state, tiers, special follows
server/auth/                 authService + authRepository + passwords (argon2-style hashing)
server/community/            communityService + communityRepository
server/profile/              profileService + profileRepository
```

### API Endpoints

| Endpoint | Method | Params | Notes |
|---|---|---|---|
| `/api/news` | GET | `blocked`, `custom`, `disabledSources`, `page`, `pageSize`, `search`, `interests` | Aggregated RSS feed with pagination |
| `/api/meta` | GET | — | Categories, modes, sources with grade info |
| `/api/trending` | GET | `platform`, `page`, `pageSize` | Hot-trending items |
| `/api/github-trending` | GET | `lang`, `since` | GitHub trending repos (30min cache) |
| `/api/verify-source` | GET | `url` | Validate RSS/Atom feed URL |
| `/api/discover-source` | GET | `url` | Auto-discover RSS feeds from a webpage |
| `/api/llm-models` | GET | `baseUrl`, `apiKey` | List available LLM models |
| `/api/llm-test` | POST | `baseUrl`, `apiKey`, `model`, `prompt` | Test LLM connection |
| `/api/ai-insights` | POST | `baseUrl`, `apiKey`, `model`, `items[]` | AI trend analysis on top 30 items |
| `/api/ai-generate` | POST | `baseUrl`, `apiKey`, `model`, `action`, `content`, `messages[]`, `systemPrompt` | Content generation; **chat** action requires `messages` array |
| `/api/fetch-page` | GET | `url` | Fetch webpage text content (SSRF-protected) |
| `/api/auth/{register,login,logout,me}` | POST/GET | `username`, `password`, `email`, `interests` | PG-backed; session cookie `meridian_session`. Dev + prod share `authHandlers.js` |
| `/api/user/{profile,interests}` | POST | `token`(cookie), `displayName`, `avatar`, `signature`, `interests` | Profile/interests update |
| `/api/community/{...path}` | GET/POST | varies | Posts, comments, likes, bookmarks, follows (PG-backed) |
| `/api/profile/state` | GET | - | Profile tiers (focus/normal/explore), special follows |
| `/api/profile/llm-config` | GET/POST | `baseUrl`, `apiKey`, `model`(POST) | Phase 3 LLM 配置跨设备同步（写入 `user_profiles.llm_config`） |
| `/api/profile/snapshots` | GET | `date`(optional) | Phase 3 推荐快照列表/单条详情 |
| `/api/profile/snapshots/preheat` | POST | - | Phase 3 触发今日预热（缓存命中直接返回） |
| `/api/profile/snapshots/analyze` | POST | `items[]` | Phase 3 实时 AI 重新分析（不写库） |
| `/api/agent-memory/learned-preferences` | PATCH | `topics`, `preferredDepth`, `preferredFormat` | Phase 3 学习偏好合并式更新 |
| `/api/stock/dashboard` | GET | - | Indices + hot stocks (60s cache, East Money + Tencent fallback) |
| `/api/stock/realtime` | GET | `code` | Realtime quote with 5-level order book (bids/asks) |
| `/api/stock/kline` | GET | `code`, `period` (101/102/103), `count` | K-line data (10min cache) |
| `/api/stock/timeline` | GET | `code` | Intraday minute timeline (60s cache) |
| `/api/stock/sectors` | GET | `type` (industry/concept) | Sector gainers/losers (60s cache) |
| `/api/stock/search` | GET | `keyword` | Stock code/name search |
| `/api/scrape` | POST | `url`, `mode`, `timeout` | Proxied to Scrapling Flask on :5000 |

### Security

`server/security/urlSafety.js` resolves DNS and blocks localhost/private/link-local/reserved addresses, credential-bearing URLs, and upstream redirects. Shared AI/page gateways also enforce body limits, timeouts, rate limits, and optional `AI_ALLOWED_HOSTS`. Legacy feed discovery routes additionally use `isSafeUrl()`.

### Caching

- `newsCache`: 5 min TTL, keyed by blocked/disabled/interests params
- `trendingCache`: 10 min TTL
- `githubCaches`: 30 min TTL, keyed by `${lang}-${since}`
- `imageResolveCache`: session-scoped (no TTL, in-memory only)
- Stock caches: realtime 60s, kline 10min, timeline 60s, sectors 60s
- Phase 3 `recommendation_snapshots`: 每日 06:00 Asia/Shanghai cron 预热（仅 production Node/Docker）；Vercel 部署不跑 cron，只走 lazy 路径（用户登录触发 `useSnapshotPreheat`）

## Deployment

- **Vercel**: `vercel.json` maps `/api/*` to serverless functions in `api/`; static build served from `dist/`
- **Node**: `server/productionServer.js` serves `dist/` and the complete shared API on `PORT` (default 3000)
- **Docker**: Multi-stage Node 22 image; startup runs migrations and then the production server
- **Docker Compose**: application + PostgreSQL 15; Scrapling is an optional external service configured by `SCRAPLING_URL`
- **Vercel**: use Node/Docker for the complete long-lived platform; serverless-compatible routes remain in `api/`

## Critical Duplication (Must Update Both)

Categories, source grades, and tag rules are defined **independently** in both `server/news/config/constants.js` and `src/App.jsx`:

| | `server/news/config/constants.js` | `src/App.jsx` |
|---|---|---|
| Categories | 28 items with `all` | 27 items (no `all`) |
| Source Grades | `SOURCE_GRADES` with color/icon | `gradeColors` object (different hex values!) |
| Grade Badge Colors | S=#dc2626, A=#ea580c, B=#16a34a, C=#2563eb, D=#64748b | S=#ff0000, A=#ff8800, B=#00cc00, C=#0088ff, D=#666666 |

> **Note**: Phase 1 统一了分级色值——App.jsx 和 NewsItem 已改用服务端 `SOURCE_GRADES` 权威色（#dc2626 系）。`api/news.js` 和 `api/meta.js` 已复用 `server/news/config/constants.js`。App.jsx 的 `categories` 现从 `/api/meta` 加载（`serverCategories`），离线时降级到 `FALLBACK_CATEGORIES`——双源问题已消除。
>
> **Note**: 前端常量双源问题已消除——`src/constants/index.jsx` 已变为 92 行的 re-export shim，真实定义统一在 `src/constants/appConstants.jsx`。37 个文件仍通过 index.jsx 引用（兼容性保留），但数据源已单一化。新代码应直接 import `appConstants.jsx`。
>
> **Note**: specialFollows submit 逻辑双源已消除——App.jsx 内联的 `submitSpecialFollow`/`editSpecialFollow`/`resetSpecialFollowForm` 已删除，ProfilePage.jsx 内部 `submit`/`editFollow`/`resetForm` 为唯一实现。

- **Navigation**: Right context panel (`showRightPanel`) only shows on `nav === 'all'`. Global news search box (`search-wrap` in topbar) also only renders on `all`. Other pages (stock/github/studio/etc) have no right panel and full-width main. `navToPrimary` maps each nav to its primary group; missing entries fall back to `today` (caused stock highlight bug).
- **Multi-image**: NewsItem renders `item.images` (2-4 imgs) as a 2-col grid; lightbox state is `{ open, src, title, images, index }` supporting prev/next nav. `onOpenLightbox` signature: `(src, title, images, index)`.
- **GitHub card**: App.jsx has an **inline** `GithubRepoCard` function (NOT a separate file). Inline version uses `inferGithubScenario/Audience/Difficulty/Value` + `buildGithubMaterial`; `deriveRepoInsight` in repoInsight.js is a parallel implementation. AI insight is collapsible by default.
## Known Issues

- **Tests limited to pure-logic engines** — 410 unit tests cover workflowEngine.js (80) + profileModel.js (85) + behaviorStore/profileStore (10) + useProfileSync (9) + applySuggestionByType (7) + useAgentMemories (8) + useSnapshotPreheat (7) + dashboardBuilders (12) + src/domain/intelligence + src/domain/stock + sandbox + agentTools (31) + server/ (incl. profileRepository/profileService 15 + snapshotService 4 + aiHandlers 4) tests; no integration/E2E tests, no component tests
- **RSS failure rate ~40-50%** — many sources return 403/404 or HTML instead of RSS
- **Auth requires PostgreSQL** - register/login/me/logout/profile/interests delegate to server/http/authHandlers.js -> server/auth/authService.js (password hashing + session tokens in sessions table). Dev (server/news/plugin.js) and prod (api/auth/[action].js) share the same handler. Without DATABASE_URL, auth endpoints return 503 DATABASE_UNAVAILABLE.
- **`package.json` type: "module"** — all `.js` files use ESM; CI workflows using `require()` will crash
- **GitHub API rate limit** — 60 req/hr unauthenticated; 30-min cache mitigates but README data may be empty when rate-limited

## Gotchas

- Dev server port is **5175** (configured in `vite.config.js`, not the default 5173)
- `vite.config.js` has `allowedHosts: ['.monkeycode-ai.online']`
- `/api/scrape` proxies to Scrapling Flask on port 5000 (must be started separately)
- `LLM_PRESETS` must be defined at **file scope** (top level), not inside a function — causes `ReferenceError` otherwise
- `GlobeView` canvas needs `min-height: 420px`; fullscreen uses `createPortal` to `document.body`; background effects need `pointer-events: none`
- `renderSourceGrade` uses `item.sourceGradeColor` (NOT `gradeColor`)
- Editor image upload uses placeholder syntax `![alt](#{id})`; call `renderMarkdownWithImages(text, images)` for preview
- AI Elf localStorage: all `setItem` calls wrapped in try-catch for `QuotaExceededError`
- When adding source grading features, declare: `sourceGrades`, `gradeFilter`, `sourceTypeTab`, `statusFilter`, `searchQuery`, `regionFilter`, `disabledSources` — do NOT add `selectedSources` or `batchMode` (batch ops are filter-based, no selection state)
- Settings modal JSX is deeply nested; each tab is a sibling inside `<div className="settings-content">`
- `scripts/` contains deployment and test scripts; `docs/reports/` contains historical optimization reports
- v2 localStorage keys: `agentWorkflowHistory` (workflow run records, max 12), `dailyBriefingReport` (last generated briefing). AI Elf uses per-agent keys. All `setItem` calls must be wrapped in try-catch for `QuotaExceededError`.
- WorkflowEngine: `condition` node failure halts the entire rest of the chain (subsequent nodes marked `skipped`), it does NOT branch. LLM nodes require `ctx.llmConfig` (baseUrl/apiKey/selectedModel) and an agent with `systemPrompt`; local nodes ignore LLM config entirely.
- The `App.jsx` (~4367 lines) file imports v2 modules and Zustand stores (`useWorkflowStore`/`useMaterialsStore`/`useProfileStore`). When editing workflow/profile/materials state, prefer reading from the store directly rather than passing as props. Inline workflow constants (`WORKFLOW_SKILL_CATALOG`, `WORKFLOW_CONDITION_METRICS`, `getWorkflowSkillMeta`, `isWorkflowSkillId`, `formatWorkflowNodeConfig`) are still defined in App.jsx for live usage; the larger constants (`DEFAULT_AGENT_WORKFLOW`, `WORKFLOW_TEMPLATE_LIBRARY`, `normalizeWorkflowTemplate`, `createWorkflowTemplateInstance`, `validateWorkflowImportPayload`) live in `src/constants/workflowConstants.js` and are consumed by `workflowStore.js`.
- Runtime `ReferenceError: useMemo is not defined` means a component file uses `useMemo` without importing it from `react` — add `import { useMemo } from 'react'` to that file.
