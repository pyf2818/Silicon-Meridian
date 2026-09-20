import { useCallback, useState } from 'react';

async function request(path, options = {}) {
  const response = await fetch(`/api/community/${path}`, { ...options, credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload?.error?.message || '社区服务请求失败');
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload.data || {};
}

/** 帖子深链（分享链接）：广场页挂载时检测 ?post= 自动打开详情 */
export function buildPostShareLink(postId) {
  const base = `${window.location.origin}/`;
  return `${base}?post=${encodeURIComponent(postId)}`;
}

/**
 * C3 任务 3：本地上传（效果图 / 效果视频 / 附件资料）。
 * multipart 单文件直传；成功返回 { id, url, kind, mime, name, size }。
 * 与 request() 分开：不能让 fetch 自动设置 JSON 头，FormData 的 boundary 由浏览器生成。
 */
export async function uploadCommunityMedia(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch('/api/community/uploads', { method: 'POST', body: form, credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload?.error?.message || '上传失败，请稍后再试');
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload.data.uploads[0];
}

export async function copyPostShareLink(postId) {
  const link = buildPostShareLink(postId);
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = link;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  return link;
}

/**
 * B2 社区视图模型：
 * view: 'featured' 精选(混合) | 'discussion' 讨论 | 'review' 测评 | 'following' 关注流
 *       | 'mine' 我的作品（含草稿） | 'bookmarks' 我的收藏
 * 频道内可叠加 tag（场景 chips）与 q（搜索）；切换 view 清空两者。
 * 每个 view 独立游标分页（nextCursor）。
 */
const VIEW_CHANNEL = { featured: null, discussion: 'discussion', review: 'review' };

export function useCommunity() {
  const [view, setView] = useState('featured');
  const [activeTag, setActiveTag] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const buildListPath = useCallback((nextView, { tag, q }) => {
    if (nextView === 'mine') return 'posts?author=me&limit=20';
    if (nextView === 'bookmarks') return 'bookmarks?limit=20';
    const parts = ['posts?limit=20'];
    const channel = VIEW_CHANNEL[nextView];
    if (channel) parts.push(`channel=${encodeURIComponent(channel)}`);
    if (nextView === 'following') parts.push('following=1');
    if (tag) parts.push(`tag=${encodeURIComponent(tag)}`);
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    return parts.join('&');
  }, []);

  const loadPosts = useCallback(async ({ view: nextView = 'featured', reset = true, tag = '', q = '' } = {}) => {
    if (reset) { setLoading(true); setPosts([]); setCursor(null); setHasMore(false); }
    else setLoadingMore(true);
    setError('');
    try {
      const path = buildListPath(nextView, { tag, q });
      const suffix = reset ? '' : `&cursor=${encodeURIComponent(cursor || '')}`;
      const data = await request(`${path}${suffix}`);
      const items = data.items || [];
      setPosts(previous => (reset ? items : [...previous, ...items]));
      setCursor(data.nextCursor || null);
      setHasMore(Boolean(data.nextCursor));
    } catch (requestError) {
      if (reset) setPosts([]);
      setError(requestError.message);
    } finally { setLoading(false); setLoadingMore(false); }
  }, [buildListPath, cursor]);

  const switchView = useCallback((nextView) => {
    setView(nextView);
    setActiveTag('');
    setActiveQuery('');
    loadPosts({ view: nextView, reset: true }).catch(() => {});
  }, [loadPosts]);

  const applyTag = useCallback((tag) => {
    const nextTag = tag || '';
    setActiveTag(nextTag);
    setActiveQuery('');
    loadPosts({ view, reset: true, tag: nextTag }).catch(() => {});
  }, [loadPosts, view]);

  const applySearch = useCallback((q) => {
    const nextQuery = String(q || '').trim();
    setActiveQuery(nextQuery);
    setActiveTag('');
    loadPosts({ view, reset: true, q: nextQuery }).catch(() => {});
  }, [loadPosts, view]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    loadPosts({ view, reset: false, tag: activeTag, q: activeQuery }).catch(() => {});
  }, [activeQuery, activeTag, hasMore, loadPosts, loadingMore, view]);

  const openPost = useCallback(async (postId) => {
    setSelectedPostId(postId);
    setDetailLoading(true); setError('');
    try {
      const [postData, commentData] = await Promise.all([
        request(`posts/${postId}`),
        request(`posts/${postId}/comments`),
      ]);
      setSelectedPost(postData.post || null);
      setComments(commentData.comments || []);
    } catch (requestError) { setError(requestError.message); } finally { setDetailLoading(false); }
  }, []);

  const createPost = useCallback(async (input) => {
    const data = await request('posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    // 发布后回到当前视图并置顶新帖（含 mine 视角）
    setPosts(previous => [data.post, ...previous]);
    return data.post;
  }, []);

  // 编辑帖子（仅作者，服务端 PATCH /posts/:id 校验）：本地列表 + 详情同步
  const updatePost = useCallback(async (postId, input) => {
    const data = await request(`posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    setPosts(previous => previous.map(post => post.id === postId ? data.post : post));
    if (selectedPost?.id === postId) setSelectedPost(data.post);
    return data.post;
  }, [selectedPost]);

  const addComment = useCallback(async (postId, body, parentId = null, kind = 'comment') => {
    const data = await request(`posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, parentId, kind }) });
    setComments(previous => [...previous, data.comment]);
    setPosts(previous => previous.map(post => post.id === postId ? { ...post, commentCount: Number(post.commentCount || 0) + 1 } : post));
    if (selectedPost?.id === postId) setSelectedPost(previous => ({ ...previous, commentCount: Number(previous.commentCount || 0) + 1 }));
    return data.comment;
  }, [selectedPost?.id]);

  const updateRelationship = useCallback(async (postId, relation, enabled) => {
    const stateKey = relation === 'like' ? 'liked' : 'bookmarked';
    const countKey = relation === 'like' ? 'likeCount' : 'bookmarkCount';
    const update = post => post.id !== postId ? post : { ...post, [stateKey]: enabled, [countKey]: Math.max(0, Number(post[countKey] || 0) + (enabled ? 1 : -1)) };
    const previousPosts = posts;
    const previousSelected = selectedPost;
    setPosts(current => current.map(update));
    if (selectedPost?.id === postId) setSelectedPost(update);
    try {
      const data = await request(`posts/${postId}/${relation}`, { method: enabled ? 'PUT' : 'DELETE' });
      setPosts(current => current.map(post => post.id === postId ? data.post : post));
      if (selectedPost?.id === postId) setSelectedPost(data.post);
    } catch (requestError) {
      setPosts(previousPosts); setSelectedPost(previousSelected); throw requestError;
    }
  }, [posts, selectedPost]);

  const setFollow = useCallback(async (authorId, enabled) => {
    await request(`users/${authorId}/follow`, { method: enabled ? 'PUT' : 'DELETE' });
    setPosts(previous => previous.map(post => post.authorId === authorId ? { ...post, following: enabled } : post));
    if (selectedPost?.authorId === authorId) setSelectedPost(previous => ({ ...previous, following: enabled }));
  }, [selectedPost?.authorId]);

  return {
    view, switchView, activeTag, activeQuery, applyTag, applySearch,
    posts, selectedPost, selectedPostId, comments, loading, loadingMore, hasMore, detailLoading, error,
    setSelectedPost, setComments, setError, setSelectedPostId,
    loadPosts, loadMore,
    openPost, createPost, updatePost, addComment,
    setLike: (postId, enabled) => updateRelationship(postId, 'like', enabled),
    setBookmark: (postId, enabled) => updateRelationship(postId, 'bookmark', enabled),
    setFollow,
  };
}
