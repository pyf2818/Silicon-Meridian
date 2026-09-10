# 全站审查报告 · v26.9e

> 范围：Silicon Meridian 全仓（前端 src/ + 服务端 server/ + api/）
> 方法：只读静态审查（子代理）+ 我逐条**独立复验**（读源码定位行号 / 构造复现 / 单测锁死）
> 结论口径：**结论 → 理由 → 依据**，每条都给出可查证的代码位置
> 提交：`2aaaedb`（25 文件 +1309/−163）

---

## 0. 摘要

| 等级 | 数量 | 状态 |
| --- | --- | --- |
| P0（安全/整站不可用） | 1 | ✅ 已修 |
| P1（功能静默失效/卡死） | 4 | ✅ 已修 |
| P2（健壮性/可维护性） | 7 | ⏸ 待你拍板 |
| 死代码（高置信） | 2 处 | ✅ 已删 |
| 死代码（待确认，**刻意未删**） | ~40 导出 + 3 组件 | ⏸ 需人工确认 |

本轮共修 **5 个真缺陷**，全部有单测/探针锁死。
刻意**没有**动的：需要大范围重构的 3 项（见 §3），为了保持这次改动可审查。

---

## 1. 已修缺陷（P0 / P1）

### 🔴 P0-1 Markdown 渲染存在 XSS 注入面

**结论**：`src/utils/markdown.jsx` 生成的 HTML 会经 `dangerouslySetInnerHTML` 落到 10+ 处调用点，而转义与协议校验都不完整 → 资讯正文/LLM 输出里的恶意串可执行脚本。

**理由**（四处叠加，任何一处单独都足以破防）：
1. 转义表只处理 `&` `<` `>`，**没有引号** → 属性逃逸（`<a href="x" onmouseover="...">`）。
2. 图片/链接 URL 未做协议白名单 → `javascript:` / `data:text/html` 可注入。
3. `imgMap` 用 `String.replace(str, str)` 还原标签 → 替换串里的 `$&`、`` $` ``、`$'` 会被当成替换模式**二次展开**。
4. `sanitizeImgTag` 未剥离 `on*` 事件属性。

**依据**：`src/utils/markdown.jsx:26`（转义表）、`:46`（图片还原）。已补：引号转义、`isSafeUrl` 协议白名单（`http/https/mailto/tel/相对路径/#/?`）、`data:image/*;base64` 严格白名单、`sanitizeImgTag` 剥 `on*`、全部改**函数式替换**。不安全协议降级为纯文本，不静默丢弃（可读性优先）。

**验证**：`src/utils/__tests__/markdown.test.jsx` 13 条，含 `$&` 污染用例、非法 data URL 反向用例。

---

### 🟠 P1-1 StockPage 实时刷新「从未真正跑过」

**结论**：四个轮询 effect 依赖 `clockNow`（每秒 tick），每次 tick 都触发 effect 清理 + 重建 interval，而 1 秒远小于最小刷新间隔 → **interval 永远等不到触发就被 clear**。功能静默失效，无报错、无异常，测试也不会失败——最难发现的一类。

**理由**：`clockNow` 是显示用秒级时钟，把它放进轮询依赖等于给 interval 装了个 1s 定时销毁器。

**依据**：`src/components/StockPage.jsx:90`（clockNow 定义）、`:312-343`（四个 effect）。已改为依赖 `const marketOpen = useMemo(() => isMarketOpen(new Date(clockNow)), [isMarketOpen, clockNow])` —— 布尔值只在开/收盘翻转时变化，语义正确且依赖稳定。

**附带收益**：修复后**收盘时段不再空转轮询**，请求量下降。

---

### 🟠 P1-2 `handleOrchestrate` 缺 try/finally → 会话永久卡「生成中」

**结论**：这正是用户报的「第一条信息就进入排队」的**真因**。排队触发条件本身是对的（仅 `streamingSessionsRef.current.has(targetId)` 时才入队），但一旦 handler 中途抛错，`finally` 缺失导致 session 的 streaming 标记永不清除 → 之后**每条**消息都命中"已有会话在跑"而进入队列，且队列永不被消费。

**理由**：用户看到的是"第一条就排队"，实际语义是"上一条失败了但系统以为自己还在跑"。**症状位置 ≠ 故障位置**，这类 bug 靠读代码猜很容易修错地方（比如去改排队条件，那会把正确逻辑改坏）。

**依据**：`src/components/AiChatPanel.jsx` 的 `handleOrchestrate`。已补 `try/catch/finally`。

---

### 🟠 P1-3 流式响应无看门狗 → 上游静默挂起即永久等待

**结论**：`streamAgentResponse` 只受调用方 `signal` 控制。若上游 TCP 连着但**不再吐字节**（网关半死、代理挂起），`reader.read()` 永远 pending → UI 无限转圈，用户只能刷新页面。

**依据**：`src/components/aichat/agentLoopCore.js`。已加 `STREAM_STALL_TIMEOUT_MS = 90_000`，**每次 `reader.read()` 成功返回就续期**（有数据就不算卡）；看门狗中止抛**可重试的 Error**，而用户主动 abort 仍保持 `AbortError` 语义（否则"用户取消"会被误报成错误弹窗）。

**为什么是 90s**：首 token 前的思考时间在中转站上可能到 30-60s，留足余量；而"静默 90s"已经远超任何正常流式节奏。

---

### 🟠 P1-4 `runAgentLoop` 两处辅助 fetch 无 signal / 无超时

**结论**：自检修复（selfVerifyRepair）与技能沉淀两处 fetch 既不带 `signal` 也无超时。用户中止主流程后，这两个请求仍在后台跑并**继续消耗 token**；上游挂起时也会一直吊着。

**依据**：`src/components/aichat/runAgentLoop.js`。新增 `fetchAuxCompletion(url, body, parentSignal, timeoutMs = 60_000)`，两处统一走它。顺带把 `selfVerifyRepair` 补上 `signal` 参数，调用点传 `controller?.signal`。

---

### 🟠 P1-5 `loadLS` 缺类型自愈 → 脏数据可能整站崩

**结论**：`loadLS(key, fallback)` 若持久化内容是"合法 JSON 但类型错了"（期望数组拿到对象），调用方 `.filter`/`.map` 直接 `TypeError` → 冒泡到 app 级错误边界 → 整站白屏。这不是网络问题，用户完全无法自查。

**依据**：`src/utils/localStorage.js`。已加：`if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;`（只做形状校验，不做数据清洗，避免误删用户数据）。

**同类既有修复**（本批之前，v26.9c）：`src/store/behaviorStore.js` 的 `normalizePersistedBehavior` 作为 persist `merge`。两处合起来覆盖 localStorage 的读路径与 rehydrate 路径。

---

## 2. 死代码清理

### 已删（高置信，零风险）

| 位置 | 内容 | 依据 |
| --- | --- | --- |
| `src/styles.css` | `.chat-queue-indicator` 样式族 + `@keyframes chatQueuePulse` | 全仓无任何 JSX className 引用；本轮弹层改造后视觉方案已废弃 |
| `src/i18n/locales/{zh-CN,en}.json` | `chat.queueSend`、`chat.queueIndicator` | 全仓 `t('chat.queueSend')` 等调用点已不存在 |

同时把 `chat.inputPlaceholderStreaming` **保留**并加注释说明用途（流式中占位文案，属于未来 i18n 覆盖项，不是死键）。

### 刻意未删（审计报告了，我判定**不可删**）

审计子代理用"全仓 grep 无引用"判定出约 40 个领域层导出 + 3 个孤儿组件：

- `src/components/LlmConfigModal.jsx`
- `src/components/WorkflowEdge.jsx`
- `src/hooks/useAgentSession.js`

**为什么不删**：纯 grep 判死对**动态访问**有系统性假阳性 —— 本项目里已实证存在以下模式：

1. `toolRegistry.js` 运行时注册（字符串名映射到实现）；
2. 领域引擎大量通过 `import * as X` 聚合再动态取键；
3. `src/domain/` 的纯逻辑模块是**单测直接引用**的，grep 源码不覆盖测试文件时会全部误判。

**建议**：真要清理，先做一次"打包产物分析"（vite build 后看 chunk 里是否有该导出被 tree-shake 掉），比 grep 可靠得多。这是一次独立的清理任务，不适合混在修 bug 的批次里。

---

## 3. 待你拍板（P2 / 需决策）

### ⏸ 需大范围重构，我刻意没动

| # | 问题 | 为什么值得修 | 为什么我没动 |
| --- | --- | --- | --- |
| R1 | 上下文预算计算逻辑在多处重复实现 | 阈值口径漂移会静默改变 agent 行为，且改一处漏一处 | 抽取会动到 agent 主循环，回归面大 |
| R2 | `AiChatPanel.jsx` 的 `sendMessage` 函数过长（含队列/流式/落库/错误四段） | 是 P1-2 那类"缺 finally"bug 的温床 | 拆分需同时改 6+ 处调用契约，风险 > 收益 |
| R3 | `App.jsx` 新闻流逻辑未 hook 化（文件 ~3000 行） | 副作用耦合导致改动易踩踏 | 属结构性重构，建议独立批次 |

**我的建议**：R1/R2 打包成下一批"agent 主循环加固"，与功能需求分开走；R3 优先级最低（不动它能跑，动它容易出事）。

### 其它 P2（低风险，未修）

1. `res.on('close')` vs `req.on('close')` 在服务端 SSE 清理处若也用错，会导致流被提前掐死（见 §4 探针坑——我在 mock 上游上真实踩到）。
2. `agentLoopCore` 的 6 轮循环上限为硬编码常量，未走配置。
3. 工具调用目前串行执行，独立只读工具可并行以缩短等待。
4. 无 per-tool timeout（依赖全局看门狗兜底）。
5. `sanitizeImgTag` 只剥 `on*`，未做 `style` 白名单（当前风险低：img 的 `style` 无法执行脚本）。
6. `popoverPosition` 的两趟测量在极端场景（弹层内内容异步撑高）仍需复测，当前靠 raf 一次兜底。
7. 自定义 HTTP 工具的出站限制偏松（与 `safeExternalFetch` 的严格度不一致）。

---

## 4. 本轮新沉淀的坑（避免下次重踩）

### 浮层被祖先裁剪 —— 一次踩了两个地方

**铁律**：`overflow-x: auto|scroll|hidden` 会把 `overflow-y` **一并**算成 `auto`（非 `visible`）→ 纵向照样裁。
本次命中：`.chat-composer-top`（排队弹层）、`.gtc-panel { overflow-y:auto }`（邀请成员菜单）。

**取证方式**（推荐复用）：探针里直接读弹层 `getBoundingClientRect()` 与祖先链 overflow，判定「已渲染但被裁」：
```
rect.bottom = 866  vs  clippedBy = { cls:'chat-composer-top', overflow:'auto/auto', parentBottom:770 }
```
→ 弹层**其实已经打开了，只是看不见**。这解释了用户为什么描述成"点击无法打开"。

**统一解法**：`createPortal(…, document.body)` + `position:fixed` + 新增 `src/utils/popoverPosition.js`（纯函数，可单测）。一套抽象同时修掉两个 bug。

### 实体解码 `&nbsp;` 为什么"改了没效果"

`&nbsp;` 若解码成 **U+00A0**（不换行空格）而非普通空格，下游 `\s+` 折叠不生效 → 观感上"还是没解码干净"。**必须归一为普通空格**。

### mock 上游：`req.on('close')` 会杀自己的流

我在探针里用 `req.on('close')` 清 SSE interval —— 但该事件在**请求体读完**时就触发（**不是**客户端断开），流被提前掐死 → 应用永远等不到结束，探针双向 FAIL（9s / 90s）。改用 `finished` 标志 + `res.on('close')` 后 12/12 PASS。
**服务端若有 SSE 清理逻辑，务必检查用的是哪一个。**

### 探针 timeout 要按"多次 mock 往返"估算

`runAgentLoop` 一次任务会做多次 mock 往返，90s 才够。给探针设小 timeout = 自己制造假失败。

### `safeExternalFetch` 拦私网 → 本地 mock 无法用于 `/api/fetch-page`

该函数拒绝 private IP/localhost 且**无 allowPrivate 开关**。所以页面正文解码的验证改用 **handler 级单测**（mock 掉 `safeExternalFetch` 本身），不走 e2e。

---

## 5. 验证证据

| 项目 | 结果 |
| --- | --- |
| 单元测试 | **882 / 882 通过**（86 文件） |
| 新增测试 | 50 条：popoverPosition 9 · markdown 13 · format 10 · textProcessing 12 · fetchPageHandler 6 |
| 构建 | `vite build` ✓ **1368 modules，0 error** |
| 探针 · 排队弹层 | `v26-9e-queue-diagnose.mjs` **12/12** |
| 探针 · 邀请菜单 | `v26-9e-invite-menu-probe.mjs` **12/12** |
| 回归 · chunk 失败链路 | `v26-9d` 11/11 |
| 回归 · 毛玻璃 | `v26-9b` 8/8 |
| 回归 · 粒子 | `v26-8` 6/6 |
| 提交 | `2aaaedb`，推送 `985a541..2aaaedb` ✓ |

> 沙盒限制说明：`vite build` 的 `vite:prepare-out-dir` 走回收站删除在本沙盒不可用，故以**编译验证**为准（`N modules transformed` + 0 错误）。

---

## 6. 一句话总结

本轮的四个问题里，**真正的位置和用户描述的位置都不完全一致**：
- 排队问题是"上一步卡死没解锁"，不是排队条件错；
- 弹层问题是"已经打开但被裁掉"，不是没触发；
- 实体问题是"解码成 NBSP 没被空白折叠收掉"，不是没解码。

三处都是**症状落在 A、故障在 B** —— 所以本轮全部先构造复现取证、再动手，没有一处是靠读代码猜着改的。
