# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                              # Install dependencies
npm run dev                              # Dev server on 0.0.0.0:5175 (with API middleware)
npm run build                            # Production build -> dist/
npm start                                # Production Node server (dist + full API, default port 3000)
npm run preview                          # Preview production build (static only, no API)
npm run test                             # Run unit tests (vitest) — 410 tests across src/utils, src/store, src/domain, src/hooks/__tests__, src/components/profile/__tests__, server/
npm run test:watch                       # Watch mode
npm run test:integration                 # Integration tests (vitest.integration.config.js)
npm run test:e2e                         # Playwright E2E tests
npm run verify:platform                  # Verify platform connectivity (DB + services)
npm run intelligence:sync                # Intelligence data sync script
npm run preheat:today                    # Trigger today's briefing preheat
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

- **`App.jsx`** (~2800 lines) - Main component with routing logic, settings modal, and page composition. State progressively extracted into Zustand stores (`src/store/`) and custom hooks. Topbar JSX extracted to `src/components/Topbar.jsx`. Workflow runner logic in `src/hooks/useAgentWorkflowRunner.js`, workflow actions in `src/hooks/useWorkflowActions.js`.
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
  index.js              Barrel: exports 12 stores
  newsStore.js          资讯列表：items/loading/error/blockedCategories/searchQuery + loadNews
  recommendStore.js     推荐引擎：items/briefing/todayBriefing/loading + loadRecommendations
  workflowStore.js      智能体工作流：draft/templates/activeId/selectedNodeId/run/result/history/actions (persisted)
  materialsStore.js     素材库 UI：filter/search/tags/timeRange/sourceFilter/spaceFilter/showSpaceForm/showAddMaterial
  profileStore.js       用户画像：domainTiers/sourceTiers/specialFollows/snapshots/briefingConfig/pendingSuggestions/personaSummary (persisted)
  behaviorStore.js      行为信号单一 source of truth：readingHistory/recommendationFeedback/events/followKeywords/trackTargets (persisted)
  aiStore.js            AI 对话：messages/loading/selectedAgent/config + sendMessage/reset
  elfStore.js           AI Elf 会话：sessions/activeSession/messages/agents (persisted, 50 msg/20 session cap)
  githubStore.js        GitHub 情报：repos/loading/error/lang/period + loadGithubTrending
  sourceStore.js        信源管理：customSources/disabledSources/health/verify/discovery
  stockStore.js         股市：realtime/kline/timeline/sectors/watchlist/loading (localStorage watchlist)
  uiStore.js            全局 UI 开关（在 store/index.js 内联定义）：lightbox/sidebar/rightPanel/settings/shortcuts/profileTab/...
```

UI Store (`useUiStore`) and Lightbox Store (`useLightboxStore`) are defined inline in `src/store/index.js`. Usage:
```js
import { useWorkflowStore } from './store';
const draft = useWorkflowStore(s => s.agentWorkflowDraft);
const setDraft = useWorkflowStore(s => s.setAgentWorkflowDraft);
```

Setters support both direct value and updater function (React `setState` style): `setAgentWorkflowDraft(prev => ({ ...prev, name }))`.

#### Extracted Modules (Phase 1-6 refactoring)

State progressively moved into hooks + stores. Some logic (`generateDailyBriefing`, `intelligenceProfile` derivation, `buildWorkbenchContext`) still lives inline in App.jsx as `useMemo`s.

**Standalone component files (actual, in `src/components/`):**
```
src/components/
  Topbar.jsx               顶部栏（从 App.jsx 抽离，~280 行）
  SettingsModal.jsx        设置模态（拆分为 settings/ 子目录）
  ArticleEditor.jsx        Markdown article editor
  StockPage.jsx            股市动向三栏行情终端（分时/K线/五档/AI诊断）
  AiChatPanel.jsx          AI chat panel（780 lines，拆出 aichat/ 子目录）
  CreativeWorkspace.jsx    智创空间主组件（素材库 + 编辑器 + 工作流）
  CommunityPage.jsx        社区广场页（发帖/评论/点赞/收藏/关注）
  CommunityPostDetail.jsx  社区帖子详情
  NewsItem.jsx             资讯卡片
  HexRadarChart.jsx        六边形雷达图
  TrendLineChart.jsx       趋势折线图（支持 onSelect 回调）
  Lightbox.jsx             多图灯箱（prev/next 导航）
  AuthModal.jsx / InterestModal.jsx / ProfileModal.jsx
  LlmQuickConfigModal.jsx  LLM 快速配置
  ShortcutsModal.jsx       快捷键面板
  LanguageSwitcher.jsx     中英文切换
  IntelligenceFeedPanel.jsx 情报动态面板
  NewspaperOverlay.jsx     今日情报报覆盖层
  SkeletonCard.jsx         骨架屏卡片
  ColorfulBubbles.jsx      装饰气泡动画
  WorkflowNodeCard.jsx     画布节点卡片
  settings/                设置模态子标签页
    SourcesTab.jsx         信息源管理
    AgentsTab.jsx          Agent 管理
    LlmTab.jsx             大模型配置
    CustomToolsPanel.jsx   自定义 HTTP 工具
    SandboxPanel.jsx       沙箱配置
  aielf/                   AI Elf 子组件
    Sidebar.jsx, ChatHeader.jsx, MessageList.jsx, InputArea.jsx
    ElfToolCard.jsx, prompts.js, markdown.js
    runElfAgentLoop.js     Agent 工具调用循环
    useSendMessage.js     发送消息 hook
  aichat/                  AiChatPanel 子组件
    ToolCards.jsx, buildSystemPrompt.js, buildQuickActions.js
    buildMaterialContext.js, runAgentLoop.js, useInputHistory.js
  stock/
    KLineChart.jsx         K线图（klinecharts v10）
    ResearchTools.jsx      研究工具
  profile/                 用户画像组件
    ProfileDashboard.jsx   仪表盘主组件（Phase 6 双栏布局：时间轴 + 主画像卡）
    PersonaTimelineRail.jsx 左侧时间轴（日期 + delta chip）
    PersonaHeroCard.jsx    主画像卡（current/diff 模式 + 置信度环 SVG）
    PersonaDiffList.jsx    diff 模式三栏列表
    BehaviorObservedCard.jsx 行为观测卡
    PreheatCard.jsx        预热按钮卡片
    KpiStrip.jsx           KPI 细条（4 项均分 + 竖向分隔）
    PersonaEvolutionMiniChart.jsx 精简 SVG 进化趋势（3 条折线）
    PendingSuggestionsSection.jsx AI 建议待确认列表
    PendingSuggestionCard.jsx   单条建议卡片
    AgentMemorySection.jsx      AI 跨会话记忆 CRUD
    SnapshotHistorySection.jsx 历史快照展示
```

**NOT separate files (inline in App.jsx or located elsewhere):**
- `SkeletonCard`, `GithubRepoCard` are **inline functions** in App.jsx.
- `ThemePicker.jsx` lives at `src/ThemePicker.jsx` (NOT `src/components/`); exports default `ThemePicker` + named `PALETTES`.

#### Pages (App.jsx routing destinations)

```
src/components/
  NewsPage.jsx               资讯聚合页（分类/模式/地区/信源过滤 + 搜索 + 分页）
  CustomUrlPage.jsx          自定义 URL 抓取页
  RecommendationFeed.jsx    精准推荐时间线（含日期轨道）
  RecommendationDateRail.jsx 推荐日期导航
  RecommendationsPage.jsx    推荐页容器
  GithubPage.jsx             GitHub 热门页（日/周/月榜 + 语言筛选 + AI 情报）
  TrendingPage.jsx           热点趋势页
  StockPage.jsx              股市动向三栏终端（分时/K线/五档/AI诊断）
  MaterialsPage.jsx          智创素材库页
  StudioPage.jsx             智创工作室（工作流画布 + 素材 + 编辑器）
  AgentsPage.jsx             Agent 管理页
  CalendarPage.jsx           日历管理页
  CommunityPage.jsx          社区广场
  ProfilePage.jsx            个人画像（Phase 6 双栏仪表盘 + 设置 tab）
  ReadingListPage.jsx        阅读列表
  InsightDashboardPage.jsx   情报仪表盘
  KnowledgeExportPage.jsx    知识导出页
  MonitorPage.jsx            竞争情报监测页
```

#### Shell & Block System (Feishu-inspired three-layer UI)

```
src/shell/
  CommandPalette.jsx    Ctrl+K 全局面板：页面导航(9 route) + 新闻搜索 + 快捷操作
src/blocks/
  BlockGrid.jsx         网格容器（<BlockGrid columns={3}><BlockGrid.Card .../>）
  BlockPanel.jsx        带标题的可选操作槽面板
  BlockList.jsx         列表块
  BlockToolbar.jsx      工具栏 + Pills 子组件
  BlockStat.jsx         统计块（value/label/desc/size/variant/trendDir）
```

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
  useLocalStorage.js        Auto-syncing localStorage hook
  useAuth.js                认证与用户会话（user/token/auth表单/interests + 持久化 + handler）
  useLlmConfig.js           LLM配置与模型管理（config/models/test + allLlmModels useMemo）
  useTrending.js            热门榜单 + GitHub trending（items/loading/filter/page + loadTrending/loadGithub）
  useSourceManager.js       信息源管理（customSources/disabledSources/health/verify/discovery + 4 handler）
  useCustomUrl.js           自定义URL抓取（input/result/loading/error/mode + fetchCustomUrl）
  useCalendar.js            日历管理（calendarDate/events/eventForm + addEvent/removeEvent）
  useUI.js                  纯UI开关（showFollowDropdown/mobileMenuOpen/showBackToTop/moreNavOpen）
  useStockWatchlist.js      股票自选列表（localStorage 持久化，add/remove/toggle/move）
  useStockAi.js             股市AI智能模块（诊断/早报/监控，联动LLM）
  useWorkflowEngine.js      React wrapper over WorkflowEngine: run/result/history/actions, persists `agentWorkflowHistory` (max 12)
  useCommunity.js           社区广场数据（posts/comments/likes，调用 /api/community/*）
  useProfileSync.js         画像分层同步：5 块 <-> /api/profile/state（buildSavePayload + mergeSnapshots 纯函数）
  useAgentMemories.js       agent_memories CRUD（list/search/delete + buildListQuery/parseListResponse）
  useAgentWorkflowRunner.js 智能体工作流运行器（runAgentWorkflow，从 App.jsx 抽离）
  useWorkflowActions.js     工作流行动队列（createWorkflowActions/executeWorkflowAction）
  useWorkflowMeta.js        工作流元数据（模板列表 + 验证）
  useWorkflowOps.js         工作流操作（创建/删除/复制工作流）
  useBriefingOps.js         早报操作（从 App.jsx 抽离）
  useGithubInsight.js       GitHub 情报（从 App.jsx 抽离）
  useRecommendationFeedback.js 推荐反馈（从 App.jsx 抽离）
  useCalendarMemos.js       日历备注（从 App.jsx 抽离）
  useMaterialsMemos.js      素材备注
  useReadingStatsMemos.js   阅读统计备注
  useNewsFilter.js          资讯过滤状态（blockedCategories/searchQuery/sourceFilter）
  useExternalIntelligence.js 外部情报（行业/竞品/供应链扫描）
  useIntelligenceMemos.js   情报备忘录
  useRecommendationMemos.js 推荐备忘录（注入 personaSummary + relevantMemories，暴露 eventClusters）
  useIntelligenceBriefing.js 情报简报 hook（briefing 生成 + AI 合并）
  useBookmarkMaterial.js    收藏转素材
  useArticleEditor.js       文章编辑器状态
  useAgents.js              Agent 管理（列表/创建/配置/删除）
  useSnapshotPreheat.js     lazy 预热触发（用户登录 + 今日 snapshot 缺失 → 30s 超时 + 算法降级）
  useAiRecommendationEnhance.js 实时 AI 重新分析（调 /api/profile/snapshots/analyze，不写库）
  useProfileDashboard.js    仪表盘聚合（snapshots/learnedPreferences/personaSummary/preheat/personaHistory）
  useCreativeWorkspace.js   智创空间（素材 + 编辑器 + 工作流统一状态）
```

#### Domain Layer (`src/domain/`)

Pure-logic domain engines (no React, no HTTP), unit-tested in-place. App.jsx imports these directly.

```
src/domain/intelligence/
  profileTiers.js           PROFILE_TIERS, SPECIAL_FOLLOW_TYPES, tier migration/score
  recommendationEngine.js   buildRecommendation, selectBriefingLanes, clusterEvents, freshnessScore, matchSpecialFollow
  briefingEngine.js         buildAlgorithmBriefing (lane-based), mergeAiBriefing
  briefingEvolution.js      briefing 版本追踪与演化分析
  agenticBriefing.js        Agent 驱动简报生成
  semanticCluster.js       语义聚类（轻量向量增强）
  snapshotStore.js          localStorage-backed daily recommendation/briefing snapshots
  graphEngine.js           知识图谱引擎
src/domain/stock/
  indicators.js             SMA, annualizedVolatility, supportResistance, volumeTrend, priceMomentum
  algorithmAnalysis.js      analyzeStock (local technical analysis, no-LLM fallback)
  intelligenceRadar.js     情报雷达（多维度扫描）
  investorPolicy.js        投资者策略（风险偏好/仓位规则）
  positionSizing.js        仓位计算
src/domain/creative/
  assetModel.js            创作资产模型（素材/文档/版本抽象）
  exportEngine.js          导出引擎（Markdown/JSON/HTML）
  versionStore.js          版本存储（diff + rollback）
```

#### Utility / Hook / Constant Files

```
src/utils/
  localStorage.js       loadLS/saveLS/clearStaleLS
  format.js             formatTime/formatRelative/formatStars + getGradeColors/hexToRgba
  toast.js              showToast DOM notification
  markdown.jsx          renderMarkdown/renderMarkdownWithImages/renderBriefMarkdown/renderInline
  repoInsight.js        deriveRepoInsight (本地规则派生 GitHub 项目情报)
  githubMaterial.js     buildGithubMaterial
  workflowEngine.js     Pure-logic DAG executor (LLM nodes call /api/ai-generate; local nodes synchronous)
  workflowValidation.js validateWorkflowDraft
  profileModel.js       computeIntelligenceProfile / computeReadingProfile / computeProfileLearningEngine / computeTodayProfileSnapshot
  dashboardBuilders.js  buildTrendSeries / buildAiStatusCounts / buildPersonaTrendSeries / diffPersonaSnapshots
  memoryEvolver.js     extractLearnedPreferences + write learned_preferences
  graphEngine.js       知识图谱构建（与 domain/intelligence/graphEngine.js 区分）

src/constants/
  appConstants.jsx     权威常量源：PRODUCT_NAME, NAV_ITEMS, FALLBACK_CATEGORIES, CATEGORY_GROUPS,
                       VERTICAL_CHANNELS, LLM_PRESETS, SCROLLING_NEWS_ITEMS, AGENT_CATEGORIES, MODES,
                       VIEW_MODES, TRENDING_TYPES, GITHUB_LANGS/PERIODS, REGION_MAP, MODE_MAP,
                       MATERIAL_TYPES, ARTICLE_STATUS/TEMPLATES/TEMPLATE_CONTENT, WEEKDAYS, MONTHS,
                       ICONS, WORKFLOW_SKILL_CATALOG, WORKFLOW_CONDITION_METRICS/OPERATORS,
                       getWorkflowSkillMeta, isWorkflowSkillId, formatWorkflowNodeConfig
  index.jsx            兼容 shim（re-export appConstants.jsx，保留死代码供历史引用）
  workflowConstants.js  DEFAULT_AGENT_WORKFLOW, WORKFLOW_NODE_TYPES, WORKFLOW_TEMPLATE_LIBRARY
                       (3 templates: daily-briefing / github-evaluator / material-to-article) + helpers
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

**Phase 5 画像进化趋势（已完成）**：personaSummary 进化历史 + 仪表盘第 6 区块。
- Migration 007：`persona_summary_history` 表（user_id/snapshot jsonb/evolved_at）+ cap 90/用户（同事务清理）
- `agentMemoryService.mergePersonaSummary` 改造为同事务：UPDATE user_profiles + INSERT persona_summary_history + DELETE cap>90，并清理遗留 `updatedAt` 字段
- 新增 `getPersonaHistory(userId, limit)` 服务方法 + `GET /api/agent-memory/persona/history?limit=30` 端点
- `dashboardBuilders.js` 新增 `buildPersonaTrendSeries` + `diffPersonaSnapshots` 纯函数 + 15 个单元测试
- `useProfileDashboard` 加 `personaHistory` + `loadPersonaHistory`
- 新增 `PersonaEvolutionSection` + `PersonaDiffCard` 组件，集成到仪表盘第 6 区块
- `TrendLineChart` 加可选 `onSelect` 回调（不破坏现有调用）
- Bug 1 修复：`preheatForUser` 内部从 DB 自动读 personaSummary（cron/lazy 路径无前端传入时）
- Bug 2 修复：`agentContext.js` 字段名 `lp.frequentTopics` → `lp.topics || lp.frequentTopics`
- Bug 3 修复：`profileStore` 默认值字段名 `updatedAt` → `lastEvolvedAt`（带 fallback 兼容旧 localStorage）
- 测试：新增 15 个纯函数单元测试（buildPersonaTrendSeries 8 + diffPersonaSnapshots 7），总测试数 410 → 425

**Phase 6 仪表盘视觉重构（已完成）**：从"方块堆叠"重构为左侧时间轴叙事 + 右侧画像主卡聚焦的双栏布局。
- `src/components/profile/ProfileDashboard.jsx`：重写容器，引入双栏布局 + `selectedIdx` 状态联动时间轴与趋势图
- `src/components/profile/PersonaTimelineRail.jsx`：左侧时间轴，节点显示日期 + delta chip（+N 绿 / -N 红）
- `src/components/profile/PersonaHeroCard.jsx`：主画像卡，current/diff 两种模式，含置信度环 SVG（金色渐变 stroke + glow）
- `src/components/profile/PersonaDiffList.jsx`：diff 模式下的三栏列表，added/removed 标记
- `src/components/profile/BehaviorObservedCard.jsx`：行为观测卡（重命名自 LearnedPrefsCard）
- `src/components/profile/PreheatCard.jsx`：包装 PreheatButton，加 info-card 样式
- `src/components/profile/KpiStrip.jsx`：KPI 细条，4 项均分，项间竖向分隔
- `src/components/profile/PersonaEvolutionMiniChart.jsx`：精简 SVG 进化趋势，3 条折线 + 节点 + 图例，index 映射 history[length-1-trendIdx]
- 删除：PersonaSummaryCard / LearnedPrefsCard / PersonaEvolutionSection / PersonaDiffCard（被新组件取代）
- `src/utils/dashboardBuilders.js`：`formatEvolvedAt` 改为 export（Phase 6 前置依赖）
- `src/components/ProfilePage.jsx`：传递 `specialFollows` 给 ProfileDashboard
- `src/styles.css`：替换 L19241-L19596 的 Phase 4/5 样式块为 Phase 6 新样式（双栏布局 + 时间轴 + 主画像卡 + KPI 细条 + 趋势图）
- 交互：点击时间轴节点 / 趋势图节点 → PersonaHeroCard 切换 diff 模式；再次点击 / 点击 × / 点击"今日" → 回到当前画像视图
- 测试：425 个测试全部通过（无新增测试，computeDelta 留在组件内部未抽纯函数）

**Phase 7 Agent 自主层（已完成）**：Agent 任务调度 + 执行 + 记忆服务。
- `server/agent/agentJobsService.js`：cron 驱动的 Agent 任务调度（每日情报扫描/竞品监测）
- `server/agent/agentContext.js`：Agent 执行上下文（用户画像 + 偏好 + 记忆注入）
- `server/agent/agentMemoryService.js`：Agent 记忆 CRUD + persona_summary 合并式更新
- `server/agent/memoryAgentMemoryService.js`：记忆服务扩展（向量检索 + 语义去重）
- `server/http/agentRunHandlers.js`：Agent 运行端点（启动/停止/状态查询）
- `server/http/agentJobsHandlers.js`：Agent 任务管理端点
- `server/http/agentAuth.js`：Agent 认证中间件
- `server/skills/skillLoader.js`：工具注册/发现/触发匹配系统（SKILL_SOURCES + matchSkillsByTriggers）
- `src/hooks/useAgents.js`：前端 Agent 管理（列表/创建/配置/删除）
- Migration 004/005：agent_jobs + agent_memory 相关表

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

`server/newsPlugin.js` is a **16-line re-export shim** pointing to `server/news/plugin.js`. All real logic lives in the `server/news/` tree:

```
server/news/
  plugin.js                   Vite plugin: registers middleware, routes /api/* requests
  config/
    constants.js              MEDIA_CONFIG, SOURCE_WEIGHTS, SOURCE_GRADES, DEFAULT_SOURCES (~52KB)
    sourceGrades.js           Source grade lookup utilities
  services/
    newsService.js            News aggregation, feed fetching, caching (5min TTL)
    trendingService.js        Trending + GitHub trending (10min/30min caches)
    externalFetchers.js       Source fetching logic
    sourceDiscovery.js        Auto-discover RSS feeds from websites
    stockService.js           East Money (primary) + Tencent (fallback) data source
  images/
    imageProcessing.js        Image extraction, scoring, validation (~21KB)
    imageResolver.js          Image resolution pipeline with Scrapling fallback (~21KB)
  parsing/
    feedParser.js             RSS/Atom feed parsing and normalization
  utils/
    httpUtils.js              SSRF protection (isSafeUrl), sendJson, parseBody
    textProcessing.js         Text processing helpers
```

> **Note**: Auth no longer lives under `server/news/` — it moved to the platform layer (`server/auth/` + `server/http/authHandlers.js`). The old `server/news/auth/userAuth.js` was deleted.

**Route handling**: `plugin.js` uses `if (pathname === '/api/xxx')` pattern for each endpoint. When adding new API routes, add the handler in `plugin.js` and import services from the appropriate module.

**Production API**: `api/*.js` contains Vercel serverless functions. `api/meta.js` and `api/news.js` reuse `server/news/config/constants.js`. `api/auth/[action].js`, `api/community/[...path].js`, `api/profile/[...path].js` delegate to the **same** `server/http/*Handlers.js` as the dev plugin (no manual copy). `api/stock/[action].js` reuses `server/news/services/stockService.js` directly. When changing API behavior, prefer updating the shared handler/service; only `api/news.js`-style files that hand-copy plugin logic need both-side updates.

### Platform Backend (server/auth, server/community, server/profile, server/db, server/http, server/agent, server/skills)

PostgreSQL-backed platform layer. Requires `DATABASE_URL` + `npm run db:migrate`.

```
server/db/
  client.js                  pg Pool (reads DATABASE_URL and DATABASE_SSL)
  migrate.js                 Runs migrations (npm run db:migrate)
  migrations/001..007.sql    7 migrations: platform schema + indexes + intelligence + agent autonomy + profile extensions + LLM sync + persona history
server/http/                 Shared HTTP handlers (used by BOTH dev plugin.js and api/ serverless)
  httpUtils.js               sendJsonResponse, readJsonBody, parseCookies, sessionCookie, routeError
  authHandlers.js            handleAuthRequest - register/login/logout/me/profile/interests
  communityHandlers.js       handleCommunityRequest - posts/comments/likes/bookmarks/follows
  profileHandlers.js         handleProfileRequest - profile state, tiers, special follows, snapshots
  agentMemoryHandlers.js     handleAgentMemoryRequest - agent memories + persona
  agentRunHandlers.js        handleAgentRunRequest - agent execution
  agentJobsHandlers.js       handleAgentJobsRequest - scheduled agent tasks
  creativeHandlers.js        handleCreativeRequest - assets, documents, versions
  intelligenceHandlers.js    handleIntelligenceRequest - events, items, opportunities, sectors, alerts
  aiHandlers.js              handleAiGenerateRequest, handleAiInsightsRequest
  fetchPageHandler.js        handleFetchPageRequest - SSRF-protected page fetch
  webSearchHandler.js        handleWebSearchRequest - web search gateway
  lastSeenMiddleware.js      updateLastSeen - track user activity
server/auth/                 authService + authRepository + passwords (argon2-style hashing)
server/community/            communityService + communityRepository
server/profile/              profileService + profileRepository + snapshotService + agentMemoryService
server/agent/                Agent autonomous layer
  agentJobsService.js        Cron-driven agent task scheduling (daily intelligence scan / competitive monitoring)
  agentContext.js            Agent execution context (user profile + preferences + memory injection)
  agentMemoryService.js      Agent memory CRUD + persona_summary merge式更新
  memoryAgentMemoryService.js Memory service extension (vector retrieval + semantic dedup)
server/skills/
  skillLoader.js             Tool registration / discovery / trigger matching (SKILL_SOURCES + matchSkillsByTriggers)
server/cron/
  dailyBriefingPreheatJob.js Daily 06:00 Asia/Shanghai preheat (production Node/Docker only)
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
| `/api/intelligence/events` | GET | - | External intelligence events (industry/competitor/supply chain scan) |
| `/api/intelligence/items` | GET | - | Curated intelligence items |
| `/api/intelligence/opportunities` | GET | - | Market opportunity detection |
| `/api/intelligence/sectors` | GET | - | Weekly sector analysis |
| `/api/intelligence/alerts` | GET | - | Intelligence alerts |
| `/api/agent-memory/learned-preferences` | PATCH | `topics`, `preferredDepth`, `preferredFormat` | Phase 3 学习偏好合并式更新 |
| `/api/agent-memory/persona` | GET | - | User persona summary |
| `/api/agent-memory/persona/history` | GET | `limit` | Persona evolution history |
| `/api/agent/run` | POST | `agentId`, `input` | Agent execution |
| `/api/agent/jobs` | GET/POST | varies | Agent scheduled task management |
| `/api/creative/assets` | GET/POST | varies | Creative assets (materials/documents/versions) |
| `/api/web-search` | GET | `query` | Web search gateway |
| `/api/community/{...path}` | GET/POST/PATCH/DELETE | varies | Posts, comments, likes, bookmarks, follows (PG-backed) |
| `/api/profile/state` | GET/PUT | - | Profile tiers (focus/normal/explore), special follows |
| `/api/profile/llm-config` | GET/POST | `baseUrl`, `apiKey`, `model`(POST) | Phase 3 LLM 配置跨设备同步（写入 `user_profiles.llm_config`） |
| `/api/profile/snapshots` | GET | `date`(optional) | Phase 3 推荐快照列表/单条详情 |
| `/api/profile/snapshots/preheat` | POST | - | Phase 3 触发今日预热（缓存命中直接返回） |
| `/api/profile/snapshots/analyze` | POST | `items[]` | Phase 3 实时 AI 重新分析（不写库） |

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

- **Tests limited to pure-logic engines** — 425 unit tests cover workflowEngine.js (80) + profileModel.js (85) + behaviorStore/profileStore (10) + useProfileSync (9) + applySuggestionByType (7) + useAgentMemories (8) + useSnapshotPreheat (7) + dashboardBuilders (27 = Phase 4 12 + Phase 5 15) + src/domain/intelligence + src/domain/stock + sandbox + agentTools (31) + server/ (incl. profileRepository/profileService 15 + snapshotService 4 + aiHandlers 4) tests; no integration/E2E tests, no component tests
- **RSS failure rate ~40-50%** — many sources return 403/404 or HTML instead of RSS
- **Auth requires PostgreSQL** - register/login/me/logout/profile/interests delegate to server/http/authHandlers.js -> server/auth/authService.js (password hashing + session tokens in sessions table). Dev (server/news/plugin.js) and prod (api/auth/[action].js) share the same handler. Without DATABASE_URL, auth endpoints return 503 DATABASE_UNAVAILABLE.
- **`package.json` type: "module"** — all `.js` files use ESM; CI workflows using `require()` will crash
- **GitHub API rate limit** — 60 req/hr unauthenticated; 30-min cache mitigates but README data may be empty when rate-limited
- **Vitest 4.x incompatible** — rolldown native binding failures; pin to vitest 3.x. On Windows, `npx vitest` fails (bin symlink not created); use `node node_modules/vitest/vitest.mjs run`.

## Gotchas

- Dev server port is **5175** (configured in `vite.config.js`, not the default 5173)
- `vite.config.js` has `allowedHosts: ['.monkeycode-ai.online', 'localhost', '127.0.0.1']`
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
- `App.jsx` (~2800 lines) imports v2 modules and Zustand stores. When editing workflow/profile/materials state, prefer reading from the store directly rather than passing as props. Inline workflow constants (`WORKFLOW_SKILL_CATALOG`, `WORKFLOW_CONDITION_METRICS`, `getWorkflowSkillMeta`, `isWorkflowSkillId`, `formatWorkflowNodeConfig`) are still defined in App.jsx for live usage; the larger constants (`DEFAULT_AGENT_WORKFLOW`, `WORKFLOW_TEMPLATE_LIBRARY`, `normalizeWorkflowTemplate`, `createWorkflowTemplateInstance`, `validateWorkflowImportPayload`) live in `src/constants/workflowConstants.js` and are consumed by `workflowStore.js`.
- Runtime `ReferenceError: useMemo is not defined` means a component file uses `useMemo` without importing it from `react` — add `import { useMemo } from 'react'` to that file.
- Intelligence API: `GET /api/intelligence/events|items|opportunities|sectors|alerts` return external industry/competitor/supply-chain data. In dev mode, `SILICON_E2E=1` enables fixture responses for offline testing.
- Agent auth: `server/http/agentAuth.js` provides middleware for agent run endpoints; agent context (`agentContext.js`) injects user profile + preferences + relevant memories into each agent execution.
- Skills system: `server/skills/skillLoader.js` manages tool registration with `SKILL_SOURCES` taxonomy; `matchSkillsByTriggers` auto-discovers tools by keyword triggers.
