/**
 * 画布偏好（网格样式 / 连线动画 / 模拟速度）
 *
 * 设置页写入、画布页读取，通过自定义事件做跨组件同步。
 * 只有三个开关，不值得引入 store，localStorage + 事件足够。
 */
const KEY = 'siliconstream-canvas-prefs';
const EVENT = 'canvas-prefs-change';

export const CANVAS_PREFS_DEFAULT = {
  grid: 'line',      // 'line' | 'dot' | 'off'
  animateEdges: true,
  speed: 1,          // 0.6 慢 / 1 标准 / 1.8 快
  snap: true,        // 节点拖拽吸附网格
};

export function getCanvasPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...CANVAS_PREFS_DEFAULT };
    return { ...CANVAS_PREFS_DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...CANVAS_PREFS_DEFAULT };
  }
}

export function setCanvasPrefs(patch) {
  const next = { ...getCanvasPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* noop */ }
  return next;
}

export function subscribeCanvasPrefs(handler) {
  const listener = (event) => handler(event.detail || getCanvasPrefs());
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
