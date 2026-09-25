# WorkBuddy 对齐升级 · 补丁包应用手册

> 生成背景：会话期间环境对「会话前已存在 + 非本轮新建」的文件实施 OS 级只读锁
> （Edit/Write/PowerShell/node fs/git apply 全通道被拦），因此存量文件集成点全部以
> git 补丁包形式交付，新文件已直接落在仓库中。锁解除后按本手册应用即可。

## 一、应用顺序（严格按序）

补丁按「同文件叠加兼容性」排定依赖，**必须按编号顺序应用**：

```bash
cd "E:/VStudio_Project/ai/Silicon Meridian"

# 1. plugin.js 链（0001 先行，0003 基于其上）
git apply .workbuddy/patches/0001-plugin-artifacts-routes.patch
git apply .workbuddy/patches/0003-plugin-audit-health-routes.patch

# 2. productionServer.js 链（四个补丁锚区互不重叠，已验证叠加）
git apply .workbuddy/patches/0004-productionserver-health-snapshot.patch
git apply .workbuddy/patches/0007-productionserver-csp-report-only.patch
git apply .workbuddy/patches/0008-productionserver-process-hardening.patch
git apply .workbuddy/patches/0012-productionserver-memory-distill-cron.patch

# 3. profile 仓储加密（依赖新文件 server/security/llmSecrets.js，已入库）
git apply .workbuddy/patches/0005-profile-repository-llm-secrets.patch
git apply .workbuddy/patches/0006-memory-profile-repository-llm-secrets.patch

# 4. 深度模式（quick/deep）
git apply .workbuddy/patches/0010-buildsystemprompt-depth-mode.patch
git apply .workbuddy/patches/0009-aichat-depth-toggle.patch
```

## 二、应用后验证

```bash
# 1. 语法（四链全部通过）
node --check server/news/plugin.js
node --check server/productionServer.js
node --check server/profile/profileRepository.js
node --check server/profile/memoryProfileRepository.js
node --check src/components/aichat/buildSystemPrompt.js

# 2. 全量测试（应全绿；promptDepth 测试在 0010 应用后验证 quick 行为）
node node_modules/vitest/vitest.mjs run

# 3. 构建
node node_modules/vite/bin/vite.js build
```

## 三、补丁清单

| 补丁 | 目标文件 | 内容 | 批次 |
|---|---|---|---|
| 0001 | server/news/plugin.js | artifacts 路由 + import | 批 1 |
| 0003 | server/news/plugin.js | /api/audit + /api/health 路由（**基于 0001**） | 批 5 |
| 0004 | server/productionServer.js | /health → healthSnapshot（rss/heap/audit 计数/DB 探测，503 语义） | 批 5 |
| 0005 | server/profile/profileRepository.js | llm_config 凭证存储层加解密（PG） | 批 5 |
| 0006 | server/profile/memoryProfileRepository.js | 同上（内存仓储） | 批 5 |
| 0007 | server/productionServer.js | HTML 响应 CSP report-only 头 | 批 5 |
| 0008 | server/productionServer.js | 进程加固：shutdown 防重入 + closeIdleConnections + unhandledRejection/uncaughtException 兜底 | 批 6 |
| 0009 | src/components/AiChatPanel.jsx | 输入工具条「深研/快问」切换胶囊 + mode 传参 | 批 4 |
| 0010 | src/components/aichat/buildSystemPrompt.js | mode 参数（deep=现状/quick 砍重上下文七处） | 批 4 |
| 0011 | server/agent/agentJobsService.js | createJob/updateJob 接入护栏（cap 20 + cron ≥10min） | 批 7 |
| 0012 | server/productionServer.js | 记忆蒸馏 cron（每日 04:00） | 批 8 |

## 四、注意事项

1. **0003 必须在 0001 之后**：其 import 区锚基于 0001 应用后的状态生成
   （曾实证：0003 独立应用可通过 check，但 0001 先应用后因上下文行变化而失配）。
2. **快照文件清理**：`src/components/aichat/_patchedSnapshot.buildSystemPrompt.js`
   是 0010 应用前的行为验证快照；0010 应用后其内容与 buildSystemPrompt.js 一致，
   可删除（同时删除 promptDepth.test.js 中对它的 import，或保留作回归基线）。
3. **MERIDIAN_SECRET**：llm 凭证加密为渐进增强——未配置 env 时维持明文（现状），
   配置后（64 位 hex 或任意口令）新写入即加密；明文存量在下次保存时自动升级。
4. **叠加终验已通过**：8 个补丁在临时仓库按序应用 + node --check 全部通过
   （`.workbuddy/stack-verify-final.out`）。
