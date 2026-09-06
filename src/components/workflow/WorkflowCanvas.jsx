/**
 * WorkflowCanvas - 无限画布（对标 Dify / n8n 的工作流编辑器形态）
 *
 * 能力：
 * - 无限视口：指针拖拽平移 + 滚轮/触控板以光标为中心连续缩放 + 平滑缩放动画 + 适应视图
 * - 节点自由拖拽：pointer 事件 + requestAnimationFrame 合帧，拖拽期间直接写 DOM，
 *   不触发 React 重渲染（拖拽 0 次 re-render），松手才提交 position
 * - 连线可视化：按执行顺序绘制 SVG 贝塞尔连线（in 端口 → out 端口），
 *   与 workflowEngine 的顺序执行语义一致——边的拓扑即启用节点的数组顺序
 * - 连线动态：模拟运行时当前边流光 + 粒子沿路径运动 + 传递数据标签，已完成的边转实线
 * - 节点面板（palette）：拖拽或单击创建节点
 *
 * 纯 UI 层：坐标换算（screen↔world）为纯函数，业务提交全部通过回调上抛。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { normalizeNodePosition } from '../../constants/workflowConstants.js';

export const WF_NODE_W = 240;
export const WF_NODE_H = 118;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.8;
const WORLD_W = 6000;
const WORLD_H = 4000;
const GRID = 28;
const FIT_PADDING = 90;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 屏幕坐标 → 世界坐标（考虑 pan 与 zoom） */
export function screenToWorld(clientX, clientY, rect, pan, zoom) {
  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom,
  };
}

/** 顺序链的贝塞尔连线 path（out 端口右侧 → in 端口左侧） */
export function edgePath(from, to) {
  const x1 = from.x + WF_NODE_W;
  const y1 = from.y + WF_NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + WF_NODE_H / 2;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

export default function WorkflowCanvas({
  nodes = [],
  selectedId = null,
  onSelect = () => {},
  onMoveNode = () => {},      // (id, x, y) → 提交 position
  onCreateNodeAt = () => {},  // (type, worldX, worldY)
  nodeTypeMeta = {},
  selectedNode = null,
  children,                   // 画布内浮层（工作流名/动作/节点配置卡），随画布渲染
  nodeStates = {},            // 模拟运行态：id → 'running' | 'done' | 'skipped'
  flowEdge = -1,              // 模拟运行时正在"流动"的边下标（-1 无）
  flowLabel = '',             // 当前流动边传递的数据摘要
  invalidIds = [],            // 校验未通过（缺必填）的节点 id
  simOutputs = {},            // 模拟产物：id → 文本
  onDblClick = () => {},      // (worldX, worldY) 双击空白处快速建节点
  gridMode = 'line',          // 'line' | 'dot' | 'off'
  animateEdges = true,        // 连线流动动画开关
  snap = true,                // 拖拽节点时吸附到网格
  onDuplicateNode = null,     // (id) → 复制节点（提供时节点工具条出现复制按钮）
  onRemoveNode = null,        // (id) → 删除节点
  paletteOpen = true,         // 右侧节点面板开合（状态由 CanvasPage 持久化）
  onSetPaletteOpen = null,    // (open) → 开关节点面板；不提供则面板常驻
}) {
  const viewportRef = useRef(null);
  const worldRef = useRef(null);
  const gridLayerRef = useRef(null);
  const zoomLabelRef = useRef(null);
  const nodeElMap = useRef(new Map());
  /** 视图真相源：拖拽/缩放期间只改这里，避免 React 重渲染 */
  const viewRef = useRef({ x: 40, y: 40, z: 1 });
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const pendingRef = useRef(null);
  const didFitRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  // 节点拖拽中的 React 态：pointerup 只清 ref 不触发重渲染，若仅凭 dragRef 判断，
  // 单击选中后工具条会在「选中重渲染时仍处拖拽态」与「松手后无重渲染」之间漏渲染。
  const [nodeDragActive, setNodeDragActive] = useState(false);
  const spaceRef = useRef(false);

  /* ---------- 视图应用：直接写 DOM，不进 React 渲染 ---------- */
  const applyView = useCallback(() => {
    const world = worldRef.current;
    const { x, y, z } = viewRef.current;
    if (world) {
      world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
    }
    // 网格画在视口层（无限延伸）：尺寸/偏移跟随 pan 与 zoom，永不到边
    const grid = gridLayerRef.current;
    if (grid) {
      grid.style.backgroundSize = `${GRID * z}px ${GRID * z}px, ${GRID * z}px ${GRID * z}px, ${GRID * 5 * z}px ${GRID * 5 * z}px, ${GRID * 5 * z}px ${GRID * 5 * z}px`;
      grid.style.backgroundPosition = `${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px`;
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(z * 100)}%`;
  }, []);

  /** rAF 合帧：一帧内的多次指针事件只落地一次 */
  const scheduleApply = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      if (pending) { pendingRef.current = null; pending(); }
      applyView();
    });
  }, [applyView]);

  useLayoutEffect(() => { applyView(); }, [applyView]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const rect = useCallback(() => viewportRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: 0, height: 0 }, []);

  /* ---------- 平滑缩放动画（按钮/适应视图使用） ---------- */
  const animateTo = useCallback((target, duration = 240) => {
    const from = { ...viewRef.current };
    const start = performance.now();
    const world = worldRef.current;
    if (world) world.classList.add('is-animating');
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      viewRef.current = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        z: from.z + (target.z - from.z) * e,
      };
      applyView();
      if (t < 1) requestAnimationFrame(step);
      else if (world) world.classList.remove('is-animating');
    };
    requestAnimationFrame(step);
  }, [applyView]);

  /** 以某个屏幕锚点为中心缩放 */
  const zoomAt = useCallback((nextZoomRaw, anchorClientX, anchorClientY, animated = false) => {
    const r = rect();
    const mx = anchorClientX ?? r.left + r.width / 2;
    const my = anchorClientY ?? r.top + r.height / 2;
    const z = clamp(nextZoomRaw, ZOOM_MIN, ZOOM_MAX);
    const { x, y, z: cz } = viewRef.current;
    const wx = (mx - r.left - x) / cz;
    const wy = (my - r.top - y) / cz;
    const target = { x: mx - r.left - wx * z, y: my - r.top - wy * z, z };
    if (animated) animateTo(target);
    else { viewRef.current = target; applyView(); }
  }, [animateTo, applyView, rect]);

  /* ---------- 适应视图：把所有节点框进视口 ---------- */
  const fitView = useCallback((animated = true) => {
    const r = rect();
    const list = (nodes || []).map((n, i) => normalizeNodePosition(n.position, i));
    if (!list.length || !r.width) return;
    const minX = Math.min(...list.map(p => p.x)) - FIT_PADDING;
    const minY = Math.min(...list.map(p => p.y)) - FIT_PADDING;
    const maxX = Math.max(...list.map(p => p.x)) + WF_NODE_W + FIT_PADDING;
    const maxY = Math.max(...list.map(p => p.y)) + WF_NODE_H + FIT_PADDING;
    const w = maxX - minX;
    const h = maxY - minY;
    const z = clamp(Math.min(r.width / w, r.height / h), ZOOM_MIN, 1.1);
    const target = { x: (r.width - w * z) / 2 - minX * z, y: (r.height - h * z) / 2 - minY * z, z };
    if (animated) animateTo(target, 300);
    else { viewRef.current = target; applyView(); }
  }, [nodes, animateTo, applyView, rect]);

  // 首次挂载：自动把已有工作流框进视口（仅一次）
  useLayoutEffect(() => {
    if (didFitRef.current || !nodes?.length) return;
    didFitRef.current = true;
    fitView(false);
  }, [nodes, fitView]);

  /* ---------- 滚轮：鼠标滚轮缩放，触控板双指平移，Ctrl/⌘ + 滚轮缩放 ---------- */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const { deltaX, deltaY } = event;
      const isPinch = event.ctrlKey || event.metaKey;
      // 鼠标滚轮：整数且幅度大 → 缩放；触控板：小步长/带横向位移 → 平移
      const isMouseWheel = !isPinch && Math.abs(deltaX) === 0 && Number.isInteger(deltaY) && Math.abs(deltaY) >= 40;
      if (isPinch || isMouseWheel) {
        const { z } = viewRef.current;
        zoomAt(z * Math.exp(-deltaY * 0.0016), event.clientX, event.clientY);
      } else {
        const v = viewRef.current;
        viewRef.current = { ...v, x: v.x - deltaX, y: v.y - deltaY };
        scheduleApply();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scheduleApply, zoomAt]);

  /* ---------- 空格键：临时切换到抓手 ---------- */
  useEffect(() => {
    const isTyping = () => {
      const tag = document.activeElement?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const down = (e) => {
      if (e.code === 'Space' && !isTyping()) { spaceRef.current = true; setSpaceDown(true); e.preventDefault(); }
    };
    const up = (e) => { if (e.code === 'Space') { spaceRef.current = false; setSpaceDown(false); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /* ---------- 键盘：+/- 缩放、0 重置、F 适应视图 ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '+' || e.key === '=') zoomAt(viewRef.current.z * 1.15, null, null, true);
      else if (e.key === '-' || e.key === '_') zoomAt(viewRef.current.z / 1.15, null, null, true);
      else if (e.key === '0') animateTo({ x: 40, y: 40, z: 1 });
      else if (e.key === 'f' || e.key === 'F') fitView(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [animateTo, fitView, zoomAt]);

  const isBackground = (target) => (
    target === viewportRef.current || target === worldRef.current
    || target?.classList?.contains('wf-edges') || target?.tagName === 'svg' || target?.tagName === 'path'
  );

  /* ---------- 视口指针：背景拖拽平移 ---------- */
  const onViewportPointerDown = useCallback((event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && !spaceRef.current && !isBackground(event.target)) return;
    const v = viewRef.current;
    dragRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: v.x,
      startPanY: v.y,
      moved: false,
    };
    viewportRef.current?.setPointerCapture?.(event.pointerId);
  }, []);

  const onViewportPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'pan' || drag.pointerId !== event.pointerId) return;
    const nx = drag.startPanX + (event.clientX - drag.startX);
    const ny = drag.startPanY + (event.clientY - drag.startY);
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    pendingRef.current = () => { viewRef.current = { ...viewRef.current, x: nx, y: ny }; };
    scheduleApply();
  }, [scheduleApply]);

  const onViewportPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    viewportRef.current?.releasePointerCapture?.(event.pointerId);
    // 背景单击（未拖动）→ 取消选中
    if (drag.kind === 'pan' && !drag.moved && event.button === 0) onSelect(null);
  }, [onSelect]);

  /* ---------- 节点指针：拖拽移动（DOM 直写，松手提交） ---------- */
  const onNodePointerDown = useCallback((event, node) => {
    if (event.button !== 0 || spaceRef.current) return;
    event.stopPropagation();
    const r = rect();
    const v = viewRef.current;
    const world = screenToWorld(event.clientX, event.clientY, r, v, v.z);
    const pos = normalizeNodePosition(node.position);
    dragRef.current = {
      kind: 'node',
      pointerId: event.pointerId,
      id: node.id,
      el: event.currentTarget,
      startWorldX: world.x,
      startWorldY: world.y,
      origX: pos.x,
      origY: pos.y,
      zoom: v.z,
      cur: { x: pos.x, y: pos.y },
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setNodeDragActive(true);
    onSelect(node.id);
  }, [onSelect, rect]);

  const onNodePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'node' || drag.pointerId !== event.pointerId) return;
    const r = rect();
    const v = viewRef.current;
    const world = screenToWorld(event.clientX, event.clientY, r, v, v.z);
    const align = (value) => (snap ? Math.round(value / GRID) * GRID : Math.round(value));
    const nx = align(drag.origX + (world.x - drag.startWorldX));
    const ny = align(drag.origY + (world.y - drag.startWorldY));
    if (Math.abs(nx - drag.origX) + Math.abs(ny - drag.origY) > 2) drag.moved = true;
    drag.cur = { x: nx, y: ny };
    const el = drag.el;
    pendingRef.current = () => { if (el) { el.style.left = `${nx}px`; el.style.top = `${ny}px`; } };
    scheduleApply();
  }, [rect, scheduleApply, snap]);

  const onNodePointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setNodeDragActive(false);
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    if (drag.kind === 'node' && drag.moved) onMoveNode(drag.id, drag.cur.x, drag.cur.y);
  }, [onMoveNode]);

  /* ---------- 双击空白：就地建节点 ---------- */
  const onViewportDblClick = useCallback((event) => {
    if (!isBackground(event.target)) return;
    const r = rect();
    const v = viewRef.current;
    const world = screenToWorld(event.clientX, event.clientY, r, v, v.z);
    onDblClick(Math.round(world.x - WF_NODE_W / 2), Math.round(world.y - WF_NODE_H / 2));
  }, [onDblClick, rect]);

  /* ---------- palette 拖放创建 ---------- */
  const onDropCreate = useCallback((event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-wf-node-type');
    if (!type) return;
    const r = rect();
    const v = viewRef.current;
    const world = screenToWorld(event.clientX, event.clientY, r, v, v.z);
    onCreateNodeAt(type, Math.round(world.x - WF_NODE_W / 2), Math.round(world.y - WF_NODE_H / 2));
  }, [onCreateNodeAt, rect]);

  /** palette 单击创建：落在视口中心（比拖拽更快） */
  const createAtViewCenter = useCallback((type) => {
    const r = rect();
    const v = viewRef.current;
    const world = screenToWorld(r.left + r.width / 2, r.top + r.height / 2, r, v, v.z);
    onCreateNodeAt(type, Math.round(world.x - WF_NODE_W / 2 + (Math.random() * 60 - 30)), Math.round(world.y - WF_NODE_H / 2 + (Math.random() * 60 - 30)));
  }, [onCreateNodeAt, rect]);

  /* ---------- 连线（启用节点的数组顺序 = 执行顺序） ---------- */
  const chain = (nodes || []).filter(n => n.enabled !== false);
  const edges = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const from = normalizeNodePosition(chain[i].position, i);
    const to = normalizeNodePosition(chain[i + 1].position, i + 1);
    const state = flowEdge < 0 ? '' : i < flowEdge ? 'done' : i === flowEdge ? 'flow' : '';
    edges.push({
      id: `${chain[i].id}->${chain[i + 1].id}`,
      d: edgePath(from, to),
      state,
      mid: { x: (from.x + WF_NODE_W + to.x) / 2, y: (from.y + to.y) / 2 + WF_NODE_H / 2 },
    });
  }

  const paletteTypes = Object.entries(nodeTypeMeta);
  const gridClass = `wf-grid-layer grid-${gridMode}${spaceDown ? ' grab' : ''}`;
  const worldClass = `wf-world${spaceDown ? ' grab' : ''}`;

  return (
    <div
      className="wf-canvas"
      ref={viewportRef}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={onViewportPointerUp}
      onPointerCancel={onViewportPointerUp}
      onDoubleClick={onViewportDblClick}
      onDragOver={event => event.preventDefault()}
      onDrop={onDropCreate}
      role="application"
      aria-label="工作流无限画布"
    >
      {/* 网格层：铺满视口、无限延伸（不随 world 裁剪），尺寸/偏移由 applyView 驱动 */}
      <div className={gridClass} ref={gridLayerRef} aria-hidden="true" />
      {/* 世界层：pan+zoom 变换（全部由 applyView 直接写 DOM） */}
      <div className={worldClass} ref={worldRef}>
        <svg className="wf-edges" width={WORLD_W} height={WORLD_H} aria-hidden="true">
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="wf-arrow-path" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker id="wf-arrow-done" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="wf-arrow-path done" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker id="wf-arrow-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="wf-arrow-path flow" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {edges.map(edge => (
            <g key={edge.id} className={`wf-edge-group ${edge.state}`}>
              <path
                className={`wf-edge ${edge.state}`}
                d={edge.d}
                markerEnd={`url(#wf-arrow${edge.state === 'done' ? '-done' : edge.state === 'flow' ? '-flow' : ''})`}
              />
              {edge.state === 'flow' && animateEdges && (
                <>
                  <circle className="wf-edge-dot" r="4">
                    <animateMotion dur="1s" repeatCount="indefinite" path={edge.d} />
                  </circle>
                  {flowLabel ? (
                    <text className="wf-edge-label" x={edge.mid.x} y={edge.mid.y - 12} textAnchor="middle">{flowLabel}</text>
                  ) : null}
                </>
              )}
            </g>
          ))}
        </svg>

        {(nodes || []).map((node) => {
          const drag = dragRef.current;
          const pos = drag?.kind === 'node' && drag.id === node.id ? drag.cur : normalizeNodePosition(node.position);
          const meta = nodeTypeMeta[node.type] || {};
          const st = nodeStates[node.id];
          const invalid = invalidIds.includes(node.id);
          const chainIndex = chain.findIndex(n => n.id === node.id);
          return (
            <div
              key={node.id}
              ref={(el) => { if (el) nodeElMap.current.set(node.id, el); else nodeElMap.current.delete(node.id); }}
              className={`wf-node tone-${meta.tone || 'slate'} ${selectedId === node.id ? 'selected' : ''} ${node.enabled === false ? 'disabled' : ''} ${st === 'running' ? 'sim-running' : ''} ${st === 'done' ? 'sim-done' : ''} ${st === 'skipped' ? 'sim-skipped' : ''} ${invalid ? 'sim-invalid' : ''}`}
              style={{ left: pos.x, top: pos.y, width: WF_NODE_W }}
              onPointerDown={event => onNodePointerDown(event, node)}
              onPointerMove={onNodePointerMove}
              onPointerUp={onNodePointerUp}
              onPointerCancel={onNodePointerUp}
              onClick={event => event.stopPropagation()}
              title={`${meta.label || node.type} · ${node.title}${invalid ? ' · ⚠ 缺少必填配置' : ''}`}
            >
              <header className="wf-node-head">
                <span className="wf-node-index">{node.enabled === false ? '--' : String(chainIndex + 1).padStart(2, '0')}</span>
                <span className="wf-node-type">{meta.label || node.type}</span>
                {st === 'running' && <span className="wf-node-off sim-tag">运行中</span>}
                {st === 'done' && <span className="wf-node-off sim-tag done">✓</span>}
                {st === 'skipped' && <span className="wf-node-off sim-tag skipped">跳过</span>}
                {invalid && !st && <span className="wf-node-off sim-tag invalid">!</span>}
                {node.enabled === false && <span className="wf-node-off">停用</span>}
              </header>
              <strong className="wf-node-title">{node.title}</strong>
              <p className="wf-node-role">{node.role}</p>
              <footer className="wf-node-io">
                <span>in: {node.inputKey}</span>
                <span className="wf-node-io-arrow">→</span>
                <span>out: {node.outputKey}</span>
              </footer>
              {simOutputs[node.id] && <div className="wf-node-sim">{simOutputs[node.id]}</div>}
              {st === 'running' && <span className="wf-node-progress" aria-hidden="true" />}
              <span className="wf-port wf-port-in" aria-hidden="true" />
              <span className="wf-port wf-port-out" aria-hidden="true" />
              {node.enabled !== false && chainIndex === chain.length - 1 && chain.length > 1 && <span className="wf-flag-end">终</span>}
              {/* 节点快捷工具条：选中且非拖拽中时浮现在节点上方 */}
              {selectedId === node.id && !nodeDragActive && (onDuplicateNode || onRemoveNode) && (
                <span className="wf-node-toolbar" onPointerDown={event => event.stopPropagation()}>
                  {onDuplicateNode && (
                    <button type="button" onClick={() => onDuplicateNode(node.id)} title="复制节点（含配置）">⧉ 复制</button>
                  )}
                  {onRemoveNode && (
                    <button type="button" className="danger" onClick={() => onRemoveNode(node.id)} title="删除节点">✕</button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 节点面板：拖拽到画布，或单击在视口中心创建；可收起成窄条 */}
      {paletteOpen ? (
        <aside className="wf-palette" onPointerDown={event => event.stopPropagation()}>
          <div className="wf-palette-label">
            节点 · 拖入或点击
            {onSetPaletteOpen && (
              <button type="button" className="wf-palette-collapse" onClick={() => onSetPaletteOpen(false)} title="收起节点面板">»</button>
            )}
          </div>
          <div className="wf-palette-list custom-scrollbar">
            {paletteTypes.map(([type, meta]) => (
              <button
                type="button"
                key={type}
                className="wf-palette-item"
                draggable
                onDragStart={event => {
                  event.dataTransfer.setData('application/x-wf-node-type', type);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => createAtViewCenter(type)}
                title={`${meta.label}：点击在画布中央创建，或拖到任意位置`}
              >
                <span className="wf-palette-dot" style={{ background: meta.color || 'var(--accent-cyan)' }} />
                {meta.label}
                <span className="wf-palette-plus">+</span>
              </button>
            ))}
          </div>
        </aside>
      ) : onSetPaletteOpen && (
        <button
          type="button"
          className="wf-palette-rail"
          onPointerDown={event => event.stopPropagation()}
          onClick={() => onSetPaletteOpen(true)}
          title="展开节点面板"
        >
          <span className="wf-palette-rail-icon">‹</span>
          <span className="wf-palette-rail-text">节点面板</span>
        </button>
      )}

      {/* 视图控制条 */}
      <div className="wf-zoombar" onPointerDown={event => event.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(viewRef.current.z / 1.2, null, null, true)} title="缩小">−</button>
        <span className="wf-zoom-value" ref={zoomLabelRef}>100%</span>
        <button type="button" onClick={() => zoomAt(viewRef.current.z * 1.2, null, null, true)} title="放大">+</button>
        <button type="button" onClick={() => fitView(true)} title="适应视图（F）">⤢</button>
        <button type="button" onClick={() => animateTo({ x: 40, y: 40, z: 1 })} title="重置视图（0）">⟲</button>
      </div>

      {nodes.length === 0 && (
        <div className="wf-empty-hint">
          <b>画布是空的</b>
          <span>从左侧拖入节点，或双击空白处快速创建；也可以打开右侧「AI 搭建」用一句话生成整条链路。</span>
        </div>
      )}

      {/* 页面级浮层（工作流名 / 动作 / 节点配置卡） */}
      {children}
    </div>
  );
}
