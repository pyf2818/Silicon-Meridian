import { describe, it, expect } from 'vitest';
import {
  isTextLikeUpload,
  looksBinary,
  formatBytes,
  buildAttachmentBlock,
  buildUserContentWithAttachments,
  toAttachmentMeta,
  isWorkspaceAttachment,
  ATTACHMENT_TEXT_INJECT_LIMIT,
} from '../attachmentInjection.js';

describe('isTextLikeUpload', () => {
  it('按扩展名识别文本类附件', () => {
    expect(isTextLikeUpload('report.csv', '')).toBe(true);
    expect(isTextLikeUpload('notes.md', '')).toBe(true);
    expect(isTextLikeUpload('app.tsx', '')).toBe(true);
    expect(isTextLikeUpload('data.json', '')).toBe(true);
  });
  it('按 mime 识别文本类附件', () => {
    expect(isTextLikeUpload('blob', 'text/plain')).toBe(true);
    expect(isTextLikeUpload('blob', 'application/json')).toBe(true);
  });
  it('二进制类型不判为文本', () => {
    expect(isTextLikeUpload('photo.png', 'image/png')).toBe(false);
    expect(isTextLikeUpload('clip.mp4', 'video/mp4')).toBe(false);
    expect(isTextLikeUpload('archive.zip', 'application/zip')).toBe(false);
  });
});

describe('looksBinary', () => {
  it('含 NUL 字符判为二进制', () => {
    expect(looksBinary('abc\u0000def')).toBe(true);
  });
  it('纯文本不判为二进制', () => {
    expect(looksBinary('正常文本内容')).toBe(false);
  });
});

describe('formatBytes', () => {
  it('分级格式化', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2.0KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
    expect(formatBytes(undefined)).toBe('0B');
  });
});

describe('buildAttachmentBlock', () => {
  it('文本附件注入内容且带 URL', () => {
    const block = buildAttachmentBlock({
      name: 'a.csv', mime: 'text/csv', size: 1024, kind: 'file', url: '/api/community/uploads/x', textContent: 'id,name\n1,张三',
    });
    expect(block).toContain('【附件】a.csv');
    expect(block).toContain('--- 文件内容开始 ---');
    expect(block).toContain('id,name\n1,张三');
    expect(block).toContain('/api/community/uploads/x');
  });
  it('图片附件不含内容区但说明已在界面展示', () => {
    const block = buildAttachmentBlock({ name: 'p.png', mime: 'image/png', size: 9, kind: 'image', url: '/u/1' });
    expect(block).toContain('已在对话界面展示');
    expect(block).not.toContain('文件内容开始');
  });
  it('超长内容截断并标注原长度', () => {
    const block = buildAttachmentBlock({
      name: 'big.txt', mime: 'text/plain', size: 9, kind: 'file', url: '/u/2',
      textContent: 'x'.repeat(ATTACHMENT_TEXT_INJECT_LIMIT + 500),
    });
    expect(block).toContain('内容过长已截断');
    expect(block.length).toBeLessThan(ATTACHMENT_TEXT_INJECT_LIMIT + 800);
  });
  it('预算耗尽时不注入后续文本', () => {
    const block = buildAttachmentBlock({
      name: 'late.txt', mime: 'text/plain', size: 9, kind: 'file', url: '/u/3', textContent: 'hello world',
    }, 100);
    expect(block).not.toContain('hello world');
  });
});

describe('buildUserContentWithAttachments', () => {
  it('无附件原样返回', () => {
    expect(buildUserContentWithAttachments('你好', [])).toBe('你好');
    expect(buildUserContentWithAttachments('你好', null)).toBe('你好');
  });
  it('多附件编号并保留原文', () => {
    const out = buildUserContentWithAttachments('分析一下', [
      { name: 'a.txt', mime: 'text/plain', size: 5, kind: 'file', url: '/u/a', textContent: 'AAA' },
      { name: 'b.png', mime: 'image/png', size: 5, kind: 'image', url: '/u/b' },
    ]);
    expect(out.startsWith('分析一下')).toBe(true);
    expect(out).toContain('【附件 1/2】');
    expect(out).toContain('【附件 2/2】');
    expect(out).toContain('AAA');
    expect(out).toContain('/u/b');
  });
  it('过滤无 url 的无效附件', () => {
    const out = buildUserContentWithAttachments('hi', [{ name: 'x', status: 'uploading' }]);
    expect(out).toBe('hi');
  });
});

describe('isWorkspaceAttachment（v36.2 空间文件）', () => {
  it('source=workspace 且有文本内容才认', () => {
    expect(isWorkspaceAttachment({ source: 'workspace', textContent: 'code' })).toBe(true);
    expect(isWorkspaceAttachment({ source: 'workspace', textContent: '   ' })).toBe(false);
    expect(isWorkspaceAttachment({ source: 'workspace' })).toBe(false);
    expect(isWorkspaceAttachment({ url: '/u/1', textContent: 't' })).toBe(false);
  });
});

describe('工作空间文件注入（v36.2：无 url 也走同管道）', () => {
  const wsFile = {
    id: 'wsfile:src/app.jsx', source: 'workspace', kind: 'file',
    name: 'app.jsx', path: 'src/app.jsx', size: 12, textContent: 'export default App;',
  };

  it('块头尾用空间文件口径（本地路径，不是上传 URL）', () => {
    const block = buildAttachmentBlock(wsFile);
    expect(block).toContain('【空间文件】app.jsx');
    expect(block).toContain('--- 文件内容开始 ---');
    expect(block).toContain('export default App;');
    expect(block).toContain('（本地工作空间文件：src/app.jsx）');
    expect(block).not.toContain('文件已上传');
  });

  it('截断存储的空间文件带 read_workspace_file 提示', () => {
    const block = buildAttachmentBlock({ ...wsFile, truncated: true });
    expect(block).toContain('read_workspace_file');
  });

  it('buildUserContentWithAttachments 接受空间文件（无 url 不再被过滤）', () => {
    const out = buildUserContentWithAttachments('帮我审查这份代码', [wsFile]);
    expect(out).toContain('【空间文件】app.jsx');
    expect(out).toContain('帮我审查这份代码');
    expect(out).toContain('export default App;');
  });

  it('上传附件与空间文件混合编号共享预算', () => {
    const out = buildUserContentWithAttachments('看这两个', [
      { name: 'a.txt', mime: 'text/plain', size: 3, kind: 'file', url: '/u/a', textContent: 'AAA' },
      wsFile,
    ]);
    expect(out).toContain('【附件 1/2】');
    expect(out).toContain('【附件 2/2】');
    expect(out).toContain('AAA');
    expect(out).toContain('src/app.jsx');
  });

  it('toAttachmentMeta：空间文件落 path/source，不落 textContent/url（防持久化双份膨胀）', () => {
    const meta = toAttachmentMeta([wsFile]);
    expect(meta).toHaveLength(1);
    expect(meta[0].source).toBe('workspace');
    expect(meta[0].path).toBe('src/app.jsx');
    expect(meta[0].textContent).toBeUndefined();
    expect(meta[0].url).toBeUndefined();
    expect(meta[0].name).toBe('app.jsx');
  });

  it('toAttachmentMeta：无内容的空间文件（无效项）被过滤', () => {
    expect(toAttachmentMeta([{ source: 'workspace', name: 'empty' }])).toHaveLength(0);
  });
});

describe('toAttachmentMeta', () => {
  it('剔除运行时字段并截断文本', () => {
    const meta = toAttachmentMeta([{
      key: 'k', status: 'ready', localUrl: 'data:image/png;base64,xx', errorMsg: '',
      id: 'u1', url: '/u/1', kind: 'file', mime: 'text/plain', name: 'a.txt', size: 10,
      textContent: 't'.repeat(ATTACHMENT_TEXT_INJECT_LIMIT + 100),
    }]);
    expect(meta).toHaveLength(1);
    expect(meta[0].key).toBeUndefined();
    expect(meta[0].localUrl).toBeUndefined();
    expect(meta[0].status).toBeUndefined();
    expect(meta[0].textContent.length).toBe(ATTACHMENT_TEXT_INJECT_LIMIT);
    expect(meta[0].url).toBe('/u/1');
  });
  it('过滤未就绪附件', () => {
    expect(toAttachmentMeta([{ name: 'x' }, { url: '/u/2', name: 'y', size: 1 }])).toHaveLength(1);
  });
});
