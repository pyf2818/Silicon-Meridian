import { getAuthService } from '../auth/authService.js';
import { getCommunityService } from '../community/communityService.js';
import { getUploadRepository, classifyUpload, assertUploadSize, MAX_UPLOADS_PER_REQUEST } from '../community/uploads.js';
import { parseCookies, readJsonBody, readRawBody, routeError, sendJsonResponse } from './httpUtils.js';
import { parseMultipart } from './multipart.js';

const writeWindows = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUuid(value) {
  if (!UUID_RE.test(String(value || ''))) throw Object.assign(new Error('资源标识无效'), { code: 'INVALID_ID', status: 400 });
  return value;
}
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (writeWindows.get(key) || []).filter(time => now - time < windowMs);
  if (hits.length >= max) throw Object.assign(new Error('操作过于频繁，请稍后再试'), { code: 'RATE_LIMITED', status: 429 });
  hits.push(now); writeWindows.set(key, hits);
}

async function viewer(req, auth, required = false) {
  const user = await auth.authenticate(parseCookies(req).meridian_session || '');
  if (required && !user) throw Object.assign(new Error('请先登录'), { code: 'UNAUTHORIZED', status: 401 });
  return user;
}

export async function handleCommunityRequest(req, res, { path = [], service, authService } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const parts = Array.isArray(path) ? path.filter(Boolean) : String(path || '').split('/').filter(Boolean);
  try {
    const community = service || await getCommunityService();
    const auth = authService || await getAuthService();
    if (parts[0] === 'posts' && parts.length === 1) {
      let user = await viewer(req, auth);
      if (method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        // author=me → 我的作品（含草稿）；需要登录态
        let authorId = null;
        if (url.searchParams.get('author') === 'me') {
          if (!user) throw Object.assign(new Error('请先登录'), { code: 'UNAUTHORIZED', status: 401 });
          authorId = user.id;
        }
        const data = await community.listPosts({
          viewerId: user?.id, cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit'), authorId,
          // B1：频道过滤 / 关键词搜索 / 场景标签 / 关注流
          channel: url.searchParams.get('channel'),
          q: url.searchParams.get('q'),
          tag: url.searchParams.get('tag'),
          followingOnly: url.searchParams.get('following') === '1',
        });
        return sendJsonResponse(res, 200, { ok: true, data });
      }
      if (method === 'POST') {
        user = await viewer(req, auth, true); rateLimit(`post:${user.id}`, 10, 60 * 60 * 1000);
        return sendJsonResponse(res, 201, { ok: true, data: { post: await community.createPost({ userId: user.id, input: await readJsonBody(req) }) } });
      }
    }
    if (parts[0] === 'bookmarks' && parts.length === 1 && method === 'GET') {
      const user = await viewer(req, auth, true);
      const url = new URL(req.url, 'http://localhost');
      const data = await community.listBookmarks({ viewerId: user.id, cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit') });
      return sendJsonResponse(res, 200, { ok: true, data });
    }
    if (parts[0] === 'posts' && parts[1]) {
      const postId = requireUuid(parts[1]);
      const user = await viewer(req, auth, method !== 'GET');
      if (parts.length === 2) {
        if (method === 'GET') return sendJsonResponse(res, 200, { ok: true, data: { post: await community.getPost({ postId, viewerId: user?.id }) } });
        if (method === 'PATCH') return sendJsonResponse(res, 200, { ok: true, data: { post: await community.updatePost({ userId: user.id, postId, input: await readJsonBody(req) }) } });
        if (method === 'DELETE') { await community.deletePost({ userId: user.id, postId }); return sendJsonResponse(res, 200, { ok: true, data: {} }); }
      }
      if (parts[2] === 'comments') {
        if (method === 'GET') return sendJsonResponse(res, 200, { ok: true, data: { comments: await community.listComments({ postId, viewerId: user?.id }) } });
        if (method === 'POST') {
          rateLimit(`comment:${user.id}`, 30, 60 * 60 * 1000); const body = await readJsonBody(req);
          return sendJsonResponse(res, 201, { ok: true, data: { comment: await community.createComment({ userId: user.id, postId, body: body.body, parentId: body.parentId, kind: body.kind }) } });
        }
      }
      if ((parts[2] === 'like' || parts[2] === 'bookmark') && (method === 'PUT' || method === 'DELETE')) {
        const enabled = method === 'PUT';
        const post = parts[2] === 'like'
          ? await community.setLike({ userId: user.id, postId, enabled })
          : await community.setBookmark({ userId: user.id, postId, enabled });
        return sendJsonResponse(res, 200, { ok: true, data: { post } });
      }
    }
    if (parts[0] === 'users' && parts[1] && parts[2] === 'follow' && (method === 'PUT' || method === 'DELETE')) {
      const user = await viewer(req, auth, true);
      return sendJsonResponse(res, 200, { ok: true, data: await community.setFollow({ userId: user.id, followedId: requireUuid(parts[1]), enabled: method === 'PUT' }) });
    }
    // C3 任务 3：本地上传（multipart）。登录 + 限流；校验（mime 白名单 + 魔法数嗅探 + 分级大小）后 bytea/内存入库
    if (parts[0] === 'uploads' && parts.length === 1 && method === 'POST') {
      const user = await viewer(req, auth, true);
      rateLimit(`upload:${user.id}`, 30, 60 * 60 * 1000);
      const contentType = req.headers?.['content-type'] || '';
      if (!/multipart\/form-data/i.test(contentType)) throw Object.assign(new Error('请使用 multipart/form-data 上传'), { code: 'INVALID_MULTIPART', status: 400 });
      const body = await readRawBody(req);
      const { files } = parseMultipart(body, contentType);
      if (!files.length) throw Object.assign(new Error('未收到任何文件'), { code: 'UPLOAD_EMPTY', status: 400 });
      if (files.length > MAX_UPLOADS_PER_REQUEST) throw Object.assign(new Error(`单次最多上传 ${MAX_UPLOADS_PER_REQUEST} 个文件`), { code: 'UPLOAD_TOO_MANY', status: 400 });
      const repository = await getUploadRepository();
      const results = [];
      for (const file of files) {
        const { kind, mime } = classifyUpload(file.filename, file.contentType, file.data);
        assertUploadSize(kind, file.data.length);
        const record = await repository.createUpload({ ownerId: user.id, kind, mime, name: file.filename, size: file.data.length, data: file.data });
        results.push({ ...record, url: `/api/community/uploads/${record.id}` });
      }
      return sendJsonResponse(res, 201, { ok: true, data: { uploads: results } });
    }
    // 上传物公开读：帖子里的图/视频要能匿名查看（id 为 uuid，防遍历注入）
    if (parts[0] === 'uploads' && parts.length === 2 && method === 'GET') {
      const upload = await (await getUploadRepository()).getUpload(requireUuid(parts[1]));
      if (!upload) throw Object.assign(new Error('文件不存在或已被删除'), { code: 'UPLOAD_NOT_FOUND', status: 404 });
      const isMedia = upload.kind === 'image' || upload.kind === 'video';
      const safeName = String(upload.name || '').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 120) || 'download';
      res.statusCode = 200;
      res.setHeader('Content-Type', upload.mime);
      res.setHeader('Content-Length', upload.data.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Disposition', `${isMedia ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`);
      res.end(upload.data);
      return undefined;
    }
    return sendJsonResponse(res, 404, { ok: false, error: { code: 'COMMUNITY_ROUTE_NOT_FOUND', message: '社区接口不存在' } });
  } catch (error) {
    return routeError(res, error);
  }
}
