import React, { useEffect, useRef, useState } from 'react';

// WindowControls — Electron 桌面壳：mac 风格「红绿灯」窗口控制按钮（左上角）。
// 设计要点：
//   1. 平时完全隐形（opacity:0 + pointer-events:none）——零遮挡，左上角内容照常交互；
//   2. 指针靠近左上角（顶部 34px、左侧 170px 内）或悬停按钮时淡入，离开 350ms 后淡出；
//   3. mac 惯例配色：红(关闭) / 黄(最小化) / 绿(最大化·还原)，悬停单个圆点显示符号；
//   4. 仅在 Electron（preload 注入 window.meridianWindow）下渲染，纯浏览器返回 null。
const BASE = 'macwc';

const CSS = `
.${BASE}-bar{position:fixed;top:14px;left:14px;display:flex;gap:8px;z-index:2147483000;
  -webkit-app-region:no-drag;opacity:0;transform:translateY(-4px);
  transition:opacity .18s ease,transform .18s ease;pointer-events:none}
.${BASE}-bar[data-visible='1']{opacity:1;transform:none;pointer-events:auto}
.${BASE}-dot{width:13px;height:13px;border-radius:50%;border:none;padding:0;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18), 0 1px 3px rgba(0,0,0,.28);
  transition:filter .12s ease}
.${BASE}-dot:hover{filter:brightness(1.12)}
.${BASE}-dot:active{filter:brightness(.92)}
.${BASE}-dot svg{width:8px;height:8px;stroke:rgba(0,0,0,.62);stroke-width:1.4;fill:none;
  stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity .1s ease}
.${BASE}-dot:hover svg{opacity:1}
.${BASE}-close{background:#ff5f57}
.${BASE}-min{background:#febc2e}
.${BASE}-max{background:#28c840}
`;

const S = { viewBox: '0 0 10 10', 'aria-hidden': true };

export default function WindowControls() {
  const bridge = typeof window !== 'undefined' ? window.meridianWindow : null;
  const [visible, setVisible] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const hideTimer = useRef(null);

  useEffect(() => {
    if (!bridge) return undefined;
    let disposed = false;
    bridge.isMaximized().then((v) => { if (!disposed) setMaximized(!!v); }).catch(() => {});
    const offState = bridge.onMaximizeState((v) => setMaximized(!!v));
    // 指针靠近左上角即浮现；离开后延迟 350ms 淡出（防手抖）。纯事件监听，零 DOM 覆盖。
    const onMove = (e) => {
      const near = e.clientY <= 34 && e.clientX <= 170;
      if (near) {
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
        setVisible(true);
      } else if (!hideTimer.current) {
        hideTimer.current = setTimeout(() => { setVisible(false); hideTimer.current = null; }, 350);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      disposed = true;
      window.removeEventListener('pointermove', onMove);
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      if (offState) offState();
    };
  }, [bridge]);

  if (!bridge) return null;

  return (
    <>
      <style>{CSS}</style>
      <div className={BASE + '-bar'} data-visible={visible ? '1' : '0'}>
        <button type="button" title="关闭" className={BASE + '-dot ' + BASE + '-close'} onClick={() => bridge.close()}>
          <svg {...S}><line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" /></svg>
        </button>
        <button type="button" title="最小化" className={BASE + '-dot ' + BASE + '-min'} onClick={() => bridge.minimize()}>
          <svg {...S}><line x1="1.5" y1="5" x2="8.5" y2="5" /></svg>
        </button>
        <button type="button" title={maximized ? '还原' : '最大化'} className={BASE + '-dot ' + BASE + '-max'} onClick={() => bridge.toggleMaximize()}>
          {maximized ? (
            <svg {...S}><rect x="1" y="3" width="6" height="6" rx="1" /><line x1="3.5" y1="1" x2="9" y2="1" /><line x1="9" y1="1" x2="9" y2="6.5" /></svg>
          ) : (
            <svg {...S}><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" /></svg>
          )}
        </button>
      </div>
    </>
  );
}
