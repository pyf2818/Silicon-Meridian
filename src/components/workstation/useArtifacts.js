/**
 * useArtifacts.js - 结果区数据 hook：列表加载 / 删除 / 刷新
 *
 * 独立可测（fetch 由 createArtifactClient 注入）；失败静默降级为 error 态，不打断工作站主流程。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createArtifactClient } from '../../session/artifactRegistry.js';

export function useArtifacts({ sessionId = '', limit = 100, client } = {}) {
  const artifactClient = useRef(client || createArtifactClient());
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const refresh = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await artifactClient.current.list({ sessionId, limit });
        if (!cancelled) setArtifacts(Array.isArray(data?.artifacts) ? data.artifacts : []);
      } catch (err) {
        if (!cancelled) setError(err?.message || '产物列表加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sessionId, limit, reloadTick]);

  const remove = useCallback(async (id) => {
    try {
      await artifactClient.current.remove(id);
      setArtifacts(list => list.filter(a => a.id !== id));
      return true;
    } catch (err) {
      setError(err?.message || '产物删除失败');
      return false;
    }
  }, []);

  /** 本地注册回显：注册成功后把 meta 行插到列表头（避免整表刷新） */
  const prepend = useCallback((artifact) => {
    if (artifact && artifact.id) setArtifacts(list => [artifact, ...list.filter(a => a.id !== artifact.id)]);
  }, []);

  return { artifacts, loading, error, refresh, remove, prepend };
}
