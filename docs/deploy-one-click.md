# 一键部署

本文只讲「把它跑起来」的三条路径，以及跑起来之后怎么确认它是真的活着。
架构与功能见 [../README.md](../README.md)，完整参数细节见 [../DEPLOYMENT.md](../DEPLOYMENT.md)。

---

## 路径 A：Docker 全栈一键部署（推荐，应用 + PostgreSQL 一起起）

```bash
git clone https://github.com/pyf2818/siliconstream.git
cd siliconstream
bash scripts/docker-deploy.sh
```

`scripts/docker-deploy.sh` 会依次完成：

1. 校验 Docker 与 compose（**优先 `docker compose` v2，回退 `docker-compose` v1**）
2. 缺 `.env` 时自动生成一个随机 `DB_PASSWORD` 并写入（`.env` 不入库）
3. 检查 `APP_PORT`（默认 **80**）与 `POSTGRES_PORT`（默认 **5433**）是否被占用
4. `compose build` → `compose up -d`
5. 轮询 `http://127.0.0.1:${APP_PORT}/health` 直到应用就绪，并打印容器状态

非交互场景（CI、首次跑通）：

```bash
ASSUME_YES=1 bash scripts/docker-deploy.sh
```

**数据库表由容器启动时自动创建**：镜像的启动命令是
`node server/db/migrate.js && node server/productionServer.js`，不需要手工执行迁移。

改端口：编辑 `.env` 里的 `APP_PORT` / `POSTGRES_PORT` 后重新执行脚本即可。

> 注意：`DB_PASSWORD` 是 compose 的必填项（Postgres 初始化密码）。
> 直接裸跑 `docker compose up -d` 而不设置它，数据库容器会起不来——
> 这正是走脚本而不是手敲 compose 的原因。

---

## 路径 B：Node 生产服务（不用 Docker，自己管 Postgres）

```bash
npm install
cp .env.example .env        # 填 DATABASE_URL / DATABASE_SSL
npm run db:migrate          # 建表（首次或迁移后执行）
npm run build               # 产出 dist/
npm start                   # dist/ + 完整 /api/*，默认 :3000（PORT 可改）
```

该路径提供**完整接口面**：认证、社区、画像、创意、智能体等需要长驻连接的模块都能用。

---

## 路径 C：Serverless（Vercel 等）

`api/*.js` 已提供资讯、趋势、GitHub、信源发现、AI 生成等无状态接口。
构建产物为 `dist/`，函数入口在 `api/`。

- 在平台侧配置 `DATABASE_URL` 等环境变量（同下面的表）
- **认证 / 社区 / 画像 / 创意同步等依赖长驻 PostgreSQL 会话的模块不建议放在 Serverless**，
  请改用路径 A 或 B
- Serverless 环境下没有常驻抓取调度器，资讯由请求路径直接采集（官方结构化 API 源已内置）

---

## 环境变量

从 `.env.example` 起步。以下变量名与代码中实际读取的一致（可直接 grep 核对）。

### 基础

| 变量 | 说明 | 必需 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串。**缺失时认证/社区/画像接口返回 503，其余功能正常** | 用 DB 功能时 |
| `DATABASE_SSL` | `"true"` 启用 SSL 连接 | 云数据库常需 |
| `NODE_ENV` | 生产环境设为 `production` | 生产必需 |
| `PORT` | Node 服务的监听端口，默认 `3000` | 否 |
| `DB_PASSWORD` / `APP_PORT` / `POSTGRES_PORT` | Docker 路径使用（compose 读取） | Docker 路径必需 |

### 抓取与联网搜索（全部可选，缺省自动降级）

| 变量 | 说明 |
| --- | --- |
| `SCRAPLING_URL` | Scrapling 抓取服务地址（默认尝试 `:5000`）；未启动时走直接请求 + RSS |
| `TAVILY_API_KEY` / `DOUBAO_SEARCH_API_KEY` | 联网搜索的付费通道；不配则走免密钥回退源 |
| `RSSHUB_BASE` | 自建 RSSHub 实例地址；不配则用公共实例（公共实例不稳定时建议自建） |
| `GITHUB_TOKEN` / `VITE_GITHUB_TOKEN` | 提高 GitHub API 额度（趋势榜 / Releases 源） |
| `GDELT_VERIFY=off` | 停用事件的 GDELT 交叉验证 |

### 安全与出站控制（生产建议显式配置）

| 变量 | 说明 |
| --- | --- |
| `AI_ALLOWED_HOSTS` | AI / 抓取出站白名单，如 `api.openai.com,api.deepseek.com` |
| `AI_ALLOW_PRIVATE_NETWORK` | 默认 `false`（私网地址一律拦截）。连本地 Ollama 等才设为 `true` |

### 服务端默认模型与集成

| 变量 | 说明 |
| --- | --- |
| `DEFAULT_LLM_BASE_URL` / `DEFAULT_LLM_MODEL` / `DEFAULT_LLM_API_KEY` | 快照预热等后台任务使用的默认模型 |
| `AGENT_LLM_CONFIG` | 智能体任务的模型配置覆盖 |
| `MCP_CONFIG_PATH` | MCP 配置路径（默认项目根 `mcp.config.json`，也读 `~/.workbuddy/mcp.json`） |

### 仅开发 / 测试用（**不要在生产开启**）

| 变量 | 说明 |
| --- | --- |
| `DEV_MEMORY_AUTH=true` | 走进程内内存认证仓储（**仅非 production 生效**），用于无 DB 调试认证 |
| `SILICON_E2E=1` | 让资讯接口返回 E2E 固定夹具 |
| `TEST_DATABASE_URL` | `npm run test:e2e` 使用的测试库连接串 |

---

## 部署后自检

```bash
# 1. 健康检查（Docker 路径：端口用 .env 里的 APP_PORT）
curl -fsS http://127.0.0.1:80/health
# → {"ok":true,"service":"siliconstream"}

# 2. 平台连通性自检（Node / Docker 均可用）
npm run verify:platform

# 3. 接口冒烟：资讯
curl -fsS "http://127.0.0.1:3000/api/news?page=0&pageSize=5" | head -c 400
```

期望：`/health` 返回 `ok:true`；资讯接口返回 `items` / `total` / `hasMore`；
未配置 `DATABASE_URL` 时认证类接口返回 **503**（这是预期降级，不是故障）。

---

## 常见问题

**应用起来了但接口全是 503**
缺 `DATABASE_URL`。补上后重启；若刚建库，先跑 `npm run db:migrate`。

**数据库容器反复重启**
`DB_PASSWORD` 为空，或端口 5433 被本地已有 Postgres 占用。改 `.env` 里的 `POSTGRES_PORT`。

**构建/端口相关**
生产端口是容器内的 `3000`，宿主端口由 `APP_PORT` 决定（默认 80），两者不是一回事。

**前端能开、数据是空的**
首次启动是冷启动，抓取需要时间；也可先配好模型与信息源再观察。未配置大模型时，
今日情报与股市分析会走内置确定性算法，这是预期行为。

**抓取大量失败**
公网 RSS 源本身会超时、限流、改版，冷启动首轮失败属正常；
`GITHUB_TOKEN` 未配置时 GitHub 类源更容易被限流。
