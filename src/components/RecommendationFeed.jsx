/**
 * RecommendationFeed - 精准推荐页中间资讯卡片流
 *
 * 展示当日满足用户关注领域 / 用户画像的资讯卡片，支持滚动按需加载。
 * 卡片复用 App.jsx 的 NewsItem（通过 render-prop 传入），以保持与全局一致的交互。
 */
import { useMemo } from 'react';

export default function RecommendationFeed({
  lanes,
  allItems, // 当天全部画像资讯（不限条数），由 App.jsx 传入 recommendationCandidates
  loading,
  error,
  isLoggedIn,
  selectedInterests,
  categories,
  renderLimit,
  viewMode,
  renderCard, // (item, index) => ReactNode  由 App.jsx 提供，复用 NewsItem + 全部 handler
  snapshotMeta,
  onLoadMore,
  loadingMore,
  hasMore,
  onRefresh,
  onPickInterests,
  onLogin,
}) {
  // 精准推荐（抖音式）：当日全部画像资讯（allItems 由 buildPrecisionFeed 产出——
  // 仅今天发布、不限条数、含探索池、多样性打散），按推荐分与新鲜度混排。
  // 仅在 allItems 为空时才回退到 lanes（历史快照的 10 条精选）
  const feedItems = useMemo(() => {
    const seen = new Set();
    const result = [];
    const merged = Array.isArray(allItems) && allItems.length > 0
      ? allItems
      : [...(lanes?.personal || []), ...(lanes?.public || [])];
    for (const item of merged) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
    // 引擎已按 feedScore + 多样性排好序；这里仅兜底保证"探索注入的次序"不被破坏：
    // 有 feedScore 的条目保持引擎序，无 feedScore 的回退（lanes）按发布时间倒序
    const hasEngineOrder = result.some(item => typeof item.feedScore === 'number');
    if (!hasEngineOrder) {
      result.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
    }
    return result;
  }, [lanes, allItems]);

  const total = feedItems.length;
  const visible = feedItems;
  const canLoadMore = false;

  // 未登录
  if (!snapshotMeta && !isLoggedIn) {
    return (
      <div className="empty-state">
        <p>请先登录并选择感兴趣的领域，以获得个性化推荐</p>
        <button type="button" onClick={onLogin}>去登录</button>
      </div>
    );
  }

  // 未选兴趣领域
  if (!snapshotMeta && selectedInterests.length === 0) {
    return (
      <div className="empty-state">
        <p>你还没有选择感兴趣的领域</p>
        <button type="button" onClick={onPickInterests}>选择兴趣领域</button>
      </div>
    );
  }

  // 已选领域标签条
  const interestBar = (
    <div className="interest-tags-bar">
      <span className="interest-tags-label">已选领域：</span>
      {selectedInterests.map(id => {
        const cat = categories?.find(c => c.id === id);
        return cat ? <span key={id} className="interest-tag-badge">{cat.label}</span> : null;
      })}
      <button type="button" className="interest-edit-btn" onClick={onPickInterests}>编辑</button>
    </div>
  );

  const snapshotBanner = snapshotMeta ? (
    <div className="recommendation-snapshot-meta">
      <span>Snapshot {snapshotMeta.date}</span>
      <strong>Algorithm {snapshotMeta.algorithmVersion || '1.0'}</strong>
      <span>Profile v{snapshotMeta.profileVersion || 1}</span>
    </div>
  ) : null;

  // 当日精准推荐说明条：让用户理解这份流"是什么、为什么是这些"
  const precisionBar = (
    <div className="precision-meta-bar">
      <span className="precision-meta-title">当日精准推荐</span>
      <span className="precision-meta-chip">仅今天发布</span>
      <span className="precision-meta-chip">不限条数</span>
      <span className="precision-meta-desc">按 画像契合 · 行为信号 · 多源发酵 综合排序，并注入探索内容拓宽视野（标记「探索」的条目来自你关注领域之外）</span>
    </div>
  );

  if (loading) {
    return (
      <>
        {snapshotBanner}
        {interestBar}
        {precisionBar}
        <div className={`feed-list view-${viewMode} ${viewMode === 'card' ? 'card-grid' : ''}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <article key={i} className="news-item skeleton view-standard">
              <div className="skeleton-line w-80" />
              <div className="skeleton-line w-60" />
              <div className="skeleton-line w-40" />
            </article>
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {snapshotBanner}
        {interestBar}
        {precisionBar}
        <div className="error-state">
          <p>加载失败: {error}</p>
          <button type="button" onClick={onRefresh}>重试</button>
        </div>
      </>
    );
  }

  if (total === 0) {
    return (
      <>
        {snapshotBanner}
        {interestBar}
        {precisionBar}
        <div className="empty-state">
          <p>今天还没有满足你关注领域的新资讯——引擎只推荐今天发布的内容，稍后刷新再看看</p>
          <button type="button" onClick={onRefresh}>刷新重试</button>
        </div>
      </>
    );
  }

  return (
    <>
      {snapshotBanner}
      {interestBar}
      {precisionBar}
      <div className={`feed-list view-${viewMode} ${viewMode === 'card' ? 'card-grid' : ''}`}>
        {visible.map((item, i) => renderCard(item, i))}
      </div>
      {canLoadMore ? (
        <div id="load-more-sentinel" className="load-more-area">
          {loadingMore && <div className="load-more-spinner"><div className="spinner" /><span>加载中...</span></div>}
          {!loadingMore && <span className="load-more-hint">滚动加载更多（已显示 {visible.length} / {total}）</span>}
        </div>
      ) : (
        <div className="load-more-area load-more-done">已全部加载（今日共 {total} 条）</div>
      )}
    </>
  );
}
