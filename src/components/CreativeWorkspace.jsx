import { useMemo, useState } from 'react';
import { renderMarkdown } from '../utils/markdown.jsx';

function parseCitationIds(text = '') {
  return [...String(text).matchAll(/\[asset:([^\]]+)\]/gi)]
    .map(match => String(match[1]).trim())
    .filter(Boolean);
}

function downloadExport(result) {
  const blob = new Blob([result.content], { type: result.mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename || 'creative-export.md';
  anchor.click();
  URL.revokeObjectURL(url);
}

function mergeCitations(current = [], assets = [], citationIds = []) {
  const byId = new Map(current.map(citation => [String(citation.id), citation]));
  citationIds.forEach(id => {
    if (byId.has(String(id))) return;
    const asset = assets.find(item => String(item.id) === String(id) || String(item.originalItemId) === String(id));
    if (asset?.citation) byId.set(String(id), { ...asset.citation, id: String(id) });
  });
  return [...byId.values()];
}

export default function CreativeWorkspace({ workspace, onOpenEditor, onOpenMaterials }) {
  const [selectedAssetId, setSelectedAssetId] = useState(workspace?.assets?.[0]?.id || '');
  const [proposal, setProposal] = useState('');
  const [exportFormat, setExportFormat] = useState('md');
  const [showAssetPreview, setShowAssetPreview] = useState(false);

  const assets = workspace?.assets || [];
  const documents = workspace?.documents || [];
  const activeDocument = workspace?.activeDocument || documents[0] || null;
  const selectedAsset = assets.find(asset => String(asset.id) === String(selectedAssetId)) || assets[0] || null;
  const activeVersions = workspace?.versions || [];

  const assetIdSet = useMemo(() => new Set(assets.flatMap(asset => [
    String(asset.id),
    String(asset.originalItemId || ''),
  ]).filter(Boolean)), [assets]);

  const proposalCitationIds = useMemo(() => parseCitationIds(proposal), [proposal]);
  const invalidCitationIds = proposalCitationIds.filter(id => !assetIdSet.has(String(id)));

  const unresolvedCitations = useMemo(() => {
    if (!activeDocument) return 0;
    const linked = new Set((activeDocument.assetIds || []).map(id => String(id)));
    return (activeDocument.citations || []).filter(citation => citation.id && !linked.has(String(citation.id))).length;
  }, [activeDocument]);

  const createFromAsset = () => {
    if (!selectedAsset || !workspace?.createDocument) return;
    const document = workspace.createDocument({
      title: `${selectedAsset.title || 'Untitled'} draft`,
      content: `# ${selectedAsset.title || 'Untitled'}\n\n${selectedAsset.fullContent || selectedAsset.content || ''}\n\nSource: [asset:${selectedAsset.id}]`,
      assetIds: [selectedAsset.id],
      citations: [selectedAsset.citation].filter(Boolean),
    });
    workspace.saveVersion?.(document.id, {
      title: document.title,
      content: document.draftContent,
      assetIds: document.assetIds,
      citations: document.citations,
      reason: 'manual',
    });
  };

  const insertProposal = () => {
    if (!activeDocument || !proposal.trim() || invalidCitationIds.length) return;
    const nextContent = [activeDocument.draftContent || '', proposal.trim()].filter(Boolean).join('\n\n');
    const nextAssetIds = [...new Set([...(activeDocument.assetIds || []), ...proposalCitationIds])];
    const nextCitations = mergeCitations(activeDocument.citations || [], assets, proposalCitationIds);

    workspace.updateDraft?.(activeDocument.id, {
      draftContent: nextContent,
      assetIds: nextAssetIds,
      citations: nextCitations,
    });
    workspace.saveVersion?.(activeDocument.id, {
      title: activeDocument.title,
      content: nextContent,
      assetIds: nextAssetIds,
      citations: nextCitations,
      reason: 'ai_insert',
    });
    setProposal('');
  };

  const exportActiveDocument = () => {
    if (!activeDocument || !workspace?.exportDocument) return;
    const result = workspace.exportDocument(activeDocument.id, exportFormat);
    if (result?.ok) downloadExport(result);
  };

  return (
    <section className="creative-workspace">
      <div className="creative-workspace-head">
        <div>
          <span>Creative Workspace</span>
          <h2>创意工作台</h2>
        </div>
        <div className="creative-workspace-stats">
          <strong>{assets.length}<span>素材</span></strong>
          <strong>{documents.length}<span>文稿</span></strong>
          <strong>{activeVersions.length}<span>版本</span></strong>
          <button
            type="button"
            className="creative-sync-button"
            onClick={() => workspace?.syncNow?.()}
            disabled={!workspace?.syncNow || ['syncing', 'local'].includes(workspace?.syncState?.status)}
          >
            {workspace?.syncState?.status === 'local' ? '本地' : workspace?.syncState?.status === 'syncing' ? '同步中' : '同步'}
          </button>
        </div>
      </div>
      {workspace?.syncState?.status === 'conflict' && (
        <div className="creative-sync-alert">
          <span>检测到 {workspace.syncState.conflicts?.length || 0} 个文稿存在远端变更。</span>
          <button type="button" onClick={() => workspace.syncNow?.({ resolve: 'local' })}>保留本地</button>
          <button type="button" onClick={() => workspace.syncNow?.({ resolve: 'remote' })}>使用远端</button>
        </div>
      )}
      {workspace?.syncState?.status === 'error' && (
        <div className="creative-sync-alert error">{workspace.syncState.error?.message || '同步失败'}</div>
      )}

      <div className="creative-workspace-grid">
        <div className="creative-panel">
          <div className="creative-panel-head">
            <h3>最近素材</h3>
            <button type="button" onClick={onOpenMaterials}>管理</button>
          </div>
          <div className="creative-asset-list">
            {assets.slice(0, 6).map(asset => (
              <button
                type="button"
                key={asset.id}
                className={String(selectedAsset?.id) === String(asset.id) ? 'active' : ''}
                onClick={() => setSelectedAssetId(asset.id)}
              >
                <strong>{asset.title}</strong>
                <span>{asset.source || '未知来源'} / {(asset.tags || []).slice(0, 2).join(', ') || '未标记'}</span>
              </button>
            ))}
            {assets.length === 0 && <p className="creative-empty">还没有素材。先把资讯卡片或 AI 精灵的输出收藏进素材库。</p>}
          </div>
          {selectedAsset && (
            <>
              <p className="creative-asset-provenance">
                <span>{selectedAsset.citation?.title || selectedAsset.title} / {selectedAsset.citation?.source || selectedAsset.source || '未知来源'}</span>
                {(selectedAsset.citation?.url || selectedAsset.url) && (
                  <a href={selectedAsset.citation?.url || selectedAsset.url} target="_blank" rel="noreferrer">
                    {selectedAsset.citation?.url || selectedAsset.url}
                  </a>
                )}
              </p>
              <button
                type="button"
                className="creative-toggle-preview"
                onClick={() => setShowAssetPreview(v => !v)}
                aria-expanded={showAssetPreview}
              >
                {showAssetPreview ? '收起预览' : '查看完整内容'}
              </button>
              {showAssetPreview && (
                <div className="creative-asset-preview">
                  {renderMarkdown(selectedAsset.fullContent || selectedAsset.content || selectedAsset.summary || '')}
                </div>
              )}
            </>
          )}
          <button type="button" className="creative-primary" onClick={createFromAsset} disabled={!selectedAsset} aria-label="Create from asset">
            从素材创建文稿
          </button>
        </div>

        <div className="creative-panel creative-document-panel">
          <div className="creative-panel-head">
            <h3>当前文稿</h3>
            <button type="button" onClick={onOpenEditor}>编辑</button>
          </div>
          {activeDocument ? (
            <>
              <h4>{activeDocument.title}</h4>
              <p>{String(activeDocument.draftContent || '').slice(0, 220) || '空白草稿'}</p>
              <div className="creative-document-meta">
                <span>{(activeDocument.assetIds || []).length} linked assets</span>
                <span>{activeVersions.length} versions</span>
                <span>{unresolvedCitations} unresolved citations</span>
              </div>
              <div className="creative-export-row">
                <select value={exportFormat} onChange={event => setExportFormat(event.target.value)}>
                  <option value="md">Markdown</option>
                  <option value="json">JSON</option>
                  <option value="html">HTML</option>
                </select>
                <button type="button" onClick={exportActiveDocument} aria-label="Export local">导出到本地</button>
              </div>
              {activeVersions.length > 0 && (
                <div className="creative-version-list" aria-label="版本历史">
                  {activeVersions.slice(0, 5).map(version => (
                    <button
                      type="button"
                      key={version.id}
                      onClick={() => workspace?.restoreVersion?.(activeDocument.id, version)}
                      aria-label={`Restore v${version.number}`}
                    >
                      <strong>v{version.number}</strong>
                      <span>{version.reason || 'manual'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="creative-empty">还没有文稿。从左侧素材创建第一份草稿。</p>
          )}
        </div>

        <div className="creative-panel creative-proposal-panel">
          <div className="creative-panel-head">
            <h3>AI 稿件审议</h3>
            <span>{invalidCitationIds.length ? '引用无效' : '手动插入'}</span>
          </div>
          <textarea
            value={proposal}
            onChange={event => setProposal(event.target.value)}
            placeholder="把 AI 输出粘贴到这里，用 [asset:素材ID] 引用素材。"
          />
          {invalidCitationIds.length > 0 && (
            <div className="creative-citation-error">无效的素材引用：{invalidCitationIds.join(', ')}</div>
          )}
          <button type="button" className="creative-primary" onClick={insertProposal} disabled={!proposal.trim() || invalidCitationIds.length > 0 || !activeDocument} aria-label="Insert as new version">
            插入为新版本
          </button>
        </div>
      </div>
    </section>
  );
}
