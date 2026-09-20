import { useState, useEffect, useCallback } from 'react';
import { loadLS, saveLS } from '../utils/localStorage.js';
import { showToast } from '../utils/toast.js';
import { canonicalItemId, canonicalSpaceId, matchesSpaceId } from '../utils/itemIdentity.js';
import { createStableId } from '../utils/stableId.js';
import {
  assignSpaceToMaterials,
  detachMaterialsFromSpace,
  normalizeStoredMaterials,
  normalizeStoredSpaces,
} from '../domain/creative/spaceMapping.js';
import {
  collectImportedMaterials,
  mergeMaterials,
  pullMaterialFromTrash,
  purgeMaterialFromTrash,
  pushMaterialsToTrash,
  removeMaterialsByIds,
} from '../domain/creative/materialLifecycle.js';

/**
 * 书签与素材库状态管理 hook
 *
 * 从 App.jsx 提取，管理：
 *   - bookmarks / materials / selectedMaterials / materialSpaces / newSpaceName
 *   - 所有书签/素材操作函数（toggleBookmark / toggleMaterial / ...）
 *   - localStorage 持久化
 *
 * 跨域依赖（由调用方以参数传入，避免循环依赖）：
 *   - creativeWorkspace: useCreativeWorkspace() 返回值，用于 addAsset/removeAsset
 *   - setNav: 导航 setter（setNav('home') 替代 goNav，在 App.jsx 第一批 useState 即可用）
 *   - setCopilotPendingMessage: 设置 AI 工作站待发送消息
 *   - setShowAddMaterial: 控制添加素材弹窗
 *   - setShowSpaceForm: 控制素材空间表单
 *   - materialSpaceFilter / setMaterialSpaceFilter: 当前空间筛选
 *   - buildNewsCardInsight: 可选，从资讯卡片构造洞察文本
 *
 * NOTE: filteredMaterials / selectAllMaterials 已移回 App.jsx，在 useMaterialsMemos 之后定义，
 *       避免循环依赖（useMaterialsMemos 需要本 hook 提供的 materials）。
 */
export function useBookmarkMaterial({
  creativeWorkspace,
  setNav,
  setCopilotPendingMessage,
  setCopilotMaterialIds,
  setShowAddMaterial,
  setShowSpaceForm,
  materialSpaceFilter,
  setMaterialSpaceFilter,
  buildNewsCardInsight,
} = {}) {
  const [bookmarks, setBookmarks] = useState(() => loadLS('bookmarks', []));
  // 冷启动自愈：历史 spaceId 可能是数字 / 带空格字符串（NaN 已在落盘时变 null）→ 统一成字符串
  const [materials, setMaterials] = useState(() => normalizeStoredMaterials(loadLS('materials', [])));
  const [materialSpaces, setMaterialSpaces] = useState(() => normalizeStoredSpaces(loadLS('materialSpaces', [])));
  const [newSpaceName, setNewSpaceName] = useState('');
  // selectedMaterials 保留在 hook 内，selectAllMaterials 移到 App.jsx（依赖 filteredMaterials）
  const [selectedMaterials, setSelectedMaterials] = useState([]);

  // 持久化：与原 App.jsx 统一同步 effect 保持一致，单独写一份只管本 hook 的 state
  useEffect(() => {
    saveLS('bookmarks', bookmarks);
  }, [bookmarks]);
  useEffect(() => {
    saveLS('materials', materials);
  }, [materials]);
  useEffect(() => {
    saveLS('materialSpaces', materialSpaces);
  }, [materialSpaces]);

  const isBookmarked = useCallback(
    (itemId) => { const key = canonicalItemId(itemId); return Boolean(key) && bookmarks.some(b => canonicalItemId(b.itemId) === key); },
    [bookmarks]
  );

  const isInMaterials = useCallback(
    (itemId) => { const key = canonicalItemId(itemId); return Boolean(key) && materials.some(m => canonicalItemId(m.originalItemId) === key); },
    [materials]
  );

  const toggleBookmark = useCallback((item) => {
    const itemId = canonicalItemId(item?.id);
    if (!itemId) return;
    setBookmarks(prev => {
      const exists = prev.find(b => canonicalItemId(b.itemId) === itemId);
      if (exists) return prev.filter(b => canonicalItemId(b.itemId) !== itemId);
      return [...prev, {
        id: createStableId('bookmark'),
        itemId,
        title: item.title,
        url: item.url,
        source: item.source,
        savedAt: new Date().toISOString(),
        isRead: false,
        readAt: null,
        summary: item.summary,
        tags: item.tags,
        region: item.region,
        mode: item.mode,
        publishedAt: item.publishedAt,
        category: item.category,
      }];
    });
  }, []);

  const toggleRead = useCallback((bookmarkId) => {
    setBookmarks(prev => prev.map(b => b.id === bookmarkId
      ? { ...b, isRead: !b.isRead, readAt: !b.isRead ? new Date().toISOString() : null }
      : b));
  }, []);

  // 根据内容智能判断素材类型
  const detectMaterialType = useCallback((item) => {
    if (item.materialType) return item.materialType;
    if (item.source === 'GitHub' || item.category === 'open-source' || item.fullName) return 'project';
    if (item.category) {
      const catMap = {
        'ai-models': 'data', 'ai-apps': 'data', 'ai-tools': 'data',
        'open-source': 'case', 'developer': 'case',
        'funding': 'data', 'ipo': 'data', 'mergers-acquisitions': 'data',
        'policy': 'viewpoint', 'regulation': 'viewpoint',
        'industry-trends': 'viewpoint', 'emerging-tech': 'viewpoint',
        'product-launch': 'case', 'partnership': 'case',
      };
      return catMap[item.category] || 'news';
    }
    return 'news';
  }, []);

  // 素材库操作
  const toggleMaterial = useCallback((item, type = null, note = '') => {
    if (!canonicalItemId(item?.id)) return;
    if (isInMaterials(item.id)) {
      const key = canonicalItemId(item.id);
      setMaterials(prev => prev.filter(m => canonicalItemId(m.originalItemId) !== key));
      const removed = materials.find(m => canonicalItemId(m.originalItemId) === canonicalItemId(item.id));
      creativeWorkspace?.removeAsset?.(removed?.id || item.id);
      const toast = document.createElement('div');
      toast.className = 'material-toast';
      toast.textContent = '已从素材库移除';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    } else {
      const detectedType = type || detectMaterialType(item);
      const tags = Array.from(new Set([
        ...(item.tags || []),
        ...(item.topics || []),
        item.language,
        item.category,
      ].filter(Boolean)));
      const newMaterial = {
        id: createStableId('material'),
        type: detectedType,
        title: item.title,
        content: item.summary || item.title,
        fullContent: item.fullContent || item.content || item.summary || item.title,
        source: item.source,
        url: item.url,
        tags,
        imageUrl: item.imageUrl || '',
        insight: item.insight || (buildNewsCardInsight ? buildNewsCardInsight(item) : null),
        metadata: item.metadata || null,
        originalItemId: canonicalItemId(item.id),
        note,
        createdAt: new Date().toISOString(),
      };
      setMaterials(prev => [...prev, newMaterial]);
      creativeWorkspace?.addAsset?.(newMaterial);
      const toast = document.createElement('div');
      toast.className = 'material-toast';
      toast.textContent = '✓ 已添加到素材库';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }
  }, [isInMaterials, detectMaterialType, creativeWorkspace, buildNewsCardInsight, materials]);

  const addManualMaterial = useCallback(({ title, content, type, source, url, tags, note, spaceId, imageUrl, fullContent, insight, metadata }) => {
    const newMaterial = {
      id: createStableId('material'),
      type,
      title,
      content,
      fullContent: fullContent || content,
      source: source || '手动添加',
      url: url || '',
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      note,
      // 空间 ID 是不透明字符串：绝不做 Number() 强转（'space-xxxx' → NaN → 落盘变 null）
      spaceId: canonicalSpaceId(spaceId) || null,
      imageUrl: imageUrl || '',
      insight: insight || null,
      metadata: metadata || null,
      createdAt: new Date().toISOString(),
    };
    setMaterials(prev => [...prev, newMaterial]);
    setShowAddMaterial?.(false);
    return newMaterial;
  }, [setShowAddMaterial]);

  const continueMaterialInWorkbench = useCallback((material) => {
    if (!material) return;
    setSelectedMaterials([material.id]);
    // 结构化引用：不再把 3500 字正文快照贴进消息——素材 ID 挂进 copilotMaterialIds，
    // buildMaterialContext 会把该素材强制置顶进上下文；正文由 agent 用 read_material
    // 按需取回（目录层已列 [素材:ID]，read_material 可读全文）。
    setCopilotMaterialIds?.([material.id]);
    setCopilotPendingMessage?.(
      `请基于素材「${material.title || '未命名素材'}」（[素材:${material.id}]，已置顶进上下文）继续研究：先用 read_material 读取它的完整正文，再给出判断与建议。`,
    );
    setNav?.('home');
    showToast('已发送到 AI 工作站继续研究');
  }, [setNav, setCopilotPendingMessage, setCopilotMaterialIds]);

  // ===== 回收站：删除进回收站（软删除，可恢复/彻底清除），上限 30 条 =====
  // 自愈：历史 spaceId 可能是数字 / 带空格字符串
  const [recentlyDeleted, setRecentlyDeleted] = useState(() => normalizeStoredMaterials(loadLS('recentlyDeletedMaterials', [])));
  useEffect(() => {
    saveLS('recentlyDeletedMaterials', recentlyDeleted);
  }, [recentlyDeleted]);

  // 恢复：先算出「要恢复哪条」，再分别做纯 state 更新与副作用。
  // 不能在 updater 里调 setMaterials / addAsset —— StrictMode 下 updater 会被调用两次，素材会重复插入。
  const restoreMaterial = useCallback((id) => {
    const { trash, item } = pullMaterialFromTrash(recentlyDeleted, id);
    if (!item) return;
    setRecentlyDeleted(trash);
    setMaterials(prev => mergeMaterials(prev, [item], { front: true }));
    creativeWorkspace?.addAsset?.(item);
  }, [recentlyDeleted, creativeWorkspace]);

  const purgeMaterial = useCallback((id) => {
    setRecentlyDeleted(prev => purgeMaterialFromTrash(prev, id));
  }, []);

  const emptyTrash = useCallback(() => setRecentlyDeleted([]), []);

  // 删除 = 进回收站（软删除），可恢复；彻底删除走 purgeMaterial
  const removeMaterial = useCallback((id) => {
    const target = materials.find(m => m.id === id);
    if (!target) return;
    setMaterials(prev => removeMaterialsByIds(prev, [id]));
    setRecentlyDeleted(prev => pushMaterialsToTrash(prev, [target]));
    creativeWorkspace?.removeAsset?.(target.id);
  }, [materials, creativeWorkspace]);

  const batchRemoveMaterials = useCallback((ids) => {
    const targets = materials.filter(m => ids.includes(m.id));
    if (targets.length) {
      setMaterials(prev => removeMaterialsByIds(prev, ids));
      setRecentlyDeleted(prev => pushMaterialsToTrash(prev, targets));
      targets.forEach(m => creativeWorkspace?.removeAsset?.(m.id));
    }
    setSelectedMaterials([]);
  }, [materials, creativeWorkspace]);

  const updateMaterialTags = useCallback((id, tags) => {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, tags } : m));
  }, []);

  const toggleMaterialSelection = useCallback((id) => {
    setSelectedMaterials(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }, []);

  // selectAllMaterials moved to App.jsx — depends on filteredMaterials (useMaterialsMemos),
  // which in turn depends on materials from this hook (would cause TDZ if kept here).

  const clearMaterialSelection = useCallback(() => {
    setSelectedMaterials([]);
  }, []);

  const updateMaterialNote = useCallback((id, note) => {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, note } : m));
  }, []);

  /** 编辑素材标题与正文（抽屉编辑态）：写回后由 saveLS 自动持久化 */
  const updateMaterialContent = useCallback((id, { title, content } = {}) => {
    setMaterials(prev => prev.map(m => {
      if (m.id !== id) return m;
      const next = { ...m };
      if (typeof title === 'string' && title.trim()) next.title = title.trim();
      if (typeof content === 'string') {
        next.content = content;                        // 列表摘要源
        next.fullContent = content;                    // 详情/工作站取用源
        next.updatedAt = new Date().toISOString();
      }
      return next;
    }));
  }, []);

  const assignMaterialsToSpace = useCallback((ids, spaceId) => {
    setMaterials(prev => assignSpaceToMaterials(prev, ids, spaceId));
    setSelectedMaterials([]);
  }, []);

  const createMaterialSpace = useCallback(() => {
    if (!newSpaceName.trim()) return;
    const newSpace = { id: createStableId('space'), name: newSpaceName.trim(), createdAt: new Date().toISOString() };
    setMaterialSpaces(prev => [...prev, newSpace]);
    setNewSpaceName('');
    setShowSpaceForm?.(false);
  }, [newSpaceName, setShowSpaceForm]);

  const renameMaterialSpace = useCallback((id, name) => {
    const next = String(name || '').trim();
    if (!next) return;
    setMaterialSpaces(prev => prev.map(s => matchesSpaceId(s?.id, id) ? { ...s, name: next } : s));
  }, []);

  const deleteMaterialSpace = useCallback((id) => {
    setMaterialSpaces(prev => prev.filter(s => !matchesSpaceId(s?.id, id)));
    // 严格相等会漏掉类型不一致的 spaceId，留下永远筛不出的孤儿归属
    setMaterials(prev => detachMaterialsFromSpace(prev, id));
    if (materialSpaceFilter !== 'all' && matchesSpaceId(materialSpaceFilter, id)) setMaterialSpaceFilter?.('all');
  }, [materialSpaceFilter, setMaterialSpaceFilter]);

  const toggleMaterialStar = useCallback((id) => {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, starred: !m.starred } : m));
  }, []);

  const exportMaterials = useCallback(() => {
    const data = JSON.stringify(materials, null, 2);
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `siliconstream-materials-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [materials]);

  const importMaterials = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (Array.isArray(imported)) {
          // 空间归属要按本机现有空间校验：导入的备份可能来自另一台设备
          const spaceIds = new Set(materialSpaces.map(s => canonicalSpaceId(s.id)).filter(Boolean));
          const { imported: valid, rejected } = collectImportedMaterials(imported, { spaceIds });
          if (!valid.length) throw new Error('empty material list');
          setMaterials(prev => mergeMaterials(prev, valid));
          valid.forEach(material => creativeWorkspace?.addAsset?.(material));
          const toast = document.createElement('div');
          toast.className = 'material-toast';
          toast.textContent = rejected
            ? `✓ 成功导入 ${valid.length} 条素材（跳过 ${rejected} 条无效）`
            : `✓ 成功导入 ${valid.length} 条素材`;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 2000);
        }
      } catch (err) {
        alert('导入失败：文件格式错误');
      }
    };
    reader.readAsText(file);
  }, [creativeWorkspace, materialSpaces]);

  return {
    // state
    bookmarks,
    setBookmarks,
    materials,
    setMaterials,
    selectedMaterials,
    setSelectedMaterials,
    materialSpaces,
    setMaterialSpaces,
    newSpaceName,
    setNewSpaceName,
    // operations
    toggleBookmark,
    isBookmarked,
    isInMaterials,
    toggleRead,
    detectMaterialType,
    toggleMaterial,
    addManualMaterial,
    continueMaterialInWorkbench,
    removeMaterial,
    batchRemoveMaterials,
    updateMaterialTags,
    toggleMaterialSelection,
    // selectAllMaterials is defined in App.jsx after useMaterialsMemos
    clearMaterialSelection,
    updateMaterialNote,
    updateMaterialContent,
    assignMaterialsToSpace,
    createMaterialSpace,
    deleteMaterialSpace,
    renameMaterialSpace,
    // 回收站
    recentlyDeleted,
    restoreMaterial,
    purgeMaterial,
    emptyTrash,
    toggleMaterialStar,
    exportMaterials,
    importMaterials,
  };
}
