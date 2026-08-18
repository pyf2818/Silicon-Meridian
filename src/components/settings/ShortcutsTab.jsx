import React from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../utils/toast.js';

// 与 B2 键盘效率体系保持一致
const GROUPS = [
  {
    title: 'settings.shortcuts.groupGeneral',
    items: [
      { keys: ['Ctrl', 'K'], id: 'palette' },
      { keys: ['?'], id: 'shortcuts' },
      { keys: ['Esc'], id: 'esc' },
      { keys: ['/'], id: 'search' },
    ],
  },
  {
    title: 'settings.shortcuts.groupNav',
    items: [
      { keys: ['g'], id: 'nav' },
      { keys: ['i'], id: 'interest' },
      { keys: ['a'], id: 'agent' },
      { keys: ['m'], id: 'monitor' },
      { keys: ['p'], id: 'profile' },
    ],
  },
  {
    title: 'settings.shortcuts.groupWorkspace',
    items: [
      { keys: ['Ctrl', 'Enter'], id: 'send' },
      { keys: ['Ctrl', 'B'], id: 'sidebar' },
      { keys: ['R'], id: 'refresh' },
      { keys: ['h'], id: 'help' },
    ],
  },
];

export default function ShortcutsTab() {
  const { t } = useTranslation();

  const copy = (keys) => {
    const text = keys.join(' + ');
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    showToast(t('settings.shortcuts.copied', '已复制：{{k}}', { k: text }));
  };

  return (
    <div className="sc-tab">
      <div className="sc-tab-head">
        <h2 className="sc-tab-title">{t('settings.shortcuts.title', '键盘快捷键')}</h2>
        <p className="sc-tab-desc">{t('settings.shortcuts.desc', '全面键盘效率。点击任意组合可复制。')}</p>
      </div>

      {GROUPS.map((g) => (
        <div className="sc-card" key={g.title}>
          <div className="sc-card-title"><span className="sc-card-kicker" />{t(g.title, g.title)}</div>
          {g.items.map((it) => (
            <div className="sc-shortcut-row" key={it.id}>
              <div className="sc-shortcut-desc">{t(`settings.shortcuts.${it.id}`, it.id)}</div>
              <button className="sc-shortcut-keys" onClick={() => copy(it.keys)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', gap: 5 }} aria-label="copy">
                {it.keys.map((k, i) => (
                  <kbd className="sc-kbd" key={i}>{k}</kbd>
                ))}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
