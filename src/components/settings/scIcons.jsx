// 设置模块图标集（线性，currentColor，随主题）
import React from 'react';

const S = (children, vb = '0 0 24 24') => (
  <svg viewBox={vb} width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const SC_ICONS = {
  palette: S(<><circle cx="12" cy="12" r="9" /><circle cx="8.5" cy="9" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="9" r="1.1" fill="currentColor" stroke="none" /><circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" /></>),
  sliders: S(<><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2.2" fill="var(--bg-primary)" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2.2" fill="var(--bg-primary)" /></>),
  bell: S(<><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6z" /><path d="M10 19a2 2 0 0 0 4 0" /></>),
  rss: S(<><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" /><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 5a15 15 0 0 1 15 15" /></>),
  cpu: S(<><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></>),
  bot: S(<><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 4h6" /><circle cx="9.5" cy="13" r="1.2" fill="currentColor" stroke="none" /><circle cx="14.5" cy="13" r="1.2" fill="currentColor" stroke="none" /></>),
  tool: S(<><path d="M14 7a3.5 3.5 0 0 0-4.6 4.2L4 16.6 7.4 20l5.4-5.4A3.5 3.5 0 0 0 17 10l-2.5 2.5-1.5-1.5L17 8.5z" /></>),
  shield: S(<><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  user: S(<><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></>),
  sparkles: S(<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></>),
  database: S(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>),
  keyboard: S(<><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><line x1="6" y1="10" x2="6" y2="10" /><line x1="9" y1="10" x2="9" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="15" y1="10" x2="15" y2="10" /><line x1="18" y1="10" x2="18" y2="10" /><line x1="7.5" y1="14" x2="16.5" y2="14" /></>),
  flask: S(<><path d="M9 3h6M10 3v6l-5 8a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 17l-5-8V3" /><line x1="7.5" y1="14" x2="16.5" y2="14" /></>),
  help: S(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4 2c0 1.5-2 2-2 3" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" /></>),
  info: S(<><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none" /></>),
  book: S(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><line x1="9" y1="3" x2="9" y2="19" /></>),
  mail: S(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></>),
  history: S(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></>),
  compass: S(<><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" /></>),
};
