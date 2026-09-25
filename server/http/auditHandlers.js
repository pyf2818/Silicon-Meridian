/**
 * auditHandlers.js - 审计查询端点（dev plugin 与 serverless 共享）
 *
 * GET /api/audit?action=&limit=  → 本人审计记录（时间倒序）
 * 仅登录用户可查自己的记录；写入路径在各业务 handler 内 recordAudit() fire-and-forget。
 */
import { getAuthService } from '../auth/authService.js';
import { getAuditService, AUDIT_ACTIONS } from '../security/auditService.js';
import { parseCookies, routeError, sendJsonResponse } from './httpUtils.js';

async function viewer(req, auth) {
  const user = await auth.authenticate(parseCookies(req).meridian_session || '');
  if (!user) throw Object.assign(new Error('请先登录'), { code: 'UNAUTHORIZED', status: 401 });
  return user;
}

export async function handleAuditRequest(req, res, { service, authService } = {}) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      throw Object.assign(new Error('不支持的方法'), { code: 'METHOD_NOT_ALLOWED', status: 405 });
    }
    const audit = service || await getAuditService();
    const auth = authService || await getAuthService();
    const user = await viewer(req, auth);
    const url = new URL(req.url, 'http://localhost');
    const result = await audit.list(user.id, {
      action: (url.searchParams.get('action') || '').slice(0, 64),
      limit: Number(url.searchParams.get('limit')) || 50,
    });
    return sendJsonResponse(res, 200, { ok: true, data: { ...result, actions: AUDIT_ACTIONS } });
  } catch (error) {
    return routeError(res, error);
  }
}
