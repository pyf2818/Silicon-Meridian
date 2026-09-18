import { useState } from 'react';
import { avatarColor } from '../../domain/community/visualIdentity.js';

/**
 * B2 社区统一头像（广场卡片/详情/联系人共用规范）：
 * 有 avatar_url → 图片（懒加载 + 失败回落色哈希）；否则昵称哈希取 8 色盘 + 首字。
 */
export default function CommunityAvatar({ name, src, size = 32, online = false }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;
  return (
    <span
      className="community-user-avatar"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.42)), ...(showImage ? {} : { background: avatarColor(name) }) }}
      title={name || ''}
    >
      {showImage ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : String(name || '川').trim().slice(0, 1) || '川'}
      {online && <i className="community-user-avatar-online" />}
    </span>
  );
}
