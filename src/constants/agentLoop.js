/**
 * agentLoop.js — agent 循环的统一定额常量（唯一调参入口）
 *
 * 为什么集中到一处：这些数字此前散落在多个文件里各自演化 ——
 *   maxIterations：runAgentLoop 12 / runElfAgentLoop 6 / agentLoopCore 默认 12 /
 *                  subagentCore preset 5~10
 *   maxTokens：    agentLoopCore 4000 / runAgentLoop 4000 / AiChatPanel 4000 / 技能沉淀 3000
 * 同一语义的数字多处硬编码，等于「调一处 = 没调」，而且无法从任何单一位置回答
 * 「工作站到底允许几轮推理」。收敛到这里后，调参只需改本文件。
 *
 * 注意：服务端对 max_tokens 另有一道安全闸（server/http/aiHandlers.js：
 * 非法或 >8000 时回落 4000），它与 COMPLETION_MAX_TOKENS 是两个层面的东西 ——
 * 前者是「防客户端要一个荒谬的值」，后者是「我们默认要多少」。若要调整默认输出长度，
 * 需同时确认服务端闸门不会把它截掉。
 */

/** 工作站（深度多步任务）推理轮数上限。末轮会撤走工具并注入收敛指令强制收尾。 */
export const WORKSTATION_MAX_ITERATIONS = 12;

/** AI 精灵（全站轻量助手）推理轮数上限。刻意压低：精灵定位是低摩擦快问快答。 */
export const ELF_MAX_ITERATIONS = 6;

/** 循环内核的默认轮数（调用方未显式传入时生效） */
export const AGENT_DEFAULT_MAX_ITERATIONS = WORKSTATION_MAX_ITERATIONS;

/** 对话补全的单次输出上限（token）。
 *  8000 而非 4000：agent 的核心场景「写一个完整的文件」的参数 JSON 很容易超过
 *  4000 token（中文 content ≈ 1 字 1~2 token），一旦截断，toolCallMerge 的卫生降级
 *  会把整个参数替换为 {}（安全失败），模型重试必然再次截断 → 写文件死循环。
 *  服务端闸门是 >8000 才回落，8000 恰好通过。 */
export const COMPLETION_MAX_TOKENS = 8000;

/** 辅助产物的输出上限（如技能沉淀）：只需结构化要点，不需要长文，省额度 */
export const AUX_COMPLETION_MAX_TOKENS = 3000;
