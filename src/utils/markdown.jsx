// Markdown rendering utilities extracted from App.jsx
import React from 'react';

// Markdown rendering for AI-generated content (returns HTML string)
// Supports: headers, bold, italic, strikethrough, code blocks, inline code,
// images, links, horizontal rules, tables, blockquotes, lists
//
// ⚠️ 安全边界（v26.9e）：本函数的返回值会被 10+ 处 dangerouslySetInnerHTML 直接注入 DOM，
// 输入可能来自社区正文、抓取的网页正文、LLM 输出等**外部不可信来源**。因此：
//   1. 全文转义阶段必须连引号一起转义（否则 URL 里的 `"` 能逃出 href="" 注入事件属性）
//   2. 所有 URL 走协议白名单（挡 javascript: / vbscript: / data:text/html）
//   3. 被原样保留的 <img> 标签要剥掉 on* 事件属性
// 改动这里请务必同步更新 src/utils/__tests__/markdown.test.jsx 的注入用例。

// 协议白名单：相对路径 / 锚点 / 查询串 / http(s) / mailto / tel
const SAFE_URL_RE = /^(?:https?:|mailto:|tel:|\/|\.{1,2}\/|#|\?)/i;
// 允许内嵌图片的 data URL（ArticleEditor 会把 base64 图片塞进正文）
const SAFE_DATA_IMG_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=]+$/i;

function isSafeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (SAFE_URL_RE.test(u)) return true;
  return SAFE_DATA_IMG_RE.test(u);
}

/** 剥掉 <img> 上的 on* 事件属性，并对 src 做协议校验（不合规则移除 src） */
function sanitizeImgTag(tag) {
  return String(tag)
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, pre, dq, sq, uq) => {
      const url = (dq ?? sq ?? uq ?? '').trim();
      return isSafeUrl(url) ? `${pre}"${url}"` : '';
    });
}

export function renderMarkdown(text) {
  if (!text) return '';
  // Ensure text is a string
  let str = text;
  if (typeof str === 'object') {
    str = str.content || str.text || JSON.stringify(str);
  }
  let html = typeof str === 'string' ? str : String(str);

  // Protect existing <img> tags from HTML escaping（同时剥掉事件属性，防 onerror 注入）
  const imgMap = new Map();
  let imgCounter = 0;
  html = html.replace(/<img[^>]*\/?>/g, (match) => {
    const key = `__IMG_${imgCounter++}__`;
    imgMap.set(key, sanitizeImgTag(match));
    return key;
  });

  // Escape HTML (but preserve existing markdown syntax)
  // 引号必须一起转义：否则 [x](a" onmouseover="alert(1)) 会逃出 href="" 属性（存储型 XSS）
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="code-block${lang ? ` language-${lang}` : ''}"><code>${code.trim()}</code></pre>`;
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Images（URL 过协议白名单；alt 已在转义阶段处理）
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => (
    isSafeUrl(url) ? `<img src="${url}" alt="${alt}" loading="lazy" />` : alt
  ));
  // Links（同上；不安全协议降级为纯文本，不留可点击出口）
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => (
    isSafeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
  ));
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr />');
  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (_, headerRow, sepRow, bodyRows) => {
    const headers = headerRow.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = bodyRows.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  // Blockquotes (handle multi-line)
  html = html.replace(/^(?:&gt; (.+)\n?)+/gm, match => {
    const lines = match.split('\n').map(l => l.replace(/^&gt; /, '')).filter(Boolean);
    return `<blockquote>${lines.join('<br>')}</blockquote>`;
  });
  // Unordered lists
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, list => {
    const items = list.trim().split('\n').map(line => `<li>${line.replace(/^[-*] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, list => {
    const items = list.trim().split('\n').map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  // Line breaks and paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // Restore <img> tags（用函数式替换：字符串替换会把 $&/$' 当替换模式解析，破坏 base64 内容）
  imgMap.forEach((imgTag, key) => {
    html = html.replace(key, () => imgTag);
  });

  return `<p>${html}</p>`;
}

// Markdown rendering with embedded Base64 image support
// Replaces image placeholders like ![alt](#img-id|w=300|h=200) with actual images
export function renderMarkdownWithImages(text, images = []) {
  if (!text) return '';

  // Replace image placeholders with actual Base64 data, supporting size parameters
  // Format: ![alt](#img-id|w=300|h=200) or ![alt](#img-id|w=300)
  let processedText = text;
  if (images && images.length > 0) {
    images.forEach(img => {
      // Support multiple placeholder formats:
      // 1. ![alt](#img-id) - default size
      // 2. ![alt](#img-id|w=300) - specified width, auto height
      // 3. ![alt](#img-id|w=300|h=200) - specified width and height
      const placeholderPattern = new RegExp(`!\\[([^\\]]*)\\]\\(\\#${img.id}(?:\\|[^)]+)?\\)`, 'g');

      processedText = processedText.replace(placeholderPattern, (match, alt) => {
        // Parse size parameters
        const sizeMatch = match.match(/\|w=(\d+)(?:\|h=(\d+))?/);
        let sizeAttrs = '';
        if (sizeMatch) {
          const width = sizeMatch[1];
          const height = sizeMatch[2];
          sizeAttrs = ` width="${width}"`;
          if (height) {
            sizeAttrs += ` height="${height}"`;
          }
        } else {
          // If no size specified, use original dimensions but cap max width
          sizeAttrs = ` style="max-width:100%;height:auto;"`;
        }
        // alt 来自正文，必须转义引号与尖括号，否则能逃出属性（同 v26.9e XSS 修复）
        const safeAlt = String(alt || img.alt || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<img src="${img.base64}" alt="${safeAlt}"${sizeAttrs} />`;
      });
    });
  }

  return renderMarkdown(processedText);
}

// Simplified markdown renderer for AI briefings (returns JSX elements)
export function renderBriefMarkdown(text) {
  const lines = text.split('\n');
  const elements = [];
  let inList = false;
  let listItems = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`list-${elements.length}`} className="brief-list">{listItems.map((item, i) => <li key={i}>{item}</li>)}</ul>);
      listItems = [];
      inList = false;
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    // Headers
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h4 key={idx} className="brief-h2">{renderInline(trimmed.slice(3))}</h4>);
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<h3 key={idx} className="brief-h1">{renderInline(trimmed.slice(2))}</h3>);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('1. ') || /^\d+\.\s/.test(trimmed)) {
      inList = true;
      const content = trimmed.replace(/^[-\d]+\.\s|^- /, '');
      listItems.push(renderInline(content));
    } else {
      flushList();
      elements.push(<p key={idx} className="brief-p">{renderInline(trimmed)}</p>);
    }
  });
  flushList();
  return elements;
}

// Inline formatting: bold **text** wrapping (returns string or JSX array)
export function renderInline(text) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part);
}
