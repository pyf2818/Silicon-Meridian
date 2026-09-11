import { describe, it, expect } from 'vitest';
import { PLAN_MODE_PROMPT, buildPlanSystemPrompt } from '../aichat/planMode.js';

/**
 * planMode 计划请求语义（P0-2 触发侧）
 *
 * 守住三条性质：
 *  1. 计划指令是追加而非覆盖——基础 system prompt（人设/上下文注入）必须保留
 *  2. 空/非字符串 base 时优雅降级为纯计划指令
 *  3. 指令内容必须「禁止执行 + 要求结构化」——这是计划卡「批准执行」语义成立的前提
 */
describe('planMode 计划请求语义', () => {
  it('有基础 system prompt 时追加而非覆盖', () => {
    const out = buildPlanSystemPrompt('你是资讯情报助手。');
    expect(out.startsWith('你是资讯情报助手。')).toBe(true);
    expect(out).toContain('【计划模式】');
  });

  it('空 / 空白 / 非字符串 base 时返回纯计划指令', () => {
    expect(buildPlanSystemPrompt('')).toBe(PLAN_MODE_PROMPT);
    expect(buildPlanSystemPrompt('   ')).toBe(PLAN_MODE_PROMPT);
    expect(buildPlanSystemPrompt(undefined)).toBe(PLAN_MODE_PROMPT);
    expect(buildPlanSystemPrompt(null)).toBe(PLAN_MODE_PROMPT);
  });

  it('计划指令禁止执行并要求结构化产出（批准执行的语义前提）', () => {
    expect(PLAN_MODE_PROMPT).toContain('不要实际调用任何工具');
    expect(PLAN_MODE_PROMPT).toContain('目标拆解');
    expect(PLAN_MODE_PROMPT).toContain('风险与备选路径');
  });
});
