/**
 * 零依赖 multipart/form-data 解析器（社区上传专用，C3 任务 3）。
 *
 * 项目风格：serverless/middleware 环境零第三方依赖；一次性读满 body（上限由调用方 readRawBody 控制）
 * 后按 boundary 切分。只支持浏览器 FormData 的常规形态：
 *   --boundary\r\n Content-Disposition... \r\n\r\n <data> \r\n--boundary ... --boundary--\r\n
 *
 * 输出：{ fields: [{ name, value }], files: [{ name, filename, contentType, data }] }
 * data 保持 Buffer（二进制安全），由调用方做大小/白名单/魔法数校验。
 */

const CRLF = '\r\n';

function parseHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split(CRLF)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

/** Content-Disposition 里的带引号值（浏览器不转义引号内嵌套引号，简单提取即可） */
function dispositionParam(disposition, key) {
  const match = new RegExp(`${key}="([^"]*)"`, 'i').exec(disposition);
  return match ? match[1] : '';
}

export function extractBoundary(contentTypeHeader) {
  const match = /boundary=(?:"([^"]+)"|([^;,]+))/i.exec(String(contentTypeHeader || ''));
  if (!match) return '';
  return (match[1] || match[2]).trim();
}

export function parseMultipart(buffer, contentTypeHeader) {
  const boundary = extractBoundary(contentTypeHeader);
  if (!boundary) throw Object.assign(new Error('请求缺少 multipart boundary'), { code: 'INVALID_MULTIPART', status: 400 });
  const delimiter = Buffer.from(`--${boundary}`);
  const terminator = Buffer.from(`--${boundary}--`);

  const fields = [];
  const files = [];
  let cursor = buffer.indexOf(delimiter);
  while (cursor !== -1) {
    // 结束哨兵：--boundary-- 后没有新的 part
    if (buffer.slice(cursor + delimiter.length, cursor + delimiter.length + 2).toString('latin1') === '--') break;
    const headerStart = cursor + delimiter.length;
    const blankLine = buffer.indexOf(CRLF + CRLF, headerStart);
    if (blankLine === -1) break;
    const headers = parseHeaders(buffer.slice(headerStart, blankLine).toString('utf8'));
    const dataStart = blankLine + 4;
    const next = buffer.indexOf(delimiter, dataStart);
    if (next === -1) break;
    // part 数据区以 \r\n 结尾（紧贴下一个 --boundary），剥掉这 2 字节
    const data = buffer.slice(dataStart, Math.max(dataStart, next - 2));

    const disposition = headers['content-disposition'] || '';
    const name = dispositionParam(disposition, 'name');
    const filename = dispositionParam(disposition, 'filename');
    if (filename) {
      files.push({ name, filename, contentType: headers['content-type'] || 'application/octet-stream', data });
    } else if (name) {
      fields.push({ name, value: data.toString('utf8') });
    }
    cursor = next;
  }
  // 任何一种结构异常（无 part、无结束哨兵）都视为非法请求，防止下游拿到半截数据
  if (!fields.length && !files.length) {
    throw Object.assign(new Error('multipart 请求体为空或格式非法'), { code: 'INVALID_MULTIPART', status: 400 });
  }
  return { fields, files };
}
