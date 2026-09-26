import { useId } from 'react';

/**
 * C3 任务 4：川川 v2 —— 用户卡片形象重设计。
 * 相比 B2 版：立体感（径向渐变体积光 + 底部投影 + 边缘反光）、更可爱（大眼高光 / 腮红 / 微笑弧），
 * 动效（浮动呼吸 + 眨眼 + 环绕光点；prefers-reduced-motion 时静止）。
 */

export const VERIFICATION_META = {
  creator: { label: '博主认证', icon: '✍️', tone: 'creator' },
  enterprise: { label: '企业认证', icon: '🏢', tone: 'enterprise' },
  individual: { label: '个人认证', icon: '✓', tone: 'individual' },
};

/** 认证徽章（帖子卡 / 详情作者行 / 身份卡通用） */
export function VerifiedBadge({ badge, compact = false }) {
  if (!badge || !VERIFICATION_META[badge]) return null;
  const meta = VERIFICATION_META[badge];
  return (
    <span className={`verified-badge verified-badge-${meta.tone}${compact ? ' compact' : ''}`} title={meta.label}>
      {meta.icon} {!compact && meta.label}
    </span>
  );
}

export function ChuanChuanV2({ size = 120, className = '', guide = false }) {
  const uid = useId().replace(/[:]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" className={`chuanchuan-v2 ${className}`} aria-hidden="true">
      <defs>
        {/* 身体主渐变：左上体积光 → 青色 → 深靛 */}
        <radialGradient id={`cc-body-${uid}`} cx="0.36" cy="0.28" r="0.95">
          <stop offset="0%" stopColor="#c8fbff" />
          <stop offset="30%" stopColor="#67e8f9" />
          <stop offset="68%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#4f46e5" />
        </radialGradient>
        {/* 顶部镜面高光 */}
        <linearGradient id={`cc-gloss-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`cc-blush-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fb7185" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
        </radialGradient>
        {/* v39 引导员光环渐变 */}
        <linearGradient id={`cc-halo-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* v39 引导员光环：外圈双弧（缓慢公转，标识「官方引导员」身份） */}
      {guide && (
        <g className="cc-halo" fill="none">
          <circle cx="110" cy="118" r="100" stroke={`url(#cc-halo-${uid})`} strokeWidth="3.5" strokeDasharray="46 26 8 26" strokeLinecap="round" opacity="0.85" />
          <circle cx="110" cy="118" r="92" stroke="#a5f3fc" strokeWidth="1.4" strokeDasharray="2 12" strokeLinecap="round" opacity="0.55" />
        </g>
      )}

      <ellipse cx="110" cy="203" rx="52" ry="9" fill="#0e7490" opacity="0.22" />

      <g className="cc-float">
        {/* v39 AI 芯片天线：硅基身份标识（触杆 + 方形芯片 + 呼吸灯） */}
        <g className="cc-antenna">
          <line x1="110" y1="30" x2="110" y2="12" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
          <g className="cc-antenna-blink">
            <rect x="101" y="0" width="18" height="14" rx="3.5" fill="#22d3ee" stroke="#0ea5e9" strokeWidth="1.6" />
            <circle cx="110" cy="7" r="2.6" fill="#ecfeff" />
            <path d="M104.5,7 h3 M112.5,7 h3" stroke="#0e7490" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        </g>

        {/* 川字鳍（三根，中高侧低，保持「川」意象） */}
        <g strokeLinecap="round" fill="none" strokeWidth="7">
          <path className="cc-fin cc-fin-l" d="M84,40 Q76,22 88,10" stroke="#7dd3fc" />
          <path className="cc-fin cc-fin-m" d="M108,34 Q106,14 118,6" stroke="#38bdf8" />
          <path className="cc-fin cc-fin-r" d="M132,40 Q140,24 130,12" stroke="#7dd3fc" />
        </g>

        {/* 小手：两侧圆片，随浮动轻微摆 */}
        <ellipse className="cc-hand-l" cx="44" cy="158" rx="11" ry="16" fill={`url(#cc-body-${uid})`} transform="rotate(26 44 158)" />
        <ellipse className="cc-hand-r" cx="176" cy="158" rx="11" ry="16" fill={`url(#cc-body-${uid})`} transform="rotate(-26 176 158)" />

        {/* 身体：水滴形 */}
        <path
          d="M110,24 C148,64 174,102 174,140 A64,64 0 1 1 46,140 C46,102 72,64 110,24 Z"
          fill={`url(#cc-body-${uid})`}
          stroke="#0ea5e9" strokeOpacity="0.4" strokeWidth="2"
        />
        {/* 体积高光带 + 边缘反光 */}
        <path d="M74,92 C84,66 96,52 110,42" stroke="#ffffff" strokeWidth="12" strokeLinecap="round" opacity="0.38" fill="none" />
        <path d="M150,180 C160,170 168,156 170,142" stroke="#a5f3fc" strokeWidth="4" strokeLinecap="round" opacity="0.5" fill="none" />
        <ellipse cx="92" cy="52" rx="14" ry="20" fill={`url(#cc-gloss-${uid})`} opacity="0.5" transform="rotate(-18 92 52)" />

        {/* 电路纹（保留硅感） */}
        <g stroke="#e0f2fe" strokeWidth="1.8" opacity="0.4" fill="none">
          <path d="M76,138 h20 v13 h14" />
          <path d="M144,120 v-15 h-13" />
        </g>
        <circle cx="76" cy="138" r="2.6" fill="#f0f9ff" />
        <circle cx="131" cy="105" r="2.6" fill="#f0f9ff" />

        {/* 大眼睛（含眨眼动效）+ 高光双点 + v39 下弧眼睑反光（眼神更灵动） */}
        <g className="cc-eyes">
          <g className="cc-eye">
            <ellipse cx="87" cy="126" rx="10.5" ry="13" fill="#0f2f3d" />
            <circle cx="91" cy="121" r="4" fill="#ffffff" />
            <circle cx="83.5" cy="131" r="1.8" fill="#a5f3fc" opacity="0.9" />
            <path d="M79,133 Q87,137 95,133" stroke="#67e8f9" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" fill="none" />
          </g>
          <g className="cc-eye">
            <ellipse cx="133" cy="126" rx="10.5" ry="13" fill="#0f2f3d" />
            <circle cx="137" cy="121" r="4" fill="#ffffff" />
            <circle cx="129.5" cy="131" r="1.8" fill="#a5f3fc" opacity="0.9" />
            <path d="M125,133 Q133,137 141,133" stroke="#67e8f9" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" fill="none" />
          </g>
        </g>

        {/* 腮红 */}
        <circle cx="68" cy="148" r="10" fill={`url(#cc-blush-${uid})`} />
        <circle cx="152" cy="148" r="10" fill={`url(#cc-blush-${uid})`} />

        {/* 微笑嘴 */}
        <path d="M99,148 Q110,158 121,148" stroke="#0f2f3d" strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>

      {/* 环绕光点（缓慢公转） */}
      <g className="cc-orbit">
        <circle cx="0" cy="0" r="3.2" fill="#a5f3fc" opacity="0.9" />
        <circle cx="0" cy="0" r="2" fill="#ffffff" opacity="0.8" transform="rotate(150)" />
      </g>
    </svg>
  );
}

/**
 * 身份卡内的川川立绘（带光环底座）：用于用户铭牌卡左侧。
 */
export function ChuanChuanPortrait({ size = 132 }) {
  return (
    <div className="cc-portrait">
      <span className="cc-portrait-ring" aria-hidden="true" />
      <ChuanChuanV2 size={size} />
    </div>
  );
}
