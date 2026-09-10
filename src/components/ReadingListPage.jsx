import { ICONS } from '../constants/index.jsx';
import { useBehaviorStore } from '../store/behaviorStore.js';
import { useNewsPreviewStore } from '../store/newsPreviewStore.js';

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 日期 */
function previewRelativeTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  return new Date(t).toLocaleDateString('zh-CN');
}

/**
 * 预览轨迹（v26.8）：资讯卡片的侧边预览行为记录。
 * 点击条目可重新打开侧边预览；支持清空。数据与画像阅读记录同源（behaviorStore）。
 */
function PreviewTrailSection() {
  const previewHistory = useBehaviorStore(s => s.previewHistory);
  const clearPreviewHistory = useBehaviorStore(s => s.clearPreviewHistory);
  const openPreview = useNewsPreviewStore(s => s.open);

  if (previewHistory.length === 0) return null;
  return (
    <section className="trends-section">
      <div className="trends-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>{ICONS.eye || ICONS.bookmark}<span>预览轨迹</span></h3>
        <button
          className="bookmark-remove"
          onClick={() => clearPreviewHistory()}
          title="清空预览轨迹"
        >清空</button>
      </div>
      <p className="trends-desc">最近预览过的 {previewHistory.length} 条资讯（预览行为已计入阅读画像）</p>
      <div className="bookmarks-list">
        {previewHistory.map(p => (
          <div
            key={p.id}
            className="bookmark-item"
            style={{ cursor: 'pointer' }}
            onClick={() => openPreview(p)}
            title="点击重新打开预览"
          >
            <div className="bookmark-main">
              <span className="bookmark-title">{p.title}</span>
              <div className="bookmark-meta">
                <span className="bookmark-source">{p.source}</span>
                <span className="bookmark-date">{previewRelativeTime(p.previewAt)}</span>
                {(p.previewCount || 0) > 1 && <span className="bookmark-category">预览 ×{p.previewCount}</span>}
                {p.depth === 'full' && <span className="bookmark-category">已读原文</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ReadingListPage({
  bookmarks,
  setBookmarks,
  categories,
  toggleRead,
}) {
  return (
    <div className="trends-dashboard">
      <div className="trends-header">
        <h2>{ICONS.bookmark}<span>阅读列表</span></h2>
        <p className="trends-desc">共 {bookmarks.length} 条收藏，{bookmarks.filter(b => !b.isRead).length} 条未读</p>
      </div>
      {bookmarks.length === 0 ? (
        <section className="trends-section">
          <div className="empty-state">
            <p>暂无收藏内容</p>
            <p className="hint">浏览资讯时点击收藏按钮，将感兴趣的内容添加到阅读列表</p>
          </div>
        </section>
      ) : (
        <section className="trends-section">
          <div className="bookmarks-list">
            {bookmarks.map(b => (
              <div key={b.id} className={`bookmark-item ${b.isRead ? 'read' : ''}`}>
                <div className="bookmark-main">
                  <a href={b.url} target="_blank" rel="noopener noreferrer" className="bookmark-title">{b.title}</a>
                  <div className="bookmark-meta">
                    <span className="bookmark-source">{b.source}</span>
                    <span className="bookmark-date">{new Date(b.savedAt).toLocaleDateString('zh-CN')}</span>
                    {b.category && <span className="bookmark-category">{categories.find(c => c.id === b.category)?.label || b.category}</span>}
                  </div>
                  {b.summary && <p className="bookmark-summary">{b.summary}</p>}
                </div>
                <div className="bookmark-actions">
                  <button
                    className={`bookmark-read-btn ${b.isRead ? 'read' : ''}`}
                    onClick={() => toggleRead(b.id)}
                    title={b.isRead ? '标记为未读' : '标记为已读'}
                  >
                    {b.isRead ? '已读' : '未读'}
                  </button>
                  <button className="bookmark-remove" onClick={() => setBookmarks(prev => prev.filter(x => x.id !== b.id))} title="移除">{ICONS.x}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <PreviewTrailSection />
    </div>
  );
}
