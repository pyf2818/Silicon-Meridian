import { describe, it, expect } from 'vitest';
import { getToolCapabilities, buildToolCapabilitiesText } from '../toolCapabilities.js';

describe('getToolCapabilities', () => {
  it('从白名单派生已声明工具的能力', () => {
    const caps = getToolCapabilities(['search_news', 'get_stock_quote']);
    expect(caps).toHaveLength(2);
    expect(caps[0].name).toBe('search_news');
    expect(caps[0].snippet).toContain('资讯');
    expect(caps[0].guidelines.length).toBeGreaterThan(0);
    expect(caps[1].label).toBe('股票行情');
  });

  it('未声明工具兜底保留（标记 unknown，不丢白名单项）', () => {
    const caps = getToolCapabilities(['unknown_tool', 'search_news']);
    expect(caps).toHaveLength(2);
    expect(caps[0].name).toBe('search_news');
    expect(caps[1].name).toBe('unknown_tool');
    expect(caps[1].unknown).toBe(true);
  });

  it('空白名单返回空', () => {
    expect(getToolCapabilities([])).toEqual([]);
    expect(getToolCapabilities(null)).toEqual([]);
  });
});

describe('buildToolCapabilitiesText', () => {
  it('agent 配置工具时输出能力段', () => {
    const text = buildToolCapabilitiesText(['search_news', 'fetch_page']);
    expect(text).toContain('可用工具');
    expect(text).toContain('search_news');
    expect(text).toContain('检索资讯');
    expect(text).toContain('function calling');
    expect(text).toContain('注意：'); // guidelines 注入
  });

  it('未配置工具返回空字符串（避免误导 agent）', () => {
    expect(buildToolCapabilitiesText([])).toBe('');
    expect(buildToolCapabilitiesText(undefined)).toBe('');
  });

  it('未知工具以自定义工具形式列出，不丢白名单', () => {
    const text = buildToolCapabilitiesText(['customTool', 'search_news']);
    expect(text).toContain('search_news');
    expect(text).toContain('customTool');
    expect(text).toContain('自定义工具');
  });

  it('每个工具行同时含 snippet 与 guidelines', () => {
    const text = buildToolCapabilitiesText(['read_workspace_file', 'web_search']);
    // read 工具的边界（需用户连接工作空间）
    expect(text).toContain('连接工作空间');
    // web_search 的边界（总开关关闭时不可用）
    expect(text).toContain('联网搜索总开关');
  });
});