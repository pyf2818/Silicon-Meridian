import React from 'react';
import { useTranslation } from 'react-i18next';
import { SC_ICONS } from './scIcons.jsx';

const CONTENT = {
  account: {
    icon: SC_ICONS.user,
    roadmap: ['登录 / 注册', '会话管理', '跨设备同步', '账号安全'],
  },
  personalization: {
    icon: SC_ICONS.sparkles,
    roadmap: ['兴趣领域', '推荐强度', '简报节奏', '画像深度'],
  },
  storage: {
    icon: SC_ICONS.database,
    roadmap: ['缓存清理', '离线阅读', '素材库管理', '知识沉淀导出'],
  },
  labs: {
    icon: SC_ICONS.flask,
    roadmap: ['主动情报推送', '云端长任务', '多模型路由', '评估体系'],
  },
};

export default function PlannedTab({ section }) {
  const { t } = useTranslation();
  const c = CONTENT[section] || CONTENT.account;

  return (
    <div className="sc-tab">
      <div className="sc-planned">
        <span className="sc-planned-glyph">{c.icon}</span>
        <h3>{t(`settings.planned.${section}.title`, section)}</h3>
        <p>{t(`settings.planned.${section}.desc`, '该模块已在路线图中，将在后续版本与你见面。')}</p>
        <ul className="sc-roadmap">
          {c.roadmap.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
