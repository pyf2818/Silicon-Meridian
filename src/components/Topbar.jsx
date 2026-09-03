import { useEffect, useState } from 'react';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import HudTelemetryBar from './profile/HudTelemetryBar.jsx';
import {
  PRODUCT_NAME,
  CATEGORY_GROUPS, GITHUB_LANGS, GITHUB_PERIODS,
  MODES, VIEW_MODES, TRENDING_TYPES,
  ICONS,
} from '../constants/appConstants.jsx';

/**
 * 顶部栏：滚动资讯 / 品牌 / 搜索 / 分类筛选 / GitHub 过滤 / 模式 / 平台 / 语言切换
 * 由 App.jsx 抽离，仅在 nav 等内部状态变化时重渲染。
 */

// 画像页 4 分区子导航（顶部时间钟左侧菜单）
const PROFILE_SECTIONS = [
  { id: 'overview', label: '画像总览', icon: 'sparkles' },
  { id: 'insights', label: '行为洞察', icon: 'trend' },
  { id: 'preferences', label: '偏好设置', icon: 'target' },
  { id: 'social', label: '我的社交', icon: 'user' },
];

export default function Topbar({
  // 当前导航
  nav,
  // 滚动资讯
  scrollingNews,
  scrollingNewsRef,
  setScrollingNewsPaused,
  handleScrollingNewsMouseDown,
  // 主题
  themeMode,
  // 移动端菜单
  setMobileMenuOpen,
  // 搜索
  searchInputRef,
  query,
  setQuery,
  searchOpen,
  setSearchOpen,
  searchSuggestions,
  executeSearch,
  searchHistory,
  searchSort,
  setSearchSort,
  // 分类
  category,
  setCategory,
  categoryOpen,
  setCategoryOpen,
  categories,
  // GitHub
  githubLang,
  setGithubLang,
  githubSince,
  setGithubSince,
  loadGithub,
  // GitHub 一键 AI 情报（顶栏按钮，替代原中英文切换位置）
  githubExpandedAll,
  onToggleGithubInsights,
  githubAnyInsightLoading,
  // 模式 / 区域
  mode,
  setMode,
  regionFilter,
  setRegionFilter,
  // 来源过滤
  sourceFilter,
  setSourceFilter,
  sourceOptions,
  // 视图模式
  viewMode,
  setViewMode,
  // 大屏
  setGlobeFullscreenOpen,
  // 刷新
  loadNews,
  blocked,
  debouncedQuery,
  // 热门榜单
  trendingType,
  setTrendingType,
  trendingPlatform,
  setTrendingPlatform,
  loadTrending,
  newSinceLastVisit = 0,
  // 用户画像页遥测数据（由 App 注入，仅 profile-center 使用）
  telemetryStats,
  profileSection,
  setProfileSection,
}) {
  // 滚动毛玻璃化：页面滚动 >10px 时 topbar 加 scrolled 类
  const [scrolled, setScrolled] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`topbar ${nav === 'all' ? 'topbar-all' : ''} ${nav === 'stock' ? 'topbar-stock' : ''} ${(nav === 'trending' || nav === 'recommendations') ? 'topbar-trending' : ''} ${scrolled ? 'topbar-scrolled' : ''}`}>
      {/* 滚动资讯热点区域 - 置于最顶部，连续滚动 + 可手动拖动 */}
      {nav === 'all' && scrollingNews.length > 0 && (
        <div className="scrolling-news-container">
          <div className="scrolling-news-header">
            <span className="scrolling-news-label">热门资讯</span>
            <span className="scrolling-news-icon">{ICONS.fire}</span>
          </div>
          <div
            ref={scrollingNewsRef}
            className="scrolling-news-content"
            onMouseEnter={() => setScrollingNewsPaused(true)}
            onMouseLeave={() => setScrollingNewsPaused(false)}
            onMouseDown={handleScrollingNewsMouseDown}
          >
            <div className="scrolling-news-track">
              {[...scrollingNews, ...scrollingNews].map((item, index) => (
                <div key={`${item.id}-${index}`} className="scrolling-news-item">
                  {item.hot && <span className="scrolling-news-hot">HOT</span>}
                  <span className="scrolling-news-title">{item.title}</span>
                  <span className="scrolling-news-meta">
                    <span className="scrolling-news-source">{item.source}</span>
                    <span className="scrolling-news-time">{item.time}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 用户画像页：系统遥测栏置顶（替代顶部语言切换，随 sticky 顶栏固定在屏幕最顶端） */}
      {/* 用户画像页：系统遥测栏置顶 + 分区菜单按钮 */}
      {nav === 'profile-center' && (
        <div className="profile-center-page topbar-hud-host">
          <HudTelemetryBar
            stats={telemetryStats || []}
            actions={
              <div className="hud-section-menu">
                <button type="button" className="hud-section-menu-btn" title={'\u5207\u6362\u753b\u50cf\u5206\u533a'} aria-label={'\u5207\u6362\u753b\u50cf\u5206\u533a'} aria-expanded={sectionMenuOpen} onClick={() => setSectionMenuOpen(v => !v)}>
                  {ICONS.grid}
                </button>
                {sectionMenuOpen && (
                  <>
                    <div className="dropdown-backdrop" onClick={() => setSectionMenuOpen(false)} />
                    <div className="hud-section-dropdown">
                      {PROFILE_SECTIONS.map(sec => (
                        <button
                          key={sec.id}
                          className={"hud-section-opt " + (profileSection === sec.id ? "active" : "")}
                          onClick={() => { setProfileSection(sec.id); setSectionMenuOpen(false); }}>
                          <span className="hud-section-icon">{ICONS[sec.icon]}</span>
                          <span>{sec.label}</span>
                        </button>
                      ))}
                    </div>
                </>
              )}
            </div>
            }
          />
        </div>
      )}


      <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>
        {ICONS.menu}
      </button>
      <div className={`topbar-main ${nav === 'all' ? 'topbar-main-all' : ''}`}>
        <div className={`topbar-main-row ${nav === 'all' ? 'topbar-main-row-all' : ''}`}>
          {nav === 'all' && (
            <div className="topbar-brand">
              <span className="brand-title">{PRODUCT_NAME}</span>
              <span className="brand-theme-icon" aria-hidden="true" title={themeMode === 'dark' ? '深色模式' : '浅色模式'}>{themeMode === 'dark' ? ICONS.moon : ICONS.sun}</span>
            </div>
          )}
          {nav === 'all' && (
            <div className="search-wrap">
              {ICONS.search}
              <input ref={searchInputRef} value={query} onChange={e => { setQuery(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={e => { if (e.key === "Enter" && query.trim()) executeSearch(query.trim()); }} placeholder="搜索技术、公司、项目..." />
              {searchOpen && (query.trim() || searchHistory.length > 0) && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setSearchOpen(false)} />
                  <div className="search-dropdown">
                    {searchSuggestions.map((s, i) => (
                      <button key={i} className="search-suggestion" onClick={() => executeSearch(s)}>{s}</button>
                    ))}
                    {searchSuggestions.length === 0 && searchHistory.slice(0, 5).map((h, i) => (
                      <button key={i} className="search-history-item" onClick={() => executeSearch(h.query)}>
                        {ICONS.clock}<span>{h.query}</span>
                      </button>
                    ))}
                    {query.trim() && (
                    <>
                      <div className="search-sort-row">
                        <button className={`search-sort-btn ${searchSort === "time" ? "active" : ""}`} onClick={() => setSearchSort("time")}>按时间</button>
                        <button className={`search-sort-btn ${searchSort === "relevance" ? "active" : ""}`} onClick={() => setSearchSort("relevance")}>按相关度</button>
                      </div>
                      <button className="search-submit-btn" onClick={() => executeSearch(query.trim())}>搜索全部资讯</button>
                    </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className={`topbar-actions ${(nav === 'trending' || nav === 'recommendations') ? 'singleline' : ''} ${nav === 'all' ? 'topbar-actions-all' : ''}`}>
          {nav === 'all' && (
            <div className="category-dropdown-wrap">
              <button className="category-dropdown-btn" onClick={() => setCategoryOpen(o => !o)}>
                <span>{category === 'all' ? '全部赛道' : categories.find(c => c.id === category)?.label || '全部赛道'}</span>
                <span className={`chevron ${categoryOpen ? 'open' : ''}`}>{ICONS.chevronDown}</span>
              </button>
              {categoryOpen && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setCategoryOpen(false)} />
                  <div className="category-dropdown category-dropdown-grouped">
                    <button className={`category-option ${category === 'all' ? 'active' : ''}`} onClick={() => { setCategory('all'); setCategoryOpen(false); }}>全部赛道</button>
                    {CATEGORY_GROUPS.map(group => (
                      <div key={group.id} className="category-group">
                        <div className="category-group-header">
                          <span className="cat-group-icon">{ICONS[group.icon]}</span>
                          <span className="cat-group-label">{group.label}</span>
                        </div>
                        <div className="category-group-items">
                          {group.categories.map(catId => {
                            const cat = categories.find(c => c.id === catId);
                            if (!cat) return null;
                            return (
                              <button key={cat.id} className={`category-option ${category === cat.id ? 'active' : ''}`} onClick={() => { setCategory(cat.id); setCategoryOpen(false); }}>
                                <span className="cat-icon">{ICONS[cat.icon]}</span><span>{cat.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {nav === 'github' && (
            <div className="github-filter-bar">
              <div className="lang-tabs">
                {GITHUB_PERIODS.map(p => (
                  <button key={p.id} className={`lang-tab ${githubSince === p.id ? 'active' : ''}`} onClick={() => { setGithubSince(p.id); loadGithub(githubLang, p.id); }}>{p.label}</button>
                ))}
              </div>
              <div className="lang-tabs">
                {GITHUB_LANGS.slice(0, 6).map(l => (
                  <button key={l.id} className={`lang-tab ${githubLang === l.id ? 'active' : ''}`} onClick={() => { setGithubLang(l.id); loadGithub(l.id, githubSince); }}>{l.label}</button>
                ))}
              </div>
            </div>
          )}
          {(nav === 'all' || nav === 'trending' || nav === 'reading-list' || nav === 'recommendations' || nav === 'materials' || nav === 'editor') && (
            <>
              <div className="mode-tabs">
                {MODES.map(m => <button key={m.id} className={`mode-tab ${mode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)}>{m.label}</button>)}
              </div>
              <div className="region-filter-wrap">
                <button className={`region-filter-btn ${regionFilter === 'all' ? 'active' : ''}`} onClick={() => setRegionFilter('all')}>全部</button>
                <button className={`region-filter-btn ${regionFilter === 'domestic' ? 'active' : ''}`} onClick={() => setRegionFilter('domestic')}>国内</button>
                <button className={`region-filter-btn ${regionFilter === 'overseas' ? 'active' : ''}`} onClick={() => setRegionFilter('overseas')}>国外</button>
              </div>
              {nav === 'all' && (
                <div className="source-filter-wrap">
                  <select id="source-filter" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="source-filter-select">
                    <option value="all">全部来源</option>
                    {sourceOptions.slice(0, 20).map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
                  </select>
                </div>
              )}
              <div className="view-toggle">
                {VIEW_MODES.map(v => <button key={v.id} className={`view-btn ${viewMode === v.id ? 'active' : ''}`} onClick={() => setViewMode(v.id)} title={v.label}>{v.id === 'compact' ? ICONS.list : v.id === 'standard' ? ICONS.rows : ICONS.grid3}</button>)}
              </div>
            </>
          )}
          {(nav === 'all' || nav === 'trending' || nav === 'github') && (
            <>
              {nav === 'all' && (
                <button className="globe-entry-btn" onClick={() => setGlobeFullscreenOpen(true)} title="全球科技大屏">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  全球大屏
                </button>
              )}
              <button className={`btn-refresh ${nav === 'all' ? 'btn-refresh-all' : ''}`} onClick={() => { if (nav === 'all') loadNews(blocked, false, debouncedQuery, { forceRefresh: true }); else if (nav === 'trending') loadTrending(false, trendingPlatform, trendingType); else if (nav === 'github') loadGithub(); }}>
                {ICONS.refresh}
                {nav === 'all' && newSinceLastVisit > 0 && <span className="new-news-badge" title={`自上次访问以来新增 ${newSinceLastVisit} 条`}>{newSinceLastVisit > 99 ? '99+' : newSinceLastVisit}</span>}
              </button>
              {nav === 'trending' && (
                <>
                  <div className="trending-type-tabs">
                    {TRENDING_TYPES.map(t => (
                      <button key={t.id} className={`trending-type-tab ${trendingType === t.id ? 'active' : ''}`} onClick={() => { setTrendingType(t.id); loadTrending(false, trendingPlatform, t.id); }}>
                        <span className="trending-type-icon">{ICONS[t.iconKey] || ICONS.fire}</span>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="trending-platform-topbar">
                    <select
                      className="platform-dropdown-topbar"
                      value={trendingPlatform}
                      onChange={(e) => { setTrendingPlatform(e.target.value); loadTrending(false, e.target.value, trendingType); }}
                    >
                    <option value="all">全部平台</option>
                    <optgroup label="国内平台">
                      <option value="36氪">36氪</option>
                      <option value="少数派">少数派</option>
                      <option value="爱范儿">爱范儿</option>
                      <option value="品玩">品玩</option>
                      <option value="虎扑">虎扑</option>
                      <option value="IT之家">IT之家</option>
                    </optgroup>
                    <optgroup label="国际平台">
                      <option value="Hacker News">Hacker News</option>
                      <option value="Product Hunt">Product Hunt</option>
                      <option value="Dev.to">Dev.to</option>
                      <option value="GitHub">GitHub</option>
                      <option value="TechCrunch">TechCrunch</option>
                      <option value="The Verge">The Verge</option>
                      <option value="Ars Technica">Ars Technica</option>
                      <option value="Wired">Wired</option>
                      <option value="MIT Review">MIT Review</option>
                      <option value="Engadget">Engadget</option>
                      <option value="Slashdot">Slashdot</option>
                      <option value="Smashing Mag">Smashing Mag</option>
                      <option value="Lobsters">Lobsters</option>
                    </optgroup>
                  </select>
                </div>
                </>
              )}
            </>
          )}
          {/* 语言切换器：仅在非「全部动态」页显示（全部动态页移除中英文切换）；用户画像页由系统遥测栏替代；GitHub 页该位置替换为一键启动 AI 情报 */}
          {nav === 'github' ? (
            <button
              type="button"
              className="gh-launch-ai-btn"
              onClick={onToggleGithubInsights}
              title={githubExpandedAll ? '收起全部 AI 情报' : '一键展开全部 AI 情报（也可逐卡自选）'}
            >
              {ICONS.sparkle} {githubExpandedAll ? '收起 AI 情报' : '一键启动 AI 情报'}
              {!githubExpandedAll && githubAnyInsightLoading ? '（生成中…）' : ''}
            </button>
          ) : (nav !== 'all' && nav !== 'profile-center' && nav !== 'studio' && nav !== 'monitor' && nav !== 'agents' && <LanguageSwitcher variant="compact" />)}
        </div>
      </div>
    </header>
  );
}
