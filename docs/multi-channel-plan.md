# 多端连接方案（AI 工作站 / AI 精灵 → 微信 · 飞书 · 海外 IM）

> C3 任务 5 评估结论 + 落地路线图。结论先行：**值得做，但「值」在通道层而非全量功能镜像**——一期做「川川频道」单向入口（手机发指令 → 本机执行 → 回推结果），二期再做双向富交互。

## 一、值不值得做（钢人论证）

**正方最强论点**：
1. 用户在手机微信里，不在我们的 App 里。AI 工作站的价值密度再高，入口不在拇指边上就是零。
2. openclaw（OpenClaude 系）已验证「手机 IM 发指令 → 本地电脑 agent 执行 → 回推」的产品形态有真实需求，且付费意愿成立。
3. Silicon Meridian 的 agent 内核（`agentLoopCore.js` + 工具注册表 + plan mode）已经把「执行端」做完了，通道层是增量而非重构。

**反方最强论点**：
1. 微信个人号机器人（web 协议/-hook）违反微信使用条款，封号风险真实存在；企业微信/公众号则要审核资质。
2. IM 通道做全量功能（看资讯流、画布、社区）在手机上是伪需求——没有人为 3 寸屏设计的工作流买单。
3. 维护 3+ 通道的适配成本 > 单通道做深。

**裁决**：反方第 1、2 点决定了**一期只做「指令进 / 结果出」的窄通道**（只接 agent 对话，不镜像资讯/画布），正方第 3 点决定了边际成本低（内核现成）。值得做，窄做。

## 二、通道评估矩阵

| 通道 | 接入方式 | 合规性 | 一期可行性 | 备注 |
|---|---|---|---|---|
| **微信（企业微信/公众号）** | 企业微信自建应用 / 测试公众号回调 | ✅ 官方支持，需注册主体 | ⭐⭐⭐⭐ | 国内首选；测试公众号个人即可申请，回调 URL 即通 |
| **微信（个人号）** | web 协议机器人（itchat 类） | ❌ 违反条款，封号 | ⭐ 一律不做 | 一键连接的诱惑再大也不走这条 |
| **飞书** | 飞书开放平台自建应用（事件订阅 + 消息 API） | ✅ 官方支持，个人开发者可用 | ⭐⭐⭐⭐⭐ | 最容易：审批快、SDK 全、事件回调文档清晰 |
| **Telegram** | Bot API（long polling 或 webhook） | ✅ 官方支持，免审 | ⭐⭐⭐⭐⭐ | 海外首选；纯 HTTP API，半天可通 |
| **Slack** | Socket Mode（免公网回调） | ✅ 官方支持 | ⭐⭐⭐ | Socket Mode 免暴露端口，适合本机场景 |
| **Discord** | Bot + Gateway | ✅ 官方支持 | ⭐⭐⭐ | 与 Slack 同级，海外第二梯队 |
| **iMessage/WhatsApp** | WhatsApp Cloud API ✅ / iMessage ✗ | WhatsApp 需 Meta 商业账号 | ⭐⭐ | 后置 |

## 三、一期架构（「川川频道」，目标一键连接）

```
手机 IM（微信/飞书/TG）
   │  用户发消息
   ▼
通道网关 server/channels/          ← 新增，唯一新增层
   ├─ feishuChannel.js   （事件订阅回调 → 统一 Inbox）
   ├─ wecomChannel.js    （企业微信回调，加密解密）
   ├─ telegramChannel.js （long polling，无公网也行）
   └─ channelRouter.js   （统一消息模型 {channelId, userId, text, reply}）
   ▼
agent 内核（现有 agentLoopCore / streamAgentResponse，零改动）
   ▼
执行端（本机 WorkBuddy/浏览器会话），工具结果回推 → channelRouter.reply()
```

关键设计决策（为什么 A 不选 B）：
1. **网关独立于 dev middleware**（`server/channels/` 独立进程/端口），不塞进 Vite 插件——通道回调是长驻外部依赖，与静态服务生命周期不同。
2. **统一消息模型**而非每通道各自实现：agent 只面对 `{text, reply}`，新增通道 = 新增一个 adapter 文件。
3. **用户映射表**：`channel_identities`（channel, external_user_id → meridian user_id），首次对话发绑定码，手机端输入绑定码完成「一键连接」。
4. **安全红线**：通道侧默认低权限工具白名单（查询类），写操作（发帖/删数据）通道内禁用；所有上游消息包 `<untrusted_data>`（沿用现有约定）。

## 四、一期范围（预计 3 个 PR）

1. **PR-1**：`server/channels/` 骨架 + Telegram adapter（最简通道，long polling 免公网）+ 绑定码流程 + `channel_identities` 表。验收：TG 发「总结今天的 AI 新闻」→ 本机 agent 执行 → TG 收到回复。
2. **PR-2**：飞书 adapter（事件订阅，需内网穿透或云部署网关）。
3. **PR-3**：企业微信 adapter（回调需域名备案，放最后）。

## 五、二期以后（记录备查）

- 通道内富卡片（飞书 card / TG inline button）承载「确认执行 plan」「选择分支」。
- 打通网页端 / 移动端 App / 桌面端 / 微信小程序：统一走 `meridian_session` + 设备绑定表，小程序因审核限制只能做只读资讯流 + 提问入口。
- 语音消息转写（通道网关 → ASR → agent）。

## 六、风险与未决

- 内网穿透/公网回调是飞书/企微的前置条件：建议网关部署在云函数（Vercel/腾讯云），本机 agent 走反向长连接（WebSocket 出站），避免暴露家庭网络。
- 通道网关的会话与 `meridian_session` 隔离，IM 侧 token 单独下发、可一键吊销。
