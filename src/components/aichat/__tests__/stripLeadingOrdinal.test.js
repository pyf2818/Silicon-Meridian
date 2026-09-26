import { describe, it, expect } from 'vitest';
import { stripLeadingOrdinal } from '../stripLeadingOrdinal.js';

describe('stripLeadingOrdinal', () => {
  it('剥离开头孤立的数字行（模型写 0 的场景）', () => {
    expect(stripLeadingOrdinal('0\n好，联网兜底结果如下，直接给结论。')).toBe('好，联网兜底结果如下，直接给结论。');
  });

  it('只剥「独占一行」的孤立序号；同行的列表项保留（避免吃掉正常列表编号）', () => {
    // 独占一行 → 剥离（模型把序号单独甩在开头的目标场景）
    expect(stripLeadingOrdinal('0\n收到，技能已就绪。')).toBe('收到，技能已就绪。');
    // 同行 = 有序列表项，markdown 会渲染成 <ol><li>，属正常内容 → 保留
    expect(stripLeadingOrdinal('0. 收到，技能已就绪。')).toBe('0. 收到，技能已就绪。');
    expect(stripLeadingOrdinal('1、第一条')).toBe('1、第一条');
    expect(stripLeadingOrdinal('2) 第二条')).toBe('2) 第二条');
  });

  it('多行孤立序号块逐条剥离', () => {
    expect(stripLeadingOrdinal('0\n1\n正文开始')).toBe('正文开始');
  });

  it('不影响正常正文（数字在句中/段落中间）', () => {
    const t = '共有 3 条证据\n其中 0 条来自站内。';
    expect(stripLeadingOrdinal(t)).toBe(t);
  });

  it('不影响 markdown 有序列表正文（1. 后跟内容在同一行保留原样语义）', () => {
    // 列表项本身是正文内容，不是孤立序号行 → 不剥离
    expect(stripLeadingOrdinal('1. 先做 A\n2. 再做 B')).toBe('1. 先做 A\n2. 再做 B');
  });

  it('非空/非字符串安全返回原值', () => {
    expect(stripLeadingOrdinal('')).toBe('');
    expect(stripLeadingOrdinal(null)).toBe(null);
    expect(stripLeadingOrdinal(undefined)).toBe(undefined);
  });

  it('纯数字单条回复不误删（剥完无内容则保留原样）', () => {
    expect(stripLeadingOrdinal('0')).toBe('0');
  });

  // ── v37：实测模型还会输出字母 O / 全角数字开头（\d 不匹配 → 渲染漏网）──
  it('v37: 剥离字母 O / o 的孤立首行', () => {
    expect(stripLeadingOrdinal('O\n**一句话结论**：不一样。')).toBe('**一句话结论**：不一样。');
    expect(stripLeadingOrdinal('o\n正文开始')).toBe('正文开始');
  });

  it('v37: 剥离全角数字孤立首行', () => {
    expect(stripLeadingOrdinal('０\n正文开始')).toBe('正文开始');
    expect(stripLeadingOrdinal('０１\n正文开始')).toBe('正文开始');
  });

  it('v37: "O(n) 复杂度" 这类同行带后续内容的 O 不误伤', () => {
    const t = 'O(n) 复杂度是这个算法的瓶颈。\n下一行正文。';
    expect(stripLeadingOrdinal(t)).toBe(t);
  });

  it('v37: OK 开头的正常英文回复不误伤（同行有后续内容）', () => {
    const t = 'OK，以下是分析结果。';
    expect(stripLeadingOrdinal(t)).toBe(t);
  });

  it('v37: 代码块内首行为数字时不受影响（仅当正文以其开头才按规则评估）', () => {
    // 正文以代码块围栏开头，围栏行不匹配序号行 → 整体保留
    const t = '```\n0\n```\n后文';
    expect(stripLeadingOrdinal(t)).toBe(t);
  });
});
