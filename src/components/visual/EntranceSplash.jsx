/**
 * EntranceSplash - 进场动画「墨染宣纸 · 落笔成川」
 *
 * 全屏覆盖层，每次整页加载播放一次（约 3.2s）：
 *   宣纸画卷渐显 → 一滴浓墨自顶而落、砸在纸上 → 涟漪一圈圈荡开（明显）
 *   → 品牌书法随墨韵由中心化开（wet→dry 由虚到实）→ 朱印落款 → 墨线 → 帷幕化开。
 * 背景是一幅带装裱边框的宣纸水墨：暖纸 + 纸纹 + 淡墨晕染 + 远山 + 淡月 + 暗角。
 *
 * 设计约束（与既有架构自洽）：
 * - 复用 motion.css 的 --ease-* / --dur-* 令牌与 fadeUp keyframe。
 * - 印章用跨调色板固定 --status-critical（朱红）。
 * - 墨色统一走 var(--text-primary)：浅纸=浓墨、深纸=淡墨（泥金月光），随深浅自适应。
 * - 点击 / Esc 可跳过（立即离场）。
 * - prefers-reduced-motion：直接卸载，无动画。
 * - 与 OnboardingFlow 互不冲突：本层 z-index 更高，播完淡出卸载后，
 *   首访引导（若有）在下方正常显现。
 *
 * 生命周期：onReveal 在「开始离场」时调用（驱动 App 内容随帷幕升起），
 * onDone 在「完全离场」后调用（由 App 卸载本组件）。
 */
import { useEffect, useRef, useState } from 'react';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;900&display=swap';

// 异步加载品牌书法字体（失败则回退系统衬线，不影响动画）
function injectFont() {
  if (document.getElementById('entrance-font')) return;
  const link = document.createElement('link');
  link.id = 'entrance-font';
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  link.media = 'print';
  link.onload = () => { link.media = 'all'; };
  document.head.appendChild(link);
}

const REVEAL_AT = 2500;   // 开始离场、内容升起
const DONE_AT = 3200;     // 完全离场、卸载
const SKIP_FADE = 560;    // 跳过时离场过渡时长

export default function EntranceSplash({ onReveal, onDone }) {
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef([]);
  // 用 ref 持有最新回调，避免把回调放进依赖导致 effect 重跑
  const cb = useRef({ onReveal, onDone });
  cb.current = { onReveal, onDone };

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      cb.current.onReveal?.();
      cb.current.onDone?.();
      setHidden(true);
      return;
    }

    injectFont();

    const t = [
      setTimeout(() => cb.current.onReveal?.(), REVEAL_AT),
      setTimeout(() => setLeaving(true), REVEAL_AT),
      setTimeout(() => {
        cb.current.onDone?.();
        setHidden(true);
      }, DONE_AT),
    ];
    timers.current = t;
    return () => t.forEach(clearTimeout);
  }, []);

  const skip = () => {
    if (leaving) return;
    timers.current.forEach(clearTimeout);
    cb.current.onReveal?.();
    setLeaving(true);
    timers.current = [
      setTimeout(() => {
        cb.current.onDone?.();
        setHidden(true);
      }, SKIP_FADE),
    ];
  };

  if (hidden) return null;

  return (
    <div
      className={`entrance${leaving ? ' entrance--leaving' : ''}`}
      onClick={skip}
      role="presentation"
      aria-hidden="true"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') skip(); }}
    >
      {/* 宣纸画卷：暖纸 + 淡墨晕染 + 远山 + 淡月 + 纸纹 + 暗角 + 装裱边框 */}
      <div className="entrance__bg">
        <div className="entrance__stain entrance__stain--a" />
        <div className="entrance__stain entrance__stain--b" />
        <div className="entrance__moon" />
        <svg className="entrance__mountains" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true">
          <path className="entrance__ridge entrance__ridge--far" d="M0,222 C220,180 380,204 560,172 C760,134 930,198 1120,162 C1290,134 1380,182 1440,166 L1440,320 L0,320 Z" />
          <path className="entrance__ridge entrance__ridge--near" d="M0,262 C190,212 350,252 520,216 C700,178 870,256 1060,220 C1245,188 1340,240 1440,224 L1440,320 L0,320 Z" />
        </svg>
        <div className="entrance__grain" />
        <div className="entrance__vignette" />
        <div className="entrance__frame" />
      </div>

      {/* 一滴浓墨落纸 → 涟漪一圈圈荡开 */}
      <div className="entrance__ink">
        <span className="entrance__drop" />
        <div className="entrance__ripples">
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
        </div>
      </div>

      {/* 品牌随墨韵化开 + 朱印落款 + 英文副题 */}
      <div className="entrance__center">
        <div className="entrance__halo" />
        <div className="entrance__brand">万般硅川</div>
        <div className="entrance__rule">
          <span className="entrance__line" />
          <span className="entrance__seal">印</span>
        </div>
        <div className="entrance__sub">SILICON MERIDIAN</div>
      </div>
    </div>
  );
}
