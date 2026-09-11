// planMode.js - 计划模式纯逻辑（P0-2 计划→执行闭环的触发侧）
//
// 历史脉络：b653e24 引入计划卡机制（isPlan 标记 + 批准执行/修改/放弃操作条 +
// executeApprovedPlan 以全量工具按批准的计划执行）；v6 权限三模式重构（8059316）
// 把 plan 从权限词表移除（权限 ≠ 工作流），但把触发标记的定义块一并删除，
// 留下了悬空引用——sendMessage 纯文本路径每次成功完成都会 ReferenceError，
// 已流出的回复被 catch 替换成「请求失败：planMode is not defined」错误气泡。
//
// 本模块把计划模式的触发语义收口为一份纯逻辑：
//   计划请求 = 只出方案不执行（强制纯文本路径 + 计划 system prompt）
//   → 回复打 isPlan → 计划卡「批准执行」→ executeApprovedPlan（全量工具，
//     权限模式经注册表归一后实际为 semi：敏感写操作仍走审批闸门，不因批准计划而放权）。

export const PLAN_MODE_PROMPT = [
  '【计划模式】用户当前请求的是「制定执行计划」，不是直接执行。',
  '请仅输出一份详细、可执行的方案，不要实际调用任何工具，也不要真的执行任何步骤。',
  '方案必须结构化，包含：',
  '1）目标拆解：要达成什么、分几步、每步的验收标准；',
  '2）每一步用什么工具/数据源、输入是什么、预期产出是什么；',
  '3）需要用户确认或提供的关键信息（如有）；',
  '4）风险与备选路径（如有）。',
  '语言精炼，直接输出方案本身，不要开场白。',
].join('\n');

/**
 * 组装计划请求的 system prompt：在原 system prompt 基础上追加计划模式约束。
 * @param {string|undefined} basePrompt 原系统提示词（可为空）
 * @returns {string}
 */
export function buildPlanSystemPrompt(basePrompt) {
  const base = typeof basePrompt === 'string' && basePrompt.trim() ? basePrompt : '';
  return base ? `${base}\n\n${PLAN_MODE_PROMPT}` : PLAN_MODE_PROMPT;
}
