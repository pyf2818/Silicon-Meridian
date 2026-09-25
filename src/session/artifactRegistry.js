/**
 * artifactRegistry.js - 产物中心纯逻辑层（前后端单源，无 React / 无 HTTP / 无 Node 专属 API）
 *
 * 设计对齐 WorkBuddy「任务 → 交付物 → 结果区验收」：
 *   - 产物只以 opaque uuid 引用流转，前端永不接触服务器路径
 *   - kind / mime 走白名单归一（服务端同样执行本文件的 normalize，单一实现防漂移）
 *   - 大小上限 8MB（base64 回传后 JSON 约 10.7MB，handler 侧 readRawBody(12MB) 覆盖）
 *   - meta 只收白名单键，防垃圾注入撑爆行
 */

export const ARTIFACT_KINDS = ['report', 'code', 'chart', 'table', 'file', 'image'];

/** kind 的前端展示元数据（图标/文案），纯数据可安全进浏览器包 */
export const ARTIFACT_KIND_META = {
  report: { label: '报告', icon: '📄' },
  code: { label: '代码', icon: '💻' },
  chart: { label: '图表', icon: '📊' },
  table: { label: '表格', icon: '🗂️' },
  file: { label: '文件', icon: '📎' },
  image: { label: '图片', icon: '🖼️' },
};

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

/** SVG 需要响应侧加 sandbox CSP（见 artifactHandlers），但注册侧允许它进白名单 */
const MIME_WHITELIST = new Set([
  'text/markdown', 'text/plain', 'text/csv', 'text/html',
  'application/json',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'application/octet-stream',
]);

/** meta 白名单键：来源与生产者信息，全部转字符串并截断 */
const META_KEYS = ['source', 'agentName', 'toolName', 'format', 'ext', 'version', 'sessionTag'];

const EXT_MIME_MAP = {
  md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
  json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  js: 'text/plain', ts: 'text/plain', jsx: 'text/plain', tsx: 'text/plain', py: 'text/plain', css: 'text/plain',
};

const EXT_KIND_MAP = {
  md: 'report', html: 'report', json: 'report',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', css: 'code',
  csv: 'table',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image',
};

function str(value, max) {
  const s = String(value ?? '').trim();
  return s.slice(0, max);
}

/** 从文件名推断 { kind, mime }（白名单外归一为 file/octet-stream） */
export function artifactKindFromFilename(filename) {
  const name = str(filename, 200);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mime = EXT_MIME_MAP[ext] || 'application/octet-stream';
  const kind = EXT_KIND_MAP[ext] || (mime.startsWith('image/') ? 'image' : 'file');
  return { kind, mime, ext };
}

/**
 * 归一一次产物注册输入。抛错条件：内容缺失或超限。
 * @param {Object} input
 * @param {string} input.kind
 * @param {string} input.title
 * @param {string} [input.mime]
 * @param {string} [input.filename] - 与 mime 二选一，可由扩展名推断 kind/mime
 * @param {string} [input.sessionId] [input.taskId]
 * @param {Object} [input.meta]
 * @param {string} [input.content] - utf-8 文本
 * @param {{encoding:'base64', data:string}} [input.binary] - 二进制（base64）
 * @returns {{ record: {kind,title,mime,sessionId,taskId,size,meta}, buffer: null | { toBuffer():Uint8Array } }}
 *   buffer 用惰性描述返回（避免本文件依赖 Buffer），服务端 decode；前端只需 size。
 */
export function normalizeArtifactInput(input = {}) {
  const hasText = typeof input.content === 'string' && input.content.length > 0;
  const hasBinary = Boolean(input.binary && input.binary.encoding === 'base64' && typeof input.binary.data === 'string' && input.binary.data.length > 0);
  if (!hasText && !hasBinary) {
    throw Object.assign(new Error('产物内容为空'), { code: 'ARTIFACT_EMPTY', status: 400 });
  }

  const size = hasText
    ? byteLengthOf(input.content)
    : base64ByteLength(input.binary.data);
  if (size > MAX_ARTIFACT_BYTES) {
    throw Object.assign(new Error(`产物超过大小上限（${Math.round(MAX_ARTIFACT_BYTES / 1024 / 1024)}MB）`), {
      code: 'ARTIFACT_TOO_LARGE', status: 413,
    });
  }

  const inferred = artifactKindFromFilename(input.filename || '');
  let kind = ARTIFACT_KINDS.includes(input.kind) ? input.kind : inferred.kind;
  let mime = MIME_WHITELIST.has(input.mime) ? input.mime : inferred.mime;
  // 用户显式给了 kind/mime 但互相矛盾的极端情况以 mime 可判优先（image/* 恒为 image）
  if (mime.startsWith('image/')) kind = 'image';

  const meta = {};
  if (input.meta && typeof input.meta === 'object') {
    for (const key of META_KEYS) {
      if (input.meta[key] !== undefined && input.meta[key] !== null && input.meta[key] !== '') {
        meta[key] = str(input.meta[key], 120);
      }
    }
  }
  if (!meta.ext && inferred.ext) meta.ext = inferred.ext.slice(0, 12);

  const record = {
    kind,
    title: str(input.title, 200) || `未命名${ARTIFACT_KIND_META[kind]?.label || '产物'}`,
    mime,
    sessionId: str(input.sessionId, 120),
    taskId: str(input.taskId, 120),
    size,
    meta,
  };
  return { record, hasBinary };
}

/** utf-8 字节数（不依赖 Buffer，纯 JS 实现，浏览器/Node 通用） */
export function byteLengthOf(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  // 兜底（极老环境）：转义法估算
  return unescape(encodeURIComponent(text)).length;
}

/** base64 字节数：len * 3/4 再扣除 padding */
export function base64ByteLength(b64) {
  const len = String(b64 || '').length;
  if (!len) return 0;
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor(len * 3 / 4) - padding);
}

/** 服务端把归一后的输入转成 Buffer（仅在 Node 侧调用） */
export function artifactContentToBuffer(input) {
  if (typeof input.content === 'string') return Buffer.from(input.content, 'utf8');
  if (input.binary && input.binary.encoding === 'base64') {
    const buf = Buffer.from(String(input.binary.data || ''), 'base64');
    if (!buf.length) throw Object.assign(new Error('产物内容为空'), { code: 'ARTIFACT_EMPTY', status: 400 });
    return buf;
  }
  throw Object.assign(new Error('产物内容为空'), { code: 'ARTIFACT_EMPTY', status: 400 });
}

/** uuid 形状校验（early reject，省一次仓储查询） */
export function isArtifactId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * 前端注册客户端（薄封装，便于 mock 与单测）
 * @param {{ fetchImpl?: Function, base?: string }} opts
 */
export function createArtifactClient({ fetchImpl, base = '' } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) throw new Error('createArtifactClient: no fetch implementation');
  return {
    async register(input) {
      const res = await doFetch(`${base}/api/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || '产物注册失败');
      return data.artifact;
    },
    async list({ sessionId, kind, limit = 50, offset = 0 } = {}) {
      const params = new URLSearchParams();
      if (sessionId) params.set('session', sessionId);
      if (kind) params.set('kind', kind);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const res = await doFetch(`${base}/api/artifacts?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || '产物列表加载失败');
      return data;
    },
    contentUrl(id) {
      return `${base}/api/artifacts/${id}`;
    },
    async remove(id) {
      const res = await doFetch(`${base}/api/artifacts/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || '产物删除失败');
      return true;
    },
  };
}
