// src/components/profile/ProfileSocialSection.jsx
// 我的社交 v2 —— 「社区铭牌 SOCIAL BADGE」
//
// 上一版只有一张名片 + 一排兴趣标签，粉丝/获赞等统计数据是四个裸数字。
// 这一版把社交数据可视化：影响力合成仪表 + 统计遥测带 + 领域覆盖环，
// 与认知星图/洞察台同一设计语言（Panel/Tele/pi-ring）。
// 影响力是公开可核对的合成指标，公式直接写在面板上。
import { useMemo } from 'react';
import { ICONS } from '../../constants/index.jsx';
import { Panel, Tele, Brand } from './charts/AtlasShell.jsx';
import { InfluenceGauge, ConfidenceRing } from './charts/InsightPanels.jsx';
import IdentityPanel from './IdentityPanel.jsx';

const WEIGHTS = { followers: 8, likesReceived: 2, posts: 5, following: 1 };

export default function ProfileSocialSection({
  user,
  stats,
  selectedInterests = [],
  categories = [],
}) {
  const initial = (user?.displayName || user?.username)?.[0]?.toUpperCase() || 'U';
  const joined = user?.createdAt
    ? (() => { try { return new Date(user.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }); } catch { return ''; } })()
    : '';

  const interestTags = useMemo(() => selectedInterests
    .map(id => categories.find(c => c.id === id))
    .filter(Boolean), [selectedInterests, categories]);

  /* ---------- 统计与影响力 ---------- */
  const s = stats || {};
  const followers = s.followers ?? null;
  const following = s.following ?? null;
  const posts = s.posts ?? null;
  const likes = s.likesReceived ?? null;
  const hasStats = followers != null || following != null || posts != null || likes != null;

  const influence = useMemo(() => {
    if (!hasStats) return 0;
    const raw = (followers || 0) * WEIGHTS.followers
      + (likes || 0) * WEIGHTS.likesReceived
      + (posts || 0) * WEIGHTS.posts
      + (following || 0) * WEIGHTS.following;
    return Math.min(100, raw);
  }, [hasStats, followers, following, posts, likes]);

  const level = influence >= 66 ? '社区节点' : influence >= 33 ? '活跃成员' : '新晋成员';

  const statMax = Math.max(1, followers || 0, following || 0, posts || 0, likes || 0);
  const tele = [
    { label: '粉丝', value: followers ?? '—', unit: '', note: '关注你的人', pct: ((followers || 0) / statMax) * 100, tone: 'cyan' },
    { label: '关注', value: following ?? '—', unit: '', note: '你关注的对象', pct: ((following || 0) / statMax) * 100, tone: 'green' },
    { label: '发布', value: posts ?? '—', unit: '', note: '社区内容产出', pct: ((posts || 0) / statMax) * 100, tone: 'amber' },
    { label: '获赞', value: likes ?? '—', unit: '', note: '内容被认可次数', pct: ((likes || 0) / statMax) * 100, tone: 'violet' },
    { label: '影响力', value: Math.round(influence), unit: '', note: level, pct: influence, tone: 'blue' },
  ];

  const coverage = categories.length
    ? Math.round((interestTags.length / categories.length) * 100)
    : 0;

  return (
    <div className="profile-social pa-atlas">
      {/* ============ 抬头：遥测带 ============ */}
      <header className="pa-header">
        <Brand
          kicker="SOCIAL BADGE"
          title="我的社交"
          desc={user?.signature ? `“${user.signature}”` : '面向社区的个人名片'}
          tags={[joined && `${joined}加入`].filter(Boolean)}
        />
        <div className="pa-tele-grid">
          {tele.map(t => <Tele key={t.label} {...t} />)}
        </div>
      </header>

      {/* ============ C3 任务 4：身份卡（川川 v2 + 唯一 ID + 绑定/认证） ============ */}
      <IdentityPanel user={user} />

      {/* ============ 主栅格：铭牌 + 影响力/覆盖 ============ */}
      <div className="pa-grid pa-grid-main">
        <Panel kicker="IDENTITY PLATE" title="社区铭牌" meta={user?.username ? `@${user.username}` : '未登录'} className="ps-panel-id">
          <div className="ps-id">
            <div className="ps-avatar">
              {user?.avatar
                ? <img src={user.avatar} alt="avatar" />
                : <span className="ps-avatar-initial">{initial}</span>}
            </div>
            <div className="ps-id-main">
              <h3>{user?.displayName || user?.username || '未登录用户'}</h3>
              {user?.username && <span className="ps-username">@{user.username}</span>}
              {joined && <span className="ps-joined">{ICONS.calendar} {joined}加入</span>}
              {user?.signature && <p className="ps-signature">“{user.signature}”</p>}
            </div>
          </div>
          <div className="ps-id-stats">
            <span><b>{followers ?? '—'}</b><em>粉丝</em></span>
            <span><b>{following ?? '—'}</b><em>关注</em></span>
            <span><b>{posts ?? '—'}</b><em>发布</em></span>
            <span><b>{likes ?? '—'}</b><em>获赞</em></span>
          </div>
        </Panel>

        <div className="pa-col">
          <Panel kicker="COMMUNITY INFLUENCE" title="影响力仪表" meta={hasStats ? '加权合成 · 公式公开' : '等待社区数据'}>
            <div className="ps-influence">
              <InfluenceGauge value={influence} level={level} />
              <p className="ps-influence-note">
                {hasStats
                  ? `粉丝 ×${WEIGHTS.followers} + 获赞 ×${WEIGHTS.likesReceived} + 发布 ×${WEIGHTS.posts} + 关注 ×${WEIGHTS.following}，封顶 100`
                  : '登录并发布内容后，这里会长出你的社区影响力'}
              </p>
            </div>
          </Panel>

          <Panel kicker="INTEREST COVERAGE" title="领域覆盖" meta={`${interestTags.length}/${categories.length} 个领域`}>
            <div className="ps-coverage">
              <ConfidenceRing value={coverage} size={88} label="覆盖" sub={`${interestTags.length} 个`} />
              {interestTags.length > 0 ? (
                <div className="ps-tags">
                  {interestTags.map(cat => (
                    <span key={cat.id} className="ps-tag">{ICONS[cat.icon]} {cat.label}</span>
                  ))}
                </div>
              ) : (
                <p className="ps-tags-empty">尚未设置关注领域，去「调整关注领域」选几个方向</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
