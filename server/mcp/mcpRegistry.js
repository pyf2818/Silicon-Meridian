// mcpRegistry.js - MCP（Model Context Protocol）客户端注册表
//
// 目标：给 AI 工作站的 agent 提供「外部 MCP 工具」能力（审计 B6）。
// - 配置来源（合并，项目级优先）：
//     1. <项目根>/mcp.config.json   { "mcpServers": { "<name>": { "command|url", "args", "env", "description" } } }
//     2. ~/.workbuddy/mcp.json      （WorkBuddy 用户级 MCP 配置，格式同上）
// - 传输方式：
//     stdio —— 本地 spawn 子进程，JSON-RPC 2.0 over stdin/stdout（按行）
//     http  —— 远程端点，POST JSON-RPC（兼容 application/json 与 text/event-stream 响应）
// - 会话复用：stdio 子进程按 server 缓存，进程异常退出时自动重建。
//
// 注意：只导出纯函数/类，不依赖 HTTP 层，便于单测。

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RESULT_CHARS = 12_000;

const serversCache = new Map(); // name -> { ...config, transport }
let loaded = false;

function loadServers() {
  if (loaded) return serversCache;
  loaded = true;
  const candidates = [];
  // 测试可注入自定义配置路径（优先级最高，避免污染项目根 mcp.config.json）
  if (process.env.MCP_CONFIG_PATH) candidates.push(process.env.MCP_CONFIG_PATH);
  candidates.push(join(process.cwd(), 'mcp.config.json'), join(homedir(), '.workbuddy', 'mcp.json'));
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      const entries = parsed?.mcpServers && typeof parsed.mcpServers === 'object' ? Object.entries(parsed.mcpServers) : [];
      for (const [name, config] of entries) {
        if (!config || (!config.command && !config.url)) continue;
        serversCache.set(name, {
          ...config,
          transport: config.url ? 'http' : 'stdio',
        });
      }
    } catch {
      // 单个配置文件损坏不影响其它来源
    }
  }
  return serversCache;
}

export function listMcpServers() {
  return [...loadServers().entries()].map(([name, config]) => ({
    name,
    transport: config.transport,
    description: config.description || '',
  }));
}

export function getMcpServer(name) {
  return loadServers().get(name) || null;
}

/* ============ stdio 传输：JSON-RPC over 子进程 stdin/stdout ============ */

class StdioSession {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.nextId = 1;
    this.pending = new Map();
    this.lineBuffer = '';
    this.closed = false;
    this.stderrBuf = '';
    this.child = spawn(config.command, Array.isArray(config.args) ? config.args : [], {
      env: { ...process.env, ...(config.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stderr.on('data', chunk => {
      this.stderrBuf = (this.stderrBuf + String(chunk)).slice(-2000);
    });
    this.child.stdout.on('data', chunk => this._onData(String(chunk)));
    this.child.on('error', err => this._failAll(new Error(`MCP 进程启动失败：${err.message}`)));
    this.child.on('exit', code => this._failAll(new Error(`MCP 进程退出（code=${code}）：${this.stderrBuf.slice(-300)}`)));
  }

  _onData(chunk) {
    this.lineBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message?.id != null && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message || 'MCP JSON-RPC error'));
          else resolve(message.result);
        }
      } catch {
        // 非 JSON 行（如启动 banner）：忽略
      }
    }
  }

  _failAll(error) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  async request(method, params) {
    if (this.closed) throw new Error(`MCP 服务器 "${this.name}" 不可用`);
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 调用超时（${REQUEST_TIMEOUT_MS / 1000}s）：${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  notify(method, params) {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.child.kill(); } catch { /* ignore */ }
  }
}

const stdioSessions = new Map(); // name -> StdioSession

function getStdioSession(name) {
  let session = stdioSessions.get(name);
  if (session && session.closed) {
    stdioSessions.delete(name);
    session = null;
  }
  if (!session) {
    const config = getMcpServer(name);
    if (!config || config.transport !== 'stdio') return null;
    session = new StdioSession(name, config);
    stdioSessions.set(name, session);
  }
  return session;
}

async function stdioHandshake(session) {
  await session.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'silicon-meridian-agent', version: '1.0.0' },
  });
  session.notify('notifications/initialized');
}

/* ============ http / SSE 传输 ============ */

async function httpRequest(config, method, params) {
  const res = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(config.headers || {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${res.statusText}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    const dataLine = text.split('\n').find(line => line.startsWith('data:'));
    if (!dataLine) throw new Error('MCP SSE 响应缺少 data 事件');
    return JSON.parse(dataLine.slice(5).trim());
  }
  return await res.json();
}

async function httpCall(config, method, params) {
  const result = await httpRequest(config, method, params);
  if (result?.error) throw new Error(result.error.message || 'MCP JSON-RPC error');
  return result?.result;
}

/* ============ 对外 API ============ */

function extractText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return JSON.stringify(result ?? {}, null, 2);
  const text = content
    .filter(item => item && item.type === 'text' && item.text)
    .map(item => item.text)
    .join('\n');
  return text || JSON.stringify(result ?? {}, null, 2);
}

/**
 * 列出某个 MCP 服务器可用的工具（映射为 OpenAI function schema 供 agent 使用）
 */
export async function listMcpTools(serverName) {
  if (!serverName) throw new Error('server 参数不能为空');
  const config = getMcpServer(serverName);
  if (!config) throw new Error(`MCP 服务器 "${serverName}" 未配置`);

  let tools = [];
  if (config.transport === 'stdio') {
    const session = getStdioSession(serverName);
    if (!session) throw new Error(`MCP 服务器 "${serverName}" 不可用`);
    await stdioHandshake(session);
    const result = await session.request('tools/list', {});
    tools = Array.isArray(result?.tools) ? result.tools : [];
  } else {
    await httpCall(config, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'silicon-meridian-agent', version: '1.0.0' },
    });
    const result = await httpCall(config, 'tools/list', {});
    tools = Array.isArray(result?.tools) ? result.tools : [];
  }

  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * 调用 MCP 工具
 * @returns {Promise<{ok: boolean, result?: string, isError?: boolean, error?: string}>}
 */
export async function callMcpTool(serverName, toolName, args = {}) {
  if (!serverName) return { ok: false, error: 'server 参数不能为空' };
  if (!toolName) return { ok: false, error: 'tool 参数不能为空' };
  const config = getMcpServer(serverName);
  if (!config) return { ok: false, error: `MCP 服务器 "${serverName}" 未配置` };

  try {
    let result;
    if (config.transport === 'stdio') {
      const session = getStdioSession(serverName);
      if (!session) return { ok: false, error: `MCP 服务器 "${serverName}" 不可用` };
      await stdioHandshake(session);
      result = await session.request('tools/call', { name: toolName, arguments: args || {} });
    } else {
      result = await httpCall(config, 'tools/call', { name: toolName, arguments: args || {} });
    }
    if (result?.isError) {
      return { ok: false, error: extractText(result) || 'MCP 工具执行失败' };
    }
    let text = extractText(result);
    if (text.length > MAX_RESULT_CHARS) {
      text = text.slice(0, MAX_RESULT_CHARS) + `\n\n[结果过长，已截断，原长度 ${text.length} 字符]`;
    }
    return { ok: true, result: text };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

/** 测试辅助：清空缓存（单测用） */
export function _resetForTest() {
  for (const session of stdioSessions.values()) session.close();
  stdioSessions.clear();
  serversCache.clear();
  loaded = false;
}
