import { useEffect, useMemo, useState } from 'react';
import { useCommunity, copyPostShareLink } from '../hooks/useCommunity.js';
import CommunityPostDetail from './CommunityPostDetail.jsx';
import CommunityAvatar from './community/CommunityAvatar.jsx';
import MascotState from './community/MascotState.jsx';
import PostCover from './community/PostCover.jsx';
import { CHANNEL_LABELS, stripMarkdown } from '../domain/community/visualIdentity.js';
import { showToast } from '../utils/toast.js';
import { useWorkflowStore } from '../store/workflowStore.js';

const TYPE_LABELS = { article: '文章', briefing: '每日速报', work: '创作作品', workflow: '智能体工作流' };
/** B2 频道条：精选/讨论/测评/问答(P2 先并入讨论入口不单列)/关注 + 我的 */
const VIEWS = [
  { id: 'featured', label: '精选' },
  { id: 'discussion', label: '讨论' },
  { id: 'review', label: '测评' },
  { id: 'following', label: '关注' },
  { id: 'mine', label: '我的作品' },
  { id: 'bookmarks', label: '我的收藏' },
];
const AUTH_VIEWS = new Set(['following', 'mine', 'bookmarks']);
/** 场景 chips（存储为纯文本标签，渲染带 #） */
const SCENE_TAGS = ['AI厂商', '模型评测', '开源项目', '创作分享', '行业观点'];

function relativeDate(value) {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`;
  return `${Math.floor(delta / 86400000)} 天前`;
}

/** 视图空态文案（配川川） */
function emptyStateCopy(view) {
  if (view === 'featured') return { title: '川川还在等第一条内容', hint: '登录后发布第一条经过验证的分享，让广场流动起来。', action: '发布第一条内容' };
  if (view === 'discussion' || view === 'review') return { title: '这个频道还很安静', hint: '发表一篇讨论或测评，川川帮你顶上精选。', action: '去发布' };
  if (view === 'following') return { title: '还没有关注任何作者', hint: '去广场逛逛，关注喜欢的作者，动态会汇进这条川流。', action: '去广场发现' };
  if (view === 'mine') return { title: '你还没有发布过作品', hint: '在 AI 工作站编辑器里点击「发布到广场」，或直接发布内容。', action: '发布内容' };
  return { title: '还没有收藏任何内容', hint: '在内容上点击「收藏」，就能在这里找到。', action: '去广场逛逛' };
}

export default function CommunityPage({ user, onRequireAuth, onShareToChat, materials = [] }) {
  const community = useCommunity();
  const [composerOpen, setComposerOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({ type: 'article', title: '', body: '', visibility: 'public' });
  const [pickerOpen, setPickerOpen] = useState(null); // null | 'materials' | 'workbench'
  const [searchDraft, setSearchDraft] = useState('');
  const agentWorkflowResult = useWorkflowStore(s => s.agentWorkflowResult);

  useEffect(() => { community.loadPosts({ view: 'featured', reset: true }).catch(() => {});
    // 深链：/?post=<id> 分享链接直达详情
    const params = new URLSearchParams(window.location.search);
    const deepPostId = params.get('post');
    if (deepPostId) {
      community.openPost(deepPostId);
      params.delete('post');
      const next = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v24 #2：发布对接已有积累——素材库取最近 30 条、AI 工作站取最近一次工作流成果
  const importableMaterials = useMemo(() => (materials || []).slice(0, 30), [materials]);
  const workbenchDeliverable = agentWorkflowResult?.content
    ? { title: agentWorkflowResult.missionId ? `工作流成果：${agentWorkflowResult.missionId}` : 'AI 工作站最新成果', content: agentWorkflowResult.content }
    : null;

  const openComposer = () => {
    if (!user) { onRequireAuth(); return; }
    setComposerOpen(true);
  };
  const importIntoForm = (source) => {
    if (!source) return;
    setForm(prev => ({
      ...prev,
      type: 'article',
      title: prev.title || String(source.title || '').slice(0, 120),
      body: source.body || source.content || '',
    }));
    setPickerOpen(null);
    showToast('已导入到发布器，可编辑后发布');
  };
  const publish = async () => {
    setPublishing(true); community.setError('');
    try {
      await community.createPost(form);
      setForm({ type: 'article', title: '', body: '', visibility: 'public' }); setComposerOpen(false);
    } catch (error) { community.setError(error.message); } finally { setPublishing(false); }
  };
  const protectedAction = async action => {
    if (!user) { onRequireAuth(); return; }
    try { await action(); } catch (error) { community.setError(error.message); }
  };
  const sharePost = async (post) => {
    onShareToChat?.({ type: 'community-post', id: post.id, title: post.title, body: post.body, author: post.displayName || post.username });
    await copyPostShareLink(post.id);
    showToast('分享链接已复制，粘贴给好友或群聊即可');
  };
  const switchView = (viewId) => {
    if (AUTH_VIEWS.has(viewId) && !user) { onRequireAuth(); return; }
    community.switchView(viewId);
  };
  const submitSearch = () => community.applySearch(searchDraft);

  // 精选视图（无搜索/无标签过滤）首条以 hero 呈现
  const showHero = community.view === 'featured' && !community.activeQuery && !community.activeTag && community.posts.length > 0;
  const heroPost = showHero ? community.posts[0] : null;
  const gridPosts = showHero ? community.posts.slice(1) : community.posts;
  const channelChipsVisible = ['featured', 'discussion', 'review'].includes(community.view);
  const emptyCopy = emptyStateCopy(community.view);

  return (
    <div className="product-page community-page">
      {/* B2：头部 = 标题 + 搜索 + 发布入口 */}
      <section className="community-header community-header-compact">
        <div>
          <span className="workbench-kicker">Community</span>
          <h1>用户广场</h1>
          <p className="community-header-sub">讨论 · 测评 · 关注，川流不息</p>
        </div>
        <div className="community-toolbar">
          <div className="community-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              data-testid="community-search"
              value={searchDraft}
              onChange={event => setSearchDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') submitSearch(); }}
              placeholder="搜帖子、用户…"
              aria-label="搜索广场内容"
            />
            {(searchDraft || community.activeQuery) && <button type="button" className="community-search-clear" aria-label="清除搜索" onClick={() => { setSearchDraft(''); community.applySearch(''); }}>×</button>}
          </div>
          <button className="ai-primary-action" type="button" data-testid="community-open-composer" onClick={openComposer}>＋ 发布</button>
        </div>
      </section>

      {/* B2：频道条（精选/讨论/测评/关注/我的） */}
      <nav className="community-channels" role="tablist" aria-label="社区频道">
        {VIEWS.map(view => (
          <button
            key={view.id}
            type="button"
            role="tab"
            data-testid={`community-channel-${view.id}`}
            aria-selected={community.view === view.id}
            className={`community-channel-tab ${community.view === view.id ? 'active' : ''}`}
            onClick={() => switchView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </nav>

      {/* B2：场景 chips（精选/讨论/测评频道内细分） */}
      {channelChipsVisible && (
        <div className="community-chips" role="group" aria-label="场景筛选">
          <span className="community-chips-label">场景</span>
          <button type="button" className={`community-chip ${!community.activeTag ? 'active' : ''}`} onClick={() => community.applyTag('')}>全部</button>
          {SCENE_TAGS.map(tag => (
            <button key={tag} type="button" className={`community-chip ${community.activeTag === tag ? 'active' : ''}`} onClick={() => community.applyTag(community.activeTag === tag ? '' : tag)}>
              {tag}
            </button>
          ))}
          {community.activeQuery && <span className="community-chips-query">搜索「{community.activeQuery}」中</span>}
        </div>
      )}

      {composerOpen && (
        <section className="community-composer" data-testid="community-composer">
          <div className="community-composer-head"><h2>发布到广场</h2><button type="button" onClick={() => { setComposerOpen(false); setPickerOpen(null); }} aria-label="关闭发布器">×</button></div>
          <div className="community-compose-options">
            <select value={form.type} onChange={event => setForm(previous => ({ ...previous, type: event.target.value }))}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select value={form.visibility} onChange={event => setForm(previous => ({ ...previous, visibility: event.target.value }))}><option value="public">公开</option><option value="followers">仅关注者</option><option value="private">仅自己</option></select>
            <span className="community-compose-hint">正文支持 Markdown 语法（标题、列表、代码块、引用）</span>
          </div>
          {/* v24 #2：丰富发布来源——一键引用素材库 / AI 工作站成果，简化创作发布流程 */}
          <div className="community-compose-import">
            <span>从已有积累导入：</span>
            <button type="button" className={pickerOpen === 'materials' ? 'active' : ''} onClick={() => setPickerOpen(pickerOpen === 'materials' ? null : 'materials')}>素材库（{(materials || []).length}）</button>
            <button type="button" className={pickerOpen === 'workbench' ? 'active' : ''} disabled={!workbenchDeliverable} title={workbenchDeliverable ? '导入最近一次工作流成果' : '先在无限画布运行一次工作流'}>AI 工作站成果</button>
          </div>
          {pickerOpen === 'materials' && (
            <div className="community-compose-picker custom-scrollbar">
              {importableMaterials.length === 0 && <p className="community-empty-copy">素材库还是空的，先在「素材管理」里收藏或创建素材。</p>}
              {importableMaterials.map(item => (
                <button key={item.id} type="button" className="community-picker-item" onClick={() => importIntoForm({ title: item.title, body: item.fullContent || item.content || '' })}>
                  <b>{item.title || '（无标题）'}</b>
                  <small>{stripMarkdown(item.fullContent || item.content || '').slice(0, 60)}</small>
                </button>
              ))}
            </div>
          )}
          {pickerOpen === 'workbench' && workbenchDeliverable && (
            <div className="community-compose-picker custom-scrollbar">
              <button type="button" className="community-picker-item" onClick={() => importIntoForm(workbenchDeliverable)}>
                <b>{workbenchDeliverable.title}</b>
                <small>{stripMarkdown(workbenchDeliverable.content).slice(0, 80)}</small>
              </button>
            </div>
          )}
          <input data-testid="community-title-input" value={form.title} maxLength={180} onChange={event => setForm(previous => ({ ...previous, title: event.target.value }))} placeholder="标题" />
          <textarea data-testid="community-body-input" value={form.body} maxLength={100000} onChange={event => setForm(previous => ({ ...previous, body: event.target.value }))} placeholder="正文。清楚说明事实、判断依据和结论。" />
          <div className="community-compose-footer"><span>{form.body.length} / 100000</span><button type="button" data-testid="community-submit-post" disabled={publishing || !form.title.trim() || !form.body.trim()} onClick={() => publish().catch(() => {})}>{publishing ? '发布中...' : '确认发布'}</button></div>
        </section>
      )}

      {community.error && <div className="community-error" data-testid="community-error"><strong>社区服务不可用</strong><span>{community.error}</span><button type="button" onClick={() => community.loadPosts({ view: community.view, reset: true, tag: community.activeTag, q: community.activeQuery })}>重试</button></div>}

      {/* B2：feed = hero + 封面卡片栅格 */}
      <section className="community-layout">
        <div className="community-feed">
          {community.loading && <div className="community-state">正在加载社区动态...</div>}
          {!community.loading && !community.error && community.posts.length === 0 && (
            <MascotState
              testId="community-empty-state"
              title={emptyCopy.title}
              hint={emptyCopy.hint}
              actionLabel={emptyCopy.action}
              onAction={() => (community.view === 'featured' || community.view === 'discussion' || community.view === 'review' || community.view === 'mine' ? openComposer() : switchView('featured'))}
            />
          )}
          {heroPost && (
            <article className="community-hero" data-testid="community-hero" onClick={() => community.openPost(heroPost.id)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') community.openPost(heroPost.id); }}>
              <div className="community-hero-cover" style={{ background: 'none' }}>
                <PostCover post={heroPost} height={168} />
              </div>
              <div className="community-hero-body">
                <span className="community-hero-kicker">本月最值得看</span>
                <h2>{heroPost.title}</h2>
                <p>{(heroPost.summary || stripMarkdown(heroPost.body)).slice(0, 90)}</p>
                <div className="community-card-author">
                  <CommunityAvatar name={heroPost.displayName || heroPost.username} src={heroPost.avatar} size={26} />
                  <span>{heroPost.displayName || heroPost.username}</span>
                  <em>· {relativeDate(heroPost.createdAt)}</em>
                </div>
                <span className="community-hero-go">看看 →</span>
              </div>
            </article>
          )}
          <div className="community-grid">
            {gridPosts.map(post => {
              const summary = post.summary || stripMarkdown(post.body).slice(0, 90);
              return (
                <article key={post.id} className="community-card" data-testid="community-post" data-post-id={post.id} onClick={() => community.openPost(post.id)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') community.openPost(post.id); }}>
                  <PostCover post={post} />
                  <div className="community-card-body">
                    <div className="community-card-meta">
                      <span className="community-post-type">{TYPE_LABELS[post.type] || post.type}</span>
                      {post.status === 'draft' && <span className="community-post-draft">草稿</span>}
                      <span>{relativeDate(post.createdAt)}</span>
                    </div>
                    <h3>{post.title}</h3>
                    {summary && <p>{summary}{summary.length >= 90 ? '…' : ''}</p>}
                    <div className="community-card-author">
                      <CommunityAvatar name={post.displayName || post.username} src={post.avatar} size={22} />
                      <span>{post.displayName || post.username}</span>
                      {post.following && <em className="community-card-following">已关注</em>}
                    </div>
                    <div className="community-post-actions" onClick={event => event.stopPropagation()}>
                      <button data-testid="community-like" className={post.liked ? 'active liked' : ''} onClick={() => protectedAction(() => community.setLike(post.id, !post.liked))}>赞同 {post.likeCount || 0}</button>
                      <button data-testid="community-bookmark" className={post.bookmarked ? 'active' : ''} onClick={() => protectedAction(() => community.setBookmark(post.id, !post.bookmarked))}>收藏 {post.bookmarkCount || 0}</button>
                      <button onClick={() => community.openPost(post.id)}>评论 {post.commentCount || 0}</button>
                      <button onClick={() => sharePost(post)}>分享</button>
                      {user?.id !== post.authorId && <button data-testid="community-follow" className={post.following ? 'active' : ''} onClick={() => protectedAction(() => community.setFollow(post.authorId, !post.following))}>{post.following ? '已关注' : '关注作者'}</button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {!community.loading && community.hasMore && (
            <div className="community-load-more">
              <button type="button" onClick={community.loadMore} disabled={community.loadingMore}>
                {community.loadingMore ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* v24 #2：详情改为右侧抽屉窗口（带遮罩，不挤压信息流）——B4 升级大抽屉 */}
      {(community.selectedPost || community.detailLoading) && (
        <div className="community-drawer-root">
          <div className="community-drawer-mask" onClick={() => { community.setSelectedPost(null); community.setComments([]); }} />
          <CommunityPostDetail
            post={community.selectedPost} comments={community.comments} loading={community.detailLoading}
            user={user} onRequireAuth={onRequireAuth} onClose={() => { community.setSelectedPost(null); community.setComments([]); }}
            onComment={body => protectedAction(() => community.addComment(community.selectedPost.id, body))}
            onLike={enabled => protectedAction(() => community.setLike(community.selectedPost.id, enabled))}
            onBookmark={enabled => protectedAction(() => community.setBookmark(community.selectedPost.id, enabled))}
            onFollow={enabled => protectedAction(() => community.setFollow(community.selectedPost.authorId, enabled))}
            onShare={() => sharePost(community.selectedPost)}
          />
        </div>
      )}
    </div>
  );
}
