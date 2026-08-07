// src/components/profile/ProfileSocialSection.jsx
// 我的社交 —— 面向社区的个人名片：头像/昵称/签名/兴趣标签 + 社交统计。
import { ICONS } from '../../constants/index.jsx';

export default function ProfileSocialSection({
  user,
  stats,
  selectedInterests,
  categories = [],
}) {
  const initial = (user?.displayName || user?.username)?.[0]?.toUpperCase() || 'U';
  const joined = user?.createdAt
    ? (() => { try { return new Date(user.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }); } catch { return ''; } })()
    : '';

  const interestTags = selectedInterests
    .map(id => categories.find(c => c.id === id))
    .filter(Boolean)
    .slice(0, 8);

  return (
    <div className="profile-social">
      {/* 名片卡 */}
      <section className="profile-social-card">
        <div className="profile-social-cover" />
        <div className="profile-social-head">
          <div className="profile-social-avatar">
            {user?.avatar
              ? <img src={user.avatar} alt="avatar" />
              : <span className="profile-social-initial">{initial}</span>}
          </div>
          <div className="profile-social-name">
            <h2>{user?.displayName || user?.username || '用户'}</h2>
            <span className="profile-social-username">@{user?.username}</span>
          </div>
          <div className="profile-social-meta">
            {user?.signature && <p className="profile-social-signature">"{user.signature}"</p>}
            {joined && <span className="profile-social-joined">{ICONS.calendar} {joined}加入</span>}
          </div>
        </div>

        {/* 社交统计 */}
        <div className="profile-social-stats-lg">
          <div className="profile-social-stat"><strong>{stats?.followers ?? '—'}</strong><span>粉丝</span></div>
          <div className="profile-social-stat"><strong>{stats?.following ?? '—'}</strong><span>关注</span></div>
          <div className="profile-social-stat"><strong>{stats?.posts ?? '—'}</strong><span>发布</span></div>
          <div className="profile-social-stat"><strong>{stats?.likesReceived ?? '—'}</strong><span>获赞</span></div>
        </div>
      </section>

      {/* 兴趣标签 */}
      <section className="profile-social-interests">
        <div className="section-header">
          <h2 className="section-title">{ICONS.target} 关注领域</h2>
          <p className="section-desc">向社区展示你关心的方向</p>
        </div>
        {interestTags.length > 0
          ? (
            <div className="profile-social-tags">
              {interestTags.map(cat => (
                <span key={cat.id} className="profile-social-tag">{ICONS[cat.icon]} {cat.label}</span>
              ))}
            </div>
          )
          : <div className="profile-empty-hint">尚未设置关注领域</div>}
      </section>
    </div>
  );
}
