import { useState } from 'react';
import { CHANNEL_LABELS, coverBackground, coverWord } from '../../domain/community/visualIdentity.js';

/**
 * B2 帖子封面（零上传方案三档）：
 * kind=url/extracted → 渲染 https 图片（懒加载，失败回落）；否则按 id 哈希渐变 + 标题首词大字。
 */
export default function PostCover({ post, height = 132 }) {
  const [broken, setBroken] = useState(false);
  const url = post?.cover && post.cover.kind !== 'auto' ? post.cover.url : '';
  const showImage = Boolean(url) && !broken;
  return (
    <div className="community-card-cover" style={{ height, background: coverBackground(post?.id) }}>
      {!showImage && <b className="community-card-cover-word">{coverWord(post?.title)}</b>}
      {showImage && <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />}
      <span className="community-card-cover-tag">{CHANNEL_LABELS[post?.channel] || '讨论'}</span>
    </div>
  );
}
