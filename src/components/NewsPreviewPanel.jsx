/**
 * NewsPreviewPanel - 资讯侧边预览抽屉
 *
 * 点击资讯卡片后从右侧滑出，通过 /api/fetch-page 抓取对应资讯网页的
 * 完整正文（服务端已做编码识别/去 script/15KB 截断），展示真实内容；
 * 抓取失败时降级展示卡片内摘要，并保留「浏览器打开原文」出口。
 *
 * 全局唯一实例，挂在 App 根部；NewsItem 通过 newsPreviewStore.open(item) 唤起。
 * 抓取逻辑（缓存/重试）与精灵拖拽分析共用 articleFetcher。
 */
import { useEffect, useState } from 'react';
import { useNewsPreviewStore } from '../store/newsPreviewStore.js';
import { ICONS } from '../constants/index.jsx';
import { formatRelative } from '../utils/format.js';
import { fetchArticleContent } from '../utils/articleFetcher.js';

export default function NewsPreviewPanel() {
  const item = useNewsPreviewStore(s => s.item);
  const close = useNewsPreviewStore(s => s.close);
  const [status, setStatus] = useState('idle'); // idle | loading | done | failed
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setStatus('loading');
    setContent('');
    fetchArticleContent(item.url).then((text) => {
      if (cancelled) return;
      if (text) {
        setContent(text);
        setStatus('done');
      } else {
        setStatus('failed');
      }
    });
    return () => { cancelled = true; };
  }, [item]);

  // Esc 关闭
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, close]);

  if (!item) return null;

  const paragraphs = content
    ? content.split(/(?<=[。！？.!?])\s+/).reduce((acc, sentence) => {
        // 把纯文本按句聚成 ~120 字的段落，长文更可读
        const last = acc[acc.length - 1];
        if (last && last.length < 110) acc[acc.length - 1] = `${last}${sentence}`;
        else acc.push(sentence);
        return acc;
      }, [])
    : [];

  return (
    <>
      <div className="news-preview-mask" onClick={close} aria-hidden="true" />
      <aside className="news-preview-panel" role="dialog" aria-label="资讯全文预览">
        <header className="news-preview-head">
          <button type="button" className="news-preview-close" onClick={close} title="关闭 (Esc)">{ICONS.x || '×'}</button>
          <div className="news-preview-meta">
            {item.source && <span className="news-preview-source">{item.source}</span>}
            <span className="news-preview-time">{formatRelative(item.publishedAt)}</span>
          </div>
          <h2 className="news-preview-title">{item.title}</h2>
          <div className="news-preview-actions">
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="news-preview-link">
                浏览器打开原文 {ICONS.arrowRight}
              </a>
            )}
          </div>
        </header>

        <div className="news-preview-body custom-scrollbar">
          {status === 'loading' && (
            <div className="news-preview-state">
              <span className="news-preview-spinner" />
              正在抓取原文全文…
            </div>
          )}
          {status === 'failed' && (
            <div className="news-preview-state">
              原文抓取失败（站点反爬或超时），以下为卡片摘要。
              {item.summary && <p className="news-preview-fallback">{item.summary}</p>}
            </div>
          )}
          {status === 'done' && paragraphs.map((p, i) => <p key={i} className="news-preview-para">{p}</p>)}
        </div>
      </aside>
    </>
  );
}
