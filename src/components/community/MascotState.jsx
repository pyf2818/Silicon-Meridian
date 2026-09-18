import { useId } from 'react';

/** 川川本尊（B2）：液态硅水滴 + 川字鳍 + 电路纹，与设计方案矢量版同源 */
export function MascotFigure({ size = 96, className = '' }) {
  const gradientId = useId().replace(/[:]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`mg-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5f3fc" />
          <stop offset="48%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <ellipse cx="110" cy="198" rx="48" ry="9" fill="var(--text-primary)" opacity="0.08" />
      <path d="M88,38 Q82,20 94,9" stroke="#22d3ee" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M107,34 Q105,15 116,7" stroke="#38bdf8" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M126,38 Q132,22 124,11" stroke="#22d3ee" strokeWidth="7" strokeLinecap="round" fill="none" />
      <ellipse cx="50" cy="162" rx="10" ry="15" fill={`url(#mg-${gradientId})`} transform="rotate(24 50 162)" />
      <ellipse cx="170" cy="162" rx="10" ry="15" fill={`url(#mg-${gradientId})`} transform="rotate(-24 170 162)" />
      <path d="M110,26 C146,66 172,102 172,138 A62,62 0 1 1 48,138 C48,102 74,66 110,26 Z" fill={`url(#mg-${gradientId})`} stroke="#0ea5e9" strokeOpacity="0.35" strokeWidth="2" />
      <path d="M72,92 C82,68 94,54 108,44" stroke="#ffffff" strokeWidth="11" strokeLinecap="round" opacity="0.32" fill="none" />
      <g stroke="#e0f2fe" strokeWidth="2" opacity="0.65" fill="none">
        <path d="M78,134 h22 v15 h16" />
        <path d="M140,118 v-16 h-14" />
      </g>
      <circle cx="78" cy="134" r="3" fill="#f0f9ff" />
      <circle cx="116" cy="149" r="3" fill="#f0f9ff" />
      <circle cx="140" cy="118" r="3" fill="#f0f9ff" />
      <circle cx="126" cy="102" r="3" fill="#f0f9ff" />
      <ellipse cx="88" cy="128" rx="9" ry="11.5" fill="#164e63" />
      <circle cx="91.5" cy="123.5" r="3.4" fill="#ffffff" />
      <ellipse cx="132" cy="128" rx="9" ry="11.5" fill="#164e63" />
      <circle cx="135.5" cy="123.5" r="3.4" fill="#ffffff" />
      <circle cx="66" cy="149" r="8" fill="#fb7185" opacity="0.5" />
      <circle cx="154" cy="149" r="8" fill="#fb7185" opacity="0.5" />
      <path d="M99,151 Q110,161 121,151" stroke="#164e63" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M192,44 C199,55 205,62 205,70 A13,13 0 1 1 179,70 C179,62 185,55 192,44 Z" fill="#a5f3fc" opacity="0.95" />
    </svg>
  );
}

/** 吉祥物空态/引导卡：川川 + 一句话 + 主行动 */
export default function MascotState({ title, hint, actionLabel, onAction, size = 104, testId }) {
  return (
    <div className="community-mascot-state" data-testid={testId}>
      <MascotFigure size={size} />
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
      {actionLabel && <button type="button" className="ai-primary-action" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}
