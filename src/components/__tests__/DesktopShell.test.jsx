import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CloseConfirmDialog from '../CloseConfirmDialog.jsx';
import DesktopTab from '../settings/DesktopTab.jsx';

// 纯浏览器 / node 环境（无 preload 注入的 window.meridianWindow）：
// 两个桌面壳组件必须渲染空——不给 web 版引入任何 DOM 副作用。
describe('桌面壳组件（浏览器环境降级）', () => {
  it('CloseConfirmDialog 无桥时渲染空', () => {
    const markup = renderToStaticMarkup(React.createElement(CloseConfirmDialog));
    expect(markup).toBe('');
  });
  it('DesktopTab 无桥时显示「桌面版专属」提示而非崩溃', () => {
    const markup = renderToStaticMarkup(React.createElement(DesktopTab));
    expect(markup).toContain('桌面版专属');
  });
});
