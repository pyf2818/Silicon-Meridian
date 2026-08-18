import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../utils/toast.js';

function Switch({ checked, onChange, label }) {
  return (
    <label className="sc-switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="sc-switch-track" />
      <span className="sc-switch-thumb" />
    </label>
  );
}

export default function NotificationsTab({ autoMonitorEnabled, setAutoMonitorEnabled }) {
  const { t } = useTranslation();
  const [briefing, setBriefing] = useState(() => localStorage.getItem('ntfBriefing') !== 'off');
  const [watchlist, setWatchlist] = useState(() => localStorage.getItem('ntfWatchlist') !== 'off');
  const [agentDone, setAgentDone] = useState(() => localStorage.getItem('ntfAgent') !== 'off');

  const toggle = (key, val, setter, name) => {
    setter(val);
    localStorage.setItem(key, val ? 'on' : 'off');
    showToast(val ? t('settings.notifications.enabled', '已开启：{{n}}', { n: name }) : t('settings.notifications.disabled', '已关闭：{{n}}', { n: name }));
  };

  return (
    <div className="sc-tab">
      <div className="sc-tab-head">
        <h2 className="sc-tab-title">{t('settings.notifications.title', '通知与推送')}</h2>
        <p className="sc-tab-desc">{t('settings.notifications.desc', '管理简报、线报与 Agent 任务的推送方式。')}</p>
      </div>

      <div className="sc-card">
        <div className="sc-card-title"><span className="sc-card-kicker" />{t('settings.notifications.channels', '推送渠道')}</div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.notifications.briefing', '每日简报推送')}</div>
            <div className="sc-row-desc">{t('settings.notifications.briefingDesc', '每日聚合你关注的领域，生成个性化情报简报。')}</div>
          </div>
          <div className="sc-row-control">
            <Switch checked={briefing} label="briefing" onChange={(e) => toggle('ntfBriefing', e.target.checked, setBriefing, t('settings.notifications.briefing', '每日简报推送'))} />
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.notifications.watchlist', 'Watchlist 线报')}</div>
            <div className="sc-row-desc">{t('settings.notifications.watchlistDesc', '订阅的选题/公司出现重大动态时主动提醒。')}</div>
          </div>
          <div className="sc-row-control">
            <Switch checked={watchlist} label="watchlist" onChange={(e) => toggle('ntfWatchlist', e.target.checked, setWatchlist, t('settings.notifications.watchlist', 'Watchlist 线报'))} />
          </div>
        </div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.notifications.agentDone', 'Agent 完成提醒')}</div>
            <div className="sc-row-desc">{t('settings.notifications.agentDoneDesc', '长任务 / 深度研究完成后通知你。')}</div>
          </div>
          <div className="sc-row-control">
            <Switch checked={agentDone} label="agent" onChange={(e) => toggle('ntfAgent', e.target.checked, setAgentDone, t('settings.notifications.agentDone', 'Agent 完成提醒'))} />
          </div>
        </div>
      </div>

      <div className="sc-card">
        <div className="sc-card-title"><span className="sc-card-kicker" />{t('settings.notifications.monitor', '信源监控')}</div>
        <div className="sc-row">
          <div className="sc-row-main">
            <div className="sc-row-label">{t('settings.notifications.monitorAlerts', '信源健康告警')}</div>
            <div className="sc-row-desc">{t('settings.notifications.monitorAlertsDesc', '定期检测信源可用性，异常时提示。')}</div>
          </div>
          <div className="sc-row-control">
            <Switch checked={!!autoMonitorEnabled} label="monitor" onChange={(e) => setAutoMonitorEnabled(e.target.checked)} />
          </div>
        </div>
      </div>
    </div>
  );
}
