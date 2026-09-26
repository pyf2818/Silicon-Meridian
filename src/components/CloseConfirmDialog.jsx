import React, { useEffect, useState } from 'react';

// CloseConfirmDialog — 关闭确认对话框（Electron 桌面壳专用）
// 主进程拦截 close 后发送 close-requested，本组件弹出三选一：
//   退出应用 / 最小化到托盘 / 取消，可勾选「记住我的选择」（由主进程持久化）。
// 纯浏览器环境（无 window.meridianWindow）不渲染。
const BASE = 'mccd';

const CSS = `
.${BASE}-overlay{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;
  background:rgba(8,10,14,.55);backdrop-filter:blur(6px);animation:mccd-fade .16s ease}
@keyframes mccd-fade{from{opacity:0}to{opacity:1}}
.${BASE}-card{width:400px;max-width:calc(100vw - 48px);border-radius:16px;padding:26px 28px 20px;
  background:var(--bg-primary,#16181d);border:1px solid var(--border-color,rgba(255,255,255,.09));
  box-shadow:0 24px 64px rgba(0,0,0,.45);color:var(--text-primary,#e8eaf0);
  animation:mccd-pop .18s ease}
@keyframes mccd-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.${BASE}-title{margin:0 0 8px;font-size:16px;font-weight:600}
.${BASE}-desc{margin:0 0 18px;font-size:13px;line-height:1.7;color:var(--text-muted,#9aa1b0)}
.${BASE}-actions{display:flex;flex-direction:column;gap:8px}
.${BASE}-btn{display:flex;flex-direction:column;gap:2px;width:100%;padding:11px 14px;border-radius:10px;
  border:1px solid var(--border-color,rgba(255,255,255,.09));background:transparent;
  color:var(--text-primary,#e8eaf0);font-size:13px;cursor:pointer;text-align:left;
  transition:background .15s ease,border-color .15s ease}
.${BASE}-btn:hover{background:color-mix(in srgb,var(--accent-cyan,#4fe3ff) 10%,transparent);
  border-color:color-mix(in srgb,var(--accent-cyan,#4fe3ff) 40%,transparent)}
.${BASE}-btn b{font-weight:600}
.${BASE}-btn span{font-size:11.5px;color:var(--text-muted,#9aa1b0)}
.${BASE}-btn.${BASE}-danger:hover{background:color-mix(in srgb,#e5484d 14%,transparent);
  border-color:color-mix(in srgb,#e5484d 45%,transparent)}
.${BASE}-footer{margin-top:14px;display:flex;align-items:center;justify-content:space-between}
.${BASE}-remember{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-muted,#9aa1b0);cursor:pointer}
.${BASE}-remember input{accent-color:var(--accent-cyan,#4fe3ff)}
.${BASE}-cancel{font-size:12px;color:var(--text-muted,#9aa1b0);background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px}
.${BASE}-cancel:hover{color:var(--text-primary,#e8eaf0);background:rgba(255,255,255,.06)}
`;

export default function CloseConfirmDialog() {
  const bridge = typeof window !== 'undefined' ? window.meridianWindow : null;
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!bridge || !bridge.onCloseRequested) return undefined;
    const off = bridge.onCloseRequested(() => setOpen(true));
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      if (off) off();
      window.removeEventListener('keydown', onKey);
    };
  }, [bridge]);

  if (!bridge || !open) return null;

  const act = (action) => {
    setOpen(false);
    if (action === 'cancel') return;
    bridge.confirmClose({ action, remember });
  };

  return (
    <>
      <style>{CSS}</style>
      <div className={BASE + '-overlay'} onClick={() => act('cancel')}>
        <div className={BASE + '-card'} onClick={(e) => e.stopPropagation()}>
          <h3 className={BASE + '-title'}>关闭 SiliconStream</h3>
          <p className={BASE + '-desc'}>选择关闭窗口后的行为。挂到托盘后，情报聚合与智能体会继续在后台运行。</p>
          <div className={BASE + '-actions'}>
            <button type="button" className={BASE + '-btn ' + BASE + '-danger'} onClick={() => act('exit')}>
              <b>退出应用</b>
              <span>完全关闭，停止后台聚合</span>
            </button>
            <button type="button" className={BASE + '-btn'} onClick={() => act('tray')}>
              <b>最小化到托盘</b>
              <span>驻留系统托盘，后台继续运行</span>
            </button>
          </div>
          <div className={BASE + '-footer'}>
            <label className={BASE + '-remember'}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              记住我的选择（可在设置中修改）
            </label>
            <button type="button" className={BASE + '-cancel'} onClick={() => act('cancel')}>取消</button>
          </div>
        </div>
      </div>
    </>
  );
}
