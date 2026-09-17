import { describe, it, expect, vi, beforeEach } from 'vitest';

// 用假的 safeExternalFetch 代替真实网络，确定性地验证 handleFetchPageRequest 的内容清洗链路
const mockSafeFetch = vi.fn();
vi.mock('../../security/urlSafety.js', () => ({
  safeExternalFetch: (...args) => mockSafeFetch(...args),
}));

const { handleFetchPageRequest } = await import('../fetchPageHandler.js');

function makeRes() {
  const state = { status: 0, body: null, headers: {} };
  return {
    state,
    setHeader: (k, v) => { state.headers[k] = v; },
    end: (payload) => { state.body = JSON.parse(payload); },
    // sendJsonResponse 会优先走 status()/json() 分支（如果有）
    status(code) { state.status = code; return this; },
    json(payload) { state.body = payload; return this; },
  };
}

function makeReq(url) {
  return { url, method: 'GET', headers: {} };
}

function htmlResponse(html, contentType = 'text/html; charset=utf-8') {
  return new Response(html, { status: 200, headers: { 'content-type': contentType } });
}

beforeEach(() => { mockSafeFetch.mockReset(); });

describe('handleFetchPageRequest（资讯全文预览的数据源）', () => {
  it('剥掉 HTML 标签并解码具名实体（&nbsp; &mdash; &hellip;）', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(
      '<html><body><p>OpenAI&nbsp;发布新模型&mdash;重磅&hellip;</p><p>第二段&ldquo;引用&rdquo;</p></body></html>'
    ));
    const res = makeRes();
    await handleFetchPageRequest(makeReq('/api/fetch-page?url=https://example.com/a'), res);
    expect(res.state.body.ok).toBe(true);
    expect(res.state.body.content).toContain('OpenAI 发布新模型—重磅…\n\n');
    expect(res.state.body.content).toContain('“引用”');
    expect(res.state.body.content).not.toContain('&nbsp;');
    expect(res.state.body.content).not.toContain('&mdash;');
    expect(res.state.body.content).not.toContain('<p>');
  });

  it('数字实体与 &amp; 也一并解开', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse('<div>R&amp;D &#8212; 5&#215;3&#176;</div>'));
    const res = makeRes();
    await handleFetchPageRequest(makeReq('/api/fetch-page?url=https://example.com/b'), res);
    expect(res.state.body.content).toContain('R&D — 5×3°');
  });

  it('script/style 内容被剔除，不会混进正文', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(
      '<html><head><style>.a{color:red}</style><script>var x="&nbsp;";</script></head><body><p>正文&nbsp;A</p></body></html>'
    ));
    const res = makeRes();
    await handleFetchPageRequest(makeReq('/api/fetch-page?url=https://example.com/c'), res);
    expect(res.state.body.content).not.toContain('color:red');
    expect(res.state.body.content).not.toContain('var x');
    expect(res.state.body.content).toContain('正文 A');
  });

  it('依然抽出图片并返回，不受实体解码影响', async () => {
    mockSafeFetch.mockResolvedValue(htmlResponse(
      '<html><body><img src="https://cdn.example.com/pic.jpg" alt="a&nbsp;b"><p>文字</p></body></html>'
    ));
    const res = makeRes();
    await handleFetchPageRequest(makeReq('/api/fetch-page?url=https://example.com/d'), res);
    expect(res.state.body.images).toContain('https://cdn.example.com/pic.jpg');
  });

  it('缺少 url 参数时返回 400', async () => {
    const res = makeRes();
    await handleFetchPageRequest(makeReq('/api/fetch-page'), res);
    expect(res.state.status).toBe(400);
  });

  it('上游非文本类型时返回 415', async () => {
    mockSafeFetch.mockResolvedValue(new Response('binary', { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    const res = makeRes();
    await handleFetchPageRequest(makeReq('/api/fetch-page?url=https://example.com/e'), res);
    expect(res.state.status).toBe(415);
  });
});
