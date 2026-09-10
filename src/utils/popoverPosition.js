// 锚定弹层定位（纯函数，便于单测）
//
// 背景：项目里多处弹层原先用「绝对定位 + 祖先 overflow:auto」实现，会被滚动容器裁剪。
// 统一改为「createPortal 到 body + position:fixed」，本函数负责算出安全坐标。
//
// 规则：
//  - 垂直：默认向下弹；下方空间不足且上方更宽裕则翻转向上；最后夹紧到视口内
//  - 水平：align='end' 与锚点右缘对齐（如输入框上方的排队按钮），'start' 与左缘对齐
//  - 四边留 padding 安全边距，保证弹层完整可见

export const POPOVER_DEFAULT_OPTS = { gap: 8, padding: 8, prefer: 'down', align: 'end' };

/**
 * @param {{top:number,bottom:number,left:number,right:number}} anchor 锚点矩形（视口坐标）
 * @param {{width:number,height:number}} size 弹层尺寸（未挂载时未知可传 0）
 * @param {{width:number,height:number}} viewport 视口尺寸
 * @param {{gap?:number,padding?:number,prefer?:'down'|'up',align?:'start'|'end'}} [opts]
 * @returns {{left:number,top:number,placement:'down'|'up'}}
 */
export function computePopoverPosition(anchor, size, viewport, opts = {}) {
  const { gap, padding, prefer, align } = { ...POPOVER_DEFAULT_OPTS, ...opts };
  const vw = Math.max(0, viewport?.width || 0);
  const vh = Math.max(0, viewport?.height || 0);
  const w = Math.max(0, size?.width || 0);
  const h = Math.max(0, size?.height || 0);

  if (!anchor) return { left: padding, top: padding, placement: prefer };

  const spaceBelow = vh - anchor.bottom - gap - padding;
  const spaceAbove = anchor.top - gap - padding;

  let placement = prefer;
  if (prefer === 'down' && h > spaceBelow && spaceAbove > spaceBelow) placement = 'up';
  else if (prefer === 'up' && h > spaceAbove && spaceBelow > spaceAbove) placement = 'down';

  // 弹层尺寸未知（h=0）时无法判定，按 prefer 处理
  let top = placement === 'down' ? anchor.bottom + gap : anchor.top - gap - h;

  let left = align === 'end' ? anchor.right - w : anchor.left;
  if (left + w > vw - padding) left = vw - padding - w;
  if (left < padding) left = padding;
  if (w === 0) left = Math.max(padding, Math.min(align === 'end' ? anchor.right : anchor.left, vw - padding));

  // 垂直夹紧：极端窄高视口下保证至少完整贴边可见
  if (top + h > vh - padding) top = vh - padding - h;
  if (top < padding) top = padding;

  return { left: Math.round(left), top: Math.round(top), placement };
}

/** 元素 → 纯对象矩形（getBoundingClientRect 的 DOMRect 不可跨序列化，统一转换） */
export function toPlainRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
}
