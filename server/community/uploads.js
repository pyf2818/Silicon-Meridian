import { randomUUID } from 'node:crypto';
import { getPool } from '../db/client.js';
import { isDevMemoryMode } from '../db/devMemoryStore.js';

/**
 * C3 任务 3：社区上传服务（图片/视频/附件）。
 *
 * 安装模型：POST /api/community/uploads（multipart）→ 校验 → bytea/内存入库 →
 * 返回 { id, url, kind, mime, name, size }；GET 同路径返回二进制（图/视频 inline，附件 attachment）。
 *
 * 安全闸（对抗性视角）：
 * - mime 白名单（客户端 Content-Type 完全不可信，只做参考）
 * - 魔法数嗅探：扩展名声明的 kind 与文件头不符直接拒（exe 伪装 .jpg / html 伪装 .png 均被拦）
 * - 大小分级限制 + 每用户限流在 handler 层
 */

export const UPLOAD_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  file: 10 * 1024 * 1024,
};
export const MAX_UPLOADS_PER_REQUEST = 12;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
const FILE_MIMES = new Set([
  'application/pdf', 'application/zip', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const EXT_MIME = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'], ['gif', 'image/gif'],
  ['mp4', 'video/mp4'], ['webm', 'video/webm'],
  ['pdf', 'application/pdf'], ['zip', 'application/zip'],
  ['txt', 'text/plain'], ['md', 'text/markdown'], ['csv', 'text/csv'], ['json', 'application/json'],
  ['doc', 'application/msword'], ['xls', 'application/vnd.ms-excel'], ['ppt', 'application/vnd.ms-powerpoint'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
]);

const startsWith = (data, offset, hex) => {
  if (data.length < offset + hex.length / 2) return false;
  for (let i = 0; i < hex.length / 2; i += 1) {
    if (data[offset + i] !== parseInt(hex.slice(i * 2, i * 2 + 2), 16)) return false;
  }
  return true;
};

/** 魔法数嗅探：返回可信 mime；无法识别（纯文本等）返回 '' */
export function sniffMime(data) {
  if (!data || data.length < 12) return '';
  if (startsWith(data, 0, 'ffd8ff')) return 'image/jpeg';
  if (startsWith(data, 0, '89504e470d0a1a0a')) return 'image/png';
  if (startsWith(data, 0, '47494638')) return 'image/gif';
  if (startsWith(data, 0, '52494646') && startsWith(data, 8, '57454250')) return 'image/webp';
  if (startsWith(data, 4, '66747970')) return 'video/mp4'; // ISO-BMFF：ftyp box
  if (startsWith(data, 0, '1a45dfa3')) return 'video/webm'; // EBML
  if (startsWith(data, 0, '25504446')) return 'application/pdf';
  if (startsWith(data, 0, '504b0304')) return 'zip-family'; // docx/xlsx/pptx/zip 共用容器，按扩展名细分
  if (startsWith(data, 0, 'd0cf11e0a1b11ae1')) return 'ms-office-legacy'; // doc/xls/ppt 老格式
  return '';
}

function extMime(filename) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(filename || '').trim());
  return match ? EXT_MIME.get(match[1].toLowerCase()) || '' : '';
}

/**
 * 声明 kind 与嗅探结果交叉校验；通过则返回 { kind, mime }，失败抛 400。
 * 文本类附件（嗅探为空）放行；zip/ms-office 容器按扩展名细分 mime。
 */
export function classifyUpload(filename, declaredMime, data) {
  const declared = extMime(filename);
  const sniffed = sniffMime(data);
  const effectiveMime = declared || String(declaredMime || '').split(';')[0].trim().toLowerCase();

  if (IMAGE_MIMES.has(effectiveMime)) {
    if (!sniffed.startsWith('image/')) throw Object.assign(new Error('图片文件内容与格式不符，已拒绝上传'), { code: 'UPLOAD_MIME_MISMATCH', status: 400 });
    return { kind: 'image', mime: effectiveMime };
  }
  if (VIDEO_MIMES.has(effectiveMime)) {
    if (!sniffed.startsWith('video/')) throw Object.assign(new Error('视频文件内容与格式不符，已拒绝上传'), { code: 'UPLOAD_MIME_MISMATCH', status: 400 });
    return { kind: 'video', mime: effectiveMime };
  }
  if (FILE_MIMES.has(effectiveMime)) {
    // 图片/视频伪装成附件同样拒绝（缩小攻击面：附件目录里不该有可内联渲染的媒体）
    if (sniffed.startsWith('image/') || sniffed.startsWith('video/')) {
      throw Object.assign(new Error('文件内容与格式不符，已拒绝上传'), { code: 'UPLOAD_MIME_MISMATCH', status: 400 });
    }
    const mime = sniffed === 'zip-family' || sniffed === 'ms-office-legacy' ? effectiveMime : (sniffed || effectiveMime);
    return { kind: 'file', mime };
  }
  throw Object.assign(new Error('不支持的文件格式'), { code: 'UPLOAD_TYPE_REJECTED', status: 400 });
}

export function assertUploadSize(kind, size) {
  const limit = UPLOAD_LIMITS[kind];
  if (!limit || size <= 0) throw Object.assign(new Error('文件内容为空或类型未知'), { code: 'UPLOAD_EMPTY', status: 400 });
  if (size > limit) {
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '附件';
    throw Object.assign(new Error(`${label}不能超过 ${Math.round(limit / 1024 / 1024)}MB`), { code: 'UPLOAD_TOO_LARGE', status: 413 });
  }
}

const memoryUploads = new Map(); // id -> { id, ownerId, kind, mime, name, size, data, createdAt }

function createMemoryUploadRepository() {
  return {
    async createUpload({ ownerId, kind, mime, name, size, data }) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      memoryUploads.set(id, { id, ownerId, kind, mime, name, size, data, createdAt });
      return { id, kind, mime, name, size, createdAt, url: `/api/community/uploads/${id}` };
    },
    async getUpload(id) {
      return memoryUploads.get(id) || null;
    },
  };
}

function createPgUploadRepository(db = getPool()) {
  return {
    async createUpload({ ownerId, kind, mime, name, size, data }) {
      const { rows } = await db.query(
        `insert into community_uploads(owner_id, kind, mime, name, size, data)
         values ($1,$2,$3,$4,$5,$6) returning id, kind, mime, name, size, created_at as "createdAt"`,
        [ownerId, kind, mime, String(name).slice(0, 200), size, data],
      );
      return { ...rows[0], url: `/api/community/uploads/${rows[0].id}` };
    },
    async getUpload(id) {
      const { rows } = await db.query(
        'select id, owner_id as "ownerId", kind, mime, name, size, data, created_at as "createdAt" from community_uploads where id = $1 limit 1',
        [id],
      );
      return rows[0] || null;
    },
  };
}

export function createUploadRepository(repository = (isDevMemoryMode() ? createMemoryUploadRepository() : createPgUploadRepository())) {
  return repository;
}

let defaultUploadPromise = null;
export function getUploadRepository() {
  if (!defaultUploadPromise) {
    defaultUploadPromise = (async () => createUploadRepository())();
  }
  return defaultUploadPromise;
}

export const __memoryUploadStore = { uploads: memoryUploads };
