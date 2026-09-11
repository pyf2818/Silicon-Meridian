import { describe, it, expect } from 'vitest';
import { mergeToolCallDeltas } from '../toolCallMerge.js';

describe('mergeToolCallDeltas', () => {
  it('单工具单批次：name + arguments 原样还原', () => {
    const out = mergeToolCallDeltas([[
      { index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"q":"ai"}' } },
    ]]);
    expect(out).toEqual([{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"q":"ai"}' } }]);
  });

  it('单工具 arguments 跨多批次拼接', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"q":"' } }],
      [{ index: 0, function: { arguments: 'ai agent"}' } }],
    ]);
    expect(out[0].function.name).toBe('web_search');
    expect(out[0].function.arguments).toBe('{"q":"ai agent"}');
  });

  it('单工具 name 跨批次拼接', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, id: 'call_x', type: 'function', function: { name: 'fetch' } }],
      [{ index: 0, function: { name: '_page' } }],
    ]);
    expect(out[0].function.name).toBe('fetch_page');
  });

  it('id 在后续批次到达也能捕获（首片 id 为空）', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      [{ index: 0, id: 'call_late' }],
    ]);
    expect(out[0].id).toBe('call_late');
  });

  it('多工具按 index 分别还原并保持顺序', () => {
    const out = mergeToolCallDeltas([
      [
        { index: 0, id: 'a', type: 'function', function: { name: 'search_news', arguments: '{}' } },
        { index: 1, id: 'b', type: 'function', function: { name: 'get_stock_quote', arguments: '{"code":"NVDA"}' } },
      ],
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].function.name).toBe('search_news');
    expect(out[1].function.name).toBe('get_stock_quote');
    expect(out[1].function.arguments).toBe('{"code":"NVDA"}');
  });

  it('无任何工具分片返回 undefined', () => {
    expect(mergeToolCallDeltas([])).toBeUndefined();
    expect(mergeToolCallDeltas([[], undefined, []])).toBeUndefined();
    // 只有文本增量（无 toolCallDelta）也应返回 undefined
    expect(mergeToolCallDeltas([null])).toBeUndefined();
  });

  it('arguments 缺失时回退为 {} 字符串', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, id: 'c', type: 'function', function: { name: 'noop' } }],
    ]);
    expect(out[0].function.arguments).toBe('{}');
  });

  // ── 历史卫生（2026-09-11）：合并结果会进入对话历史发给上游，必须始终合法 ──

  it('截断的 arguments 替换为 {}（上游 400 根修：不把非法 JSON 写进历史）', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, id: 'call_t', type: 'function', function: { name: 'write_workspace_file', arguments: '{"path":"notes/a.md","content":"# 标题' } }],
    ]);
    expect(out[0].function.arguments).toBe('{}');
  });

  it('合法 arguments 原样保留（不误伤）', () => {
    const valid = '{"q":"深度","limit":3,"nested":{"ok":true}}';
    const out = mergeToolCallDeltas([
      [{ index: 0, id: 'call_v', type: 'function', function: { name: 'web_search', arguments: valid } }],
    ]);
    expect(out[0].function.arguments).toBe(valid);
  });

  it('混合批次：合法与截断并存时各按各的处理', () => {
    const out = mergeToolCallDeltas([
      [
        { index: 0, id: 'a', type: 'function', function: { name: 'search_news', arguments: '{"keyword":"AI"}' } },
        { index: 1, id: 'b', type: 'function', function: { name: 'fetch_page', arguments: '{"url":"https://exam' } },
      ],
    ]);
    expect(out[0].function.arguments).toBe('{"keyword":"AI"}');
    expect(out[1].function.arguments).toBe('{}');
  });

  it('id 为空时生成占位 id（tool_call_id 匹配 + 部分上游拒空 id）', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, type: 'function', function: { name: 'noop', arguments: '{}' } }],
      [{ index: 1, type: 'function', function: { name: 'noop2', arguments: '{}' } }],
    ]);
    expect(out[0].id).toBe('call_delta_0');
    expect(out[1].id).toBe('call_delta_1');
  });

  it('非空合法 id 不被占位符覆盖', () => {
    const out = mergeToolCallDeltas([
      [{ index: 0, id: 'call_real', type: 'function', function: { name: 'noop', arguments: '{}' } }],
    ]);
    expect(out[0].id).toBe('call_real');
  });
});
