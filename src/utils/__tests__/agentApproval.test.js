import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeAgentTool, gradeCommandRisk } from '../agentTools.js';
import {
  resolveApprovalDecision,
  getTool,
  registerCustomHttpTool,
  deleteCustomTool,
  testCustomHttpTool,
  getToolMeta,
} from '../toolRegistry.js';
import {
  subscribePending,
  respondApproval,
  clearSessionGrants,
  setEgressAllowlist,
} from '../sandbox.js';

/**
 * 审批闸门与风险分级测试（P0-1 / P0-3 / P1-8）
 *
 * 这组测试守住三条不能退化的性质：
 *  1. 一次工具调用最多弹一张审批卡（P0-1 修掉的双重审批 BUG）
 *  2. execute_command 的只读子命令不打扰用户，写子命令一定拦（P0-3）
 *  3. 自定义 HTTP 工具默认需审批、模板注入被转义、非法出口被拒（P1-8）
 */

/** 订阅审批事件并自动作答，返回收到的 request 列表 */
function autoRespond(decision) {
  const seen = [];
  const unsub = subscribePending((evt) => {
    if (evt.type !== 'request') return;
    seen.push(evt);
    // 异步作答：避免在 requestApproval 的同步 listener 里回调自己
    setTimeout(() => respondApproval(evt.id, decision), 0);
  });
  return { seen, unsub };
}

describe('execute_command 子命令风险分级（P0-3）', () => {
  it('只读子命令判为 read', () => {
    for (const cmd of ['ls', 'ls notes/', 'tree . 2', 'glob *.md', 'grep TODO', 'pwd',
      'read notes.md', 'news OpenAI', 'search 大模型', 'stock 600519', 'kline 600519',
      'tools', 'sandbox', 'help', '?']) {
      expect(gradeCommandRisk(cmd), cmd).toBe('read');
    }
  });

  it('写 / 高危子命令判为 write', () => {
    for (const cmd of ['write a.md hi', 'touch a.md', 'mkdir docs', 'rm a.md', 'del a.md',
      'fetch https://example.com', 'plan.add 调研', 'plan.set t1 done']) {
      expect(gradeCommandRisk(cmd), cmd).toBe('write');
    }
  });

  it('plan / var / bb 读写同名，按参数形态区分', () => {
    expect(gradeCommandRisk('plan')).toBe('read');
    expect(gradeCommandRisk('plan add 调研竞品')).toBe('write');
    expect(gradeCommandRisk('plan set t1 done')).toBe('write');
    expect(gradeCommandRisk('var topic')).toBe('read');
    expect(gradeCommandRisk('var topic 大模型')).toBe('write');
    expect(gradeCommandRisk('bb notes')).toBe('read');
    expect(gradeCommandRisk('bb notes 内容')).toBe('write');
  });

  it('空命令与未知命令无副作用，判为 read', () => {
    expect(gradeCommandRisk('')).toBe('read');
    expect(gradeCommandRisk('   ')).toBe('read');
    expect(gradeCommandRisk('frobnicate foo')).toBe('read');
  });

  it('fetch 必须判 write —— 否则 execute_command 会成为 fetch_page 的审批旁路', () => {
    // fetch_page 工具本身 requiresApproval=true，但 execute_command 内部是直接调函数，
    // 不经过注册表闸门。若这里判 read，模型就能用 execute_command 抓任意 URL 而不被拦。
    expect(getToolMeta('fetch_page').requiresApproval).toBe(true);
    expect(gradeCommandRisk('fetch https://evil.example.com')).toBe('write');
  });
});

describe('resolveApprovalDecision 单点判定（P0-1）', () => {
  const mkEntry = (name, meta) => ({ schema: { type: 'function', function: { name } }, meta });

  it('非敏感工具 + 自主模式 → 免审批', () => {
    const d = resolveApprovalDecision(mkEntry('search_news', {}), { approvalMode: 'autonomous' }, {});
    expect(d.required).toBe(false);
  });

  it('非敏感工具 + 协助模式 → 需审批', () => {
    const d = resolveApprovalDecision(mkEntry('search_news', {}), { approvalMode: 'assist' }, {});
    expect(d.required).toBe(true);
    expect(d.reason).toContain('协助模式');
  });

  it('敏感工具 + 自主模式 → 需审批', () => {
    const d = resolveApprovalDecision(mkEntry('write_workspace_file', { requiresApproval: true }), { approvalMode: 'autonomous' }, {});
    expect(d.required).toBe(true);
    expect(d.reason).toContain('敏感操作');
  });

  it('敏感工具被 riskLevel 判为只读 + 自主模式 → 降级免审批', () => {
    const entry = mkEntry('execute_command', { requiresApproval: true, riskLevel: () => 'read' });
    const d = resolveApprovalDecision(entry, { approvalMode: 'autonomous' }, { command: 'ls' });
    expect(d.required).toBe(false);
  });

  it('敏感工具被判只读 + 协助模式 → 仍需审批（assist 语义是每步都看）', () => {
    const entry = mkEntry('execute_command', { requiresApproval: true, riskLevel: () => 'read' });
    const d = resolveApprovalDecision(entry, { approvalMode: 'assist' }, { command: 'ls' });
    expect(d.required).toBe(true);
  });

  it('riskLevel 抛异常时保守判为 write（fail-closed）', () => {
    const entry = mkEntry('execute_command', {
      requiresApproval: true,
      riskLevel: () => { throw new Error('boom'); },
    });
    const d = resolveApprovalDecision(entry, { approvalMode: 'autonomous' }, {});
    expect(d.required).toBe(true);
  });
});

describe('审批卡去重：一次调用只弹一张（P0-1 回归防线）', () => {
  const SID = 'approval-test-session';

  beforeEach(() => {
    vi.unstubAllGlobals();
    clearSessionGrants(SID);
  });
  afterEach(() => {
    clearSessionGrants(SID);
    vi.unstubAllGlobals();
  });

  it('协助模式下调用非敏感工具，只产生 1 次审批请求', async () => {
    const { seen, unsub } = autoRespond('allow-once');
    try {
      await executeAgentTool('search_news', { keyword: 'x' }, {
        sessionId: SID,
        approvalMode: 'assist',
      });
    } finally { unsub(); }
    expect(seen.length).toBe(1);
    expect(seen[0].request.toolName).toBe('search_news');
    expect(seen[0].request.reason).toContain('协助模式');
  });

  it('协助模式下调用敏感工具，也只产生 1 次审批请求（不是循环层+注册表层两张）', async () => {
    const { seen, unsub } = autoRespond('allow-once');
    try {
      await executeAgentTool('execute_command', { command: 'rm a.md' }, {
        sessionId: SID,
        approvalMode: 'assist',
      });
    } finally { unsub(); }
    expect(seen.length).toBe(1);
  });

  it('allow-always 后同工具第二次调用不再弹卡', async () => {
    const { seen, unsub } = autoRespond('allow-always');
    try {
      await executeAgentTool('search_news', { keyword: 'a' }, { sessionId: SID, approvalMode: 'assist' });
      expect(seen.length).toBe(1);
      await executeAgentTool('search_news', { keyword: 'b' }, { sessionId: SID, approvalMode: 'assist' });
      expect(seen.length).toBe(1); // 仍然是 1，没有新增
    } finally { unsub(); }
  });

  it('自主模式下只读命令 0 次审批，写命令 1 次审批', async () => {
    const readRun = autoRespond('allow-once');
    try {
      await executeAgentTool('execute_command', { command: 'ls' }, { sessionId: SID, approvalMode: 'autonomous' });
    } finally { readRun.unsub(); }
    expect(readRun.seen.length).toBe(0);

    const writeRun = autoRespond('allow-once');
    try {
      await executeAgentTool('execute_command', { command: 'mkdir docs' }, { sessionId: SID, approvalMode: 'autonomous' });
    } finally { writeRun.unsub(); }
    expect(writeRun.seen.length).toBe(1);
    expect(writeRun.seen[0].request.summary).toBe('mkdir docs');
  });

  it('用户拒绝时返回可回灌给 LLM 的中文错误，而不是抛异常', async () => {
    const { unsub } = autoRespond('deny');
    let result;
    try {
      result = await executeAgentTool('execute_command', { command: 'rm a.md' }, {
        sessionId: SID,
        approvalMode: 'autonomous',
      });
    } finally { unsub(); }
    expect(result).toContain('用户拒绝授权');
    expect(result.startsWith('错误：')).toBe(true);
  });
});

describe('自定义 HTTP 工具安全收紧（P1-8）', () => {
  const NAME = 'my_test_http_tool';

  afterEach(() => {
    deleteCustomTool(NAME);
    setEgressAllowlist([]);
    vi.unstubAllGlobals();
  });

  it('注册后默认 requiresApproval=true', () => {
    registerCustomHttpTool(NAME, { method: 'GET', url: 'https://api.example.com/{{q}}' }, { label: '测试' });
    const entry = getTool(NAME);
    expect(entry).toBeTruthy();
    expect(entry.meta.requiresApproval).toBe(true);
  });

  it('bodyTemplate 中含引号的参数被 JSON 转义，body 仍是合法 JSON', async () => {
    let capturedBody = null;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init.body;
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
    }));
    await testCustomHttpTool(
      { method: 'POST', url: 'https://api.example.com/ask', bodyTemplate: '{"q":"{{query}}"}' },
      { query: '他说"你好"\n换行\\反斜杠' },
    );
    expect(capturedBody).toBeTruthy();
    // 关键断言：转义后仍可解析，且值被完整还原（没被撕成两段）
    const parsed = JSON.parse(capturedBody);
    expect(parsed.q).toBe('他说"你好"\n换行\\反斜杠');
  });

  it('参数试图注入额外 JSON 字段时不会生效', async () => {
    let capturedBody = null;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init.body;
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
    }));
    await testCustomHttpTool(
      { method: 'POST', url: 'https://api.example.com/ask', bodyTemplate: '{"q":"{{query}}"}' },
      { query: 'x","admin":true' },
    );
    const parsed = JSON.parse(capturedBody);
    expect(parsed.admin).toBeUndefined();
    expect(parsed.q).toBe('x","admin":true');
  });

  it('非 http(s) 地址被拒绝', async () => {
    const r = await testCustomHttpTool({ method: 'GET', url: 'file:///etc/passwd' }, {});
    expect(r).toContain('错误');
  });

  it('出口白名单生效时，白名单外的域名被拒绝', async () => {
    setEgressAllowlist(['api.allowed.com']);
    const blocked = await testCustomHttpTool({ method: 'GET', url: 'https://evil.example.com/x' }, {});
    expect(blocked).toContain('错误');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'pong',
    })));
    const allowed = await testCustomHttpTool({ method: 'GET', url: 'https://api.allowed.com/ping' }, {});
    expect(allowed).toBe('pong');
  });

  it('参数名含正则元字符不会破坏占位符替换', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => String(url),
    })));
    const r = await testCustomHttpTool(
      { method: 'GET', url: 'https://api.example.com/?a={{a.b}}' },
      { 'a.b': 'v1' },
    );
    expect(r).toContain('a=v1');
  });
});
