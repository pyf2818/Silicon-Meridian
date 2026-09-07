import { useEffect, useMemo, useState } from 'react';
import { useCommunity, copyPostShareLink } from '../hooks/useCommunity.js';
import CommunityPostDetail from './CommunityPostDetail.jsx';
import { renderMarkdown } from '../utils/markdown.jsx';
import { showToast } from '../utils/toast.js';
import { useWorkflowStore } from '../store/workflowStore.js';

const TYPE_LABELS = { article: '文章', briefing: '每日速报', work: '创作作品', workflow: '智能体工作流' };
const TABS = [
  { id: 'square', label: '广场' },
  { id: 'mine', label: '我的作品' },
  { id: 'bookmarks', label: '我的收藏' },
];

function relativeDate(value) {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`;
  return `${Math.floor(delta / 86400000)} 天前`;
}

/** v24 #2：摘要卡不再渲染完整 Markdown——剥掉语法标记取纯文本前几行 */
function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '［代码］')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|-]{1,3}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function CommunityPage({ user, onRequireAuth, onShareToChat, materials = [] }) {
  const community = useCommunity();
  const [composerOpen, setComposerOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({ type: 'article', title: '', body: '', visibility: 'public' });
  const [pickerOpen, setPickerOpen] = useState(null); // null | 'materials' | 'workbench'
  const agentWorkflowResult = useWorkflowStore(s => s.agentWorkflowResult);

  useEffect(() => { community.loadPosts({ tab: 'square', reset: true }).catch(() => {});
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

  return (
    <div className="product-page community-page">
      {/* v24 #2：去掉大段模块说明，头部只留标题 + 发布入口 */}
      <section className="community-header community-header-compact">
        <div><span className="workbench-kicker">Community</span><h1>用户广场</h1></div>
        <button className="ai-primary-action" type="button" data-testid="community-open-composer" onClick={openComposer}>发布内容</button>
      </section>

      {/* Tab 切换：广场 / 我的作品 / 我的收藏 */}
      <nav className="community-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={community.tab === t.id}
            className={`community-tab ${community.tab === t.id ? 'active' : ''}`}
            onClick={() => { if (t.id !== 'square' && !user) { onRequireAuth(); return; } community.switchTabSafe(t.id); }}
          >
            {t.label}
          </button>
        ))}
      </nav>

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

      {community.error && <div className="community-error" data-testid="community-error"><strong>社区服务不可用</strong><span>{community.error}</span><button type="button" onClick={() => community.loadPosts({ tab: community.tab, reset: true })}>重试</button></div>}

      {/* v24 #2：feed 占满可用空间；点击内容从右侧抽屉查看 */}
      <section className="community-layout">
        <div className="community-feed">
          {community.loading && <div className="community-state">正在加载社区动态...</div>}
          {!community.loading && !community.error && community.posts.length === 0 && (
            <div className="community-state">
              <strong>{community.tab === 'square' ? '广场尚无公开内容' : community.tab === 'mine' ? '你还没有发布过作品' : '还没有收藏任何内容'}</strong>
              <span>{community.tab === 'square' ? '登录后发布第一条经过验证的分享。' : community.tab === 'mine' ? '在 AI 工作站编辑器里点击「发布到广场」，或直接发布内容。' : '在广场内容上点击「收藏」，即可在这里找到。'}</span>
            </div>
          )}
          {community.posts.map(post => {
            const excerpt = post.type === 'article' ? stripMarkdown(post.body).slice(0, 180) : String(post.body || '').slice(0, 180);
            return (
              <article key={post.id} className="community-post" data-testid="community-post" data-post-id={post.id} onClick={() => community.openPost(post.id)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') community.openPost(post.id); }}>
                <div className="community-post-meta">
                  <span className="community-post-type">{TYPE_LABELS[post.type] || post.type}</span>
                  {post.status === 'draft' && <span className="community-post-draft">草稿</span>}
                  <span>{post.displayName || post.username} · {relativeDate(post.createdAt)}</span>
                </div>
                <h2>{post.title}</h2>
                {excerpt && <p className="community-post-excerpt">{excerpt}{stripMarkdown(post.body).length > 180 || String(post.body || '').length > 180 ? '…' : ''}</p>}
                <div className="community-post-actions" onClick={event => event.stopPropagation()}>
                  <button data-testid="community-like" className={post.liked ? 'active liked' : ''} onClick={() => protectedAction(() => community.setLike(post.id, !post.liked))}>赞同 {post.likeCount || 0}</button>
                  <button data-testid="community-bookmark" className={post.bookmarked ? 'active' : ''} onClick={() => protectedAction(() => community.setBookmark(post.id, !post.bookmarked))}>收藏 {post.bookmarkCount || 0}</button>
                  <button onClick={() => community.openPost(post.id)}>评论 {post.commentCount || 0}</button>
                  <button onClick={() => sharePost(post)}>分享</button>
                  {user?.id !== post.authorId && <button data-testid="community-follow" className={post.following ? 'active' : ''} onClick={() => protectedAction(() => community.setFollow(post.authorId, !post.following))}>{post.following ? '已关注' : '关注作者'}</button>}
                </div>
              </article>
            );
          })}
          {!community.loading && community.hasMore && (
            <div className="community-load-more">
              <button type="button" onClick={community.loadMore} disabled={community.loadingMore}>
                {community.loadingMore ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* v24 #2：详情改为右侧抽屉窗口（带遮罩，不挤压信息流） */}
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
