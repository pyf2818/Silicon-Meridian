import { describe, it, expect } from 'vitest';
import { computePopoverPosition, toPlainRect } from '../popoverPosition.js';

const vp = { width: 1440, height: 900 };

describe('computePopoverPosition（锚定弹层定位）', () => {
  it('下方空间充足时向下弹，右对齐锚点', () => {
    const anchor = { top: 100, bottom: 130, left: 400, right: 500 };
    const p = computePopoverPosition(anchor, { width: 360, height: 200 }, vp);
    expect(p.placement).toBe('down');
    expect(p.top).toBe(138);
    expect(p.left).toBe(140); // 500 - 360
  });

  it('下方空间不足且上方更宽裕时向上翻转（实测踩坑：排队按钮贴底）', () => {
    // 按钮在视口底部 770~800，弹层高 320
    const anchor = { top: 770, bottom: 800, left: 450, right: 810 };
    const p = computePopoverPosition(anchor, { width: 360, height: 320 }, vp);
    expect(p.placement).toBe('up');
    expect(p.top).toBe(442); // 770 - 8 - 320
    expect(p.top + 320).toBeLessThanOrEqual(900 - 8);
  });

  it('align=start 时左对齐锚点', () => {
    const anchor = { top: 100, bottom: 130, left: 400, right: 500 };
    const p = computePopoverPosition(anchor, { width: 210, height: 120 }, vp, { align: 'start' });
    expect(p.left).toBe(400);
  });

  it('右侧超界时向左夹紧到安全边距', () => {
    const anchor = { top: 100, bottom: 130, left: 1380, right: 1430 };
    const p = computePopoverPosition(anchor, { width: 360, height: 120 }, vp);
    expect(p.left + 360).toBeLessThanOrEqual(1440 - 8);
  });

  it('左侧超界时夹紧到 padding', () => {
    const anchor = { top: 100, bottom: 130, left: 12, right: 60 };
    const p = computePopoverPosition(anchor, { width: 360, height: 120 }, vp);
    expect(p.left).toBe(8);
  });

  it('弹层比视口还高时仍保证顶部贴边可见（不被推到负坐标）', () => {
    const anchor = { top: 700, bottom: 730, left: 400, right: 500 };
    const p = computePopoverPosition(anchor, { width: 360, height: 1000 }, vp);
    expect(p.top).toBe(8);
  });

  it('尺寸未知（未挂载）时按 prefer 返回且不产生 NaN', () => {
    const anchor = { top: 500, bottom: 530, left: 400, right: 500 };
    const p = computePopoverPosition(anchor, { width: 0, height: 0 }, vp, { prefer: 'up' });
    expect(p.placement).toBe('up');
    expect(Number.isFinite(p.left)).toBe(true);
    expect(Number.isFinite(p.top)).toBe(true);
  });

  it('anchor 为空时回落到安全边距', () => {
    const p = computePopoverPosition(null, { width: 100, height: 50 }, vp);
    expect(p).toEqual({ left: 8, top: 8, placement: 'down' });
  });

  it('toPlainRect 对非元素返回 null', () => {
    expect(toPlainRect(null)).toBe(null);
    expect(toPlainRect({})).toBe(null);
    expect(toPlainRect({ getBoundingClientRect: () => ({ top: 1, bottom: 2, left: 3, right: 4, width: 1, height: 1 }) }))
      .toEqual({ top: 1, bottom: 2, left: 3, right: 4, width: 1, height: 1 });
  });
});
