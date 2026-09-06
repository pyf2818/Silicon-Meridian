/**
 * WorkspacePanel - 本地工作空间面板（AI 工作站左栏"文件"tab）
 *
 * v3：纯空间视图 —— 目录只由当前空间绑定决定：
 * - 每个空间绑定自己的本地文件夹（handle 按 spaceId 存 IndexedDB 槽位）
 * - 切换空间 → 自动切到该空间的目录树；「加入 AI 上下文」= 把文件**关联**进该空间
 * - 关联文件随空间持久化（元数据+截断内容），对话上下文按空间隔离
 * - 顶部：当前空间 + 绑定目录路径 + 刷新/断开（换绑通过断开后重选）
 * - 中部：文件树（展开/折叠），多选文件；双击预览可切编辑并写回
 * - 底部：操作区（关联文件）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { indexFile } from '../utils/workspaceIndex.js';
import { renderMarkdown } from '../utils/markdown.jsx';
import {
  isFileSystemSupported, pickRootDirectory, restoreRootDirectory, clearRootDirectory,
  peekSavedHandle, requestHandlePermission,
  listFiles, readFile, readFileObject, writeFile,
} from '../utils/workspace.js';
import { setRootHandle as setSharedRootHandle } from '../utils/workspaceHandleStore.js';
import {
  getActiveSpaceId, subscribeSpaces, getSpaces,
  setSpaceRoot, associateFiles, clearSpaceFiles,
} from '../utils/workspaceStore.js';

// 支持预览的文件扩展名（其他类型直接显示原始文本）
// 可预览为文本/代码的扩展名（编辑写回对所有文本类生效）
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.log', '.json', '.csv', '.tsv', '.xml', '.yml', '.yaml', '.toml', '.ini', '.env',
  '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sql',
  '.sh', '.bat', '.ps1', '.dockerfile', '.gitignore', '.svg',
]);
// 图片：object URL 预览（不可编辑/不可关联为文本上下文）
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif']);
const CLOSE_SVG = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);

export default function WorkspacePanel() {
  const [rootHandle, setRootHandle] = useState(null);

  // 预览类型判断（v12）：文本/图片/HTML 三类；extOf 取小写扩展名
  const extOf = useCallback((name) => {
    const lower = String(name || '').toLowerCase();
    const dot = lower.lastIndexOf('.');
    return dot === -1 ? '' : lower.slice(dot);
  }, []);
  const isMarkdownFile = useCallback((name) => ['.md', '.markdown'].includes(extOf(name)), [extOf]);
  const isHtmlFile = useCallback((name) => ['.html', '.htm'].includes(extOf(name)), [extOf]);
  const isImageFile = useCallback((name) => IMAGE_EXT.has(extOf(name)), [extOf]);
  const isTextFile = useCallback((name) => TEXT_EXT.has(extOf(name)) || isMarkdownFile(name) || isHtmlFile(name), [extOf, isMarkdownFile, isHtmlFile]);
  const [rootName, setRootName] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState(new Set()); // 选中的文件 path
  const [expanded, setExpanded] = useState(new Set()); // 展开的目录 path
  // 文件预览侧边 panel
  const [previewFile, setPreviewFile] = useState(null); // { name, path }
  const [previewContent, setPreviewContent] = useState('');
  const [previewUrl, setPreviewUrl] = useState(''); // 图片预览 object URL
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  // 预览内直接编辑：切换「预览 ⇄ 编辑」，保存写回本地文件
  const [editingPreview, setEditingPreview] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [savingPreview, setSavingPreview] = useState(false);
  // 权限失效后需要用户手势重新激活
  const [pendingHandle, setPendingHandle] = useState(null); // 待激活权限的 handle
  const [reactivating, setReactivating] = useState(false);
  const supported = isFileSystemSupported();

  /* ---------- 跟随当前空间：空间切换 → 切换到该空间的目录 ---------- */
  const [spaceId, setSpaceId] = useState(() => getActiveSpaceId());
  const [spaceName, setSpaceName] = useState(() => getSpaces().find(s => s.id === getActiveSpaceId())?.name || '');
  const handlesRef = useRef(new Map()); // spaceId → FileSystemDirectoryHandle（会话内缓存，切回免重授权）

  useEffect(() => subscribeSpaces(() => {
    setSpaceId(getActiveSpaceId());
    setSpaceName(getSpaces().find(s => s.id === getActiveSpaceId())?.name || '');
  }), []);

  const bindHandle = useCallback((handle, sid) => {
    handlesRef.current.set(sid, handle);
    setRootHandle(handle);
    setRootName(handle.name);
    setPendingHandle(null);
  }, []);

  // 空间切换 / 首次挂载：恢复该空间的 handle（内存缓存 → IndexedDB 槽位 → 待激活）
  useEffect(() => {
    if (!supported || !spaceId) return;
    let cancelled = false;
    setSelected(new Set());
    setExpanded(new Set());
    setPreviewFile(null);
    (async () => {
      const cached = handlesRef.current.get(spaceId);
      if (cached) {
        setRootHandle(cached);
        setRootName(cached.name);
        setPendingHandle(null);
        await refreshFiles(cached);
        return;
      }
      setRootHandle(null);
      setRootName('');
      setFiles([]);
      try {
        const handle = await restoreRootDirectory(spaceId);
        if (cancelled) return;
        if (handle) {
          bindHandle(handle, spaceId);
          setSpaceRoot(spaceId, handle.name);
          await refreshFiles(handle);
          return;
        }
        const saved = await peekSavedHandle(spaceId);
        if (cancelled) return;
        if (saved) setPendingHandle(saved);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, supported]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  const refreshFiles = useCallback(async (handle) => {
    setLoading(true);
    setError('');
    try {
      const list = await listFiles(handle, 4);
      setFiles(list);
    } catch (e) {
      setError(e.message || '读取文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // rootHandle 变化时同步到模块级 store，供 AiChatPanel agent loop 读取
  useEffect(() => {
    setSharedRootHandle(rootHandle);
  }, [rootHandle, isImageFile, isTextFile]);

  // 用户手势触发：重新激活当前空间的目录权限
  const handleReActivate = useCallback(async () => {
    if (!pendingHandle) return;
    setReactivating(true);
    setError('');
    try {
      const granted = await requestHandlePermission(pendingHandle);
      if (granted) {
        bindHandle(pendingHandle, spaceId);
        setSpaceRoot(spaceId, pendingHandle.name);
        await refreshFiles(pendingHandle);
      } else {
        setError('权限未授予，请重新点击激活按钮');
      }
    } catch (e) {
      setError(e.message || '激活权限失败');
    } finally {
      setReactivating(false);
    }
  }, [pendingHandle, refreshFiles, spaceId, bindHandle]);

  // 为当前空间选择/更换绑定的本地文件夹（换绑时清空旧关联文件）
  const handlePick = useCallback(async () => {
    setError('');
    try {
      const handle = await pickRootDirectory(spaceId);
      if (handle) {
        bindHandle(handle, spaceId);
        setSpaceRoot(spaceId, handle.name);
        clearSpaceFiles(spaceId);
        await refreshFiles(handle);
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || '选择文件夹失败');
    }
  }, [refreshFiles, spaceId, bindHandle]);

  // 断开当前空间的目录绑定（空间与会话数据都保留）
  const handleDisconnect = useCallback(async () => {
    await clearRootDirectory(spaceId);
    handlesRef.current.delete(spaceId);
    setRootHandle(null);
    setRootName('');
    setFiles([]);
    setSelected(new Set());
    setSpaceRoot(spaceId, '');
    clearSpaceFiles(spaceId);
  }, [spaceId]);

  const toggleSelect = useCallback((path) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((path) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(files.filter(f => !f.isDir).map(f => f.path)));
  }, [files]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // 双击文件 → 右侧 panel 预览
  const handlePreview = useCallback(async (file) => {
    if (!rootHandle) return;
    setPreviewFile({ name: file.name, path: file.path });
    setPreviewContent('');
    setPreviewError('');
    setPreviewLoading(true);
    setEditingPreview(false);
    setEditDraft('');
    try {
      const segments = file.path.split('/');
      if (isImageFile(file.name)) {
        const fileObj = await readFileObject(rootHandle, segments);
        setPreviewUrl(URL.createObjectURL(fileObj));
      } else if (isTextFile(file.name)) {
        setPreviewContent(await readFile(rootHandle, segments));
      } else {
        setPreviewError('暂不支持预览该格式');
      }
    } catch (e) {
      setPreviewError(e.message || '读取文件失败');
    } finally {
      setPreviewLoading(false);
    }
  }, [rootHandle]);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewUrl(url => { if (url) URL.revokeObjectURL(url); return ''; });
    setPreviewContent('');
    setPreviewError('');
    setPreviewLoading(false);
    setEditingPreview(false);
    setEditDraft('');
  }, []);

  // 预览 ⇄ 编辑 切换
  const togglePreviewEdit = useCallback(() => {
    setEditingPreview(prev => {
      if (!prev) setEditDraft(previewContent);
      return !prev;
    });
  }, [previewContent]);

  // 保存编辑到本地文件（写回原路径）+ 刷新文件树 + 更新空间关联内容
  const savePreviewEdit = useCallback(async () => {
    if (!previewFile || !rootHandle) return;
    setSavingPreview(true);
    try {
      const segs = previewFile.path.split('/');
      const fileName = segs.pop();
      await writeFile(rootHandle, segs, fileName, editDraft);
      setPreviewContent(editDraft);
      setEditingPreview(false);
      indexFile(previewFile.path, previewFile.name, editDraft);
      associateFiles(spaceId, [{ name: previewFile.name, path: previewFile.path, content: editDraft }]);
      showToast(`已保存：${previewFile.name}`);
      await refreshFiles(rootHandle);
    } catch (e) {
      setPreviewError(e.message || '保存失败');
    } finally {
      setSavingPreview(false);
    }
  }, [previewFile, rootHandle, editDraft, spaceId, showToast, refreshFiles]);

  // Esc 关闭预览
  useEffect(() => {
    if (!previewFile) return;
    const onKey = e => { if (e.key === 'Escape') closePreview(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewFile, closePreview]);


  // 在预览 panel 内一键关联当前文件到空间（并进对话上下文）
  const addPreviewToContext = useCallback(async () => {
    if (!previewFile) return;
    associateFiles(spaceId, [{ name: previewFile.name, path: previewFile.path, content: previewContent }]);
    showToast(`已关联到空间「${spaceName}」：${previewFile.name}`);
    closePreview();
  }, [previewFile, previewContent, spaceId, spaceName, showToast, closePreview]);

  // 关联选中文件到当前空间（元数据 + 截断内容持久化，随空间切换自动进出上下文）
  const handleAddContext = useCallback(async () => {
    if (!rootHandle || selected.size === 0) return;
    const picked = files.filter(f => !f.isDir && selected.has(f.path));
    const result = [];
    for (const f of picked) {
      try {
        const segments = f.path.split('/');
        const text = await readFile(rootHandle, segments);
        result.push({ name: f.name, path: f.path, content: text });
      } catch (e) {
        result.push({ name: f.name, path: f.path, content: `读取失败: ${e.message}`, error: true });
      }
    }
    associateFiles(spaceId, result);
    showToast(`已关联 ${result.length} 个文件到空间「${spaceName}」`);
  }, [rootHandle, selected, files, spaceId, spaceName, showToast]);

  // 不支持 File System Access API
  if (!supported) {
    return (
      <aside className="workspace-panel">
        <div className="workspace-empty">
          <div className="workspace-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
          <p className="workspace-empty-title">当前浏览器不支持本地工作空间</p>
          <p className="workspace-empty-desc">请使用 Chrome 或 Edge 浏览器以连接本地文件夹。你仍可通过各页面的「导出」按钮下载 Markdown 文件到本地。</p>
        </div>
      </aside>
    );
  }

  // 未连接文件夹
  if (!rootHandle) {
    // 权限失效：检测到保存的 handle 但权限需用户手势激活
    if (pendingHandle) {
      return (
        <aside className="workspace-panel">
          <div className="workspace-empty">
            <div className="workspace-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
            <p className="workspace-empty-title">工作空间权限待重新激活</p>
            <p className="workspace-empty-desc">已记住上次连接的 <strong>{pendingHandle.name}</strong>，浏览器要求点击确认才能继续访问。</p>
            {error && <p className="workspace-empty-error">{error}</p>}
            <button type="button" className="workspace-connect-btn" onClick={handleReActivate} disabled={reactivating}>
              {reactivating ? '激活中…' : '重新激活权限'}
            </button>
            <button type="button" className="workspace-link-btn" onClick={handlePick} disabled={reactivating}>更换文件夹</button>
          </div>
        </aside>
      );
    }
    return (
      <aside className="workspace-panel">
        <div className="workspace-empty">
          <div className="workspace-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
          <p className="workspace-empty-title">为空间「{spaceName}」绑定本地文件夹</p>
          <p className="workspace-empty-desc">每个空间绑定一个本地文件夹：文件树、导出沉淀与对话上下文都随空间隔离。新建空间后在这里绑定对应目录即可。</p>
          <button type="button" className="workspace-connect-btn" onClick={handlePick}>选择文件夹</button>
        </div>
      </aside>
    );
  }

  // 构建文件树（按目录层级折叠）
  const dirs = files.filter(f => f.isDir);
  const fileItems = files.filter(f => !f.isDir);

  return (
    <aside className="workspace-panel">
      <div className="workspace-top">
        <div className="workspace-path" title={`空间「${spaceName}」· ${rootName}`}>
          <span className="workspace-space-tag">{spaceName || '未命名空间'}</span>
          <span className="workspace-path-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
          <span className="workspace-path-name">{rootName || '未绑定目录'}</span>
        </div>
        <div className="workspace-top-actions">
          <button type="button" className="workspace-icon-btn" onClick={() => refreshFiles(rootHandle)} title="刷新">↻</button>
          <button type="button" className="workspace-icon-btn" onClick={handleDisconnect} title="断开连接">✕</button>
        </div>
      </div>
      {toast && <div className="workspace-toast">{toast}</div>}

      <div className="workspace-file-list custom-scrollbar">
        {loading && <div className="workspace-loading">读取中…</div>}
        {error && <div className="workspace-error">{error}</div>}
        {!loading && files.length === 0 && <div className="workspace-list-empty">文件夹为空</div>}
        {!loading && files.length > 0 && (
          <>
            {/* 工具栏：全部展开 / 全部折叠 */}
            <div className="workspace-tree-toolbar">
              <button type="button" className="workspace-tree-tool-btn" onClick={() => {
                setExpanded(new Set(files.filter(f => f.isDir).map(f => f.path)));
              }}>全部展开</button>
              <button type="button" className="workspace-tree-tool-btn" onClick={() => setExpanded(new Set())}>全部折叠</button>
            </div>
            {/*
              按 DFS 顺序混合渲染目录与文件，确保文件出现在它的父目录下方。
              files 数组由 listFiles 以深度优先遍历产生，天然保持父子顺序。
              每个条目先检查所有父目录是否展开，未展开则跳过。
            */}
            {files.map(item => {
              const parents = item.path.split('/').slice(0, -1);
              const allExpanded = parents.every((_, i) => expanded.has(parents.slice(0, i + 1).join('/')));
              if (!allExpanded) return null;
              if (item.isDir) {
                return (
                  <button
                    type="button"
                    key={item.path}
                    className={`workspace-tree-dir ${expanded.has(item.path) ? 'expanded' : ''}`}
                    style={{ paddingLeft: 8 + item.depth * 12 }}
                    onClick={() => toggleExpand(item.path)}
                  >
                    <span className="workspace-tree-arrow">{expanded.has(item.path) ? '▾' : '▸'}</span>
                    <span className="workspace-tree-name">{item.name}</span>
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  key={item.path}
                  className={`workspace-tree-file has-dblclick ${selected.has(item.path) ? 'selected' : ''}`}
                  style={{ paddingLeft: 8 + item.depth * 12 }}
                  onClick={() => toggleSelect(item.path)}
                  onDoubleClick={() => handlePreview(item)}
                  title={`${item.path} · 双击预览`}
                >
                  <span className="workspace-tree-file-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                  <span className="workspace-tree-name">{item.name}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {selected.size > 0 && (
        <div className="workspace-bottom">
          <div className="workspace-selected-bar">
            <span>已选 {selected.size} 个文件</span>
            <button type="button" className="workspace-link-btn" onClick={clearSelection}>清除</button>
          </div>
          <button type="button" className="workspace-action-btn primary" onClick={handleAddContext}>
            关联到空间
          </button>
          {files.filter(f => !f.isDir).length > 0 && selected.size === 0 && (
            <button type="button" className="workspace-link-btn" onClick={selectAll}>全选</button>
          )}
        </div>
      )}

      {previewFile && createPortal(
        <>
          <div className="workspace-side-panel-backdrop" onClick={closePreview} />
          <aside className="workspace-side-panel" role="dialog" aria-modal="false" aria-label="文件预览">
            <div className="workspace-side-panel-head">
              <div className="workspace-side-panel-meta">
                <span className="workspace-side-panel-type">{editingPreview ? 'edit' : 'file'}</span>
                <h3>{previewFile.name}</h3>
                <span className="workspace-side-panel-path">{previewFile.path}</span>
              </div>
              <div className="workspace-side-panel-head-actions">
                              {!previewLoading && !previewError && isTextFile(previewFile.name) && (
                  <button
                    type="button"
                    className={`workspace-side-panel-toggle ${editingPreview ? 'active' : ''}`}
                    onClick={togglePreviewEdit}
                    title={editingPreview ? '切回预览' : '切换为可编辑格式，直接修改并保存'}
                  >
                    {editingPreview ? '✓ 编辑中' : '✎ 编辑'}
                  </button>
                )}
                <button className="workspace-side-panel-close" onClick={closePreview} title="关闭 (Esc)">{CLOSE_SVG}</button>
              </div>
            </div>
            <div className="workspace-side-panel-body">
              {previewLoading && (
                <div className="workspace-side-panel-loading"><div className="spinner" /><span>正在读取文件…</span></div>
              )}
              {!previewLoading && previewError && (
                <p className="workspace-side-panel-empty">读取失败：{previewError}</p>
              )}
              {!previewLoading && !previewError && editingPreview && (
                <textarea
                  className="workspace-preview-editor"
                  value={editDraft}
                  onChange={e => setEditDraft(e.target.value)}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); savePreviewEdit(); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingPreview(false); }
                  }}
                  spellCheck={false}
                  placeholder="直接编辑文件内容…（Ctrl+S 保存，Esc 退出编辑）"
                />
              )}
              {!previewLoading && !previewError && !editingPreview && (
                isImageFile(previewFile.name)
                  ? (previewUrl
                    ? <img className="wp-image-preview" src={previewUrl} alt={previewFile.name} />
                    : <p className="workspace-side-panel-empty">图片加载失败</p>)
                  : isHtmlFile(previewFile.name)
                    ? (
                      <iframe
                        className="wp-html-preview"
                        title={previewFile.name}
                        sandbox=""
                        srcDoc={previewContent}
                      />
                    )
                    : isMarkdownFile(previewFile.name)
                      ? (previewContent
                        ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(previewContent) }} />
                        : <p className="workspace-side-panel-empty">文件为空</p>)
                      : <pre className="wp-code-preview" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '12px' }}>{previewContent}</pre>
              )}
            </div>
            <div className="workspace-side-panel-foot">
              {editingPreview && (
                <button
                  type="button"
                  className="workspace-side-panel-action primary"
                  onClick={savePreviewEdit}
                  disabled={savingPreview || editDraft === previewContent}
                  title="写回本地文件（Ctrl+S）"
                >
                  {savingPreview ? '保存中…' : '保存到本地'}
                </button>
              )}
                {isTextFile(previewFile.name) && (
                  <button
                    type="button"
                    className="workspace-side-panel-action"
                    onClick={addPreviewToContext}
                    disabled={previewLoading || !!previewError}
                    title="把当前文件内容关联到当前空间（进对话上下文）"
                  >
                    关联到空间
                  </button>
                )}
            </div>
          </aside>
        </>,
        document.body
      )}
    </aside>
  );
}
