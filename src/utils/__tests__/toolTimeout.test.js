import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerTool, unregisterTool, executeTool } from '../toolRegistry.js';

/**
 * per-tool 超时 = 真取消（而非弃等）
 *
 * 守住三条不能退化的性质：
 *  1. 超时会向 executor 传播 abort —— 在途 fetch / 嵌套子代理循环被真掐断，
 *     止住超时后的僵尸 token 消耗（此前 Promise.race 只是弃等，executor 继续跑）。
 *  2. 超时返回结构化中文错误（工具执行失败：工具执行超时（Xs）），且标记错误
 *     不与「用户主动停止」的 AbortError 混淆 —— 后者必须原样穿透上抛。
 *  3. 用户停止语义不变：ctx.signal 中止 → executor 收到 abort → AbortError 穿透。
 */

const registered = [];
function registerTemp(name, meta, executor) {
  registerTool(name, {
    source: 'custom-http',
    schema: {
      type: 'function',
      function: { name, description: 'test tool', parameters: { type: 'object', properties: {} } },
    },
    meta,
    executor,
  });
  registered.push(name);
}

function abortError(msg = 'Aborted') {
  const e = new Error(msg);
  e.name = 'AbortError';
  return e;
}

afterEach(() => {
  while (registered.length) unregisterTool(registered.pop());
  vi.restoreAllMocks();
});

describe('executeTool 超时真取消', () => {
  it('超时时向 executor 传播 abort，并返回结构化超时错误', async () => {
    let sawAbort = false;
    registerTemp('zz_timeout_cancel_test', { timeoutMs: 60 }, (args, ctx) => new Promise((_, reject) => {
      ctx.signal.addEventListener('abort', () => {
        sawAbort = true; // executor 侧观察到了真取消
        reject(ctx.signal.reason || abortError());
      }, { once: true });
    }));

    const result = await executeTool('zz_timeout_cancel_test', {}, {});
    expect(sawAbort).toBe(true);
    expect(String(result)).toContain('超时');
    // 前缀约定：执行失败 = 「工具执行失败：」，与「错误：」（校验/审批失败）区分
    expect(String(result).startsWith('工具执行失败：')).toBe(true);
  });

  it('标记错误的 name 不是 AbortError：不与用户停止混淆', async () => {
    let rejectionReason = null;
    registerTemp('zz_timeout_tag_test', { timeoutMs: 60 }, (args, ctx) => new Promise((_, reject) => {
      ctx.signal.addEventListener('abort', () => {
        rejectionReason = ctx.signal.reason;
        reject(ctx.signal.reason || abortError());
      }, { once: true });
    }));

    await executeTool('zz_timeout_tag_test', {}, {});
    expect(rejectionReason).toBeTruthy();
    expect(rejectionReason.name).toBe('ToolTimeoutError');
  });

  it('用户停止（ctx.signal 中止）→ AbortError 原样穿透上抛（语义不变）', async () => {
    registerTemp('zz_timeout_stop_test', { timeoutMs: 5000 }, (args, ctx) => new Promise((_, reject) => {
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason || abortError()), { once: true });
      if (ctx.signal.aborted) reject(ctx.signal.reason || abortError());
    }));

    const ctrl = new AbortController();
    ctrl.abort();
    await expect(executeTool('zz_timeout_stop_test', {}, { signal: ctrl.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('执行中途用户停止同样穿透（非预先中止）', async () => {
    registerTemp('zz_timeout_midstop_test', { timeoutMs: 5000 }, (args, ctx) => new Promise((_, reject) => {
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason || abortError()), { once: true });
    }));

    const ctrl = new AbortController();
    const pending = executeTool('zz_timeout_midstop_test', {}, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('executor 无视信号自然完成：超时后其结果被丢弃，调用不悬挂', async () => {
    registerTemp('zz_timeout_ignoring_test', { timeoutMs: 60 }, () => new Promise((resolve) => {
      setTimeout(() => resolve('迟到结果'), 200);
    }));

    const result = await executeTool('zz_timeout_ignoring_test', {}, {});
    expect(String(result)).toContain('超时');
    expect(String(result)).not.toContain('迟到结果');
  });

  it('正常完成路径不受影响：结果原样返回（合并信号不破坏 happy path）', async () => {
    registerTemp('zz_timeout_happy_test', { timeoutMs: 3000 }, async (args, ctx) => {
      expect(ctx.signal).toBeTruthy(); // executor 一定拿到合并后的 signal
      expect(ctx.signal.aborted).toBe(false);
      return '正常结果';
    });

    const result = await executeTool('zz_timeout_happy_test', {}, {});
    expect(result).toBe('正常结果');
  });
});
