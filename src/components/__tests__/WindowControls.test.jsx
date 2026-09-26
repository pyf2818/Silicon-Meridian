import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import WindowControls from '../WindowControls.jsx';

// 纯浏览器 / node 环境（无 preload 注入的 window.meridianWindow）：
// 组件必须渲染 null —— 不给 web 版引入任何 DOM 副作用。
describe('WindowControls', () => {
  it('无 meridianWindow 桥时渲染 null（浏览器环境不显示）', () => {
    expect((globalThis.window || {})?.meridianWindow).toBeUndefined();
    const markup = renderToStaticMarkup(React.createElement(WindowControls));
    expect(markup).toBe('');
  });
});
