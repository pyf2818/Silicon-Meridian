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
import { Fragment, useEffect, useState } from 'react';
import { useNewsPreviewStore } from '../store/newsPreviewStore.js';
import { useBehaviorStore } from '../store/behaviorStore.js';
import { ICONS } from '../constants/index.jsx';
import { formatRelative } from '../utils/format.js';
import { fetchArticleDetail } from '../utils/articleFetcher.js';
import { renderMarkdown } from '../utils/markdown.jsx';

/** 预览停留达到该时长即升级为「完整阅读」深度（画像行为敏感度 v22） */
const FULL_READ_DWELL_MS = 8000;

/** 粗判文本是否是 markdown（素材快照/工作空间文章是 md；纯抓取文本不是） */
function looksLikeMarkdown(text) {
  if (!text) return false;
  return /^#{1,3} /m.test(text) || /\*\*[^*]+\*\*/.test(text) || /^[-*] /m.test(text) || /!\[[^\]]*\]\(/.test(text);
}

/** 抓取纯文本 → 段落数组（按句聚成 ~120 字，长文更可读） */
function toParagraphs(text) {
  return (text || '').split(/(?<=[。！？.!?])\s+/).reduce((acc, sentence) => {
    const last = acc[acc.length - 1];
    if (last && last.length < 110) acc[acc.length - 1] = `${last}${sentence}`;
    else acc.push(sentence);
    return acc;
  }, []);
}

/** 配图：懒加载 + 防盗链加载失败自动隐藏 + 点击新窗口打开 */
function PreviewImage({ src, hero = false }) {
  return (
    <figure className={`news-preview-figure${hero ? ' hero' : ''}`}>
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onClick={() => window.open(src, '_blank', 'noopener')}
        onError={e => { e.currentTarget.closest('figure')?.remove(); }}
      />
    </figure>
  );
}

export default function NewsPreviewPanel() {
  const item = useNewsPreviewStore(s => s.item);
  const close = useNewsPreviewStore(s => s.close);
  const [status, setStatus] = useState('idle'); // idle | loading | done | failed
  const [content, setContent] = useState('');
  const [images, setImages] = useState([]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setStatus('loading');
    setContent('');
    setImages([]);
    // 素材/精灵快照自带 md 全文时直接用，不再抓取
    const local = item.fullContent || item.content;
    if (looksLikeMarkdown(local) && String(local).length > 120) {
      setContent(local);
      setImages(item.imageUrl ? [item.imageUrl] : []);
      setStatus('done');
      return () => { cancelled = true; };
    }
    fetchArticleDetail(item.url).then(({ text, images: imgs }) => {
      if (cancelled) return;
      const finalImgs = [...imgs];
      if (item.imageUrl && !finalImgs.includes(item.imageUrl)) finalImgs.unshift(item.imageUrl);
      if (text) {
        setContent(text);
        setImages(finalImgs);
        setStatus('done');
      } else {
        setImages(finalImgs);
        setStatus('failed');
      }
    });
    return () => { cancelled = true; };
  }, [item]);

  // v22 画像行为敏感度：预览即计入阅读记录（depth=preview），停留≥8s 升级为 full
  useEffect(() => {
    if (!item) return undefined;
    const upsert = useBehaviorStore.getState().upsertReadingEntry;
    const entry = {
      id: item.id,
      title: item.title,
      source: item.source,
      category: item.category,
      tags: item.tags || (item.insight?.entities || []).slice(0, 6),
      summary: item.summary || '',
      url: item.url || '',
      imageUrl: item.imageUrl || '',
      via: 'preview',
    };
    upsert(entry, 'preview');
    const upgradeTimer = setTimeout(() => upsert(entry, 'full'), FULL_READ_DWELL_MS);
    return () => clearTimeout(upgradeTimer);
  }, [item]);

  // Esc 关闭
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, close]);

  if (!item) return null;

  const isMd = looksLikeMarkdown(content);
  const paragraphs = !isMd ? toParagraphs(content) : [];
  // 图片穿插：首图作 hero，其余每 5 段插一张
  const extraImages = images.slice(1);
  const heroImage = images[0] || null;
  /** 第 i 段后应插入的图片（第 5、10、15…段之后依次取后续图） */
  const imgAfter = (i) => ((i + 1) % 5 === 0 ? (extraImages[Math.floor(i / 5)] || null) : null);

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <div className="news-preview-state">
          <span className="news-preview-spinner" />
          正在抓取原文全文…
        </div>
      );
    }
    if (status === 'failed') {
      return (
        <div className="news-preview-state">
          原文抓取失败（站点反爬或超时），以下为卡片摘要。
          {item.summary && <p className="news-preview-fallback">{item.summary}</p>}
        </div>
      );
    }
    if (isMd) {
      return <div className="news-preview-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
    }
    return (
      <>
        {paragraphs.map((p, i) => (
          <Fragment key={i}>
            <p className={`news-preview-para${i === 0 ? ' lede' : ''}`}>{p}</p>
            {imgAfter(i) && <PreviewImage src={imgAfter(i)} />}
          </Fragment>
        ))}
      </>
    );
  };

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
          {/* 情报解读：雷达/情报入口传入的确定性分析（评分维度 + 信源结构 + 实体） */}
          {item.insight && (
            <aside className="news-preview-insight">
              <div className="news-preview-insight-head">◈ 情报解读</div>
              <strong className="news-preview-insight-score">{item.insight.headline}</strong>
              {item.insight.lines?.filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
              {item.insight.entities?.length > 0 && (
                <div className="news-preview-insight-entities">
                  {item.insight.entities.map(e => <span key={e}>{e}</span>)}
                </div>
              )}
            </aside>
          )}
          {heroImage && status !== 'loading' && <PreviewImage src={heroImage} hero />}
          {renderBody()}
        </div>
      </aside>
    </>
  );
}

// 语义占位：段落 + 穿插图片的包裹（不渲染额外 DOM，仅组织 JSX）
function figureFree({ children }) {
  return <>{children}</>;
}
const FigureFree = figureFree;
