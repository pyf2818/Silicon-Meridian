# Silicon Meridian × WorkBuddy 对齐升级方案

> 生成：2026-09-25 ｜ 依据：WorkBuddy 官方文档 + 本机安装实测（app.asar.unpacked / ~/.workbuddy/）+ 本仓库代码实测
> 方法：第一性思维拆真问题 → 对抗性审查逐条打边界 → 钢人论证裁决取舍

---

## 一、WorkBuddy 调研摘要（实测证据）

### 1.1 设计理念

| 理念 | 内涵 | 证据 |
|---|---|---|
| **任务制而非会话制** | 一句话任务 → 自主规划 → 可验收交付物；任务列表按文件夹分组 | 官方 Quickstart；`~/.workbuddy/` 下 tasks/、todos/、plans/ 独立目录 |
| **产物一等公民** | 结果区三视图：产物 / 全部文件 / 变更 / 预览；present_files 单一呈现入口 | `artifact-index/`、`changes-index/`、`changes-detail/`、`file-history/`、`buddy-snapshots/` |
| **交互模式分档** | 五档：quick(纯问答零工具)/ask/plan(先计划)/craft(创作)/expert(专家)，每档是独立的提示词片段集 | `workbuddy-builtin/interactionmode/{ask,quick,plan,craft,expert}/fragments/` |
| **提示词 fragment 组合** | 系统提示词不是单体函数，而是「片段文件 + `{% if %}` 条件注入 + `{{ 变量 }}` 替换」；安全段（memory-system）与行为段（current-mode/tool-use/result-presentation/task-management）解耦 | `prompt-common/fragments/*.md`；quick 模式硬规则"无工具、不得声称用过工具" |
| **三层记忆** | 云端 profile（服务端隐式学习、只读注入）→ 用户级 MEMORY.md（显式规则，4000 字符上限）→ 工作区日志 YYYY-MM-DD.md（append-only）+ MEMORY.md（3000 上限，30 天蒸馏） | `prompt-common/fragments/workbuddy-memory-system.md` 全文 |
| **能力可插拔** | Skills（SKILL.md 渐进披露，user/project 两级 + 市场云同步）、Connectors/MCP（mcp.json + mcp-approvals.json 审批）、Experts/插件市场 | `skills/`+`skills-marketplace/`+`connectors/`+`plugin-marketplace-state-new/` |
| **可编程自动化** | RRULE 调度的一次性/周期任务，任务即 prompt | automations 机制 |
| **桌面工程稳态** | Electron 多进程 + .NET supervisor（editor-sdk-supervisor.exe）+ wbipc + SQLite(WAL) 主库 + binaries 隔离运行时（python/node 多版本 + 独立 venv，绝不污染全局） | 安装目录 + `workbuddy.db-wal`、`binaries/` |
| **安全纵深** | credentials/ 独立凭证目录、security/、audit-log/、usage-log.json、traces/、工具审批闸门（riskLevel 分级 + 按调用风险降级免审） | `~/.workbuddy/` 目录实测 |

### 1.2 架构与技术实现

- **前端**：Electron(Chromium) 壳 + React 生态；界面三区：侧边栏（任务分组+搜索）/ 对话区（标题栏+消息流+输入框）/ 结果区（产物卡片、文件树、变更 diff、预览）。产物卡片带类型图标（file-icons 资源目录）。
- **后端**：本地常驻服务（SQLite WAL 状态库 + 各领域目录）+ 云端服务（账号、技能云同步、市场、遥测、LLM 网关）。
- **交互方式**：SSE 流式 + 工具调用循环 + 权限审批卡 + present_files 产物卡 + 内联可视化 widget + MCP App artifact 面板（guest SDK 隔离渲染）。
- **进程治理**：监督进程 + 快照（shell-snapshots）+ 独立运行时目录，升级不依赖用户环境。

---

## 二、Silicon Meridian 现状盘点（2026-09-25 实测）

| 维度 | 现状（实测） | 评价 |
|---|---|---|
| App.jsx | 2748 行 | CLAUDE.md 记 ~3000，Phase 拆分有成效，仍偏胖 |
| AiChatPanel.jsx | **2509 行**（CLAUDE.md 记 780） | **膨胀 3.2 倍**，最大技术债 |
| styles.css | **27883 行**（CLAUDE.md 记 16052） | **膨胀 74%**，HMR 与维护成本显著上升 |
| themes.css | 959 行 | 健康 |
| agentLoopCore.js | 498 行 | 内核紧凑，含流式/重试/取消/审批/压缩 |
| session 层 | contextManager 304 行 + untrusted + llmSummarizer + trail/trailStore + outputSink | 已有会话轨迹与产物落盘雏形 |
| 工具闸门 | toolRegistry：requiresApproval + 用户覆写 + riskLevel(args) 按调用降级 + elf `approvalPolicy:'deny'` | 与 WorkBuddy 同构，已对齐 |
| 多代理 | subagentRunner（并发池 3/上限 5）+ teamCore + teamStore（共享任务板+邮箱） | 已对齐 Phase 8 |
| 记忆 | agent_memories(PG) + personaSummary + learned_preferences + pendingSuggestions 确认闭环 | 有数据层，缺「蒸馏维护」与「注入限额策略」 |
| 产物 | outputs/subagents/ 落盘 + outputSink + 转写路径回传 | **无统一产物索引与结果区 UI**——最大产品差距 |
| 自动化 | server/cron 预热 job + agentJobsService（cron 驱动情报扫描） | 后端有，**无用户可编程入口** |
| Skills | server/skills/skillLoader.js + create_skill 工具 + createSkillDirect 旁路 | 有注册/触发，缺 SKILL.md 渐进披露与两级目录规范 |
| MCP | mcpRegistry + list_mcp_tools(免审)/mcp_call(审批 30s) | 已对齐 |
| 后端 | Vite middleware(dev) + api/* serverless + productionServer.js 常驻，共享 handler | 双轨统一做得好，保持 |
| 安全 | untrusted_data 定界 + scrypt + session cookie + SSRF 防护 + 上传魔法数交叉嗅探 + 网关限流 | 底子好；**apiKey 明文存 localStorage/PG**、无 CSP、无服务端审计日志 |

**第一性拆解**：本项目的真问题不是"缺功能"，而是三条主线——
1. **产物没有归宿**：agent 干完活，结果散在聊天流和 outputs/ 里，用户无法验收 → WorkBuddy 的"任务→交付物→结果区"正是解法。
2. **单体文件在逼近可维护性红线**：AiChatPanel 2509 行 + styles.css 27883 行，继续堆会先卡 HMR/渲染，后卡迭代速度。
3. **提示词是单体函数**：buildSystemPrompt 每加一个能力就多一段 if 字符串，无法按模式/工具面组合 → WorkBuddy 的 fragment 系统是成熟解。

---

## 三、模块清单与优先级总表

> P0=立即（下一批就做）｜P1=紧随（1-2 批内）｜P2=择机。工作量按"批次"计（每批 3-5 项，沿用现有协作节奏）。

| # | 模块 | 对齐 WorkBuddy 能力 | 优先级 | 核心产出 |
|---|---|---|---|---|
| A1 | **产物中心（Artifact Hub）** | 任务→交付物→结果区 | **P0** | 产物注册表 + 结果区 UI + 消息流 ArtifactCard |
| A2 | AiChatPanel 拆分 | 三区布局解耦 | **P0** | 2509 行 → 结果区/对话区/输入区/审批区独立模块 |
| A3 | styles.css 域拆分 | 设计令牌治理 | **P0** | 27883 行按域拆文件，引入顺序锁定 |
| B1 | 提示词 Fragment 系统 | interactionmode/fragments | **P1** | buildSystemPrompt → fragments/ + 条件拼装（安全段强制注入） |
| B2 | 交互模式档位 UI | quick/plan/craft 模式徽章 | P1 | 输入框上方模式切换（快捷/计划/深度），映射三档权限 |
| B3 | 自动化面板（Automations） | RRULE 可编程任务 | **P1** | agent_jobs 用户入口：自然语言/表单建定时情报任务 |
| B4 | Skills 对齐 SKILL.md | 渐进披露 + 两级目录 | P1 | workspace 级 skills 目录 + 管理面板 + 渐进披露加载 |
| C1 | 记忆蒸馏 job | 30 天日志→长期记忆 | P1 | agent_memories 归档/摘要服务 + 注入限额 |
| C2 | 服务端审计日志 | audit-log/ | **P1** | 登录/敏感工具/上传/导出 落 audit 表 |
| C3 | apiKey 服务端加密 | credentials/ + keyblob | **P1** | AES-GCM 加密存储，前端不再回显全文 |
| C4 | CSP + 安全响应头 | — | **P1** | index.html CSP（dev 放宽、prod 严格） |
| D1 | 进程稳定性加固 | supervisor + WAL 思想 | **P1** | unhandledRejection 兜底 + /api/health + 内存水位日志 + graceful shutdown |
| D2 | 本地 SQLite 降级层 | workbuddy.db(WAL) | P2 | dev/单机无 PG 时持久化（node:sqlite/兼容层，单仓储切换不双写） |
| D3 | 内联可视化 Widget | show_widget | P2 | agent 输出 SVG/图表沙盒渲染（iframe sandbox 白名单） |
| D4 | 审批记忆 | mcp-approvals.json | P2 | "记住本次选择"持久化，治审批疲劳 |
| D5 | Connectors 状态面板 | connectors/ | P2 | MCP/外部服务连接状态、凭证过期提示 |
| E1 | 三区布局分组 | 侧边栏任务分组 | P2 | 会话/产物按项目与日期分组+搜索 |

---

## 四、分模块实施要点

### A1 产物中心（P0，对齐核心体验）

**目标**：agent 每次产出的文件/报告/图表有唯一注册入口，用户在「结果区」验收，而不是滚聊天记录。

- `src/session/artifactRegistry.js`（纯逻辑，单测覆盖）：产物记录 `{ id(uuid), taskId, sessionId, kind(file/report/chart/table/code/attachment), title, mime, size, createdAt, pathOrRef, preview }`；**只存引用不存路径明文**——前端拿到的永远是 opaque id。
- outputSink.js 扩展为注册入口：subagent 转写、create_skill 落盘、exportEngine 导出、报告生成统一调 `registerArtifact()`。
- 存储：dev 内存 Map + PG `artifacts` 表（迁移 012：id/user_id/session_id/task_id/kind/title/mime/size/ref/created_at，索引 user_id+created_at）。上传仓储（PG bytea + 内存 Map 双仓储）已有同构先例，照抄模式。
- 读端点：`GET /api/artifacts?session=` 列表 + `GET /api/artifacts/<uuid>` 内容（**服务端校验归属 userId，防越权**；immutable 缓存同上传先例）。
- UI：AiChatPanel 右侧新增「结果」抽屉（产物/文件/变更三个 Tab 对齐 WorkBuddy）；消息流内工具卡完成态挂 ArtifactCard（类型图标 + 大小 + 预览按钮）。
- 改进点（相对 WorkBuddy）：加「产物 → 一键转素材库 / 存入工作站」——这是本项目的差异化闭环。

### A2 AiChatPanel 拆分（P0，治最大技术债）

- 目标结构（新目录 `src/components/workstation/`，旧文件变 re-export 壳，调用方零改动）：
  ```
  workstation/
    WorkstationPanel.jsx     容器 + 三区布局
    ConversationPane.jsx     消息流（现 ToolCards 归此）
    ResultsPane.jsx          A1 的结果区
    Composer.jsx             输入区 + 模式徽章(B2) + 附件/拖拽
    ApprovalOverlay.jsx      审批卡（portal+fixed，复用 popoverPosition）
  ```
- **纪律**（两次连环事故教训）：同文件串行编辑；每拆一个文件立即跑 `node node_modules/vitest/vitest.mjs run` 相关用例 + build；收尾跑「使用 vs 导入」交叉核对脚本；新增标识符先 import 后使用不分离。
- 顺序：先拆 ApprovalOverlay（依赖最少）→ Composer → ConversationPane → ResultsPane（依赖 A1）→ 容器。

### A3 styles.css 域拆分（P0，治卡顿）

- 27883 行按域拆为 `src/styles/` 多文件：`tokens.css / base.css / components-*.css / pages-*.css / aichat.css / stock.css / profile.css / overlays.css`，main.jsx 引入顺序 **锁定常量文件** `src/styles/order.js`（styles→themes→hud-theme→polish→studio-theme→onboarding→entrance→motion 语义不变，仅文件化）。
- 拆分机械规则：按现有注释分节整体搬移，**不改任何选择器/优先级/顺序语义**；拆完 build + Playwright 视觉探针（登录页/资讯/工作站/股票四页截图对比）。
- 顺手治理：`#xxx` 冷色化→`var(--accent-*)` 只在搬迁到的文件里做局部替换，不做全仓一次性大改（风险隔离）。

### B1 提示词 Fragment 系统（P1）

- `src/components/aichat/prompts/fragments/`：`agent-loop.md.js / tool-use / untrusted-policy / memory-context / persona / plan-mode / result-presentation / current-mode.*`，每个导出字符串模板 + `{{变量}}` 占位。
- buildSystemPrompt 变拼装器：按「交互模式 × 工具白名单 × 记忆可用性 × plan 状态」条件拼装；**untrustedDataPolicyText 与安全段无条件注入，不参与条件化**（对抗性结论：安全段一旦可被"模式"关掉，就是绕过面）。
- 单测：断言任意组合下安全段存在、总长 ≤ 60k 网关上限、变量替换无残留 `{{`。

### B2 交互模式档位（P1）

- 三档映射现有能力：**快捷**（Elf 同级：分析/查证白名单）/ **计划**（plan→approve/edit/abort 闭环已有）/ **深度**（全工具 + subagent/team）。
- UI：输入框上方小徽章显示当前档位（HUD 风格，符合现有视觉），快捷键 Ctrl+1/2/3。
- 价值：把"工作站很强但用户不知道能调"的感知问题解决掉——WorkBuddy 的模式徽章是低代码量高感知的对齐点。

### B3 自动化面板（P1）

- 后端 agentJobsService 已有 cron 驱动 + agentContext 注入画像，缺的是：任务 CRUD 端点暴露（agentJobsHandlers 已有部分）+ 前端面板。
- UI：设置内新 Tab「自动化」：任务列表（下次执行时间/上次结果/启停）+ 新建向导（自然语言描述 → LLM 解析为 {schedule, prompt, 工具白名单} → 用户确认）。
- **护栏（对抗性结论）**：每用户任务数上限（如 5）+ 单次 token 预算 + 失败连续 3 次自动停用 + 通知落 agent_memories 而非弹窗轰炸。

### B4 Skills 对齐（P1）

- 定 `SKILL.md` 规范：frontmatter（name/description/triggers/tools 白名单）+ 正文（渐进披露：加载时只读 frontmatter，触发后读正文）。
- 目录：workspace 级 `<repo>/skills/` + 用户级（PG agent_skills），skillLoader 增加"两级合并 + 命名冲突时 workspace 优先"。
- create_skill 工具写文件改为写新格式；**审慎**：createSkillDirect 静默通道保持仅内核可用（记忆：闸门在 executeTool 层）。

### C1 记忆蒸馏（P1）

- server/cron 新 job（并入现有 06:00 预热调度，不新建调度器）：>30 天的 agent_memories 事件型记忆 → LLM 摘要合并进 personaSummary / learned_preferences，原条目标记 archived。
- 注入限额：buildSystemPrompt「相关记忆」段 cap（如 8 条/2000 字符），超出走相关性排序截断——防上下文被记忆撑爆（48k 预算是硬约束）。

### C2/C3/C4 安全三件套（P1）

- **审计**：`audit_log` 表（迁移 013：user_id/action/target/ip/ua/created_at）；埋点=登录/登出、requiresApproval 工具执行（含 deny 结果）、上传、导出、MCP mcp_call；查询端点仅本人，写入失败不影响主流程（try/catch 包裹）。
- **apiKey 加密**：`server/security/crypto.js`（AES-256-GCM，密钥取 env `MERIDIAN_SECRET`，缺失时启动警告并退回拒绝写入而非明文）；迁移策略：读到旧明文 → 加密写回（读时升级）；`/api/profile/llm-config` GET 返回 `sk-***last4` 掩码，测试连接走服务端代理不回传原文。
- **CSP**：index.html meta 或生产 server 中间件：`default-src 'self'` + script 严格 + style/style-src 允许 'unsafe-inline'（现网 CSS-in-JS 兼容）+ connect-src 含 LLM 网关域名列表；dev 模式不启用（Vite HMR 需宽松）。img-src 含远程新闻图域名或走已有图片代理。

### D1 进程稳定性加固（P1，用户点名项）

**前端不卡顿**：
- App.jsx 2748 行：继续把 `generateDailyBriefing` / `intelligenceProfile` / `buildWorkbenchContext` 三个大 useMemo 移入 domain 纯函数（已具备测试基础）。
- 长列表：NewsPage/推荐流已分页，确认无一次渲染 >100 节点；ToolCards 历史消息超 50 条进虚拟化（react-window 级别手写即可，勿引重依赖）。
- GlobeView/StockPage 已 lazy，保持；`clockNow` 类高频 state 不进轮询 effect 依赖（既有教训固化）。

**后端不崩不泄**：
- productionServer.js：`process.on('unhandledRejection'/'uncaughtException')` 记日志不退出（uncaughtException 记录后按策略优雅重启，先落盘再 exit(1) 交给守护重启）；graceful shutdown（SIGTERM → 停调度器 → 关 pg Pool）。
- `GET /api/health`：返回 {db, scheduler, memory 水位（itemPool 条数）, uptime}，供外部探活/守护重启。
- sourceScheduler 退避已有 ≤16x，补：单源抓取超时已有——加**全局并发队列水位日志**（连续 >80% 持续 5min 打 warning）。
- 部署文档补一行守护方案：Node 直接跑时配 PM2 或 systemd/Docker restart policy（Docker 已有，补 healthcheck 字段）。

### D2-D5（P2 择机）

- D2 SQLite 降级：node:sqlite（Node 22 需 flag）/better-sqlite3 权衡后选型；**单仓储接口切换实现，绝不双写**（对抗性结论：双写必漂移）；收益场景=单机部署 + dev 数据不丢。
- D3 内联 Widget：iframe `sandbox="allow-scripts"` + srcdoc + 严格 CSP，只渲 agent 自产 SVG/Chart 配置，外部 HTML 不进（untrusted 同级防线）。
- D4 审批记忆：toolRegistry approvalOverride 已有 localStorage 版 → 升级为服务端 per-user 持久化 + 「本次会话允许」/「永久允许」/「仅此一次」三选项（对齐 mcp-approvals 语义）。
- D5 Connectors 面板：mcpRegistry 状态可视化 + 凭证过期提醒 + 免审工具列表说明。

---

## 五、对抗性审查记录（节选 P0/P1）

| # | 攻击/风险 | 触发条件 | 破坏 | 缓解 | 级别 |
|---|---|---|---|---|---|
| 1 | 产物端点越权读取 | 伪造/枚举 uuid | 数据泄露 | 服务端 session 归属校验 + uuid 不可枚举；列表端点必带鉴权 | P0→已缓解 |
| 2 | 结果区 XSS | agent 产出含脚本的 HTML 预览 | 会话劫持 | 预览走与 D3 同级 sandbox/白名单渲染，报告类先转 Markdown 安全渲染（复用 markdown.jsx 转义链） | P0→已缓解 |
| 3 | 拆分期运行时 ReferenceError | import 与调用分批提交 | 白屏 | 每小步 build+vitest；收尾交叉核对脚本；单文件串行编辑 | P0→已缓解 |
| 4 | CSS 拆分引入顺序错乱 | 手滑调整 import 顺序 | 全站视觉回归 | 顺序常量文件 + 视觉探针四页截图 | P0→已缓解 |
| 5 | 安全提示词段被模式条件关掉 | 新增"轻量模式"漏配 | 注入面复活 | B1 中安全段无条件注入 + 单测断言 | P1→已缓解 |
| 6 | 自动化任务 LLM 成本失控 | 任务循环触发任务 | 账单/额度 | 任务数上限 + token 预算 + 连败熔断；任务不能创建任务（白名单无 spawn） | P1→已缓解 |
| 7 | apiKey 迁移竞态 | 多设备同时读到旧明文 | 覆盖丢失 | 读时升级用 `UPDATE ... WHERE config=旧明文` 乐观条件写 | P1→已缓解 |
| 8 | CSP 破坏现有功能 | 第三方图床/LLM 域名被拦 | 图片/网关不可用 | 上线前 grep 现有外域清单 + report-only 模式观察一周再 enforce | P1→已缓解 |
| 9 | unhandledRejection 吞错导致静默坏数据 | DB 写失败被兜底 | 数据不一致 | 兜底只记日志+告警指标，写路径的事务/回滚语义不因兜底改变 | P1→已缓解 |
| 10 | SQLite 双写漂移 | 同时启用内存+SQLite | 脏数据 | 单仓储实现切换开关，禁止并存 | P2→设计规避 |

**钢人论证（两个反方）**：
- 反方：「WorkBuddy 是桌面产品，任务制/结果区照搬到 Web 是抄模式。」→ 钢化后仍成立：WorkBuddy 核心不是桌面壳，而是"任务→交付物→验收"的产品契约；Vercel v0、Claude Artifacts 在 Web 上已验证同一范式，且本项目定位"个人智能与创作 OS"本身要求产物沉淀层。**裁决：采纳 A1，做差异化（产物↔素材库闭环）。**
- 反方：「styles 拆分风险大收益低，不如不动。」→ 钢化后不成立：27883 行单文件已在拖 HMR 与维护，且拆分规则是纯机械搬移+顺序锁定+截图探针，风险可控；不拆的成本（每次改样式全量 diff、HMR 变慢）是持续复利支出。**裁决：采纳 A3。**

---

## 六、实施路线（批次建议）

| 批次 | 内容 | 验证闸门 |
|---|---|---|
| **批 1（P0）** | A1 产物中心后端（表+端点+注册器+单测） | build + vitest + 新端点 curl 探针 |
| **批 2（P0）** | A2 拆分（ApprovalOverlay→Composer→ConversationPane）+ A1 结果区 UI | 三件套 + Playwright 工作站流程探针 |
| **批 3（P0）** | A3 styles 拆分（机械搬移 + 顺序锁）+ C4 CSP(report-only) | build + 四页截图对比 + 现网观察 |
| **批 4（P1）** | B1 Fragment 化 + B2 模式徽章 + C2 审计 | vitest（安全段断言）+ 审计埋点自测 |
| **批 5（P1）** | C3 apiKey 加密 + D1 进程加固 + B3 自动化面板 | 迁移测试 + health 探针 + 熔断单测 |
| **批 6（P1）** | B4 Skills 规范 + C1 记忆蒸馏 | 渐进披露单测 + 蒸馏 job 干跑 |
| **批 7+（P2）** | D2/D3/D4/D5/E1 按需排期 | 各自独立闸门 |

**关键决策记录（为什么 A 不选 B）**：
- 产物存储选「PG 表 + 引用」不选「直接复用上传 bytea」：产物是元数据密集型（kind/task/preview），bytea 大对象入库会让列表查询变重；引用文件系统/上传通道更贴合现有 uploads 双仓储模式。
- Fragment 化选「JS 模块字符串」不选「.md 文件 + 运行时加载」：本项目是纯 Vite SPA（无 Node 运行时读盘条件，serverless 环境更无文件系统），JS 模块可 tree-shake、可单测；WorkBuddy 用 .md 是因为它有本地文件系统特权。
- 自动化选「复用 agentJobsService」不选「新建 RRULE 引擎」：现有 cron 调度 + agentContext 已覆盖 80% 需求，自建调度器违背"先自己想办法"——把 cron 表达式简化为前端预设档（每日/每周/自定义小时）即可。
