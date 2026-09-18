import { describe, expect, it } from 'vitest';
import { extractBoundary, parseMultipart } from '../multipart.js';

const BOUNDARY = '----meridian-form-boundary-7f3a';

function buildMultipart(parts, boundary = BOUNDARY) {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    let headers = `Content-Disposition: form-data; name="${part.name}"`;
    if (part.filename) headers += `; filename="${part.filename}"`;
    if (part.contentType) headers += `\r\nContent-Type: ${part.contentType}`;
    chunks.push(Buffer.from(`${headers}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x0d, 0x0a]);
const TEXT_WITH_CRLF = '第一行\r\n第二行\r\n-- 看起来像边界但不带前缀 --\r\n结束';

describe('multipart 解析器（C3 任务 3，零依赖）', () => {
  it('单文件 + 单字段：name/filename/contentType/data 完整还原', () => {
    const body = buildMultipart([
      { name: 'title', data: '帖子标题' },
      { name: 'file', filename: '截图.png', contentType: 'image/png', data: PNG_BYTES },
    ]);
    const { fields, files } = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
    expect(fields).toEqual([{ name: 'title', value: '帖子标题' }]);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('file');
    expect(files[0].filename).toBe('截图.png');
    expect(files[0].contentType).toBe('image/png');
    expect(files[0].data.equals(PNG_BYTES)).toBe(true);
  });

  it('多文件顺序保序；数据内含 \\r\\n 与伪边界文本不误切', () => {
    const body = buildMultipart([
      { name: 'a', filename: 'a.txt', contentType: 'text/plain', data: TEXT_WITH_CRLF },
      { name: 'b', filename: 'b.mp4', contentType: 'video/mp4', data: PNG_BYTES },
    ]);
    const { files } = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
    expect(files.map(f => f.filename)).toEqual(['a.txt', 'b.mp4']);
    expect(files[0].data.toString('utf8')).toBe(TEXT_WITH_CRLF);
    expect(files[1].data.equals(PNG_BYTES)).toBe(true);
  });

  it('带引号的 boundary 参数也能提取', () => {
    const body = buildMultipart([{ name: 'file', filename: 'x.png', contentType: 'image/png', data: PNG_BYTES }], 'simple-b');
    const { files } = parseMultipart(body, 'multipart/form-data; boundary="simple-b"');
    expect(files[0].data.equals(PNG_BYTES)).toBe(true);
  });

  it('extractBoundary：缺失/畸形 → 空串', () => {
    expect(extractBoundary('multipart/form-data')).toBe('');
    expect(extractBoundary('')).toBe('');
    expect(extractBoundary('multipart/form-data; boundary=abc-123')).toBe('abc-123');
  });

  it('缺 boundary / 空结构 → 400 INVALID_MULTIPART', async () => {
    const expectCode = (fn, code) => {
      let caught = null;
      try { fn(); } catch (error) { caught = error; }
      expect(caught?.code).toBe(code);
      expect(caught?.status).toBe(400);
    };
    expectCode(() => parseMultipart(Buffer.from('x'), 'multipart/form-data'), 'INVALID_MULTIPART');
    const bad = Buffer.from('这不是 multipart 数据');
    expectCode(() => parseMultipart(bad, `multipart/form-data; boundary=${BOUNDARY}`), 'INVALID_MULTIPART');
  });

  it('只有字段没有文件：files 为空数组（调用方据此拒绝上传请求）', () => {
    const body = buildMultipart([{ name: 'note', data: '纯文本' }]);
    const { fields, files } = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
    expect(fields).toHaveLength(1);
    expect(files).toEqual([]);
  });
});
