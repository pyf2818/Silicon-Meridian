// agentMcpHandlers.js - AI 工作站 MCP 能力 HTTP handler
// 路由前缀: /api/agent/mcp/*
// 供前端 agent 工具链（mcp_call / list_mcp_tools）代理调用外部 MCP 服务器
import { listMcpServers, listMcpTools, callMcpTool } from '../mcp/mcpRegistry.js';
import { sendJsonResponse, readJsonBody } from './httpUtils.js';

export async function handleAgentMcpRequest(req, res, pathname, method) {
  // GET /api/agent/mcp/servers —— 已配置的 MCP 服务器列表
  if (pathname === '/api/agent/mcp/servers' && method === 'GET') {
    return sendJsonResponse(res, 200, { ok: true, servers: listMcpServers() });
  }

  // POST /api/agent/mcp/tools —— 列出某服务器可用工具
  if (pathname === '/api/agent/mcp/tools' && method === 'POST') {
    const body = await readJsonBody(req);
    try {
      const tools = await listMcpTools(String(body?.server || ''));
      return sendJsonResponse(res, 200, { ok: true, tools });
    } catch (error) {
      return sendJsonResponse(res, 400, { ok: false, error: { message: error?.message || String(error) } });
    }
  }

  // POST /api/agent/mcp/call —— 调用 MCP 工具
  if (pathname === '/api/agent/mcp/call' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await callMcpTool(String(body?.server || ''), String(body?.tool || ''), body?.args || {});
    return sendJsonResponse(res, 200, result);
  }

  return sendJsonResponse(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
}
