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
 * tab: 'square' 广场 | 'mine' 我的作品（含草稿） | 'bookmarks' 我的收藏
 * 每个 tab 独立游标分页（nextCursor），切换 tab 重新加载。
 */
export function useCommunity() {
  const [tab, setTab] = useState('square');
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

  const loadPosts = useCallback(async ({ tab: nextTab = 'square', reset = true } = {}) => {
    const activeTab = nextTab;
    if (reset) { setLoading(true); setPosts([]); setCursor(null); setHasMore(false); }
    else setLoadingMore(true);
    setError('');
    try {
      const path = activeTab === 'mine' ? 'posts?author=me&limit=20' : activeTab === 'bookmarks' ? 'bookmarks?limit=20' : 'posts?limit=20';
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
  }, [cursor]);

  const switchTab = useCallback((nextTab) => {
    setTab(nextTab);
    loadPosts({ tab: nextTab, reset: true }).catch(() => {});
  }, [loadPosts]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    loadPosts({ tab, reset: false }).catch(() => {});
  }, [hasMore, loadingMore, loadPosts, tab]);

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
    // 发布后回到广场并置顶新帖；当前在 mine 视角下也直接插入
    setPosts(previous => [data.post, ...previous]);
    return data.post;
  }, []);

  const addComment = useCallback(async (postId, body, parentId = null) => {
    const data = await request(`posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, parentId }) });
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
    tab, switchTab,
    posts, selectedPost, selectedPostId, comments, loading, loadingMore, hasMore, detailLoading, error,
    setSelectedPost, setComments, setError, setSelectedPostId,
    loadPosts, loadMore, switchTabSafe: switchTab,
    openPost, createPost, addComment,
    setLike: (postId, enabled) => updateRelationship(postId, 'like', enabled),
    setBookmark: (postId, enabled) => updateRelationship(postId, 'bookmark', enabled),
    setFollow,
  };
}
