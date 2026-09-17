# 贡献指南

感谢你愿意花时间改进 Silicon Meridian。这份文档只讲**怎么在本仓库高效地改代码**，
产品定位与功能全景见 [README.md](./README.md)，架构与端点清单见 [CLAUDE.md](./CLAUDE.md)。

## 1. 环境准备

| 依赖 | 版本 | 是否必需 |
| --- | --- | --- |
| Node.js | `20.19+` 或 `22.12+` | 必需 |
| npm | `10+` | 必需 |
| PostgreSQL | `15+`（或用 Docker 起） | 需要认证 / 社区 / 画像等模块时 |
| Python | `3.11+` | 可选（仅 Scrapling 抓取增强） |

```bash
git clone https://github.com/pyf2818/siliconstream.git
cd siliconstream
npm install
cp .env.example .env      # 至少填写 DB_PASSWORD 与 DATABASE_URL

docker compose up -d postgres   # 本地起库（宿主端口默认 5433）
npm run db:migrate              # 建表
npm run dev                     # http://localhost:5175
```

**端口约定**：dev `5175`、E2E `5176`、生产 `3000`。`npm run dev` 会同时挂载 API middleware，
`vite preview` 只有静态文件、没有 API，别用它验证接口。

**没有数据库也能开发**：缺少 `DATABASE_URL` 时，认证/社区/画像接口返回 503，其余功能正常。
仅认证调试可用 `DEV_MEMORY_AUTH=true`（**只在非 production 生效**，走进程内内存仓储）。

## 2. 常用命令

```bash
npm run dev              # 开发服务器（0.0.0.0:5175，含 API middleware）
npm run build            # 生产构建 → dist/
npm test                 # Vitest 单测
npm run test:integration # 集成测试
npm run test:e2e         # Playwright E2E（脚本会自起 5176 的 vite）
npm run verify:platform  # 平台连通性自检（DB + 服务）
npm run preheat:today    # 手动触发今日推荐快照预热
npm start                # 生产服务：dist/ + 完整 /api/*，默认 :3000
```

### Windows 上的两个坑

- `npx vitest` 会因 bin 符号链接未创建而失败，用
  `node node_modules/vitest/vitest.mjs run [file]`。
- **vitest 固定在 3.x**：4.x 在当前环境有 rolldown 绑定问题，升级前请先跑通全量测试。

## 3. 代码约定

- **仅 ESM**：`package.json` 是 `"type": "module"`，一律 `import`，不要 `require()`。
- **仓库没有 lint / typecheck / formatter 命令**。代码风格靠约定与 code review 维持，
  提交前请自行确认无语法与引用错误（`npm run build` 能查出大部分）。
- **纯逻辑进 `src/domain/`**：domain 子树不允许出现 React、DOM 与 HTTP，
  这样它能在 node 环境下被单测原地覆盖。
  已有的域：`intelligence`、`stock`、`creative`、`agent`。
- **服务端 handler 只写一份**：`server/http/*Handlers.js` 同时被 dev 中间件
  （`server/news/plugin.js`）与 Serverless 入口（`api/*.js`）复用。
  改接口时改共享 handler，不要两边各改一遍。
- **身份/ID 类比较统一走 helper**：`src/utils/itemIdentity.js` 提供
  `canonicalItemId` / `matchesItemId` / `canonicalSpaceId` / `matchesSpaceId`。
  不要对 ID 做 `Number()` 强转（历史上把 `space-<uuid>` 转成 `NaN`，
  导致素材空间筛选整体失效）。

## 4. 测试要求（提交前必做）

```bash
node node_modules/vitest/vitest.mjs run   # 1. 全量单测：必须全绿
node node_modules/vite/bin/vite.js build  # 2. 生产构建：0 错误
# 3. 涉及 UI 链路时，跑对应 Playwright 探针 / e2e spec
```

三条都通过再提交。当前基线：**1072 个用例 / 105 个文件全绿**（2026-09-14）。

### 写测试的几条经验（都是踩过坑换来的）

- **回归证明优先写进断言**，而不是 `git checkout` 回旧版本再跑：
  工作区经常有未提交改动，`git checkout -- <file>` 会直接冲掉它们。
  推荐把「旧表达式」本身钉进用例，例如断言
  `items.filter(m => m.spaceId === Number(filter))` 对 `space-xxx` 恒为空。
- **错误边界会吞掉崩溃**：只监听 `pageerror` 会漏掉被 ErrorBoundary 捕获的错误。
  探针要同时收 `console` 事件，并断言「组件根元素存在 + 无降级卡片」。
- **别在 state updater 里写副作用**：本项目开启了 `<React.StrictMode>`，
  updater 会被调用两次；在 updater 内推回收站/发通知都会重复执行。
  副作用放在事件处理器里，updater 只做纯计算。
- **E2E 定位用机器的锚点**：侧栏是图标化的、文案会随 i18n 变化，
  导航请用 `[data-nav="..."]`（与 `<main data-nav="...">` 同一套标识），
  不要用中文文案 `getByText('动态')`。

## 5. 提交与 PR

- 提交信息建议带范围前缀，例如 `fix(news):`、`feat(intelligence):`、`docs:`、`chore:`。
- **pre-commit 钩子会自动重写 `CLAUDE.md`**：每次 commit 后工作区必然多出
  `M CLAUDE.md`，请用一次独立的 `docs: sync CLAUDE.md` 提交收尾，**不要 amend** 进功能提交。
- PR 请说明：改了什么、为什么这么改、怎么验证的（命令 + 结果）、有无已知遗留。
- 不要提交以下本地产物：`.m.json` / `.ml.json` / `.pw-*`（Playwright 输出目录）/
  `screenshots/_dbg_*.mjs` / `scripts/*-debug.mjs`。
- 新增依赖请说明必要性；能落在现有依赖上的改动优先不动依赖树。

## 6. 安全

发现安全漏洞**不要开公开 Issue**，请走 [SECURITY.md](./SECURITY.md) 的私密上报流程。
提交代码时不要带任何真实密钥；`mcp.config.json` 里的 `env` 尤其容易夹带令牌。
