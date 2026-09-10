import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderMarkdownWithImages } from '../markdown.jsx';

// v26.9e 安全回归：renderMarkdown 的返回值会被 10+ 处 dangerouslySetInnerHTML 注入 DOM，
// 输入来自社区正文 / 抓取网页 / LLM 输出等不可信来源。
describe('renderMarkdown 注入防护（v26.9e P0 修复）', () => {
  it('URL 里的引号不能逃出 href 属性（属性注入）', () => {
    const html = renderMarkdown('[点我](a" onmouseover="alert(document.cookie))');
    // 引号被转义 → 无法构造新的属性名
    expect(html).not.toMatch(/onmouseover=/i);
    expect(html).not.toMatch(/<a href="a"/);
  });

  it('javascript: 协议链接被降级为纯文本（无可点击出口）', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('<a ');
    expect(html).toContain('点我');
  });

  it('vbscript: / data:text/html 同样被拦', () => {
    expect(renderMarkdown('[x](vbscript:msgbox(1))')).not.toContain('<a ');
    expect(renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)')).not.toContain('<a ');
  });

  it('图片 URL 的 javascript: 协议被拦，alt 文本保留', () => {
    const html = renderMarkdown('![图](javascript:alert(1))');
    expect(html).not.toMatch(/<img[^>]*javascript:/i);
    expect(html).toContain('图');
  });

  it('原样保留的 <img> 会剥掉 on* 事件属性', () => {
    const html = renderMarkdown('正文 <img src="https://a.com/x.png" onerror="alert(1)" /> 结束');
    expect(html).not.toMatch(/onerror=/i);
    expect(html).toContain('https://a.com/x.png');
  });

  it('原样保留的 <img> 若 src 协议非法则移除 src', () => {
    const html = renderMarkdown('<img src="javascript:alert(1)" />');
    expect(html).not.toMatch(/javascript:/i);
  });

  it('合法 http(s) 链接与相对路径仍正常工作（不误伤）', () => {
    expect(renderMarkdown('[官网](https://example.com/a?x=1)')).toContain('<a href="https://example.com/a?x=1"');
    expect(renderMarkdown('[内页](/news/1)')).toContain('<a href="/news/1"');
    expect(renderMarkdown('[锚点](#sec)')).toContain('<a href="#sec"');
  });

  it('转义后正文里的 < > 仍是字面量（不会变成标签）', () => {
    const html = renderMarkdown('a <script>alert(1)</script> b');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('作者被恶意 URL 影响但正文其余 markdown 仍渲染', () => {
    const html = renderMarkdown('**粗体** 然后 [坏](javascript:alert(1)) 结束');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).not.toContain('<a ');
  });
});

describe('renderMarkdownWithImages（base64 内嵌图片）', () => {
  const b64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7lPWAAAAAElFTkSuQmCC';

  it('合法的 data:image base64 图片正常内嵌（不误伤编辑器）', () => {
    const html = renderMarkdownWithImages('![配图](#img-1)', [{ id: 'img-1', base64: b64, alt: '图' }]);
    expect(html).toContain(`src="${b64}"`);
    expect(html).toMatch(/<img /);
  });

  it('base64 中的 + / = 原样保留（还原阶段用函数式替换，不被 $ 模式解析）', () => {
    // base64 字母表含 + / =，替换串若走字符串模式会被 $&/$` 语义污染
    const tricky = 'data:image/png;base64,AA+/AA==';
    const html = renderMarkdownWithImages('![x](#img-2)', [{ id: 'img-2', base64: tricky, alt: 'x' }]);
    expect(html).toContain(`src="${tricky}"`);
  });

  it('src 非图片 data URL / 非白名单协议时被移除（防伪造 base64 注入）', () => {
    const bad = renderMarkdownWithImages('![x](#img-4)', [{ id: 'img-4', base64: 'javascript:alert(1)', alt: 'x' }]);
    expect(bad).not.toMatch(/src=/);
  });

  it('alt 里的引号被转义，不能逃出属性', () => {
    const html = renderMarkdownWithImages('![a" onerror="alert(1)](#img-3)', [{ id: 'img-3', base64: b64, alt: '' }]);
    expect(html).not.toMatch(/alt="a" onerror=/);
  });
});
