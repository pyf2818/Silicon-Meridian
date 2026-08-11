import { describe, it, expect } from 'vitest';
import {
  ELF_DEFAULT_AGENT,
  buildElfSystemPrompt,
  buildElfDropPrompt,
  buildElfQuickPrompt,
} from '../aielfDefaults.js';

describe('ELF_DEFAULT_AGENT', () => {
  it('固定为精灵单例，id 为 ai-elf', () => {
    expect(ELF_DEFAULT_AGENT.id).toBe('ai-elf');
    expect(ELF_DEFAULT_AGENT.name).toBe('AI精灵');
  });

  it('工具白名单聚焦分析/查证，不含工作站的多步编排工具', () => {
    expect(ELF_DEFAULT_AGENT.tools).toContain('search_news');
    expect(ELF_DEFAULT_AGENT.tools).toContain('web_search');
    expect(ELF_DEFAULT_AGENT.tools).toContain('get_stock_quote');
    expect(ELF_DEFAULT_AGENT.tools).toContain('create_skill');
    // set_plan 是工作站多步编排的活，精灵不做
    expect(ELF_DEFAULT_AGENT.tools).not.toContain('set_plan');
    expect(ELF_DEFAULT_AGENT.tools).not.toContain('execute_command');
  });
});

describe('buildElfSystemPrompt', () => {
  it('注入用户画像（关注/追踪）', () => {
    const p = buildElfSystemPrompt({ focusLabels: ['AI', '芯片'], tracked: ['NVIDIA'] });
    expect(p).toContain('核心关注：AI、芯片');
    expect(p).toContain('追踪记忆：NVIDIA');
  });

  it('未设置关注时合理缺省', () => {
    const p = buildElfSystemPrompt({});
    expect(p).toContain('核心关注：未设置');
  });

  it('包含内容自识别段', () => {
    const p = buildElfSystemPrompt({});
    expect(p).toContain('内容自识别');
    expect(p).toContain('GitHub 项目');
  });

  it('包含工具能力段（精灵工具进入提示词）', () => {
    const p = buildElfSystemPrompt({});
    expect(p).toContain('search_news');
    expect(p).toContain('可用工具');
  });

  it('包含输出风格硬约束（禁止 emoji）', () => {
    const p = buildElfSystemPrompt({});
    expect(p).toContain('禁止使用任何 emoji');
  });
});

describe('buildElfDropPrompt', () => {
  it('注入拖入内容（标题/摘要/链接/分类）', () => {
    const p = buildElfDropPrompt({ title: 'AI 芯片突破', summary: '英伟达发布新卡', url: 'https://x.com/1', category: '科技' }, '');
    expect(p).toContain('AI 芯片突破');
    expect(p).toContain('英伟达发布新卡');
    expect(p).toContain('https://x.com/1');
    expect(p).toContain('科技');
    expect(p).toContain('请分析这条内容');
  });

  it('含网页全文时注入全文（截断保护）', () => {
    const longContent = 'x'.repeat(8000);
    const p = buildElfDropPrompt({ title: 't', url: 'u' }, longContent);
    expect(p).toContain('网页全文');
    expect(p.length).toBeLessThan(8000 + 500); // 截断到 ~6000
  });

  it('无 itemData 返回空串', () => {
    expect(buildElfDropPrompt(null, '')).toBe('');
  });
});

describe('buildElfQuickPrompt', () => {
  it('直接透传文本（快速问答无需额外包装）', () => {
    expect(buildElfQuickPrompt('你好')).toBe('你好');
  });
});