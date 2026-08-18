/**
 * EntranceSplash - 进场动画「墨染宣纸 · 落笔成川」
 *
 * 全屏覆盖层，每次整页加载播放一次（起跑后约 3.25s）：
 *   宣纸画卷渐显（立即）→ 书法字就绪起跑 → 一滴浓墨自顶而落、沉入纸面
 *   → 墨点晕开 + 涟漪一圈圈荡开（明显）→ 品牌书法由中心化开（清晰锐利）
 *   → 朱印落款 → 墨线 → 帷幕化开。
 *
 * 丝滑三原则（本次重构核心）：
 * 1. 全程只动画 transform / opacity（合成器驱动，零重绘抖动）；
 *    品牌用 clip-path circle 圆扩（单元素、局部重绘）。
 * 2. 等品牌字体真正就绪（document.fonts.load + 超时兜底）再加 is-run 起跑，
 *    杜绝「先系统衬线虚影、中途换毛笔字」的虚化感。
 * 3. 深浅模式分治纸纹/暗角浓度（深色克制、浅色适中），背景安静不噪。
 *
 * 其余约束：复用 motion.css 令牌；印章用跨调色板固定 --status-critical；
 * 点击 / Esc 可跳过；prefers-reduced-motion 直接卸载；z-index 10000 防穿透。
 *
 * 生命周期：onReveal 在「开始离场」时调用（App 内容随帷幕升起），
 * onDone 在「完全离场」后调用（由 App 卸载本组件）。
 */
import { useEffect, useRef, useState } from 'react';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;900&display=swap';

const REVEAL_AT = 2550;    // 起跑后：开始离场、内容升起
const DONE_AT = 3250;      // 起跑后：完全离场、卸载
const SKIP_FADE = 560;     // 跳过时离场过渡时长
const FONT_WAIT_MAX = 600; // 书法字最多等这么久，超时直接起跑（回退系统衬线）

// 异步注入品牌书法字样式表；resolve 在 CSS 就绪或失败时（绝不 pending）
function injectFont() {
  return new Promise((resolve) => {
    if (document.getElementById('entrance-font')) { resolve(); return; }
    const link = document.createElement('link');
    link.id = 'entrance-font';
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    link.media = 'print';
    link.onload = () => { link.media = 'all'; resolve(); };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

export default function EntranceSplash({ onReveal, onDone }) {
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [run, setRun] = useState(false);
  const timers = useRef([]);
  const started = useRef(false);
  const dead = useRef(false);
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

    // 等品牌书法字真正可渲染再起跑（背景纸不受影响、已先行渐显）
    const begin = () => {
      if (started.current || dead.current) return;
      started.current = true;
      setRun(true);
      timers.current = [
        setTimeout(() => cb.current.onReveal?.(), REVEAL_AT),
        setTimeout(() => setLeaving(true), REVEAL_AT),
        setTimeout(() => {
          cb.current.onDone?.();
          setHidden(true);
        }, DONE_AT),
      ];
    };
    const fallback = setTimeout(begin, FONT_WAIT_MAX);
    const ready = injectFont()
      .then(() =>
        Promise.all([
          document.fonts.load('64px "Ma Shan Zheng"', '万般硅川'),
          document.fonts.load('900 24px "Noto Serif SC"', '印'),
        ])
      )
      .catch(() => {});
    ready.then(() => {
      clearTimeout(fallback);
      begin();
    });

    return () => {
      clearTimeout(fallback);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const skip = () => {
    if (leaving) return;
    dead.current = true;
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
      className={`entrance${run ? ' is-run' : ''}${leaving ? ' entrance--leaving' : ''}`}
      onClick={skip}
      role="presentation"
      aria-hidden="true"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') skip(); }}
    >
      {/* 宣纸画卷：暖纸 + 淡墨晕染 + 远山 + 淡月 + 纸纹 + 暗角 + 装裱边框（立即渐显） */}
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

      {/* 一滴浓墨落纸沉入 → 墨点晕开 → 涟漪荡漾（is-run 起跑） */}
      <div className="entrance__ink">
        <span className="entrance__drop" />
        <span className="entrance__blot" />
        <div className="entrance__ripples">
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
          <span className="entrance__ripple" />
        </div>
      </div>

      {/* 品牌由中心化开（清晰锐利）+ 朱印落款 + 英文副题 */}
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
