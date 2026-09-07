<div align="center">

# SiliconStream · 万般硅川

**个人智能情报与创作 OS —— 资讯聚合 × 卫星态势大屏 × AI 工作站 × 智能体画布 × 社区协作**

[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Node](https://img.shields.io/badge/Node-20%20%7C%2022-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-763%20passing-3fb950)](../../actions)
[![MapLibre](https://img.shields.io/badge/globe-MapLibre%20GL%20v6-1e88e5)](https://maplibre.org)

*将公开 RSS/Atom 资讯、GitHub 趋势、A 股行情、用户画像、AI 分析、创作资产与真实社区整合进一个工作台。未配置大模型时使用确定性算法驱动，接入 OpenAI 兼容模型后获得增强智能。*

</div>

---

## ✨ 功能全景

### 🧠 智能内核
| 模块 | 能力 |
| --- | --- |
| **AI 工作站**（首页） | 多专业 Agent 深度工作台：ReAct 循环、工具编排、`set_plan` 计划执行、子智能体派生（spawn_subagent）与多智能体协作团队（spawn_agent_team，共享任务清单 + 邮箱通信） |
| **AI 精灵** | 全站轻量助理：任意页面快速问答，拖入资讯/股票/代码/GitHub 卡片即席分析，产出可一键移交工作站深做 |
| **今日情报 & 精准推荐** | 新鲜度/热度/信源等级/个人画像四维评分；快照预热、日历时间线、评分组成与推荐原因全透明 |
| **学习型画像** | 领域与信源分层、特别关注、行为信号回流推荐（学习兴趣 +12/项），画像置信度与乐观锁同步 |
| **MCP 集成** | 原生 Model Context Protocol 客户端：stdio / HTTP 双传输，`list_mcp_tools` / `mcp_call` 工具直达 Agent 循环 |

### 📊 情报与市场
| 模块 | 能力 |
| --- | --- |
| **全球态势大屏** | 卫星级真实地球 + 资讯地理聚合 + 两级弹窗钻取 + 指挥中心氛围（详见下文亮点） |
| **全部动态** | 255+ 硬编码信源（S/A/B/C/D 分级轮询、失败退避、自动降档），分类/地区/模式/关键词/信源多维过滤 |
| **股市动向** | A 股搜索、自选股、实时行情、分时、K 线、板块排行；**AI 大师双引擎**（MACD/RSI/KDJ 技术面 + 「老舵主」人设盘感输出） |
| **GitHub 热门** | 日/周/月榜与语言筛选、增量 Star、主题标签、AI 情报速读 |

### 🎨 创作与协作
| 模块 | 能力 |
| --- | --- |
| **智创空间 & 无限画布** | 素材库、文章编辑、引用管理、版本保存；画布式智能体工作流——并行扇出（真实并发多视角）、路由分发、知识库读写、画布引擎与节点级差异化面板 |
| **团队群聊 & 联系人** | 好友私聊、群组协作、续火花 streak、从社区发现好友、消息持久化 |
| **用户广场** | 真实账户、发布/评论/点赞/收藏/关注，PostgreSQL 持久化 |
| **用户画像中心** | 战斗机 HUD 风格仪表盘：领域兴趣、信源分层、行为信号、置信度演进 |

---

## 🖼 界面预览

| AI 工作站（首页） | 全球态势大屏 · 卫星地球 |
| --- | --- |
| ![AI 工作站](public/screenshots/main-interface.png) | ![全球态势大屏](public/screenshots/globe-view.png) |

| 大屏两级资讯钻取 | 全部动态（255+ 信源） |
| --- | --- |
| ![大屏弹窗](public/screenshots/globe-popup.png) | ![全部动态](public/screenshots/all-news.png) |

| 股市动向（K 线 + AI 大师） | GitHub 热门 |
| --- | --- |
| ![股市动向](public/screenshots/stock-analysis.png) | ![GitHub 热门](public/screenshots/github-trending.png) |

| 无限画布（智能体工作流） | 团队群聊 |
| --- | --- |
| ![无限画布](public/screenshots/creative-canvas.png) | ![团队群聊](public/screenshots/team-chat.png) |

| 用户画像中心（HUD 风格） | AI Copilot |
| --- | --- |
| ![用户画像](public/screenshots/profile-center.png) | ![AI Copilot](public/screenshots/ai-elf-interface.png) |

### 🌍 全球态势大屏亮点

- **卫星级真实地球** —— MapLibre GL globe 投影 + ESRI World Imagery 流式瓦片，滚轮一路推到 z18 城市/街区级卫星影像，闲置自动巡航（贴地暂停防晕）
- **内容级地理定位** —— 三级判定链：标题关键词 → 正文前 400 字 → 来源映射兜底；40+ 科技城市中英文/别名/地标词库（「硅谷/湾区→旧金山」「光谷→武汉」），热点分布精准到**事件发生地**而非来源注册地
- **两级资讯钻取** —— 点击点位弹出锚定小窗（rAF 实时跟随投影、转到背面自动隐藏、贴顶自动下翻），点条目进入内联正文预览，访问不了才「查看原文」
- **指挥中心氛围** —— 星空粒子、大气辉光（setSky）、双雷达光环、扫描线、实时热点光带 ticker（呼吸辉光 + 掠过高光）、七日趋势与赛道分布面板

---

## 🏗 技术架构

- **前端**：React 19、Vite 7、Tailwind CSS 3、原生 CSS 设计系统（多主题多调色板，语义/图表色跨调色板固定）
- **可视化**：MapLibre GL（卫星地球大屏）、KLineCharts（A 股图表）、Three.js
- **Agent 层**：共享循环内核（工作站 / 精灵复用）、工具运行时注册、沙盒审批网关、多智能体编排、MCP 客户端
- **Node API**：Vite middleware 直挂 `/api/*`（dev）与共享 handler（Vercel Serverless 复用同一套）
- **数据层**：PostgreSQL 15——事务迁移、画像版本控制、社区持久化、快照对账（服务端权威 + 本地降级）
- **资讯管线**：分级轮询调度（S=15min/A=30min/B=1h/C=3h/D=6h，失败指数退避封顶 16×、连续 4 败降档）、持久化条目池（7 天 TTL）、聚类事件 upsert、源亲和度反哺采集
- **抓取增强**：可选 Scrapling Flask 服务（basic / dynamic / stealth）

```text
Browser
  ├─ React 19 App（React.lazy 代码分割：大屏 / 精灵 / 股市页）
  └─ /api/*
       ├─ Node API + 领域服务（news / intelligence / profile / community / agent / mcp / skills / cron）
       ├─ PostgreSQL 15（认证 · 画像 · 社区 · 快照）
       ├─ RSS / GitHub / 行情数据源（255+ 信源分级调度）
       ├─ OpenAI 兼容模型网关（可选，含 SSRF 防护）
       └─ Scrapling 抓取服务（可选）
```

---

## 🚀 快速开始

### 环境要求

- Node.js `20.19+` 或 `22.12+`、npm 10+
- PostgreSQL 15+（或使用 Docker 启动）
- Python 3.11+（仅在启用 Scrapling 时需要）

### 本地开发

```bash
git clone https://github.com/pyf2818/siliconstream.git
cd siliconstream
npm install
cp .env.example .env
```

修改 `.env` 中以下两项（密码保持一致）：

```dotenv
DB_PASSWORD=replace_with_a_long_random_password
DATABASE_URL=postgresql://meridian:replace_with_a_long_random_password@localhost:5433/silicon_meridian
DATABASE_SSL=false
```

启动数据库、执行迁移并运行：

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev        # http://localhost:5175
```

> 首次进入可使用「体验模式」一键登录，无需注册。

### 可选：Scrapling 抓取增强

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt && scrapling install
python scrapling_server.py                          # :5000，/api/scrape 自动代理
```

未启动时系统以直接请求 + RSS 降级运行，不影响主流程。

### 🤖 AI 模型配置

在应用「设置 → AI」填写 OpenAI 兼容接口的 Base URL、模型与 API Key。未配置时，今日情报、精准推荐和股市分析自动使用内置确定性算法。

生产环境建议：

```dotenv
AI_ALLOWED_HOSTS=api.openai.com,api.deepseek.com
AI_ALLOW_PRIVATE_NETWORK=false
```

AI 与抓取网关内置请求体限制、超时、频率限制、私网拦截、DNS 校验与重定向阻断；开发环境连本地 Ollama 可显式设 `AI_ALLOW_PRIVATE_NETWORK=true`。

### 🔌 MCP 扩展

项目内置 MCP 客户端。在项目根 `mcp.config.json`（或 `~/.workbuddy/mcp.json`）声明服务器即可让 Agent 直接调用外部工具：

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } }
  }
}
```

---

## 🧪 测试与质量

```bash
npm run test              # Vitest 单测：763 个用例全绿（domain 纯逻辑引擎 / stores / hooks / utils / server）
npm run test:integration  # 集成测试
npm run test:e2e          # Playwright E2E
npm run verify:platform   # 平台连通性自检（DB + 服务）
```

另附探针脚本（`screenshots/_probe_*.mjs`）对大屏等关键链路做真实浏览器断言：真实鼠标命中点击、瓦片网络层校验、深度缩放存活检查。

---

## 📦 生产部署

```bash
npm run build
npm start          # dist/ + 完整 /api/*，默认 :3000（首次需先 db:migrate）
```

**Docker Compose**：`docker compose up --build -d`（启动时自动迁移；`APP_PORT` 可改宿主端口，`SCRAPLING_URL` 指定抓取服务）。

**Vercel**：`api/` 提供资讯、趋势、GitHub、信源发现、AI 生成等 Serverless API；认证/社区/画像等需要长驻 PostgreSQL 的模块建议使用 Docker/Node 完整部署。

---

## 🔌 主要 API

| Endpoint | Method | 说明 |
| --- | --- | --- |
| `/api/news` | GET | 聚合资讯、搜索、分页与个性兴趣过滤 |
| `/api/meta` | GET | 分类、模式、信源与分级元数据 |
| `/api/trending` · `/api/github-trending` | GET | 多平台热点 · GitHub 日/周/月榜 |
| `/api/stock/*` | GET | 行情、K 线、分时、搜索与板块 |
| `/api/intelligence/*` | GET | 聚类事件、画像化推荐 |
| `/api/auth/*` | GET/POST | 注册、登录、会话与退出 |
| `/api/community/*` | GET/POST/PATCH/DELETE | 动态、评论、点赞、收藏与关注 |
| `/api/profile/*` | GET/PUT | 用户画像读取、版本化保存与快照 |
| `/api/agent/mcp/*` | GET/POST | MCP 服务器发现、工具列表与调用 |
| `/api/ai-generate` | POST | 对话、摘要、改写、翻译与创作 |
| `/api/verify-source` · `/api/discover-source` | GET | 信源验证 · 订阅地址自动发现 |

---

## 📁 项目结构

```text
src/
  App.jsx                    主应用编排（页面组合 / 路由 / 设置）
  components/                业务组件（aichat 工作站 / aielf 精灵 / 大屏等）
    aichat/                    Agent 循环内核 · 系统提示 · 子智能体运行器
  domain/                    纯逻辑引擎（团队协作 · 子智能体 · 工作流），单测就地覆盖
  store/                     12 个 Zustand store（persist 中间件）
  hooks/                     数据与交互 Hook
  shell/ · blocks/           Shell→Page→Block 三层 UI 体系（飞书式）
  GlobeView.jsx              全球态势大屏（MapLibre 卫星地球 + 两级弹窗）
  i18n/                      中英文国际化
server/
  news/                      分级调度器 · 条目池 · RSS/趋势/GitHub/股市服务
  agent/ · mcp/ · skills/    服务端 Agent 层 · MCP 客户端 · 技能注册
  http/                      认证/社区/画像/AI/抓取共享处理器（dev 与 serverless 复用）
  db/                        PostgreSQL 客户端与迁移
api/                         Vercel Serverless 入口
screenshots/                 探针与截图生成脚本
public/screenshots/          README 截图
scrapling_server.py          可选网页抓取服务
```

---

## 🔐 数据与隐私

- 账户、社区、画像、推荐快照与创作版本存于 PostgreSQL；UI 偏好与未登录素材存于浏览器本地。
- 认证采用不透明随机 Token + 服务端 Session 表（HttpOnly Cookie），密码使用 Node 内置 scrypt 哈希。
- AI Key 仅用于用户主动发起的模型请求；生产部署应使用可信 HTTPS 模型网关。
- `.env`、密钥、数据库密码、依赖目录与构建产物均被 `.gitignore` 排除。

## ⚠ 当前边界

- GitHub 未认证请求受官方速率限制，建议服务端配置 Token。
- 部分中文站点有反爬策略，Scrapling 提高成功率但不能保证所有来源可用。
- 卫星瓦片来自 ESRI 公共服务，弱网或受限网络下首屏加载可能较慢。
- Vercel 部署不包含需要长驻 PostgreSQL 的完整账户与社区能力。

## 📄 许可证

本仓库当前未附加开源许可证。未经项目所有者明确授权，不授予复制、修改或分发权利。
