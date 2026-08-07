import { useRef, useState, useEffect } from 'react';
import { ICONS } from '../constants/index.jsx';

export default function ProfileModal({
  showProfileModal,
  setShowProfileModal,
  user,
  setUser,
  profileForm,
  setProfileForm,
  selectedInterests,
  categories,
  updateUserProfile,
  setShowInterestModal,
  setShowUserMenu,
  handleLogout,
  showToast,
}) {
  const fileInputRef = useRef(null);
  const initial = (user?.displayName || user?.username)?.[0]?.toUpperCase() || 'U';
  const [stats, setStats] = useState(null);
  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return '—'; }
  };

  useEffect(() => {
    if (!showProfileModal || !user?.id) { setStats(null); return; }
    let cancelled = false;
    fetch('/api/auth/stats', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => { if (!cancelled && data?.ok) setStats(data.data.stats || {}); })
      .catch(() => { if (!cancelled) setStats({}); });
    return () => { cancelled = true; };
  }, [showProfileModal, user?.id]);

  if (!showProfileModal) return null;

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result;
      setUser((prev) => ({ ...prev, avatar: base64 }));
      updateUserProfile({ avatar: base64 });
      showToast('头像已更新');
    };
    reader.readAsDataURL(file);
  };

  const removeAvatar = () => {
    setUser((prev) => ({ ...prev, avatar: '' }));
    updateUserProfile({ avatar: '' });
    showToast('已移除头像');
  };

  const save = () => {
    const newDisplayName = profileForm.displayName.trim();
    const newSignature = profileForm.signature.trim();
    setUser((prev) => ({ ...prev, displayName: newDisplayName, signature: newSignature }));
    updateUserProfile({ displayName: newDisplayName, signature: newSignature });
    setShowProfileModal(false);
    setProfileForm({ displayName: '', signature: '' });
    showToast('资料已更新');
  };

  return (
    <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-cover">
          <button className="modal-close" onClick={() => setShowProfileModal(false)} aria-label="关闭">{ICONS.x}</button>
        </div>

        <div className="profile-modal-body">
          <div className="profile-identity">
            <div className="profile-avatar-ring">
              <button type="button" className="profile-avatar-btn" onClick={openFilePicker} aria-label="更换头像">
                <div className="profile-avatar-default">{initial}</div>
                {user?.avatar && (
                  <img
                    src={user.avatar}
                    alt="avatar"
                    className="profile-avatar-img"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                <span className="profile-avatar-edit">{ICONS.image}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>
            <div className="profile-name-block">
              <h3 className="profile-display-name">{user?.displayName || user?.username || '用户'}</h3>
              <span className="profile-username">@{user?.username}</span>
            </div>
            <div className="profile-avatar-actions">
              <button type="button" className="profile-avatar-change" onClick={openFilePicker}>{ICONS.image} 更换头像</button>
              {user?.avatar && (
                <button type="button" className="profile-avatar-remove" onClick={removeAvatar}>移除</button>
              )}
            </div>
          </div>

          <div className="profile-social-stats">
            <div className="profile-stat"><strong>{stats?.followers ?? '—'}</strong><span>粉丝</span></div>
            <div className="profile-stat"><strong>{stats?.following ?? '—'}</strong><span>关注</span></div>
            <div className="profile-stat"><strong>{stats?.posts ?? '—'}</strong><span>发布</span></div>
            <div className="profile-stat"><strong>{stats?.likesReceived ?? '—'}</strong><span>获赞</span></div>
          </div>

          <div className="profile-behavior-strip">
            <div className="profile-behavior-item"><span className="profile-behavior-label">加入</span><strong>{formatDate(user?.createdAt)}</strong></div>
            <div className="profile-behavior-item"><span className="profile-behavior-label">互动</span><strong>{(stats?.comments ?? 0) + (stats?.bookmarks ?? 0)}</strong></div>
            <div className="profile-behavior-item"><span className="profile-behavior-label">状态</span><strong className="profile-status-active">活跃</strong></div>
          </div>

          <div className="auth-form">
            <div className="auth-field">
              <label>显示名称</label>
              <input
                type="text"
                value={profileForm.displayName}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, displayName: e.target.value }))}
                placeholder={user?.displayName || user?.username || '显示名称'}
              />
            </div>
            <div className="auth-field">
              <label>个性签名</label>
              <input
                type="text"
                value={profileForm.signature}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, signature: e.target.value }))}
                placeholder="写点啥..."
              />
            </div>

            <div className="profile-interest-section">
              <label className="profile-interest-label">兴趣领域</label>
              <div className="profile-interest-tags">
                {selectedInterests.length === 0 && <span className="profile-interest-empty">暂无</span>}
                {selectedInterests.map((id) => {
                  const cat = categories.find((c) => c.id === id);
                  return cat ? (
                    <span key={id} className="profile-interest-tag">
                      {ICONS[cat.icon]} {cat.label}
                    </span>
                  ) : null;
                })}
              </div>
              <button
                type="button"
                className="profile-interest-edit"
                onClick={() => { setShowProfileModal(false); setShowInterestModal(true); }}
              >
                {ICONS.edit} 编辑兴趣
              </button>
            </div>

            <div className="profile-meta">
              <span className="profile-meta-label">账号邮箱</span>
              <span className="profile-meta-value">{user?.email || '未绑定邮箱'}</span>
            </div>

            <div className="profile-actions">
              <button type="button" className="auth-submit-btn" onClick={save}>保存</button>
              <button
                type="button"
                className="profile-logout-btn"
                onClick={() => { setShowProfileModal(false); setShowUserMenu(false); handleLogout(); }}
              >
                {ICONS.power} 退出登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
