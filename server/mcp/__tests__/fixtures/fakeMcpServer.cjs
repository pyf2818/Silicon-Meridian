// fakeMcpServer.js - 冒烟测试用假 MCP server（stdio JSON-RPC over 行协议）
// 响应 initialize / tools/list / tools/call，验证 mcpRegistry 客户端链路
const readline = require('node:readline');

const TOOLS = [
  { name: 'echo', description: '回显输入', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'add', description: '两数相加', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '0.1.0' } } }) + '\n');
    return;
  }
  if (msg.method === 'notifications/initialized') return; // notification 无响应
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }) + '\n');
    return;
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params || {};
    let content;
    if (name === 'echo') content = [{ type: 'text', text: `echo: ${args.text || ''}` }];
    else if (name === 'add') content = [{ type: 'text', text: String((Number(args.a) || 0) + (Number(args.b) || 0)) }];
    else content = [{ type: 'text', text: `unknown tool: ${name}` }];
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content } }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } }) + '\n');
});
