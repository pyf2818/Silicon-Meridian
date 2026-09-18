import { useEffect, useState } from 'react';
import { ChuanChuanPortrait, VerifiedBadge } from '../community/ChuanChuanV2.jsx';
import { showToast } from '../../utils/toast.js';

/**
 * C3 任务 4：用户身份卡（我的社交页）。
 * 展示唯一 ID（川流居民编号）+ 全站居民数 + 川川 v2 立绘 + 微信/邮箱绑定 + 三类认证提交。
 * 数据源：GET /api/user/identity；动作：POST /api/user/bindings、/api/user/verifications。
 */

const BINDING_PLACEHOLDER = { email: 'name@example.com', wechat: '微信号（字母开头 6-20 位）' };
const VERIFICATION_FORMS = {
  individual: [{ key: 'realName', label: '真实姓名', maxLength: 40 }],
  enterprise: [
    { key: 'companyName', label: '企业名称', maxLength: 80 },
    { key: 'creditCode', label: '统一社会信用代码', maxLength: 40 },
  ],
  creator: [
    { key: 'platform', label: '主创作平台（如：即刻/B站/公众号）', maxLength: 24 },
    { key: 'homeUrl', label: '主页链接（https://，可选）', maxLength: 300 },
  ],
};

async function identityRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload?.error?.message || '请求失败，请稍后再试');
  }
  return payload.data || {};
}

export default function IdentityPanel({ user }) {
  const [card, setCard] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [bindingType, setBindingType] = useState('email');
  const [bindingValue, setBindingValue] = useState('');
  const [verifyType, setVerifyType] = useState('individual');
  const [verifyForm, setVerifyForm] = useState({});
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const data = await identityRequest('/api/user/identity');
      setCard(data);
      setLoadError('');
    } catch (error) {
      setLoadError(error.message);
    }
  };

  useEffect(() => {
    if (!user?.id) { setCard(null); return; }
    reload().catch(() => {});
  }, [user?.id]);

  if (!user?.id) return null;

  const submitBinding = async () => {
    if (!bindingValue.trim() || busy) return;
    setBusy(true);
    try {
      const data = await identityRequest('/api/user/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: bindingType, value: bindingValue.trim() }),
      });
      setCard(previous => previous ? { ...previous, bindings: data.bindings } : previous);
      setBindingValue('');
      showToast(`${bindingType === 'email' ? '邮箱' : '微信'}绑定成功`);
    } catch (error) {
      showToast(error.message);
    } finally { setBusy(false); }
  };

  const submitVerification = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await identityRequest('/api/user/verifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: verifyType, payload: verifyForm }),
      });
      setCard(previous => previous ? { ...previous, verifications: data.verifications, badge: data.badge } : previous);
      setVerifyForm({});
      showToast('认证已通过，徽章已点亮');
    } catch (error) {
      showToast(error.message);
    } finally { setBusy(false); }
  };

  const boundTypes = new Set((card?.bindings || []).map(item => item.type));
  const verifiedTypes = new Set((card?.verifications || []).filter(item => item.status === 'approved').map(item => item.type));

  return (
    <section className="identity-card" data-testid="identity-card" aria-label="身份卡">
      <div className="identity-card-head">
        <ChuanChuanPortrait size={118} />
        <div className="identity-card-main">
          <span className="identity-card-kicker">IDENTITY · 川流居民</span>
          <h3>{user.displayName || user.username || '未登录用户'}</h3>
          <div className="identity-card-badges">
            <VerifiedBadge badge={card?.badge || ''} />
            {(card?.badge || '') === '' && <span className="verified-badge empty">暂无认证</span>}
          </div>
          <p className="identity-card-meta">
            {card?.user?.publicId
              ? <>唯一 ID <b data-testid="identity-public-id">{card.user.publicId}</b></>
              : <span data-testid="identity-public-id">唯一 ID 分配中…</span>}
            {Number.isFinite(card?.totalUsers) && (
              <em data-testid="identity-total-users">· 全站第 {card.totalUsers} 位居民</em>
            )}
          </p>
        </div>
      </div>

      {loadError && <p className="identity-card-error">{loadError}</p>}

      <div className="identity-card-section">
        <b>账号绑定</b>
        <div className="identity-binding-chips">
          {['email', 'wechat'].map(type => (
            <span key={type} className={`identity-binding-chip ${boundTypes.has(type) ? 'bound' : ''}`}>
              {type === 'email' ? '📧 邮箱' : '💬 微信'}{boundTypes.has(type) ? ' · 已绑定' : ' · 未绑定'}
            </span>
          ))}
        </div>
        <div className="identity-form-row">
          <select value={bindingType} onChange={event => setBindingType(event.target.value)} aria-label="绑定类型">
            <option value="email">邮箱</option>
            <option value="wechat">微信</option>
          </select>
          <input
            data-testid="identity-binding-input"
            value={bindingValue}
            maxLength={200}
            placeholder={BINDING_PLACEHOLDER[bindingType]}
            onChange={event => setBindingValue(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') submitBinding().catch(() => {}); }}
          />
          <button type="button" data-testid="identity-binding-submit" disabled={busy || !bindingValue.trim()} onClick={() => submitBinding().catch(() => {})}>
            {boundTypes.has(bindingType) ? '换绑' : '绑定'}
          </button>
        </div>
      </div>

      <div className="identity-card-section">
        <b>身份认证</b>
        <div className="identity-binding-chips">
          {['individual', 'enterprise', 'creator'].map(type => (
            <span key={type} className={`identity-binding-chip verify-${type} ${verifiedTypes.has(type) ? 'bound' : ''}`}>
              {type === 'individual' ? '✓ 个人' : type === 'enterprise' ? '🏢 企业' : '✍️ 博主'}{verifiedTypes.has(type) ? ' · 已认证' : ''}
            </span>
          ))}
        </div>
        <div className="identity-form-row">
          <select value={verifyType} onChange={event => { setVerifyType(event.target.value); setVerifyForm({}); }} aria-label="认证类型">
            <option value="individual">个人认证</option>
            <option value="enterprise">企业认证</option>
            <option value="creator">博主认证</option>
          </select>
          {(VERIFICATION_FORMS[verifyType] || []).map(field => (
            <input
              key={field.key}
              data-testid={`identity-verify-${field.key}`}
              value={verifyForm[field.key] || ''}
              maxLength={field.maxLength}
              placeholder={field.label}
              onChange={event => setVerifyForm(previous => ({ ...previous, [field.key]: event.target.value }))}
            />
          ))}
          <button type="button" data-testid="identity-verify-submit" disabled={busy} onClick={() => submitVerification().catch(() => {})}>提交认证</button>
        </div>
        <p className="identity-card-note">提交后立即生效点亮徽章；接入人工审核队列后会更改为「审核中」流程。</p>
      </div>
    </section>
  );
}
