import React, { useMemo, useState, useEffect } from 'react';
import { ICONS, MATERIAL_TYPES } from '../constants/index.jsx';
import MaterialGraph from './MaterialGraph.jsx';
import { getSpaces, subscribeSpaces } from '../utils/workspaceStore.js';
import { renderMarkdown } from '../utils/markdown.jsx';
import { matchesSpaceId } from '../utils/itemIdentity.js';

// v23：类型筛选直接派生自 MATERIAL_TYPES，避免再漏类型（此前漏过 project）
const TYPE_OPTIONS = Object.entries(MATERIAL_TYPES).map(([id, label]) => ({ id, label }));

const SORT_OPTIONS = [
  { id: 'newest', label: '最新优先' },
  { id: 'oldest', label: '最早优先' },
  { id: 'title', label: '按标题' },
  { id: 'source', label: '按来源' },
];

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * 素材仓库（智创中心定位重设计）
 *
 * 参考 Eagle / Notion 数据库 / Google Drive 的仓库形态，与「AI 工作站」分工：
 *   - AI 工作站负责创作与多步任务（写/编排/生成）
 *   - 素材仓库只负责「存」：收集、整理、检索、复用素材资产
 * 结构：左栏（视图/空间/类型/标签/回收站）+ 顶部工具栏 + 统计条 + 网格/列表双视图 + 详情抽屉。
 */
export default function MaterialsPage({
  materials, materialSpaces,
  materialSearch, setMaterialSearch,
  materialFilter, setMaterialFilter,
  materialSpaceFilter, setMaterialSpaceFilter,
  materialTimeRange, setMaterialTimeRange,
  materialSourceFilter, setMaterialSourceFilter,
  allMaterialSources,
  materialTags, setMaterialTags,
  allMaterialTags, filteredMaterials, selectedMaterials,
  exportMaterials, importMaterials,
  toggleMaterialStar, removeMaterial,
  batchRemoveMaterials, assignMaterialsToSpace,
  clearMaterialSelection, selectAllMaterials, toggleMaterialSelection,
  continueMaterialInWorkbench, materialRefCounts,
  showSpaceForm, setShowSpaceForm, newSpaceName, setNewSpaceName, createMaterialSpace,
  showAddMaterial, setShowAddMaterial, addManualMaterial, setLightbox,
  // 仓库新增
  materialSection, setMaterialSection,
  materialSort, setMaterialSort,
  materialView, setMaterialView,
  materialDetailId, setMaterialDetailId,
  recentlyDeleted, restoreMaterial, purgeMaterial, emptyTrash,
  renameMaterialSpace, deleteMaterialSpace,
  updateMaterialNote, updateMaterialTags, updateMaterialContent,
  onOpenStock, // v31：素材 → 股市反向链路（股市 AI 分析类素材一键跳回对应个股）
}) {
  const tagFilter = Array.isArray(materialTags) ? materialTags : [];
  const [renamingSpaceId, setRenamingSpaceId] = useState(null);
  const [editingDetail, setEditingDetail] = useState(false); // 抽屉：预览 ⇄ 编辑

  // 本地资产：各工作空间关联的文件（素材 ↔ 本地文件 关联在图谱与详情里可视化）
  const [localFiles, setLocalFiles] = useState(() => getSpaces().flatMap(sp => (sp.files || []).map(f => ({ ...f, spaceName: sp.name }))));
  useEffect(() => subscribeSpaces(() => {
    setLocalFiles(getSpaces().flatMap(sp => (sp.files || []).map(f => ({ ...f, spaceName: sp.name }))));
  }), []);
  // 素材 → 关联本地文件（标题被文件内容引用或文件名命中）
  const materialFileLinks = useMemo(() => {
    const map = new Map();
    for (const f of localFiles) {
      const content = String(f.content || '');
      for (const m of materials || []) {
        const title = String(m.title || '').trim();
        if (title.length < 2) continue;
        if ((content && content.includes(title)) || String(f.name || '').includes(title.slice(0, 12))) {
          if (!map.has(m.id)) map.set(m.id, []);
          map.get(m.id).push(f);
        }
      }
    }
    return map;
  }, [localFiles, materials]);
  const [spaceDraft, setSpaceDraft] = useState('');

  // Esc 关闭详情抽屉
  useEffect(() => {
    if (!materialDetailId) return undefined;
    const onKey = e => { if (e.key === 'Escape') setMaterialDetailId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [materialDetailId, setMaterialDetailId]);

  const detail = useMemo(
    () => materials.find(m => String(m.id) === String(materialDetailId)) || null,
    [materials, materialDetailId],
  );

  // 类型分布（统计条 + 左栏 facets）
  const typeCounts = useMemo(() => {
    const counts = new Map();
    (materials || []).forEach(m => counts.set(m.type, (counts.get(m.type) || 0) + 1));
    return counts;
  }, [materials]);

  const starCount = useMemo(() => (materials || []).filter(m => m.starred).length, [materials]);
  const weekAgo = Date.now() - 7 * 86400_000;
  const recentCount = useMemo(() => (materials || []).filter(m => Date.parse(m.createdAt) >= weekAgo).length, [materials, weekAgo]);

  const storageBytes = useMemo(
    () => (materials || []).reduce((sum, m) => sum + JSON.stringify(m || {}).length, 0),
    [materials],
  );

  // 分区 + 排序后的最终列表（搜索/类型/时间/来源/空间/标签筛选由 App 的 filteredMaterials 完成）
  const viewMaterials = useMemo(() => {
    let list = filteredMaterials;
    if (materialSection === 'starred') list = list.filter(m => m.starred);
    if (materialSection === 'recent') list = list.filter(m => Date.parse(m.createdAt) >= weekAgo);
    const sorted = [...list];
    if (materialSort === 'newest') sorted.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    else if (materialSort === 'oldest') sorted.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    else if (materialSort === 'title') sorted.sort((a, b) => String(a.title || a.content || '').localeCompare(String(b.title || b.content || ''), 'zh-CN'));
    else if (materialSort === 'source') sorted.sort((a, b) => String(a.source || '').localeCompare(String(b.source || ''), 'zh-CN'));
    return sorted;
  }, [filteredMaterials, materialSection, materialSort, weekAgo]);

  const openDetail = (m) => setMaterialDetailId(m.id);
  const closeDetail = () => setMaterialDetailId(null);

  const startRenameSpace = (space) => {
    setRenamingSpaceId(space.id);
    setSpaceDraft(space.name);
  };
  const commitRenameSpace = () => {
    if (renamingSpaceId) renameMaterialSpace(renamingSpaceId, spaceDraft);
    setRenamingSpaceId(null);
  };

  const railSection = (id, label, count) => (
    <button
      key={id}
      type="button"
      className={`repo-rail-item ${materialSection === id && materialSpaceFilter === 'all' ? 'active' : ''}`}
      onClick={() => { setMaterialSection(id); setMaterialSpaceFilter('all'); setMaterialFilter(id === 'all' ? 'all' : materialFilter); }}
    >
      <span className="repo-rail-item-label">{label}</span>
      <em className="repo-rail-item-count">{count}</em>
    </button>
  );

  return (
    <div className="repo-page">
      {/* ============ 左栏：视图 / 空间 / 类型 / 标签 / 回收站 ============ */}
      <aside className="repo-rail custom-scrollbar">
        <div className="repo-rail-group">
          <div className="repo-rail-label">视图</div>
          {railSection('all', '全部素材', materials?.length || 0)}
          {railSection('starred', '星标', starCount)}
          {railSection('recent', '最近 7 天', recentCount)}
        </div>

        <div className="repo-rail-group">
          <div className="repo-rail-label">
            空间
            <button type="button" className="repo-rail-add" onClick={() => setShowSpaceForm(true)} title="新建空间">+</button>
          </div>
          <button
            type="button"
            className={`repo-rail-item ${materialSpaceFilter === 'all' ? 'active' : ''}`}
            onClick={() => setMaterialSpaceFilter('all')}
          >
            <span className="repo-rail-item-label">不限空间</span>
          </button>
          {materialSpaces.map(space => {
            const count = (materials || []).filter(m => matchesSpaceId(m.spaceId, space.id)).length;
            return (
              <div key={space.id} className={`repo-rail-item repo-rail-item-space ${materialSpaceFilter === String(space.id) ? 'active' : ''}`}>
                {renamingSpaceId === space.id ? (
                  <input
                    className="repo-space-rename"
                    value={spaceDraft}
                    autoFocus
                    onChange={e => setSpaceDraft(e.target.value)}
                    onBlur={commitRenameSpace}
                    onKeyDown={e => { if (e.key === 'Enter') commitRenameSpace(); if (e.key === 'Escape') setRenamingSpaceId(null); }}
                  />
                ) : (
                  <>
                    <button type="button" className="repo-rail-item-btn" onClick={() => { setMaterialSection('all'); setMaterialSpaceFilter(String(space.id)); }}>
                      <span className="repo-rail-item-label">{space.name}</span>
                      <em className="repo-rail-item-count">{count}</em>
                    </button>
                    <span className="repo-rail-item-actions">
                      <button type="button" onClick={() => startRenameSpace(space)} title="重命名空间">✎</button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`删除空间「${space.name}」？其中素材将移入“不限空间”。`)) deleteMaterialSpace(space.id); }}
                        title="删除空间"
                      >×</button>
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="repo-rail-group">
          <div className="repo-rail-label">类型</div>
          {TYPE_OPTIONS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`repo-rail-item ${materialFilter === t.id ? 'active' : ''}`}
              onClick={() => { setMaterialSection('all'); setMaterialFilter(materialFilter === t.id ? 'all' : t.id); }}
            >
              <span className="repo-rail-item-label">{t.label}</span>
              <em className="repo-rail-item-count">{typeCounts.get(t.id) || 0}</em>
            </button>
          ))}
        </div>

        {allMaterialTags.length > 0 && (
          <div className="repo-rail-group">
            <div className="repo-rail-label">
              标签
              {tagFilter.length > 0 && <button type="button" className="repo-rail-add" onClick={() => setMaterialTags([])} title="清除标签筛选">×</button>}
            </div>
            <div className="repo-rail-tags">
              {allMaterialTags.slice(0, 14).map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={`repo-tag-chip ${tagFilter.includes(tag) ? 'active' : ''}`}
                  onClick={() => setMaterialTags(prev => (Array.isArray(prev) ? prev : []).includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="repo-rail-bottom">
          <button
            type="button"
            className={`repo-rail-item ${materialSection === 'trash' ? 'active' : ''}`}
            onClick={() => setMaterialSection(materialSection === 'trash' ? 'all' : 'trash')}
          >
            <span className="repo-rail-item-label">回收站</span>
            <em className="repo-rail-item-count">{recentlyDeleted.length}</em>
          </button>
        </div>
      </aside>

      {/* ============ 主区：工具栏 + 统计条 + 内容 ============ */}
      <div className="repo-main">
        <header className="repo-toolbar">
          <div className="material-search">
            {ICONS.search}
            <input
              type="text"
              placeholder="搜索素材内容、来源、标签..."
              value={materialSearch}
              onChange={e => setMaterialSearch(e.target.value)}
            />
          </div>
          <select className="material-filter" value={materialSourceFilter} onChange={e => setMaterialSourceFilter(e.target.value)} title="来源">
            <option value="all">全部来源</option>
            {allMaterialSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="material-filter" value={materialTimeRange} onChange={e => setMaterialTimeRange(e.target.value)} title="时间范围">
            <option value="all">全部时间</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
          <select className="material-filter" value={materialSort} onChange={e => setMaterialSort(e.target.value)} title="排序">
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <div className="repo-view-toggle" role="group" aria-label="视图切换">
            <button type="button" className={materialView === 'grid' ? 'active' : ''} onClick={() => setMaterialView('grid')} title="网格视图">▦</button>
            <button type="button" className={materialView === 'list' ? 'active' : ''} onClick={() => setMaterialView('list')} title="列表视图">☰</button>
            <button type="button" className={materialView === 'graph' ? 'active' : ''} onClick={() => setMaterialView('graph')} title="知识图谱（素材 ↔ 标签 ↔ 本地资产）">⌬</button>
          </div>
          <div className="repo-toolbar-spacer" />
          <div className="header-actions">
            <button className="btn-icon" onClick={exportMaterials} title="导出素材（JSON 备份）">{ICONS.link}</button>
            <label className="btn-icon" title="导入素材（JSON）">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) importMaterials(e.target.files[0]); }}
              />
            </label>
            <button className="btn-add-material" onClick={() => setShowAddMaterial(true)}>
              {ICONS.plus} 添加素材
            </button>
          </div>
        </header>

        {/* 统计条：仓库总览 */}
        <div className="repo-stats">
          <span className="repo-stat"><b>{materials?.length || 0}</b> 条素材</span>
          <span className="repo-stat"><b>{materialSpaces.length}</b> 个空间</span>
          <span className="repo-stat"><b>{starCount}</b> 星标</span>
          <span className="repo-stat-types">
            {TYPE_OPTIONS.map(t => typeCounts.get(t.id) ? (
              <span key={t.id} className="repo-stat-type">{t.label} {typeCounts.get(t.id)}</span>
            ) : null)}
          </span>
          <span className="repo-stat repo-stat-size" title="本地存储占用（估算）">≈ {formatBytes(storageBytes)}</span>
        </div>

        {/* 批量操作条 */}
        <div className="materials-actions">
          {materialSection !== 'trash' && (
            <>
              <span className="material-count">{viewMaterials.length} / {materials?.length || 0} 条</span>
              {selectedMaterials.length > 0 && (
                <div className="batch-actions">
                  <span className="batch-count">已选 {selectedMaterials.length} 项</span>
                  <select className="batch-space-select" value="" onChange={e => { if (e.target.value) assignMaterialsToSpace(selectedMaterials, e.target.value); }}>
                    <option value="">移动到空间...</option>
                    {materialSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button className="btn-batch-delete" onClick={() => { if (confirm(`确定删除 ${selectedMaterials.length} 条素材？将移入回收站。`)) batchRemoveMaterials(selectedMaterials); }}>批量删除</button>
                  <button className="btn-clear-selection" onClick={clearMaterialSelection}>取消选择</button>
                </div>
              )}
              {selectedMaterials.length === 0 && materials.length > 0 && (
                <button className="btn-select-all" onClick={selectAllMaterials}>全选</button>
              )}
            </>
          )}
          {materialSection === 'trash' && recentlyDeleted.length > 0 && (
            <div className="batch-actions">
              <span className="batch-count">回收站 {recentlyDeleted.length} 条</span>
              <button className="btn-clear-selection" onClick={() => { if (confirm('清空回收站？彻底删除后不可恢复。')) emptyTrash(); }}>清空回收站</button>
            </div>
          )}
        </div>

        {/* ============ 内容区 ============ */}
        {materialSection === 'trash' ? (
          recentlyDeleted.length === 0 ? (
            <div className="empty-materials">
              <div className="empty-icon">{ICONS.layers}</div>
              <p className="empty-title">回收站是空的</p>
              <p className="hint">删除的素材会在这里保留（最多 30 条），可随时恢复。</p>
            </div>
          ) : (
            <div className="repo-trash-list">
              {recentlyDeleted.map(m => (
                <div key={m.id} className="repo-trash-row">
                  <span className={`material-type-badge type-${m.type}`}>{MATERIAL_TYPES[m.type] || m.type}</span>
                  <span className="repo-trash-title">{m.title || String(m.content || '').slice(0, 60) || '未命名素材'}</span>
                  <span className="repo-trash-date">删除于 {new Date(m.deletedAt).toLocaleString('zh-CN')}</span>
                  <span className="repo-trash-actions">
                    <button type="button" className="btn-select-all" onClick={() => restoreMaterial(m.id)}>恢复</button>
                    <button type="button" className="btn-batch-delete" onClick={() => purgeMaterial(m.id)}>彻底删除</button>
                  </span>
                </div>
              ))}
            </div>
          )
        ) : viewMaterials.length === 0 ? (
          <div className="empty-materials">
            <div className="empty-icon">{ICONS.layers}</div>
            <p className="empty-title">{materialSearch || materialFilter !== 'all' || tagFilter.length > 0 || materialSection !== 'all' ? '没有找到匹配的素材' : '仓库还是空的'}</p>
            <p className="hint">{materialSearch || materialFilter !== 'all' || tagFilter.length > 0 || materialSection !== 'all' ? '试试调整筛选条件' : '浏览资讯时点击收藏按钮，或点击右上角“添加素材”手动添加；AI 精灵与工作站的产出也会自动存入这里。'}</p>
          </div>
        ) : materialView === 'graph' ? (
          /* 知识图谱视图：素材 ↔ 标签 ↔ 本地资产（force-graph 力导向） */
          <div className="repo-graph-view">
            <div className="repo-graph-head">
              <span className="repo-graph-title">素材知识图谱</span>
              <span className="repo-graph-meta">
                {viewMaterials.length} 素材 · {localFiles.length} 本地文件 · 连线 = 共享标签 / 内容引用
              </span>
            </div>
            <MaterialGraph
              materials={viewMaterials}
              files={localFiles}
              height={520}
              onOpenMaterial={(m) => setMaterialDetailId(m.id)}
            />
          </div>
        ) : materialView === 'list' ? (
          /* 列表视图（紧凑表格，Eagle/Drive 风格） */
          <div className="repo-list">
            {viewMaterials.map(m => (
              <div key={m.id} className={`repo-list-row ${selectedMaterials.includes(m.id) ? 'selected' : ''}`} onClick={() => openDetail(m)}>
                <label className="material-checkbox-label" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedMaterials.includes(m.id)} onChange={() => toggleMaterialSelection(m.id)} />
                  <span className="checkbox-custom" />
                </label>
                <span className={`material-type-badge type-${m.type}`}>{MATERIAL_TYPES[m.type] || m.type}</span>
                <span className="repo-list-title">{m.title || String(m.content || '').slice(0, 80) || '未命名素材'}</span>
                <span className="repo-list-source">{m.source || '—'}</span>
                <span className="repo-list-tags">{m.tags?.length ? m.tags.map(t => `#${t}`).join(' ') : ''}</span>
                <span className="repo-list-date">{new Date(m.createdAt).toLocaleDateString('zh-CN')}</span>
                <span className="repo-list-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => continueMaterialInWorkbench(m)} title="发送到 AI 工作站">研究</button>
                  <button type="button" onClick={() => toggleMaterialStar(m.id)} title={m.starred ? '取消星标' : '星标'}>{m.starred ? '★' : '☆'}</button>
                  <button type="button" onClick={() => removeMaterial(m.id)} title="删除（进回收站）">{ICONS.x}</button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          /* 网格视图（卡片，点击打开详情抽屉） */
          <div className="materials-grid">
            {viewMaterials.map(m => (
              <div
                key={m.id}
                className={`material-card material-${m.type} ${m.starred ? 'starred' : ''} ${selectedMaterials.includes(m.id) ? 'selected' : ''}`}
                onClick={() => openDetail(m)}
                title="点击查看详情"
              >
                <div className="material-header" onClick={e => e.stopPropagation()}>
                  <label className="material-checkbox-label material-select" title="选择素材（可批量操作）">
                    <input type="checkbox" checked={selectedMaterials.includes(m.id)} onChange={() => toggleMaterialSelection(m.id)} />
                    <span className="checkbox-custom" />
                  </label>
                  <span className={`material-type-badge type-${m.type}`}>{MATERIAL_TYPES[m.type] || m.type}</span>
                  <div className="material-header-actions">
                    <button className="material-research" onClick={() => continueMaterialInWorkbench(m)} title="发送到 AI 工作站继续研究">研究</button>
                    <button className="material-star" onClick={() => toggleMaterialStar(m.id)} title={m.starred ? '取消星标' : '添加星标'}>{m.starred ? '★' : '☆'}</button>
                    <button className="material-remove" onClick={() => removeMaterial(m.id)} title="删除（进回收站）">{ICONS.x}</button>
                  </div>
                </div>
                {m.title && <p className="material-title">{m.title}</p>}
                {m.imageUrl && (
                  <button className="material-image" onClick={e => { e.stopPropagation(); setLightbox({ open: true, src: m.imageUrl, title: m.title }); }} title="查看素材图片">
                    <img src={m.imageUrl} alt={m.title || '素材图片'} loading="lazy" onError={e => { e.currentTarget.parentElement.style.display = 'none'; }} />
                  </button>
                )}
                <p className="material-content">{m.fullContent || m.content}</p>
                {m.url && (
                  <a className="material-link" href={m.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    查看原文
                  </a>
                )}
                {m.note && <p className="material-note">{m.note}</p>}
                <div className="material-meta">
                  <span className="material-source">{m.source}</span>
                  {m.tags && m.tags.length > 0 && (
                    <span className="material-tags">{m.tags.map(t => `#${t}`).join(' ')}</span>
                  )}
                  {materialRefCounts[m.id] && (
                    <span className="material-ref-count" title={`被 ${materialRefCounts[m.id]} 篇文章引用`}>引用 {materialRefCounts[m.id]}</span>
                  )}
                  <span className="material-date">{new Date(m.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============ 详情抽屉 ============ */}
      {detail && (
        <>
          <div className="repo-drawer-backdrop" onClick={closeDetail} />
          <aside className="repo-drawer" role="dialog" aria-label="素材详情">
            <div className="repo-drawer-head">
              <span className={`material-type-badge type-${detail.type}`}>{MATERIAL_TYPES[detail.type] || detail.type}</span>
              <h3 className="repo-drawer-title">{detail.title || '未命名素材'}</h3>
              <button className="repo-drawer-close" onClick={closeDetail} title="关闭 (Esc)">{ICONS.x}</button>
            </div>
            <div className="repo-drawer-body custom-scrollbar">
              {detail.imageUrl && (
                <button className="material-image" onClick={() => setLightbox({ open: true, src: detail.imageUrl, title: detail.title })}>
                  <img src={detail.imageUrl} alt={detail.title || '素材图片'} onError={e => { e.currentTarget.parentElement.style.display = 'none'; }} />
                </button>
              )}
              {detail.insight && (
                <div className="material-insight">
                  {detail.insight.why && <p><span>推荐</span>{detail.insight.why}</p>}
                  {detail.insight.scenario && <p><span>场景</span>{detail.insight.scenario}</p>}
                  {detail.insight.value && <p><span>价值</span>{detail.insight.value}</p>}
                  {detail.insight.audience && <p><span>适合</span>{detail.insight.audience}</p>}
                  {detail.insight.difficulty && <p><span>难度</span>{detail.insight.difficulty}</p>}
                  {detail.insight.quality && <p><span>质量</span>{detail.insight.quality}</p>}
                </div>
              )}
              {/* 编辑态：标题/正文可改（onBlur 保存），预览即所得 */}
              {/* 预览 ⇄ 编辑切换（编辑态：标题/正文 onBlur 自动保存，保存即刷新预览） */}
              <div className="repo-drawer-editbar" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  className={`composer-chip${editingDetail ? '' : ' active'}`}
                  onClick={() => setEditingDetail(false)}
                >预览</button>
                <button
                  type="button"
                  className={`composer-chip${editingDetail ? ' active' : ''}`}
                  onClick={() => setEditingDetail(true)}
                >编辑</button>
              </div>
              {editingDetail ? (
                <div className="repo-drawer-edit">
                  <label>标题</label>
                  <input
                    className="repo-drawer-edit-title"
                    defaultValue={detail.title || ''}
                    onBlur={e => updateMaterialContentSafe(detail.id, { title: e.target.value })}
                  />
                  <label>正文（Markdown，失焦自动保存并刷新预览）</label>
                  <textarea
                    className="repo-drawer-edit-content custom-scrollbar"
                    rows={16}
                    defaultValue={String(detail.fullContent || detail.content || '')}
                    onBlur={e => {
                      updateMaterialContentSafe(detail.id, { content: e.target.value });
                      // 预览刷新由 materials → detail 重新派生自动完成，无需额外 state
                    }}
                  />
                </div>
              ) : (
                <div
                  className="repo-drawer-content markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(String(detail.fullContent || detail.content || '（无内容）')) }}
                />
              )}
              {detail.note && <p className="material-note">{detail.note}</p>}

              {(materialFileLinks.get(detail.id) || []).length > 0 && (
                <div className="repo-drawer-section">
                  <label>关联本地资产（{(materialFileLinks.get(detail.id) || []).length}）</label>
                  <div className="material-file-links">
                    {(materialFileLinks.get(detail.id) || []).map(f => (
                      <span key={f.path || f.name} className="material-file-link" title={`${f.spaceName || '空间'} · ${f.path || f.name}`}>
                        📄 {f.name}<em>{f.spaceName}</em>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="repo-drawer-section">
                <label>备注</label>
                <textarea
                  rows={2}
                  placeholder="添加备注…（自动保存）"
                  defaultValue={detail.note || ''}
                  onBlur={e => updateMaterialNoteSafe(detail.id, e.target.value)}
                />
              </div>
              <div className="repo-drawer-section">
                <label>标签（逗号分隔）</label>
                <input
                  type="text"
                  placeholder="如：AI, 芯片, 趋势"
                  defaultValue={(detail.tags || []).join(', ')}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                  onBlur={e => {
                    const tags = e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
                    updateMaterialTagsSafe(detail.id, tags);
                  }}
                />
              </div>
              <div className="repo-drawer-section">
                <label>所属空间</label>
                <select
                  value={detail.spaceId ?? ''}
                  onChange={e => assignMaterialsToSpace([detail.id], e.target.value || null)}
                >
                  <option value="">不限空间</option>
                  {materialSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="repo-drawer-meta">
                <span>来源：{detail.source || '—'}</span>
                <span>添加于 {new Date(detail.createdAt).toLocaleString('zh-CN')}</span>
                {materialRefCounts[detail.id] && <span>被 {materialRefCounts[detail.id]} 篇文章引用</span>}
                {detail.url && <a href={detail.url} target="_blank" rel="noopener noreferrer">查看原文</a>}
                {detail.metadata?.kind === 'stock-analysis' && detail.metadata?.code && onOpenStock && (
                  <button
                    type="button"
                    className="repo-drawer-stock-link"
                    onClick={() => { onOpenStock(detail.metadata.code, detail.metadata.stockName || ''); closeDetail(); }}
                    title="带着这份分析回到股市动向，查看对应个股最新行情"
                  >↗ 回到股市 · {detail.metadata.stockName || detail.metadata.code}</button>
                )}
              </div>
            </div>
            <div className="repo-drawer-foot">
              <button type="button" className="btn-select-all" onClick={() => { continueMaterialInWorkbench(detail); }}>发送到 AI 工作站</button>
              <button type="button" className="btn-batch-delete" onClick={() => { removeMaterial(detail.id); closeDetail(); }}>删除</button>
            </div>
          </aside>
        </>
      )}

      {/* 新建空间弹窗（保留） */}
      {showSpaceForm && (
        <div className="modal-backdrop" onClick={() => setShowSpaceForm(false)}>
          <div className="modal-content modal-small" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建素材空间</h3>
              <button className="modal-close" onClick={() => setShowSpaceForm(false)}>{ICONS.x}</button>
            </div>
            <form className="add-material-form" onSubmit={e => { e.preventDefault(); createMaterialSpace(); }}>
              <div className="form-group">
                <label>空间名称</label>
                <input
                  name="spaceName"
                  type="text"
                  placeholder="如：AI 素材、技术趋势、产品灵感"
                  value={newSpaceName}
                  onChange={e => setNewSpaceName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn-modal-cancel" onClick={() => setShowSpaceForm(false)}>取消</button>
                <button type="submit" className="btn-modal-submit">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  // 详情抽屉里的备注/标签保存（包装 hook 回调，静默失败）
  function updateMaterialNoteSafe(id, note) {
    try { updateMaterialNote?.(id, note); } catch { /* ignore */ }
  }
  function updateMaterialContentSafe(id, patch) {
    try { updateMaterialContent?.(id, patch); } catch { /* ignore */ }
  }
  function updateMaterialTagsSafe(id, tags) {
    try { updateMaterialTags?.(id, tags); } catch { /* ignore */ }
  }
}
