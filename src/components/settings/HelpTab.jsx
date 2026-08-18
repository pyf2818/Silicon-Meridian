import React from 'react';
import { useTranslation } from 'react-i18next';
import { SC_ICONS } from './scIcons.jsx';

export default function HelpTab({ onNavigate }) {
  const { t } = useTranslation();

  const cards = [
    {
      icon: SC_ICONS.book,
      title: t('settings.help.docs', '使用文档'),
      desc: t('settings.help.docsDesc', '快速上手与功能详解'),
      action: () => window.open('https://github.com/', '_blank'),
    },
    {
      icon: SC_ICONS.mail,
      title: t('settings.help.feedback', '反馈与建议'),
      desc: t('settings.help.feedbackDesc', '遇到问题或想法，直接告诉我们'),
      action: () => window.location.href = 'mailto:2818932783@qq.com?subject=万般硅川 反馈',
    },
    {
      icon: SC_ICONS.keyboard,
      title: t('settings.help.shortcuts', '键盘快捷键'),
      desc: t('settings.help.shortcutsDesc', '查看全部效率快捷键'),
      action: () => onNavigate && onNavigate('shortcuts'),
    },
    {
      icon: SC_ICONS.info,
      title: t('settings.help.about', '关于产品'),
      desc: t('settings.help.aboutDesc', '版本、特性与作者'),
      action: () => onNavigate && onNavigate('about'),
    },
  ];

  return (
    <div className="sc-tab">
      <div className="sc-tab-head">
        <h2 className="sc-tab-title">{t('settings.help.title', '帮助与支持')}</h2>
        <p className="sc-tab-desc">{t('settings.help.desc', '文档、反馈与产品信息，一站直达。')}</p>
      </div>
      <div className="sc-help-grid">
        {cards.map((c, i) => (
          <button className="sc-help-card" key={i} onClick={c.action}>
            <span className="sc-help-icon">{c.icon}</span>
            <div>
              <h4>{c.title}</h4>
              <p>{c.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
