import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertUploadSize, classifyUpload, createUploadRepository, sniffMime, UPLOAD_LIMITS, __memoryUploadStore,
} from '../uploads.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x0d, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const MP4_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00]);
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
const TEXT_BYTES = Buffer.from('hello, meridian 附件内容', 'utf8');

function expectFail(fn, code, status) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  expect(caught?.code).toBe(code);
  if (status) expect(caught?.status).toBe(status);
}

describe('sniffMime（魔法数嗅探）', () => {
  it('识别常见图片/视频/文档头', () => {
    expect(sniffMime(PNG_BYTES)).toBe('image/png');
    expect(sniffMime(JPEG_BYTES)).toBe('image/jpeg');
    expect(sniffMime(MP4_BYTES)).toBe('video/mp4');
    expect(sniffMime(Buffer.from('%PDF-1.7 fake'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('PK\x03\x04' + '0'.repeat(12)))).toBe('zip-family');
    expect(sniffMime(TEXT_BYTES)).toBe('');
  });
});

describe('classifyUpload（扩展名 × 内容交叉校验）', () => {
  it('真图 → image；真视频 → video；文本 → file', () => {
    expect(classifyUpload('shot.png', 'image/png', PNG_BYTES)).toEqual({ kind: 'image', mime: 'image/png' });
    expect(classifyUpload('demo.mp4', 'video/mp4', MP4_BYTES)).toEqual({ kind: 'video', mime: 'video/mp4' });
    expect(classifyUpload('资料.md', 'text/markdown', TEXT_BYTES)).toEqual({ kind: 'file', mime: 'text/markdown' });
    expect(classifyUpload('报告.pdf', '', TEXT_BYTES)).toEqual({ kind: 'file', mime: 'application/pdf' });
  });

  it('exe 伪装 jpg / png 伪装 mp4 → 内容不符拒绝（P0 攻击面）', () => {
    expectFail(() => classifyUpload('evil.jpg', 'image/jpeg', EXE_BYTES), 'UPLOAD_MIME_MISMATCH', 400);
    expectFail(() => classifyUpload('evil.mp4', 'video/mp4', PNG_BYTES), 'UPLOAD_MIME_MISMATCH', 400);
    expectFail(() => classifyUpload('evil.html', 'text/html', Buffer.from('<script>alert(1)</script>')), 'UPLOAD_TYPE_REJECTED', 400);
    // 图片/视频伪装成附件同样拒绝：附件目录不放可内联渲染的媒体
    expectFail(() => classifyUpload('fake.pdf', 'application/pdf', PNG_BYTES), 'UPLOAD_MIME_MISMATCH', 400);
  });

  it('docx/xlsx/zip 容器族按扩展名细分 mime', () => {
    const zipContainer = Buffer.from('PK\x03\x04' + '0'.repeat(20));
    expect(classifyUpload('周报.docx', '', zipContainer)).toEqual({ kind: 'file', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(classifyUpload('备份.zip', '', zipContainer)).toEqual({ kind: 'file', mime: 'application/zip' });
  });
});

describe('assertUploadSize（分级限额）', () => {
  it('超限 413 / 空文件 400', () => {
    expectFail(() => assertUploadSize('image', UPLOAD_LIMITS.image + 1), 'UPLOAD_TOO_LARGE', 413);
    expectFail(() => assertUploadSize('video', UPLOAD_LIMITS.video + 1), 'UPLOAD_TOO_LARGE', 413);
    expectFail(() => assertUploadSize('file', 0), 'UPLOAD_EMPTY', 400);
    expect(() => assertUploadSize('image', 1024)).not.toThrow();
  });
});

describe('内存上传仓储（dev 无 PG 兜底）', () => {
  beforeEach(() => { __memoryUploadStore.uploads.clear(); });

  it('createUpload → getUpload roundtrip；记录与本站 URL 规则一致', async () => {
    const repo = createUploadRepository();
    const record = await repo.createUpload({ ownerId: 'u-1', kind: 'image', mime: 'image/png', name: '截图.png', size: PNG_BYTES.length, data: PNG_BYTES });
    expect(record.url).toMatch(/^\/api\/community\/uploads\/[0-9a-f-]{36}$/);
    const fetched = await repo.getUpload(record.id);
    expect(fetched.kind).toBe('image');
    expect(fetched.data.equals(PNG_BYTES)).toBe(true);
    expect(await repo.getUpload('不存在')).toBeNull();
  });
});
