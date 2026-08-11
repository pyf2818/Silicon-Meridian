/**
 * src/session/index.js - 会话内核（对标 pi 的 compaction / session tree / output sink）
 *
 * 三块纯逻辑能力，供 agent loop / UI 复用：
 *   contextManager - 上下文 token 估算 + 中段压缩（compaction）
 *   trail          - 消息树（id + parentId，支持分支 / 回溯）
 *   trailStore     - 会话树持久化（localStorage）
 *   outputSink     - 工具长输出落盘（bash 输出进 temp 文件的思想）
 */
export * from './contextManager.js';
export * from './trail.js';
export * from './trailStore.js';
export * from './outputSink.js';
