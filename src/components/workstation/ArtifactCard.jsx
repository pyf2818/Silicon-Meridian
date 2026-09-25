/**
 * ArtifactCard.jsx - 产物卡片（结果区与消息流共用）
 *
 * 纯展示组件：只接收 opaque 产物 meta 行，预览/下载走 contentUrl（uuid 引用）。
 */
import { artifactKindMeta, formatArtifactSize, formatArtifactTime } from './artifactViews.js';
import { createArtifactClient } from '../../session/artifactRegistry.js';

const client = createArtifactClient();

export default function ArtifactCard({ artifact, onDelete, compact = false }) {
  if (!artifact?.id) return null;
  const meta = artifactKindMeta(artifact.kind);
  const contentUrl = client.contentUrl(artifact.id);

  return (
    <div className={`ws-artifact-card${compact ? ' ws-artifact-card-compact' : ''}`}>
      <span className="ws-artifact-icon" aria-hidden="true">{meta.icon}</span>
      <div className="ws-artifact-main">
        <div className="ws-artifact-title" title={artifact.title}>{artifact.title}</div>
        <div className="ws-artifact-meta">
          <span className="ws-artifact-kind">{meta.label}</span>
          <span className="ws-artifact-dot">·</span>
          <span>{formatArtifactSize(artifact.size)}</span>
          <span className="ws-artifact-dot">·</span>
          <span>{formatArtifactTime(artifact.createdAt)}</span>
        </div>
      </div>
      <div className="ws-artifact-actions">
        <a
          className="ws-artifact-action"
          href={contentUrl}
          target="_blank"
          rel="noreferrer noopener"
          title="打开预览"
        >
          预览
        </a>
        <a
          className="ws-artifact-action"
          href={`${contentUrl}?download=1`}
          title="下载"
        >
          下载
        </a>
        {onDelete && (
          <button
            type="button"
            className="ws-artifact-action ws-artifact-action-danger"
            onClick={() => onDelete(artifact)}
            title="删除产物"
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
}
