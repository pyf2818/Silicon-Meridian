import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ICONS } from '../constants/index.jsx';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '../constants/appConstants.jsx';

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export default function AuthModal({
  showAuthModal, setShowAuthModal,
  authMode, setAuthMode,
  authForm, setAuthForm,
  handleLogin, handleRegister,
  authLoading, authError, setAuthError,
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!showAuthModal) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowAuthModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAuthModal, setShowAuthModal]);
  if (!showAuthModal) return null;
  const isLogin = authMode === 'login';
  return (
    <div className="auth-shell-overlay" data-testid="auth-modal" onClick={() => setShowAuthModal(false)}>
      <div className="auth-shell" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="auth-close" type="button" onClick={() => setShowAuthModal(false)} aria-label="关闭">{ICONS.x}</button>
        {/* 品牌侧 */}
        <aside className="auth-aside">
          <div className="auth-aside-glow" aria-hidden="true" />
          <div className="auth-brand">
            <div className="auth-logo">{ICONS.target}</div>
            <h1 className="auth-product">{PRODUCT_NAME}</h1>
            <p className="auth-tagline">{PRODUCT_TAGLINE}</p>
          </div>
          <ul className="auth-feats">
            <li><span className="auth-feat-ico">{ICONS.sparkle}</span>多领域 AI 科技资讯实时聚合</li>
            <li><span className="auth-feat-ico">{ICONS.target}</span>个性化情报工作台与画像</li>
            <li><span className="auth-feat-ico">{ICONS.bot}</span>ReAct 智能体与素材创作</li>
          </ul>
          <div className="auth-aside-foot">© {new Date().getFullYear()} {PRODUCT_NAME}</div>
        </aside>

        {/* 表单侧 */}
        <section className="auth-main">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              className={`auth-tab ${isLogin ? 'active' : ''}`}
              data-testid="auth-login-tab"
              role="tab"
              aria-selected={isLogin}
              onClick={() => { setAuthMode('login'); setAuthError(''); }}
            >{t('auth.login')}</button>
            <button
              type="button"
              className={`auth-tab ${authMode === 'register' ? 'active' : ''}`}
              data-testid="auth-register-tab"
              role="tab"
              aria-selected={!isLogin}
              onClick={() => { setAuthMode('register'); setAuthError(''); }}
            >{t('auth.register')}</button>
            <span className={`auth-tab-ind ${isLogin ? 'left' : 'right'}`} aria-hidden="true" />
          </div>

          {authError && <div className="auth-error">{authError}</div>}

          <form
            className="auth-form"
            onSubmit={e => { e.preventDefault(); isLogin ? handleLogin() : handleRegister(); }}
          >
            <div className="auth-field">
              <label htmlFor="auth-username">{t('auth.username')}</label>
              <div className="auth-input">
                <span className="auth-input-ico">{ICONS.user}</span>
                <input
                  id="auth-username"
                  data-testid="auth-username"
                  type="text"
                  value={authForm.username}
                  onChange={e => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder={t('auth.username')}
                  autoFocus
                />
              </div>
            </div>

            {authMode === 'register' && (
              <div className="auth-field">
                <label htmlFor="auth-email">{t('auth.email')}</label>
                <div className="auth-input">
                  <span className="auth-input-ico"><MailIcon /></span>
                  <input
                    id="auth-email"
                    data-testid="auth-email"
                    type="email"
                    value={authForm.email}
                    onChange={e => setAuthForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder={`${t('auth.email')}（${t('common.optional')}）`}
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="auth-password">{t('auth.password')}</label>
              <div className="auth-input">
                <span className="auth-input-ico"><LockIcon /></span>
                <input
                  id="auth-password"
                  data-testid="auth-password"
                  type="password"
                  value={authForm.password}
                  onChange={e => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder={t('auth.password')}
                />
              </div>
            </div>

            {authMode === 'register' && (
              <div className="auth-field">
                <label htmlFor="auth-confirm-password">{t('auth.confirmPassword') || '确认密码'}</label>
                <div className="auth-input">
                  <span className="auth-input-ico"><LockIcon /></span>
                  <input
                    id="auth-confirm-password"
                    data-testid="auth-confirm-password"
                    type="password"
                    value={authForm.confirmPassword}
                    onChange={e => setAuthForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder={t('auth.confirmPassword') || t('auth.password')}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              className="auth-submit"
              data-testid="auth-submit"
              disabled={authLoading}
            >
              <span>{authLoading ? t('common.loading') : (isLogin ? t('auth.login') : t('auth.register'))}</span>
            </button>
          </form>

          <p className="auth-switch">
            {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
            <button
              type="button"
              className="auth-switch-btn"
              onClick={() => { setAuthMode(isLogin ? 'register' : 'login'); setAuthError(''); }}
            >
              {isLogin ? t('auth.register') : t('auth.login')}
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}
