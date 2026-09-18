import { useMemo, useState } from 'react';
import CommunityAvatar from './community/CommunityAvatar.jsx';
import PostCover from './community/PostCover.jsx';
import { CHANNEL_LABELS } from '../domain/community/visualIdentity.js';
import { renderMarkdown } from '../utils/markdown.jsx';

const KIND_META = {
  comment: { label: '讨论', tone: 'comment' },
  praise: { label: '好评', tone: 'ok' },
  critique: { label: '吐槽', tone: 'bad' },
  question: { label: '问答', tone: 'ask' },
};
const KIND_ORDER = ['comment', 'praise', 'critique', 'question'];
const VISIBILITY_LABELS = { public: '公开', followers: '仅关注者', private: '仅自己' };

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

/**
 * B4 详情大抽屉：hero 封面 → 标题/徽章 → 作者链 → 标签 → 数据行+操作 → Tabs（正文/评价/引用来源）。
 * 评价区分型（讨论/好评/吐槽/问答），kind 随评论落库。
 */
export default function CommunityPostDetail({ post, comments, loading, user, onClose, onComment, onLike, onBookmark, onFollow, onRequireAuth, onShare }) {
  const [tab, setTab] = useState('body');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentKind, setCommentKind] = useState('comment');
  const [kindFilter, setKindFilter] = useState('all');
  const [sending, setSending] = useState(false);

  const kindCounts = useMemo(() => {
    const counts = { all: comments.length, comment: 0, praise: 0, critique: 0, question: 0 };
    for (const comment of comments) counts[comment.kind] = (counts[comment.kind] || 0) + 1;
    return counts;
  }, [comments]);
  const visibleComments = useMemo(
    () => (kindFilter === 'all' ? comments : comments.filter(comment => comment.kind === kindFilter)),
    [comments, kindFilter],
  );

  if (loading) return <aside className="community-detail"><div className="community-state">正在读取完整内容...</div></aside>;
  if (!post) return null;

  const runProtected = action => {
    if (!user) { onRequireAuth(); return; }
    Promise.resolve(action()).catch(() => {});
  };
  const submitComment = async () => {
    const value = commentDraft.trim();
    if (!value || sending) return;
    if (!user) { onRequireAuth(); return; }
    setSending(true);
    try { await onComment(value, commentKind); setCommentDraft(''); } finally { setSending(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/?post=${encodeURIComponent(post.id)}`); } catch { /* 忽略 */ }
  };

  const summary = post.summary || '';

  return (
    <aside className="community-detail" data-testid="community-detail" aria-label="社区内容详情">
      <div className="community-detail-toolbar">
        <span>{CHANNEL_LABELS[post.channel] || '讨论'} · 详情</span>
        <button type="button" onClick={onClose} aria-label="关闭详情">×</button>
      </div>
      <div className="community-detail-hero">
        <PostCover post={post} height={200} />
      </div>
      <div className="community-detail-main">
        <div className="community-detail-badges">
          <span className="community-detail-badge">{CHANNEL_LABELS[post.channel] || '讨论'}</span>
          <span className="community-detail-badge ghost">{VISIBILITY_LABELS[post.visibility] || '公开'}</span>
          <span className="community-detail-badge ghost">{formatDate(post.createdAt)}</span>
        </div>
        <h2>{post.title}</h2>
        {summary && <p className="community-detail-summary">{summary}</p>}
        <div className="community-detail-author">
          <CommunityAvatar name={post.displayName || post.username} src={post.avatar} size={38} />
          <div className="community-detail-author-name">
            <strong>{post.displayName || post.username}</strong>
            <span>@{post.username}</span>
          </div>
          {user?.id !== post.authorId && (
            <button type="button" data-testid="community-detail-follow" className={`community-detail-author-follow ${post.following ? 'active' : ''}`} onClick={() => runProtected(() => onFollow(!post.following))}>
              {post.following ? '已关注' : '+ 关注'}
            </button>
          )}
        </div>
        {Array.isArray(post.tags) && post.tags.length > 0 && (
          <div className="community-detail-tags">
            {post.tags.map(tag => <span key={tag} className="community-detail-tag">#{tag}</span>)}
          </div>
        )}
        <div className="community-detail-stats-row">
          <div className="community-detail-stats">
            <span><b>{post.likeCount || 0}</b><span>赞同</span></span>
            <span><b>{post.bookmarkCount || 0}</b><span>收藏</span></span>
            <span><b>{post.commentCount || 0}</b><span>评论</span></span>
          </div>
          <div className="community-detail-actions-v2">
            <button data-testid="community-detail-like" className={post.liked ? 'liked' : ''} onClick={() => runProtected(() => onLike(!post.liked))}>👍 赞同</button>
            <button data-testid="community-detail-bookmark" className={post.bookmarked ? 'active' : ''} onClick={() => runProtected(() => onBookmark(!post.bookmarked))}>☆ 收藏</button>
            {onShare && <button onClick={() => Promise.resolve(onShare()).catch(() => {})}>分享</button>}
            <button onClick={() => Promise.resolve(copyLink()).catch(() => {})}>复制链接</button>
          </div>
        </div>

        <div className="community-detail-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'body'} className={`community-detail-tab ${tab === 'body' ? 'active' : ''}`} onClick={() => setTab('body')}>正文</button>
          <button type="button" role="tab" aria-selected={tab === 'feedback'} data-testid="community-detail-feedback-tab" className={`community-detail-tab ${tab === 'feedback' ? 'active' : ''}`} onClick={() => setTab('feedback')}>评价 {post.commentCount || comments.length || 0}</button>
          {Array.isArray(post.sourceRefs) && post.sourceRefs.length > 0 && (
            <button type="button" role="tab" aria-selected={tab === 'sources'} className={`community-detail-tab ${tab === 'sources' ? 'active' : ''}`} onClick={() => setTab('sources')}>引用来源 {post.sourceRefs.length}</button>
          )}
        </div>

        {tab === 'body' && (
          <div
            className={`community-detail-body${post.type === 'article' ? ' md-body' : ''}`}
            {...(post.type === 'article' ? { dangerouslySetInnerHTML: { __html: renderMarkdown(post.body) } } : { children: post.body })}
          />
        )}

        {tab === 'sources' && Array.isArray(post.sourceRefs) && (
          <div className="community-detail-sources">
            <strong>引用来源</strong>
            {post.sourceRefs.map((source, index) => (
              <a key={`${source.url || source.title}-${index}`} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
            ))}
          </div>
        )}

        {tab === 'feedback' && (
          <section className="community-feedback" data-testid="community-feedback">
            <div className="community-feedback-input">
              <CommunityAvatar name={user?.displayName || user?.username || '我'} src={user?.avatar || ''} size={30} />
              <div className="community-feedback-box">
                <textarea
                  data-testid="community-comment-input"
                  value={commentDraft}
                  onChange={event => setCommentDraft(event.target.value)}
                  maxLength={2000}
                  placeholder={user ? '写下经过思考的观点…' : '登录后参与讨论'}
                />
                <div className="community-feedback-kinds" role="radiogroup" aria-label="评价类型">
                  {KIND_ORDER.map(kind => (
                    <button
                      key={kind}
                      type="button"
                      data-testid={`community-kind-${kind}`}
                      className={`community-feedback-kind ${commentKind === kind ? `active-${KIND_META[kind].tone}` : ''}`}
                      onClick={() => setCommentKind(kind)}
                    >{KIND_META[kind].label}</button>
                  ))}
                </div>
              </div>
              <button type="button" data-testid="community-submit-comment" className="community-feedback-send" disabled={sending || !commentDraft.trim()} onClick={() => submitComment().catch(() => {})}>
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
            <div className="community-feedback-filters">
              {['all', ...KIND_ORDER].map(kind => (
                <button
                  key={kind}
                  type="button"
                  className={`community-feedback-filter ${kindFilter === kind ? 'active' : ''}`}
                  onClick={() => setKindFilter(kind)}
                >{kind === 'all' ? '全部' : KIND_META[kind].label} {kindCounts[kind] || 0}</button>
              ))}
            </div>
            {visibleComments.length === 0 && <p className="community-feedback-empty">还没有这类评价，来说第一句。</p>}
            {visibleComments.map(comment => {
              const meta = KIND_META[comment.kind] || KIND_META.comment;
              return (
                <article key={comment.id} className="community-feedback-item" data-testid="community-comment-item">
                  <CommunityAvatar name={comment.displayName || comment.username || '用户'} src={comment.avatar} size={30} />
                  <div className="community-feedback-item-body">
                    <div className="community-feedback-item-head">
                      <strong>{comment.displayName || comment.username || '用户'}</strong>
                      {comment.kind !== 'comment' && <span className={`community-kind-badge ${meta.tone}`}>{meta.label}</span>}
                      <time>{formatDate(comment.createdAt)}</time>
                    </div>
                    <p>{comment.body}</p>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </aside>
  );
}
