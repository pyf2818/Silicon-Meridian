import { describe, expect, it } from 'vitest';
import { MIN_USABLE_LENGTH, stripBoilerplate } from '../boilerplate.js';

const LONG_BODY = 'OpenAI 今日发布新一代推理模型，官方称在复杂任务上的准确率显著提升，并在多个基准上刷新纪录。';

describe('stripBoilerplate —— 尾部推广块', () => {
  it('切掉中文站点最常见的「点击阅读原文」尾巴', () => {
    const out = stripBoilerplate(`${LONG_BODY}点击阅读原文`);
    expect(out).toBe(LONG_BODY);
    expect(out).not.toContain('阅读原文');
  });

  it('切掉「关注公众号 / 扫码」这类尾巴', () => {
    expect(stripBoilerplate(`${LONG_BODY}关注公众号：某某科技`)).toBe(LONG_BODY);
    expect(stripBoilerplate(`${LONG_BODY}扫码关注我们，获取更多精彩内容`)).toBe(LONG_BODY);
  });

  it('切掉英文站点的 WordPress 模板尾巴', () => {
    const out = stripBoilerplate('OpenAI released a new reasoning model today. The post New model appeared first on Example Blog.');
    expect(out).toBe('OpenAI released a new reasoning model today.');
  });

  it('切掉「版权声明 / 转载请注明」尾巴', () => {
    expect(stripBoilerplate(`${LONG_BODY}版权声明：本文为作者原创，转载请注明出处`)).toBe(LONG_BODY);
  });
});

describe('stripBoilerplate —— 保守性（绝不动正文）', () => {
  it('前半段出现的敏感词不触发切除', () => {
    // 标题/正文本来就可能带「点击」「广告」这类词，位置在后半段之前一律不动
    const text = '点击率是广告投放的核心指标，本文用三个案例说明如何优化。' + LONG_BODY;
    expect(stripBoilerplate(text)).toBe(text);
  });

  it('没有命中任何规则时原样返回（逐字符相同）', () => {
    expect(stripBoilerplate(LONG_BODY)).toBe(LONG_BODY);
    expect(stripBoilerplate(LONG_BODY + '更多细节见论文。')).toBe(LONG_BODY + '更多细节见论文。');
  });

  it('短摘要不因为「短」被丢弃（未命中规则就走原样）', () => {
    const short = 'OpenAI 发布 GPT-5';
    expect(short.length).toBeLessThan(MIN_USABLE_LENGTH);
    expect(stripBoilerplate(short)).toBe(short);
  });

  it('只在「确实切掉了东西且剩余过短」时才返回空串', () => {
    expect(stripBoilerplate('短文。点击阅读原文')).toBe('');   // 切完只剩「短文。」→ 无可用摘要
    expect(stripBoilerplate('短文。')).toBe('短文。');          // 没切 → 原样保留
  });
});

describe('stripBoilerplate —— 孤立广告记号与整段推广语', () => {
  it('去掉广告记号本身，保留周围正文', () => {
    const out = stripBoilerplate(`【广告】${LONG_BODY}`);
    expect(out).toBe(LONG_BODY);
    expect(out).not.toContain('广告');
  });

  it('整段就是一句推广语 → 返回空串', () => {
    for (const only of ['点击阅读原文', '阅读原文', '关注我们', '扫码关注', 'Read more', 'Continue reading']) {
      expect(stripBoilerplate(only)).toBe('');
    }
  });
});

describe('stripBoilerplate —— 边界与稳定性', () => {
  it('空 / 非字符串输入安全', () => {
    expect(stripBoilerplate('')).toBe('');
    expect(stripBoilerplate(null)).toBe('');
    expect(stripBoilerplate(undefined)).toBe('');
    expect(stripBoilerplate('   ')).toBe('');
  });

  it('整理切除后残留的重复分隔符与尾部标点', () => {
    const out = stripBoilerplate(`${LONG_BODY} | | | 点击阅读原文`);
    expect(out).toBe(LONG_BODY);
  });

  it('幂等：清洗过的文本再洗一次不变', () => {
    const once = stripBoilerplate(`${LONG_BODY}点击阅读原文`);
    expect(stripBoilerplate(once)).toBe(once);
  });
});
