import React, { useEffect, useState } from 'react';

// DesktopTab — 设置 · 系统 · 桌面行为（Electron 桌面壳专属）
// 配置窗口关闭按钮行为：每次询问（默认）/ 最小化到托盘 / 直接退出。
// 选择通过 IPC 持久化到主进程（userData/close-behavior.json）。
const OPTIONS = [
  { id: 'ask', title: '每次询问', desc: '关闭窗口时弹出选择框，可勾选记住（默认）' },
  { id: 'tray', title: '最小化到托盘', desc: '点击关闭直接驻留托盘，情报聚合继续在后台运行' },
  { id: 'exit', title: '直接退出', desc: '点击关闭立即完全退出应用' },
];

const CSS = `
.dt-wrap{display:flex;flex-direction:column;gap:10px;max-width:520px}
.dt-wrap h3{margin:0;font-size:15px;font-weight:600;color:var(--text-primary,#e8eaf0)}
.dt-sub{margin:0 0 6px;font-size:12.5px;line-height:1.7;color:var(--text-muted,#9aa1b0)}
.dt-opt{display:flex;align-items:flex-start;gap:11px;padding:12px 14px;border-radius:10px;cursor:pointer;
  border:1px solid var(--border-color,rgba(255,255,255,.09));
  transition:background .15s ease,border-color .15s ease}
.dt-opt:hover{background:color-mix(in srgb,var(--accent-cyan,#4fe3ff) 6%,transparent)}
.dt-opt.active{border-color:color-mix(in srgb,var(--accent-cyan,#4fe3ff) 45%,transparent);
  background:color-mix(in srgb,var(--accent-cyan,#4fe3ff) 8%,transparent)}
.dt-opt input{margin-top:3px;accent-color:var(--accent-cyan,#4fe3ff)}
.dt-opt b{display:block;font-size:13px;font-weight:600;color:var(--text-primary,#e8eaf0)}
.dt-opt span{display:block;margin-top:2px;font-size:11.5px;line-height:1.6;color:var(--text-muted,#9aa1b0)}
.dt-note{margin:4px 0 0;font-size:11.5px;line-height:1.7;color:var(--text-muted,#9aa1b0)}
.dt-unavailable{padding:14px 16px;border-radius:10px;border:1px dashed var(--border-color,rgba(255,255,255,.09));
  font-size:12.5px;color:var(--text-muted,#9aa1b0)}
`;

export default function DesktopTab() {
  const bridge = typeof window !== 'undefined' ? window.meridianWindow : null;
  const [behavior, setBehavior] = useState('ask');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!bridge || !bridge.closeBehaviorGet) { setReady(true); return undefined; }
    bridge.closeBehaviorGet()
      .then((v) => { setBehavior(['ask', 'exit', 'tray'].includes(v) ? v : 'ask'); setReady(true); })
      .catch(() => setReady(true));
    return undefined;
  }, [bridge]);

  if (!bridge) {
    return (
      <>
        <style>{CSS}</style>
        <div className="dt-wrap">
          <h3>窗口关闭行为</h3>
          <div className="dt-unavailable">此项为桌面版专属设置——请在 SiliconStream 桌面应用（Electron 版）中打开。</div>
        </div>
      </>
    );
  }

  const pick = (id) => {
    setBehavior(id);
    if (bridge.closeBehaviorSet) bridge.closeBehaviorSet(id);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="dt-wrap">
        <h3>窗口关闭行为</h3>
        <p className="dt-sub">点击关闭按钮（窗口右上角红点）时的默认动作。</p>
        {ready && OPTIONS.map((o) => (
          <label key={o.id} className={'dt-opt' + (behavior === o.id ? ' active' : '')}>
            <input
              type="radio"
              name="close-behavior"
              checked={behavior === o.id}
              onChange={() => pick(o.id)}
            />
            <div>
              <b>{o.title}</b>
              <span>{o.desc}</span>
            </div>
          </label>
        ))}
        <p className="dt-note">
          「每次询问」模式下关闭窗口会弹出选择框，可勾选「记住我的选择」；托盘模式下可随时从托盘图标左键打开、右键菜单退出。
        </p>
      </div>
    </>
  );
}
