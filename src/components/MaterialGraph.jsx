/**
 * MaterialGraph.jsx - 素材库知识图谱（力导向 2D）
 *
 * 用 react-force-graph-2d 把素材库渲染成可探索的动态关系网络：
 * - 节点：素材（圆形，按 type 着色）/ 标签（tag 小节点）
 * - 边：素材 ↔ 共享标签
 * - 交互：点击素材打开 lightbox / 跳转；hover 高亮邻居；拖拽拉动能查
 *
 * 数据构造 buildGraphData 是纯函数（可单测），组件只负责渲染。
 */
import React, { useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { MATERIAL_TYPES } from '../constants/index.jsx';
import { buildGraphData, TYPE_COLORS } from '../domain/graphEngine.js';

/**
 * 从当前 CSS 主题读取真实色值（canvas 的 fillStyle 不认 var()，必须取解析值）。
 * @returns {Object} { typeColors, tag, edge, edgeDim, nodeDim, label }
 */
function readThemeColors() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name, fallback) => {
    const val = cs.getPropertyValue(name).trim();
    return val || fallback;
  };
  return {
    typeColors: {
      viewpoint: v('--accent-cyan', TYPE_COLORS.viewpoint),
      case: v('--accent-emerald', TYPE_COLORS.case),
      knowledge: v('--accent-amber', TYPE_COLORS.knowledge),
      material: v('--accent-violet', TYPE_COLORS.material),
      default: v('--text-muted', TYPE_COLORS.default),
    },
    tag: v('--text-muted', 'rgba(148,163,184,0.85)'),
    edge: v('--border-color', 'rgba(148,163,184,0.35)'),
    edgeDim: v('--accent-cyan-soft', 'rgba(74,123,167,0.08)'),
    nodeDim: v('--accent-cyan-soft', 'rgba(74,123,167,0.12)'),
  };
}

/**
 * 知识图谱组件。
 * react-force-graph-2d 的 width/height 必须是数字（画布像素），不接受 "100%"。
 * 这里用容器 ref + ResizeObserver 测实际像素宽，传给 ForceGraph2D。
 * @param {Array} props.materials 素材列表
 * @param {Function} props.onOpenMaterial (material) => void  点击素材回调
 * @param {number} [props.height] 渲染高度
 */
export default function MaterialGraph({ materials, onOpenMaterial, height = 520 }) {
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const boxRef = useRef(null);
  const [width, setWidth] = useState(600);
  // 主题色（随深浅主题实时刷新，触发重渲染）
  const [themeColors, setThemeColors] = useState(() => readThemeColors());

  // 监听 html[data-mode]/[data-palette] 变化 → 重读主题色 → 触发 ForceGraph 重绘
  useLayoutEffect(() => {
    const update = () => setThemeColors(readThemeColors());
    const root = document.documentElement;
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(update);
      mo.observe(root, { attributes: true, attributeFilter: ['data-mode', 'data-palette'] });
      return () => mo.disconnect();
    }
    // fallback：监听旧的主题类切换（部分主题可能用 class）
    window.addEventListener('themechange', update);
    return () => window.removeEventListener('themechange', update);
  }, []);

  // 测容器实际宽度（数字像素），随窗口缩放响应
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 600);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const data = useMemo(() => buildGraphData(materials), [materials]);
  const handleNodeClick = useCallback((n) => {
    setFocused(n ? n.id : null);
    if (n && n.kind === 'material' && n.material && onOpenMaterial) onOpenMaterial(n.material);
  }, [onOpenMaterial]);

  // 高亮：悬停/聚焦节点时，其邻居边加亮，其余变淡
  const highlight = hovered || focused;
  const highlightNodeIds = useMemo(() => {
    if (!highlight) return null;
    const ids = new Set([highlight]);
    for (const l of data.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === highlight) ids.add(t);
      if (t === highlight) ids.add(s);
    }
    return ids;
  }, [highlight, data.links]);

  const nodeColor = (node) => {
    if (highlightNodeIds && !highlightNodeIds.has(node.id)) return themeColors.nodeDim;
    if (node.kind === 'tag') return themeColors.tag;
    return themeColors.typeColors[node.group] || themeColors.typeColors.default;
  };

  const linkColor = (link) => {
    const s = typeof link.source === 'object' ? link.source.id : link.source;
    const t = typeof link.target === 'object' ? link.target.id : link.target;
    if (highlightNodeIds && (!highlightNodeIds.has(s) || !highlightNodeIds.has(t))) {
      return themeColors.edgeDim;
    }
    return themeColors.edge;
  };

  return (
    <div className="material-graph" ref={boxRef} style={{ position: 'relative', height }}>
      <ForceGraph2D
        graphData={data}
        width={width}
        height={height}
        nodeRelSize={5}
        nodeVal={(n) => (n.kind === 'tag' ? Math.max(2, n.val * 1.2) : 4)}
        nodeColor={nodeColor}
        nodeLabel={(n) => (n.kind === 'tag' ? `#${n.tag}` : (n.material?.title || '素材'))}
        linkColor={linkColor}
        linkOpacity={0.4}
        linkWidth={1}
        cooldownTicks={120}
        onNodeHover={(n) => setHovered(n ? n.id : null)}
        onNodeClick={handleNodeClick}
      />
      <div className="material-graph-legend">
        {Object.entries(themeColors.typeColors).filter(([k]) => k !== 'default').map(([type, color]) => (
          <span key={type} className="material-graph-legend-item">
            <span className="dot" style={{ background: color }} />
            {MATERIAL_TYPES[type] || type}
          </span>
        ))}
        <span className="material-graph-legend-item"><span className="dot" style={{ background: themeColors.tag }} />标签</span>
      </div>
    </div>
  );
}