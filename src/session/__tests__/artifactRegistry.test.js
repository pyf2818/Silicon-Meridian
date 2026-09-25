import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ARTIFACT_KINDS,
  MAX_ARTIFACT_BYTES,
  normalizeArtifactInput,
  artifactKindFromFilename,
  byteLengthOf,
  base64ByteLength,
  isArtifactId,
  createArtifactClient,
} from '../artifactRegistry.js';

describe('normalizeArtifactInput', () => {
  it('文本产物：记录 kind/title/mime/size，size 为 utf-8 字节数', () => {
    const { record, hasBinary } = normalizeArtifactInput({
      kind: 'report',
      title: '今日情报简报',
      mime: 'text/markdown',
      content: '# 标题\n中文内容',
    });
    expect(hasBinary).toBe(false);
    expect(record.kind).toBe('report');
    expect(record.title).toBe('今日情报简报');
    expect(record.mime).toBe('text/markdown');
    expect(record.size).toBe(byteLengthOf('# 标题\n中文内容'));
    expect(record.size).toBeGreaterThan(0);
  });

  it('白名单外 kind/mime 归一为 file/octet-stream', () => {
    const { record } = normalizeArtifactInput({ kind: 'hack', mime: 'application/x-msdownload', content: 'x' });
    expect(record.kind).toBe('file');
    expect(record.mime).toBe('application/octet-stream');
  });

  it('空 title 使用「未命名+类型label」默认值并截断 200', () => {
    const { record: r1 } = normalizeArtifactInput({ kind: 'code', content: 'x' });
    expect(r1.title).toBe('未命名代码');
    const { record: r2 } = normalizeArtifactInput({ kind: 'report', title: '长'.repeat(300), content: 'x' });
    expect(r2.title.length).toBe(200);
  });

  it('meta 只收白名单键且值截断', () => {
    const { record } = normalizeArtifactInput({
      kind: 'report',
      content: 'x',
      meta: { source: 'agent-loop', evilKey: 'should-drop', toolName: 'export_engine', version: 1.2 },
    });
    expect(record.meta.source).toBe('agent-loop');
    expect(record.meta.toolName).toBe('export_engine');
    expect(record.meta.version).toBe('1.2');
    expect(record.meta.evilKey).toBeUndefined();
  });

  it('超限抛 ARTIFACT_TOO_LARGE（413）', () => {
    const big = 'a'.repeat(MAX_ARTIFACT_BYTES + 1);
    expect(() => normalizeArtifactInput({ kind: 'report', content: big })).toThrowError(/大小上限/);
    try {
      normalizeArtifactInput({ kind: 'report', content: big });
    } catch (e) {
      expect(e.code).toBe('ARTIFACT_TOO_LARGE');
      expect(e.status).toBe(413);
    }
  });

  it('空内容抛 ARTIFACT_EMPTY（400）', () => {
    expect(() => normalizeArtifactInput({ kind: 'report', content: '' })).toThrowError(/内容为空/);
    try {
      normalizeArtifactInput({ kind: 'report' });
    } catch (e) {
      expect(e.code).toBe('ARTIFACT_EMPTY');
      expect(e.status).toBe(400);
    }
  });

  it('base64 二进制产物：size 正确扣 padding', () => {
    const data = Buffer.from('binary-content').toString('base64');
    const { record, hasBinary } = normalizeArtifactInput({ kind: 'image', mime: 'image/png', binary: { encoding: 'base64', data } });
    expect(hasBinary).toBe(true);
    expect(record.size).toBe('binary-content'.length);
    expect(record.size).toBe(base64ByteLength(data));
  });
});

describe('artifactKindFromFilename', () => {
  it('常见扩展名推断 kind/mime', () => {
    expect(artifactKindFromFilename('report.md')).toEqual({ kind: 'report', mime: 'text/markdown', ext: 'md' });
    expect(artifactKindFromFilename('app.jsx')).toEqual({ kind: 'code', mime: 'text/plain', ext: 'jsx' });
    expect(artifactKindFromFilename('data.csv')).toEqual({ kind: 'table', mime: 'text/csv', ext: 'csv' });
    expect(artifactKindFromFilename('pic.PNG')).toEqual({ kind: 'image', mime: 'image/png', ext: 'png' });
  });

  it('未知扩展名归一为 file/octet-stream', () => {
    expect(artifactKindFromFilename('mystery.xyz')).toEqual({ kind: 'file', mime: 'application/octet-stream', ext: 'xyz' });
    expect(artifactKindFromFilename('')).toEqual({ kind: 'file', mime: 'application/octet-stream', ext: '' });
  });
});

describe('isArtifactId', () => {
  it('接受标准 uuid、拒绝路径与任意串', () => {
    expect(isArtifactId('b3c1d2e4-5f6a-7b8c-9d0e-1a2b3c4d5e6f')).toBe(true);
    expect(isArtifactId('../../etc/passwd')).toBe(false);
    expect(isArtifactId('not-a-uuid')).toBe(false);
    expect(isArtifactId(null)).toBe(false);
  });
});

describe('createArtifactClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('register 走 POST 并返回 artifact', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, artifact: { id: 'a1', title: 't' } }),
    });
    const client = createArtifactClient({ fetchImpl });
    const artifact = await client.register({ kind: 'report', content: 'x' });
    expect(artifact.id).toBe('a1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/artifacts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).content).toBe('x');
  });

  it('list 携带 query 参数', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, artifacts: [], hasMore: false, total: 0 }),
    });
    const client = createArtifactClient({ fetchImpl });
    await client.list({ sessionId: 's1', kind: 'report', limit: 10 });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/artifacts?');
    expect(url).toContain('session=s1');
    expect(url).toContain('kind=report');
    expect(url).toContain('limit=10');
  });

  it('非 2xx 抛出服务端 message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: { message: '产物超过大小上限' } }),
    });
    const client = createArtifactClient({ fetchImpl });
    await expect(client.register({ kind: 'report', content: 'x' })).rejects.toThrow('产物超过大小上限');
  });

  it('contentUrl 生成 opaque 引用', () => {
    const client = createArtifactClient({ fetchImpl: vi.fn() });
    expect(client.contentUrl('abc')).toBe('/api/artifacts/abc');
  });
});
