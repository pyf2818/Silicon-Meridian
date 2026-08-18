// mcpRegistry.test.js - MCP 客户端 stdio 传输的 vitest 集成测试
// 用 fakeMcpServer.cjs（行协议 JSON-RPC）验证：握手 → tools/list → tools/call → 会话复用 → 错误路径
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _resetForTest, listMcpServers, listMcpTools, callMcpTool,
} from '../mcpRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeServer = join(here, 'fixtures', 'fakeMcpServer.cjs');

let tempDir;
let configPath;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  configPath = join(tempDir, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      smoke: { command: process.execPath, args: [fakeServer], description: '冒烟测试假服务器' },
    },
  }, null, 2));
  process.env.MCP_CONFIG_PATH = configPath;
  _resetForTest();
});

afterEach(() => {
  delete process.env.MCP_CONFIG_PATH;
  _resetForTest();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('mcpRegistry（stdio 传输）', () => {
  it('列出已配置服务器（transport 识别）', () => {
    const servers = listMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'smoke', transport: 'stdio', description: '冒烟测试假服务器' });
  });

  it('listMcpTools 完成 initialize 握手并映射工具 schema', async () => {
    const tools = await listMcpTools('smoke');
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: 'echo' });
    expect(tools[0].inputSchema?.type).toBe('object');
  });

  it('callMcpTool 文本工具返回正确', async () => {
    const result = await callMcpTool('smoke', 'echo', { text: '你好 MCP' });
    expect(result.ok).toBe(true);
    expect(result.result).toBe('echo: 你好 MCP');
  });

  it('callMcpTool 数字参数工具返回正确', async () => {
    const result = await callMcpTool('smoke', 'add', { a: 3, b: 4 });
    expect(result.ok).toBe(true);
    expect(result.result).toBe('7');
  });

  it('会话复用：连续调用不重启进程', async () => {
    await listMcpTools('smoke');
    const first = await callMcpTool('smoke', 'echo', { text: 'a' });
    const second = await callMcpTool('smoke', 'echo', { text: 'b' });
    expect(first.result).toBe('echo: a');
    expect(second.result).toBe('echo: b');
  });

  it('未知服务器返回友好错误', async () => {
    const result = await callMcpTool('nope', 'x', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未配置/);
  });

  it('缺少参数返回错误', async () => {
    const noServer = await callMcpTool('', 'x', {});
    expect(noServer.ok).toBe(false);
    expect(noServer.error).toMatch(/server/);
    const noTool = await callMcpTool('smoke', '', {});
    expect(noTool.ok).toBe(false);
    expect(noTool.error).toMatch(/tool/);
  });
});
