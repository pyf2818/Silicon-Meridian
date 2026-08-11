import { describe, it, expect, vi } from 'vitest';
import { persistLongResult, withSavedPointer, DEFAULT_MAX_BYTES } from '../outputSink.js';

// vi.mock 工厂会被提升，必须用模块级 mock 引用；vitest 允许工厂引用同文件声明的变量
const mocks = vi.hoisted(() => ({ writeFile: vi.fn() }));

vi.mock('../../utils/workspace.js', () => ({
  writeFile: mocks.writeFile,
}));

describe('persistLongResult', () => {
  it('短结果不截断、不落盘', async () => {
    const out = await persistLongResult({ result: 'hello', rootHandle: {} });
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('hello');
    expect(out.saved).toBeUndefined();
  });

  it('无工作空间时降级为截断提示（不改动现网行为）', async () => {
    const long = 'x'.repeat(DEFAULT_MAX_BYTES + 100);
    const out = await persistLongResult({ result: long });
    expect(out.truncated).toBe(true);
    expect(out.saved).toBeUndefined();
    expect(out.text.includes('完整输出过长')).toBe(true);
    expect(out.text.startsWith(long.slice(0, 200))).toBe(true);
  });

  it('有工作区时落盘并返回路径提示', async () => {
    mocks.writeFile.mockImplementation(async () => 'outputs/agent-tools/2026-01-01/123456.md');
    const long = 'y'.repeat(DEFAULT_MAX_BYTES + 50);
    const out = await persistLongResult({ result: long, rootHandle: {} });
    expect(out.saved).toBe('outputs/agent-tools/2026-01-01/123456.md');
    expect(out.text.includes('已保存到 outputs/agent-tools/2026-01-01/123456.md')).toBe(true);
    // 落盘请求包含完整文本（未被截断）
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('落盘失败时退回截断不抛错', async () => {
    mocks.writeFile.mockImplementation(async () => { throw new Error('EACCES'); });
    const long = 'z'.repeat(60_000);
    const out = await persistLongResult({ result: long, rootHandle: {} });
    expect(out.saved).toBeUndefined();
    expect(out.truncated).toBe(true);
    expect(out.text.includes('保存失败')).toBe(true);
  });
});

describe('withSavedPointer', () => {
  it('追加保存路径提示', () => {
    expect(withSavedPointer('内容', 'a/b.md')).toBe('内容\n\n[完整输出已保存到：a/b.md]');
  });
});