// electron/preload.cjs — 桌面壳桥接层
// sandbox 模式下 preload 仅暴露最小窗口控制面（contextBridge + ipcRenderer）。
// 浏览器/纯 web 环境没有 window.meridianWindow，WindowControls 组件据此不渲染。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meridianWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  closeBehaviorGet: () => ipcRenderer.invoke('close-behavior:get'),
  closeBehaviorSet: (behavior) => ipcRenderer.send('close-behavior:set', behavior),
  onCloseRequested: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('close-requested', listener);
    return () => ipcRenderer.removeListener('close-requested', listener);
  },
  confirmClose: (payload) => ipcRenderer.send('close:confirm', payload),
  // 返回取消订阅函数；state: boolean（是否最大化）
  onMaximizeState: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('window:maximize-state', listener);
    return () => ipcRenderer.removeListener('window:maximize-state', listener);
  },
});
