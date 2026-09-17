import { useMemo } from 'react';
import { filterBySpaceId } from '../domain/creative/spaceMapping.js';

/**
 * Derived material/article filter computations — extracted from App.jsx
 */
export function useMaterialsMemos({
  materials,
  materialSpaceFilter,
  materialFilter,
  materialTimeRange,
  materialSourceFilter,
  materialSearch,
  materialTags,
  articles,
  articleSpaceFilter,
  articleSearch,
  articleStatusFilter,
  articleTemplateFilter,
  articleSort,
  articleExportFilter,
}) {
  const filteredMaterials = useMemo(() => {
    let result = materials;
    // 空间筛选：历史上这里写的是 Number(filter)，对 'space-<uuid>' 会得到 NaN → 筛选恒空
    if (materialSpaceFilter !== 'all') result = filterBySpaceId(result, materialSpaceFilter);
    if (materialFilter !== 'all') result = result.filter(m => m.type === materialFilter);
    if (materialTimeRange !== 'all') {
      const now = Date.now();
      const ms = materialTimeRange === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      result = result.filter(m => new Date(m.createdAt).getTime() >= now - ms);
    }
    if (materialSourceFilter !== 'all') {
      result = result.filter(m => m.source === materialSourceFilter);
    }
    if (materialSearch) {
      const q = materialSearch.toLowerCase();
      result = result.filter(m =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.content || '').toLowerCase().includes(q) ||
        (m.fullContent || '').toLowerCase().includes(q) ||
        (m.source || '').toLowerCase().includes(q) ||
        (m.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (m.note || '').toLowerCase().includes(q) ||
        (m.insight && JSON.stringify(m.insight).toLowerCase().includes(q))
      );
    }
    if (materialTags.length > 0) {
      result = result.filter(m => (m.tags || []).some(t => materialTags.includes(t)));
    }
    result = [...result].sort(
      (a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return result;
  }, [materials, materialSpaceFilter, materialFilter, materialTimeRange, materialSourceFilter, materialSearch, materialTags]);

  const allMaterialSources = useMemo(() => {
    const sourceSet = new Set();
    materials.forEach(m => m.source && sourceSet.add(m.source));
    return Array.from(sourceSet).sort();
  }, [materials]);

  const allMaterialTags = useMemo(() => {
    const tagSet = new Set();
    materials.forEach(m => (m.tags || []).forEach(t => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [materials]);

  const materialRefCounts = useMemo(() => {
    const counts = {};
    articles.forEach(a => {
      (a.materials || []).forEach(mid => {
        counts[mid] = (counts[mid] || 0) + 1;
      });
    });
    return counts;
  }, [articles]);

  const filteredArticles = useMemo(() => {
    let result = [...articles];
    if (articleSpaceFilter !== 'all') result = filterBySpaceId(result, articleSpaceFilter);
    if (articleSearch) {
      const q = articleSearch.toLowerCase();
      result = result.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.content || '').toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (articleStatusFilter !== 'all') result = result.filter(a => a.status === articleStatusFilter);
    if (articleTemplateFilter !== 'all') result = result.filter(a => a.template === articleTemplateFilter);
    if (articleSort === 'updated') result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    else if (articleSort === 'created') result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (articleSort === 'title') result.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'));
    return result;
  }, [articles, articleSpaceFilter, articleSearch, articleStatusFilter, articleTemplateFilter, articleSort]);

  const filteredExportArticles = useMemo(() => {
    if (articleExportFilter === 'all') return articles;
    return articles.filter(a => a.status === articleExportFilter);
  }, [articles, articleExportFilter]);

  return {
    filteredMaterials,
    allMaterialSources,
    allMaterialTags,
    materialRefCounts,
    filteredArticles,
    filteredExportArticles,
  };
}
