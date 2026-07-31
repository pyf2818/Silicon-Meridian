// useSkills.js - P5 Skills 文件夹生态前端 hook
// 拉取服务端 skills 列表（GET /api/skills?grouped=1），提供刷新 / trigger 匹配 / CRUD
// 返回 bySource：{ builtin: [], work: [], user: [] }

import { useCallback, useEffect, useState } from 'react';

export function useSkills({ enabled = true } = {}) {
  const [skills, setSkills] = useState([]);
  const [bySource, setBySource] = useState({ builtin: [], work: [], user: [] });
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // refresh=1 强制后端重新扫描磁盘（skill 文件数量少，性能可接受）
      const resp = await fetch('/api/skills?grouped=1&refresh=1');
      if (!resp.ok) throw new Error(`http ${resp.status}`);
      const data = await resp.json();
      const grouped = data?.bySource || { builtin: [], work: [], user: [] };
      setBySource(grouped);
      setSources(data?.sources || []);
      setSkills([
        ...(grouped.builtin || []),
        ...(grouped.work || []),
        ...(grouped.user || []),
      ]);
    } catch (err) {
      setError(err?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  // 创建新 skill（id 不能已存在）
  const createSkill = useCallback(async (skill) => {
    const resp = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skill),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || `http ${resp.status}`);
    }
    await refresh();
    return data.skill;
  }, [refresh]);

  // 保存（更新已有 skill）
  const saveSkill = useCallback(async (skill) => {
    const resp = await fetch('/api/skills', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skill),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || `http ${resp.status}`);
    }
    await refresh();
    return data.skill;
  }, [refresh]);

  // 保存原始 SKILL.md 文本（源码模式编辑，绕过字段级序列化）
  const saveSkillRaw = useCallback(async (source, id, rawText) => {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}/raw?source=${encodeURIComponent(source)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || `http ${resp.status}`);
    }
    await refresh();
    return data.skill;
  }, [refresh]);

  // 删除 skill（仅 work/user 可删）
  const deleteSkill = useCallback(async (id) => {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || `http ${resp.status}`);
    }
    await refresh();
    return data;
  }, [refresh]);

  return {
    skills,
    bySource,
    sources,
    loading,
    error,
    refresh,
    createSkill,
    saveSkill,
    saveSkillRaw,
    deleteSkill,
  };
}
