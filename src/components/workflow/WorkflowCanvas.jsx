/**
 * WorkflowCanvas - 无限画布（对标 Dify / n8n 的工作流编辑器形态）
 *
 * 能力：
 * - 无限视口：背景拖拽平移 + 滚轮以光标为中心缩放（0.4x-1.6x）+ 缩放控制条
 * - 节点自由拖拽：按住节点移动，mouseup 提交 position（随 workflowStore 持久化）
 * - 连线可视化：按执行顺序绘制 SVG 贝塞尔连线（in 端口 → out 端口），
 *   与 workflowEngine 的顺序执行语义一致——边的拓扑即节点数组顺序
 * - 节点面板（palette）：拖拽节点类型到画布任意位置创建节点
 * - 点选节点 → 浮动 inspector 编辑配置；点击空白取消选择
 *
 * 纯 UI 层：坐标换算（screen↔world）为纯函数，业务提交全部通过回调上抛。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeNodePosition } from '../../constants/workflowConstants.js';

export const WF_NODE_W = 240;
export const WF_NODE_H = 118;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const WORLD_W = 4000;
const WORLD_H = 3000;

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
}) {
  const viewportRef = useRef(null);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [zoom, setZoom] = useState(1);
  const [ghost, setGhost] = useState(null);   // 拖拽中的节点临时坐标 { id, x, y }
  const ghostRef = useRef(null);              // mouseup 里读取最新 ghost（避免闭包旧值）
  const dragRef = useRef(null);               // { kind:'node'|'pan', ... }

  const setGhostBoth = useCallback((value) => {
    ghostRef.current = value;
    setGhost(value);
  }, []);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    ghostRef.current = null;
    setGhost(null);
  }, []);

  /** 全局 mousemove/mouseup：拖拽期间靠 dragRef 判空，未拖拽时零开销 */
  useEffect(() => {
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag || !viewportRef.current) return;
      if (drag.kind === 'pan') {
        setPan({
          x: drag.startPanX + (event.clientX - drag.startClientX),
          y: drag.startPanY + (event.clientY - drag.startClientY),
        });
      } else if (drag.kind === 'node') {
        const rect = viewportRef.current.getBoundingClientRect();
        const world = screenToWorld(event.clientX, event.clientY, rect, drag.startPan, drag.startZoom);
        setGhostBoth({
          id: drag.id,
          x: Math.round(drag.origX + world.x - drag.grabWorldX),
          y: Math.round(drag.origY + world.y - drag.grabWorldY),
        });
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (drag?.kind === 'node' && ghostRef.current) {
        onMoveNode(ghostRef.current.id, ghostRef.current.x, ghostRef.current.y);
      }
      stopDrag();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onMoveNode, setGhostBoth, stopDrag]);

  const onViewportMouseDown = useCallback((event) => {
    // 只处理主键；点在节点/面板上时事件已被 stopPropagation
    if (event.button !== 0) return;
    dragRef.current = { kind: 'pan', startClientX: event.clientX, startClientY: event.clientY, startPanX: pan.x, startPanY: pan.y };
    onSelect(null);
  }, [pan.x, pan.y, onSelect]);

  const onNodeMouseDown = useCallback((event, node) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = viewportRef.current.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect, pan, zoom);
    const pos = normalizeNodePosition(node.position);
    dragRef.current = {
      kind: 'node',
      id: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: pan,
      startZoom: zoom,
      origX: pos.x,
      origY: pos.y,
      grabWorldX: world.x,
      grabWorldY: world.y,
    };
    onSelect(node.id);
  }, [pan, zoom, onSelect]);

  /** 滚轮缩放：以光标为中心，缩放前后光标指向同一世界点 */
  const onWheel = useCallback((event) => {
    event.preventDefault();
    const rect = viewportRef.current.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const nextZoom = clamp(zoom * (event.deltaY < 0 ? 1.1 : 0.9), ZOOM_MIN, ZOOM_MAX);
    const wx = (mx - pan.x) / zoom;
    const wy = (my - pan.y) / zoom;
    setPan({ x: mx - wx * nextZoom, y: my - wy * nextZoom });
    setZoom(nextZoom);
  }, [pan, zoom]);

  /** palette 拖放创建：落点换算为世界坐标并居中 */
  const onDropCreate = useCallback((event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-wf-node-type');
    if (!type || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect, pan, zoom);
    onCreateNodeAt(type, Math.round(world.x - WF_NODE_W / 2), Math.round(world.y - WF_NODE_H / 2));
  }, [pan, zoom, onCreateNodeAt]);

  const resetView = useCallback(() => { setPan({ x: 24, y: 24 }); setZoom(1); }, []);

  // 连线（按数组顺序 = 执行顺序）
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = normalizeNodePosition(nodes[i].position);
    const to = normalizeNodePosition(nodes[i + 1].position);
    edges.push({ id: `${nodes[i].id}->${nodes[i + 1].id}`, d: edgePath(from, to) });
  }

  const paletteTypes = Object.entries(nodeTypeMeta);

  return (
    <div
      className="wf-canvas"
      ref={viewportRef}
      onMouseDown={onViewportMouseDown}
      onWheel={onWheel}
      onDragOver={event => event.preventDefault()}
      onDrop={onDropCreate}
      role="application"
      aria-label="工作流无限画布"
    >
      {/* 世界层：pan+zoom 变换，网格背景随缩放 */}
      <div
        className="wf-world"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <svg className="wf-edges" width={WORLD_W} height={WORLD_H} aria-hidden="true">
          {edges.map(edge => <path key={edge.id} className="wf-edge" d={edge.d} />)}
        </svg>
        {nodes.map((node, index) => {
          const pos = ghost?.id === node.id ? ghost : normalizeNodePosition(node.position);
          const meta = nodeTypeMeta[node.type] || {};
          return (
            <div
              key={node.id}
              className={`wf-node tone-${meta.tone || 'slate'} ${selectedId === node.id ? 'selected' : ''} ${node.enabled === false ? 'disabled' : ''}`}
              style={{ left: pos.x, top: pos.y, width: WF_NODE_W }}
              onMouseDown={event => onNodeMouseDown(event, node)}
              onClick={event => event.stopPropagation()}
              title={`${meta.label || node.type} · ${node.title}`}
            >
              <header className="wf-node-head">
                <span className="wf-node-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="wf-node-type">{meta.label || node.type}</span>
                {node.enabled === false && <span className="wf-node-off">停用</span>}
              </header>
              <strong className="wf-node-title">{node.title}</strong>
              <p className="wf-node-role">{node.role}</p>
              <footer className="wf-node-io">
                <span>in: {node.inputKey}</span>
                <span className="wf-node-io-arrow">→</span>
                <span>out: {node.outputKey}</span>
              </footer>
              <span className="wf-port wf-port-in" aria-hidden="true" />
              <span className="wf-port wf-port-out" aria-hidden="true" />
              {index === nodes.length - 1 && nodes.length > 1 && <span className="wf-flag-end">终</span>}
            </div>
          );
        })}
      </div>

      {/* 节点面板：拖到画布创建 */}
      <aside className="wf-palette" onMouseDown={event => event.stopPropagation()}>
        <div className="wf-palette-label">节点</div>
        {paletteTypes.map(([type, meta]) => (
          <div
            key={type}
            className="wf-palette-item"
            draggable
            onDragStart={event => {
              event.dataTransfer.setData('application/x-wf-node-type', type);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            title={`${meta.label}：拖到画布任意位置创建`}
          >
            <span className="wf-palette-dot" style={{ background: meta.color || 'var(--accent-cyan)' }} />
            {meta.label}
          </div>
        ))}
      </aside>

      {/* 缩放控制条 */}
      <div className="wf-zoombar" onMouseDown={event => event.stopPropagation()}>
        <button type="button" onClick={() => setZoom(z => clamp(z * 0.9, ZOOM_MIN, ZOOM_MAX))} title="缩小">−</button>
        <span className="wf-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(z => clamp(z * 1.1, ZOOM_MIN, ZOOM_MAX))} title="放大">+</button>
        <button type="button" onClick={resetView} title="重置视图">⟲</button>
      </div>

      {nodes.length === 0 && (
        <div className="wf-empty-hint">从左侧面板拖拽节点到画布，开始搭建工作流</div>
      )}

      {/* 页面级浮层（工作流名 / 动作 / 节点配置卡） */}
      {children}
    </div>
  );
}
