/**
 * AboutTab — 设置面板「关于」标签页
 *
 * 两段式：
 * 1. 产品信息卡：万般硅川 LOGO + 标语 + 简介 + 版本 + 特性列表
 * 2. 作者联系卡：潘裕丰 + 邮箱（点复制 / mailto）+ 电话（点复制 / tel:）+ 微信 QR 码（点放大）
 *
 * 设计原则：复用 .setting-item / .modal 设计系统；不引入新依赖；
 * 走 --accent-* / --bg-* / --text-* 主题变量，随 12 palette + 深浅自动迁移。
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_DESCRIPTION, AUTHOR_INFO } from '../../constants/appConstants.jsx';
import { showToast } from '../../utils/toast.js';
import packageJson from '../../../package.json';

const copyToClipboard = async (text, label) => {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制 ${label}`, 1500);
  } catch (e) {
    // 旧浏览器 / 权限拒绝 → 退化为临时 textarea
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(`已复制 ${label}`, 1500); }
    catch { showToast('复制失败，请手动选择', 1800); }
    document.body.removeChild(ta);
  }
};

export default function AboutTab() {
  const { t } = useTranslation();
  const [qrOpen, setQrOpen] = useState(false);
  const version = packageJson?.version || '0.1.0';
  const year = new Date().getFullYear();

  return (
    <div className="about-tab">
      {/* === 产品信息卡 === */}
      <div className="setting-item about-product-card">
        <div className="about-product-head">
          <div className="about-brand-mark" aria-hidden="true">万</div>
          <div className="about-product-meta">
            <div className="about-product-name">{PRODUCT_NAME}</div>
            <div className="about-product-tagline">{PRODUCT_TAGLINE}</div>
          </div>
        </div>
        <p className="setting-desc about-product-desc">{PRODUCT_DESCRIPTION}</p>
        <ul className="about-feature-list" aria-label={t('settings.about.features')}>
          <li><span className="about-feature-glyph" aria-hidden="true">·</span>{t('settings.about.featureNews')}</li>
          <li><span className="about-feature-glyph" aria-hidden="true">·</span>{t('settings.about.featureAgent')}</li>
          <li><span className="about-feature-glyph" aria-hidden="true">·</span>{t('settings.about.featureStudio')}</li>
          <li><span className="about-feature-glyph" aria-hidden="true">·</span>{t('settings.about.featureStock')}</li>
        </ul>
        <div className="about-product-foot">
          <span className="about-version-pill">v{version}</span>
          <span className="about-copyright">© {year} {PRODUCT_NAME}</span>
        </div>
      </div>

      {/* === 作者联系卡 === */}
      <div className="setting-item about-author-card">
        <label>{t('settings.about.authorLabel')}</label>
        <div className="about-author-head">
          <div className="about-author-avatar" aria-hidden="true">{AUTHOR_INFO.name.slice(0, 1)}</div>
          <div>
            <div className="about-author-name">{AUTHOR_INFO.name}</div>
            <div className="about-author-role">{t('settings.about.authorRole')}</div>
          </div>
        </div>

        <div className="about-contact-list">
          <div className="about-contact-row">
            <span className="about-contact-key">{t('settings.about.email')}</span>
            <a className="about-contact-value" href={`mailto:${AUTHOR_INFO.email}`}>{AUTHOR_INFO.email}</a>
            <button type="button" className="about-copy-btn" onClick={() => copyToClipboard(AUTHOR_INFO.email, t('settings.about.email'))}>{t('settings.about.copy')}</button>
          </div>
          <div className="about-contact-row">
            <span className="about-contact-key">{t('settings.about.phone')}</span>
            <a className="about-contact-value" href={`tel:${AUTHOR_INFO.phone}`}>{AUTHOR_INFO.phone}</a>
            <button type="button" className="about-copy-btn" onClick={() => copyToClipboard(AUTHOR_INFO.phone, t('settings.about.phone'))}>{t('settings.about.copy')}</button>
          </div>
        </div>

        <div className="about-wechat-block">
          <div className="about-wechat-text">
            <div className="about-contact-key">{t('settings.about.wechat')}</div>
            <div className="about-wechat-nick">{AUTHOR_INFO.wechatNickname}</div>
            <p className="setting-note">{t('settings.about.wechatHint')}</p>
          </div>
          <button type="button" className="about-qr-thumb" onClick={() => setQrOpen(true)} aria-label={t('settings.about.qrEnlarge')}>
            <img src={AUTHOR_INFO.wechatQr} alt={t('settings.about.wechat')} />
            <span className="about-qr-hint">{t('settings.about.qrEnlarge')}</span>
          </button>
        </div>
      </div>

      {/* === QR 码放大浮层 === */}
      {qrOpen && (
        <div className="about-qr-modal" onClick={() => setQrOpen(false)} role="dialog" aria-modal="true">
          <div className="about-qr-modal-card" onClick={(e) => e.stopPropagation()}>
            <img src={AUTHOR_INFO.wechatQr} alt={t('settings.about.wechat')} className="about-qr-modal-img" />
            <div className="about-qr-modal-caption">
              <div className="about-qr-modal-name">{AUTHOR_INFO.name}</div>
              <div className="about-qr-modal-nick">{t('settings.about.wechat')}: {AUTHOR_INFO.wechatNickname}</div>
            </div>
            <button type="button" className="about-qr-modal-close" onClick={() => setQrOpen(false)} aria-label="close">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
