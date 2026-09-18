const MAX_BODY_BYTES = 2 * 1024 * 1024;
// 上传请求体上限（video 25MB + multipart 开销余量），超出直接 413
const MAX_UPLOAD_BODY_BYTES = 30 * 1024 * 1024;

export function sendJsonResponse(res, status, payload, headers = {}) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE', status: 413 });
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE', status: 413 });
    try { return JSON.parse(req.body); } catch { throw Object.assign(new Error('Invalid JSON body'), { code: 'INVALID_JSON', status: 400 }); }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { code: 'INVALID_JSON', status: 400 });
  }
}

/** 二进制读体（multipart 上传用）：累计超限即断流并 413，避免恶意大包撑爆内存 */
export async function readRawBody(req, maxBytes = MAX_UPLOAD_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('上传内容过大'), { code: 'BODY_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(req) {
  return String(req.headers?.cookie || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { cookies[key] = ''; }
    return cookies;
  }, {});
}

export function sessionCookie(token, { clear = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const value = clear ? '' : encodeURIComponent(token);
  const maxAge = clear ? 0 : 2592000;
  return `meridian_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// 连接类错误：数据库未启动 / 网络不可达时，pg 会抛出这些系统错误码或带特定文案的错误，
// 需要归一为可读提示，而不是把空 message 暴露成「请求失败」。
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', '57P01', '57P03']);
const CONNECTION_MESSAGE_RE = /(could not connect|connection (to server|refused|terminated)|database .* does not exist|no pg_hba\.conf|remaining connection slots are reserved)/i;

export function routeError(res, error) {
  const code = error?.code;
  const isDatabaseError = code === 'DATABASE_UNAVAILABLE'
    || (code && CONNECTION_ERROR_CODES.has(code))
    || CONNECTION_MESSAGE_RE.test(error?.message || '');
  if (isDatabaseError) {
    return sendJsonResponse(res, 503, {
      ok: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时无法连接，账户与社区功能暂不可用，请稍后重试' },
    });
  }
  const status = error?.status || 500;
  const message = status >= 500 && code === 'INTERNAL_ERROR' ? '服务暂时不可用' : (error?.message || '请求失败');
  return sendJsonResponse(res, status, { ok: false, error: { code: code || 'INTERNAL_ERROR', message } });
}
