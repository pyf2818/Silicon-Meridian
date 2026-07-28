import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../utils/toast.js';

/**
 * Phase 2 Task 5: buildListQuery 纯函数
 * 构造 GET /api/agent-memory/list 的查询参数
 */
export function buildListQuery({ page, pageSize, memoryType }) {
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = Math.max(0, (Number(page) || 0)) * limit;
  const q = { limit, offset };
  if (memoryType) q.memoryType = memoryType;
  return q;
}

/**
 * Phase 2 Task 5: parseListResponse 纯函数
 * 解析后端响应，通过"满页"判断是否有更多数据
 */
export function parseListResponse(payload, pageSize) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.memories)) {
    return { items: [], hasMore: false };
  }
  const items = payload.memories;
  const hasMore = items.length === pageSize;
  return { items, hasMore };
}

/**
 * Phase 2 Task 5: useAgentMemories hook
 * 封装 agent_memories CRUD 操作
 */
export function useAgentMemories() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);
  const [memoryType, setMemoryType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = buildListQuery({ page, pageSize, memoryType });
      const params = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) });
      if (q.memoryType) params.set('memoryType', q.memoryType);
      const res = await fetch(`/api/agent-memory/list?${params.toString()}`, { credentials: 'include' });
      if (res.status === 401) {
        setItems([]);
        setHasMore(false);
        setError('请先登录');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || '加载失败');
      }
      const { items: parsedItems, hasMore: parsedHasMore } = parseListResponse(payload, pageSize);
      setItems(parsedItems);
      setHasMore(parsedHasMore);
    } catch (err) {
      setError(err.message || '加载失败');
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, memoryType]);

  const search = useCallback(async (q) => {
    const query = (q || '').trim();
    if (!query) {
      setIsSearchMode(false);
      await refresh();
      return;
    }
    setLoading(true);
    setError(null);
    setIsSearchMode(true);
    try {
      const res = await fetch(`/api/agent-memory/search?q=${encodeURIComponent(query)}&limit=20`, { credentials: 'include' });
      if (res.status === 401) {
        setItems([]);
        setHasMore(false);
        setError('请先登录');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || '搜索失败');
      }
      const { items: parsedItems } = parseListResponse(payload, 100);
      setItems(parsedItems);
      setHasMore(false);
    } catch (err) {
      setError(err.message || '搜索失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const remove = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/agent-memory/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || '删除失败');
      }
      showToast('已删除');
      if (isSearchMode) {
        await search(searchQuery);
      } else {
        await refresh();
      }
    } catch (err) {
      showToast(`删除失败：${err.message}`);
    }
  }, [refresh, search, isSearchMode, searchQuery]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    items, loading, error, hasMore,
    page, setPage, pageSize,
    memoryType, setMemoryType,
    searchQuery, setSearchQuery,
    refresh, search, remove,
  };
}
