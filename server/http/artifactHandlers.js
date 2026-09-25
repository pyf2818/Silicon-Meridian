/**
 * artifactHandlers.js - 产物中心 HTTP 端点（dev plugin 与 Vercel serverless 共享）
 *
 * 路由（均需登录，鉴权对齐 chatHandlers 的 viewer 模式）：
 *   GET    /api/artifacts              列表（?session=&kind=&limit=&offset=）→ 元数据（不含内容）
 *   POST   /api/artifacts              注册 { kind,title,mime,filename,sessionId,taskId,meta,content|binary }
 *   GET    /api/artifacts/:id          内容（?meta=1 → 元数据 JSON；?download=1 → attachment）
 *   DELETE /api/artifacts/:id          删除
 *
 * 安全：
 *   - 全部按 session 归属 userId 过滤（越权读取收口）
 *   - 内容响应统一 X-Content-Type-Options: nosniff + CSP sandbox（隔离 SVG/HTML 内嵌脚本）
 *   - body 走 readRawBody(12MB)（产物 base64 后约 10.7MB，绕开 readJsonBody 的 2MB 通用限）
 */
import { getAuthService } from '../auth/authService.js';
import { getArtifactService } from '../artifacts/artifactService.js';
import { parseCookies, readJsonBody, readRawBody, routeError, sendJsonResponse } from './httpUtils.js';
import { isArtifactId } from '../../src/session/artifactRegistry.js';

const ARTIFACT_BODY_LIMIT = 12 * 1024 * 1024;

async function viewer(req, auth) {
  const user = await auth.authenticate(parseCookies(req).meridian_session || '');
  if (!user) throw Object.assign(new Error('请先登录后再使用产物中心'), { code: 'UNAUTHORIZED', status: 401 });
  return user;
}

const json = (res, status, data) => sendJsonResponse(res, status, { ok: true, data });

/** 内容响应公共头：nosniff + CSP sandbox（隔离内嵌脚本，SVG/HTML 预览安全） */
function contentHeaders(row, { download }) {
  const headers = {
    'Content-Type': row.mime || 'application/octet-stream',
    'Content-Length': String(row.data?.length ?? row.size ?? 0),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox",
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  const safeTitle = String(row.title || 'artifact').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 80) || 'artifact';
  const ext = String(row.mime || '').split('/')[1] || 'bin';
  headers['Content-Disposition'] = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.${ext}`)}`;
  return headers;
}

function sendContent(res, status, row, headers) {
  const body = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || '');
  if (typeof res.status === 'function') {
    // serverless（Vercel Node runtime）：res 是类 express 对象
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    return res.status(status).send(body);
  }
  res.statusCode = status;
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(body);
}

export async function handleArtifactRequest(req, res, { path = [], service, authService } = {}) {
  try {
    const parts = (Array.isArray(path) ? path : String(path).split('/')).filter(Boolean);
    const method = String(req.method || 'GET').toUpperCase();
    const artifacts = service || await getArtifactService();
    const auth = authService || await getAuthService();
    const user = await viewer(req, auth);

    // —— 列表 / 注册 ——
    if (parts.length === 0) {
      if (method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        const result = await artifacts.list(user.id, {
          sessionId: (url.searchParams.get('session') || '').slice(0, 120),
          kind: (url.searchParams.get('kind') || '').slice(0, 16),
          limit: Number(url.searchParams.get('limit')) || 50,
          offset: Number(url.searchParams.get('offset')) || 0,
        });
        return json(res, 200, result);
      }
      if (method === 'POST') {
        // 产物 body 可达 ~11MB，走 raw 读取 + 自解析（readJsonBody 有 2MB 通用硬限）
        const raw = await readRawBody(req, ARTIFACT_BODY_LIMIT);
        let body;
        try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch {
          throw Object.assign(new Error('无效的 JSON body'), { code: 'INVALID_JSON', status: 400 });
        }
        const artifact = await artifacts.register(user.id, body);
        return json(res, 201, { artifact });
      }
      throw Object.assign(new Error('不支持的方法'), { code: 'METHOD_NOT_ALLOWED', status: 405 });
    }

    // —— 单产物：内容 / 元数据 / 删除 ——
    const id = parts[0];
    if (!isArtifactId(id)) {
      throw Object.assign(new Error('产物 ID 无效'), { code: 'INVALID_ARTIFACT_ID', status: 400 });
    }
    if (parts.length > 1) {
      throw Object.assign(new Error('产物路径不存在'), { code: 'NOT_FOUND', status: 404 });
    }

    if (method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      if (url.searchParams.get('meta') === '1') {
        // 元数据视图：复用 list 的行形状，单条查询走 get 后剥 data
        const row = await artifacts.get(user.id, id);
        if (!row) throw Object.assign(new Error('产物不存在'), { code: 'NOT_FOUND', status: 404 });
        const { data, ...metaRow } = row;
        void data;
        return json(res, 200, { artifact: normalizeRow(metaRow) });
      }
      const row = await artifacts.get(user.id, id);
      if (!row) throw Object.assign(new Error('产物不存在'), { code: 'NOT_FOUND', status: 404 });
      return sendContent(res, 200, row, contentHeaders(row, { download: url.searchParams.get('download') === '1' }));
    }

    if (method === 'DELETE') {
      const removed = await artifacts.remove(user.id, id);
      if (!removed) throw Object.assign(new Error('产物不存在'), { code: 'NOT_FOUND', status: 404 });
      return json(res, 200, {});
    }

    throw Object.assign(new Error('不支持的方法'), { code: 'METHOD_NOT_ALLOWED', status: 405 });
  } catch (error) {
    return routeError(res, error);
  }
}

/** 内存/PG 行字段名归一（get 返回 snake 列名时转 camel） */
function normalizeRow(row) {
  return {
    id: row.id,
    sessionId: row.sessionId ?? row.session_id ?? '',
    taskId: row.taskId ?? row.task_id ?? '',
    kind: row.kind,
    title: row.title,
    mime: row.mime,
    size: Number(row.size || 0),
    meta: row.meta || {},
    createdAt: row.createdAt ?? row.created_at,
  };
}
