/**
 * MaterialGraph.jsx - 素材库知识图谱（力导向 2D，v22 可读性升级）
 *
 * v22 升级点（解决「节点只是球体、难获取信息、查找不便」）：
 * 1. 全局统筹：顶部统计条 + 枢纽节点 TOP 列表（度数排序，点击即定位）+ 一键适配视图
 * 2. 关联度呈现：节点大小 = 连接度数；素材间共享 ≥2 标签画「强关联」直连边（越粗越强）
 * 3. 信息可读：枢纽/悬停/邻居节点常驻文字标签（可全开）；hover tooltip 保留
 * 4. 快速定位：图内搜索框（标题/标签匹配 → 高亮 + 镜头聚焦）；类型筛选 chips
 *
 * 数据构造 buildGraphData / topHubs 是纯函数（可单测），组件只负责渲染。
 */
import React, { useMemo, useState, useRef, useLayoutEffect, useCallback, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { MATERIAL_TYPES } from '../constants/index.jsx';
import { buildGraphData, topHubs, TYPE_COLORS } from '../domain/graphEngine.js';

/**
 * 从当前 CSS 主题读取真实色值（canvas 的 fillStyle 不认 var()，必须取解析值）。
 * 浅色模式各调色板没有提供 `--accent-*`（节点填充色）的浅色覆盖，会回退到深色值
 * （如 arctic 近白、champagne 金）导致节点在浅背景上不可见 / 低对比。
 * 因此优先读取专为知识图谱定义的高对比 `--graph-node-*`，缺失时再回退 `--accent-*`
 * （深色模式沿用旧逻辑）与内置常量。
 *
 * 色键与 MATERIAL_TYPES 完全对齐：viewpoint / case / quote / data / chart / project + default
 * @returns {Object} { typeColors, tag, edge, edgeDim, nodeDim, label }
 */
function readThemeColors() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name, fallback) => {
    const val = cs.getPropertyValue(name).trim();
    return val || fallback;
  };
  // 节点填充色：--graph-node-* 优先，否则 --accent-*，否则内置常量（深色模式走这条）
  const nodeColor = (graphVar, accentVar, typeKey) =>
    v(graphVar) || v(accentVar, TYPE_COLORS[typeKey]);
  return {
    typeColors: {
      viewpoint: nodeColor('--graph-node-viewpoint', '--accent-cyan', 'viewpoint'),
      case:     nodeColor('--graph-node-case', '--accent-emerald', 'case'),
      quote:    nodeColor('--graph-node-quote', '--accent-amber', 'quote'),
      data:     nodeColor('--graph-node-data', '--accent-violet', 'data'),
      chart:    nodeColor('--graph-node-chart', '--accent-blue', 'chart'),
      project:  nodeColor('--graph-node-project', '--accent-rose', 'project'),
      default:  v('--text-muted', TYPE_COLORS.default),
      file:     v('--graph-node-file', '--accent-amber', 'file'),
    },
    tag: v('--text-muted', 'rgba(148,163,184,0.85)'),
    edge: v('--border-color', 'rgba(148,163,184,0.35)'),
    edgeDim: v('--accent-cyan-soft', 'rgba(74,123,167,0.08)'),
    nodeDim: v('--accent-cyan-soft', 'rgba(74,123,167,0.12)'),
    label: v('--text-primary', '#e2e8f0'),
    labelHalo: v('--bg-card', 'rgba(10,14,20,0.75)'),
    accent: v('--accent-cyan', '#4ac7f5'),
  };
}

const NODE_RADIUS = 5;
// v26 Bug#11：默认参数 `files = []` 每次渲染都生成新数组引用 → data useMemo 每次重建
// → ForceGraph2D 拿到新 graphData 即重新加热模拟 → 悬停节点乱跑。改用模块级常量稳定引用。
const EMPTY_FILES = [];

/**
 * 知识图谱组件。
 * react-force-graph-2d 的 width/height 必须是数字（画布像素），不接受 "100%"。
 * 这里用容器 ref + ResizeObserver 测实际像素宽，传给 ForceGraph2D。
 * @param {Array} props.materials 素材列表
 * @param {Array} props.files 本地空间文件
 * @param {Function} props.onOpenMaterial (material) => void  点击素材回调
 * @param {number} [props.height] 渲染高度
 */
export default function MaterialGraph({ materials, files = EMPTY_FILES, onOpenMaterial, height = 520 }) {
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showAllLabels, setShowAllLabels] = useState(false);
  const boxRef = useRef(null);
  const fgRef = useRef(null);
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

  // 类型筛选 → 只把命中的素材送进图
  const filteredMaterials = useMemo(() => {
    if (typeFilter === 'all') return materials;
    return (materials || []).filter(m => (m.type || 'default') === typeFilter);
  }, [materials, typeFilter]);

  const data = useMemo(() => buildGraphData(filteredMaterials, { files }), [filteredMaterials, files]);
  const hubs = useMemo(() => topHubs(data, 6), [data]);
  const stats = useMemo(() => ({
    materials: data.nodes.filter(n => n.kind === 'material').length,
    tags: data.nodes.filter(n => n.kind === 'tag').length,
    files: data.nodes.filter(n => n.kind === 'file').length,
    strongLinks: data.links.filter(l => l.kind === 'strong').length,
    links: data.links.length,
  }), [data]);

  // 搜索匹配集合：标题/标签包含关键词的节点（高亮显示，其余变淡）
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const ids = new Set();
    for (const n of data.nodes) {
      const text = n.kind === 'tag'
        ? `#${n.tag}`
        : n.kind === 'file'
          ? (n.file?.name || n.file?.path || '')
          : (n.material?.title || '');
      if (String(text).toLowerCase().includes(q)) ids.add(n.id);
    }
    return ids;
  }, [query, data.nodes]);

  // 定位：镜头聚焦到节点
  const locateNode = useCallback((nodeOrId) => {
    const id = typeof nodeOrId === 'object' ? nodeOrId?.id : nodeOrId;
    const node = data.nodes.find(n => n.id === id);
    if (!node || !fgRef.current) return;
    setFocused(node.id);
    const fg = fgRef.current;
    if (node.x != null) {
      fg.centerAt(node.x, node.y, 800);
      fg.zoom(2.2, 800);
    } else {
      // 布局未稳定时先飞一次，冷却结束后再校正
      setTimeout(() => { if (node.x != null) { fg.centerAt(node.x, node.y, 600); fg.zoom(2.2, 600); } }, 1200);
    }
  }, [data.nodes]);

  // 搜索回车 / 枢纽点击 → 定位
  const handleSearch = useCallback((e) => {
    e?.preventDefault?.();
    if (!matchIds || !matchIds.size) return;
    locateNode(matchIds.values().next().value);
  }, [matchIds, locateNode]);

  // 类型筛选变化后重新适配视图
  useEffect(() => {
    const t = setTimeout(() => fgRef.current?.zoomToFit(400, 40), 900);
    return () => clearTimeout(t);
  }, [typeFilter]);

  // v26 Bug#11：数据变化后只在引擎首次停下时适配视图一次；
  // 旧写法 onEngineStop 每次都 zoomToFit，与重加热循环叠加导致镜头乱滚。
  const fittedRef = useRef(false);
  useEffect(() => { fittedRef.current = false; }, [data]);

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
    if (matchIds && !matchIds.has(node.id)) return themeColors.nodeDim;
    if (highlightNodeIds && !highlightNodeIds.has(node.id) && !matchIds?.has(node.id)) return themeColors.nodeDim;
    if (node.kind === 'tag') return themeColors.tag;
    return themeColors.typeColors[node.group] || themeColors.typeColors.default;
  };

  const linkColor = (link) => {
    const s = typeof link.source === 'object' ? link.source.id : link.source;
    const t = typeof link.target === 'object' ? link.target.id : link.target;
    if (highlightNodeIds && (!highlightNodeIds.has(s) || !highlightNodeIds.has(t))) {
      return themeColors.edgeDim;
    }
    return link.kind === 'strong' ? themeColors.accent : themeColors.edge;
  };

  const linkWidth = (link) => {
    if (link.kind === 'strong') return Math.min(4, 1 + (link.strength - 1) * 0.8);
    return 1;
  };

  const nodeLabel = (n) => (n.kind === 'tag' ? `#${n.tag}（${n.degree} 关联）` : n.kind === 'file' ? `📄 ${n.file?.path || n.file?.name || '本地文件'}` : `${n.material?.title || '素材'}（${n.degree} 关联）`);

  /** 判断节点是否值得常驻显示标签 */
  const shouldLabel = useCallback((node, globalScale) => {
    if (showAllLabels && globalScale > 0.65) return true;
    if (hovered && hovered === node.id) return true;
    if (matchIds?.has(node.id)) return true;
    if (highlightNodeIds?.has(node.id)) return true;
    if (node.kind === 'tag') return node.degree >= 4;
    if (node.kind === 'material') return node.degree >= 5;
    return false;
  }, [showAllLabels, hovered, matchIds, highlightNodeIds]);

  /** 自绘节点：圆形 + 常驻标签（描边光晕保证可读） */
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const isDim = (matchIds && !matchIds.has(node.id))
      || (highlightNodeIds && !highlightNodeIds.has(node.id) && !matchIds?.has(node.id));
    const color = isDim ? themeColors.nodeDim
      : node.kind === 'tag' ? themeColors.tag
        : (themeColors.typeColors[node.group] || themeColors.typeColors.default);
    const r = NODE_RADIUS * Math.sqrt(node.val || 2) * 0.75;

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    // 强关联枢纽加描边强调
    ctx.lineWidth = (node.degree >= 6 && !isDim) ? 1.6 / globalScale : 0.6 / globalScale;
    ctx.strokeStyle = (node.degree >= 6 && !isDim) ? themeColors.accent : color;
    ctx.fill();
    ctx.stroke();

    if (shouldLabel(node, globalScale)) {
      const text = node.kind === 'tag' ? `#${node.tag}`
        : node.kind === 'file' ? `📄 ${node.file?.name || '本地文件'}`
          : String(node.material?.title || '素材').slice(0, 18);
      const fontSize = Math.max(11 / globalScale, 2.6);
      ctx.font = `${node.kind === 'tag' ? '600' : '500'} ${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ty = node.y + r + 1.5;
      const tw = ctx.measureText(text).width;
      // 光晕底：提升浅色主题可读性
      ctx.fillStyle = themeColors.labelHalo;
      ctx.globalAlpha = isDim ? 0.35 : 0.72;
      ctx.fillRect(node.x - tw / 2 - 2, ty - 1, tw + 4, fontSize + 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = isDim ? themeColors.nodeDim : themeColors.label;
      ctx.fillText(text, node.x, ty);
    }
  }, [matchIds, highlightNodeIds, themeColors, shouldLabel]);

  const typeChips = useMemo(() => Object.entries(MATERIAL_TYPES || {}), []);

  return (
    <div className="material-graph" ref={boxRef} style={{ position: 'relative', height }}>
      {/* v22 图谱工具条：统计 + 搜索 + 类型筛选 + 标签开关 + 适配视图 */}
      <div className="material-graph-toolbar">
        <div className="material-graph-stats">
          <span>{stats.materials} 素材</span>
          <span>{stats.tags} 标签</span>
          {stats.files > 0 && <span>{stats.files} 文件</span>}
          <span>{stats.links} 关联{stats.strongLinks > 0 ? `（强 ${stats.strongLinks}）` : ''}</span>
        </div>
        <form className="material-graph-search" onSubmit={handleSearch}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索标题 / #标签 定位节点…"
            aria-label="搜索知识图谱节点"
          />
          {query && <button type="button" className="material-graph-search-clear" onClick={() => setQuery('')}>×</button>}
        </form>
        <div className="material-graph-actions">
          <button
            type="button"
            className={showAllLabels ? 'active' : ''}
            onClick={() => setShowAllLabels(v => !v)}
            title="全部节点显示文字标签"
          >
            {showAllLabels ? '标签：全开' : '标签：自动'}
          </button>
          <button type="button" onClick={() => fgRef.current?.zoomToFit(400, 40)} title="缩放至全图可见">适配视图</button>
        </div>
      </div>
      <div className="material-graph-filters">
        <button type="button" className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>全部类型</button>
        {typeChips.map(([type, label]) => (
          <button key={type} type="button" className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)}>{label}</button>
        ))}
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={width}
        height={height}
        nodeRelSize={NODE_RADIUS}
        nodeVal={(n) => n.val}
        nodeColor={nodeColor}
        nodeCanvasObject={nodeCanvasObject}
        nodeLabel={nodeLabel}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.45}
        cooldownTicks={120}
        onNodeHover={(n) => setHovered(n ? n.id : null)}
        onNodeClick={handleNodeClick}
        onEngineStop={() => {
          if (!fittedRef.current) {
            fittedRef.current = true;
            fgRef.current?.zoomToFit(400, 40);
          }
        }}
      />

      {/* v22 枢纽节点：全局统筹视角的「最关键节点」，点击定位 */}
      {hubs.length > 0 && (
        <div className="material-graph-hubs">
          <span className="material-graph-hubs-title">枢纽节点</span>
          {hubs.map(hub => (
            <button
              key={hub.id}
              type="button"
              onClick={() => locateNode(hub.id)}
              title={`${hub.label} · ${hub.degree} 关联（点击定位）`}
            >
              <i style={{ background: hub.kind === 'tag' ? themeColors.tag : (themeColors.typeColors[hub.group] || themeColors.tag) }} />
              {hub.kind === 'tag' ? `#${hub.label.slice(1)}` : hub.label.slice(0, 10)}
              <em>{hub.degree}</em>
            </button>
          ))}
        </div>
      )}

      <div className="material-graph-legend">
        {Object.entries(themeColors.typeColors).filter(([k]) => k !== 'default' && k !== 'file').map(([type, color]) => (
          <span key={type} className="material-graph-legend-item">
            <span className="dot" style={{ background: color }} />
            {MATERIAL_TYPES[type] || type}
          </span>
        ))}
        <span className="material-graph-legend-item"><span className="dot" style={{ background: themeColors.tag }} />标签</span>
        <span className="material-graph-legend-item"><span className="dot" style={{ background: themeColors.typeColors.file }} />本地文件</span>
        <span className="material-graph-legend-item"><span className="line" style={{ background: themeColors.accent }} />强关联（共享≥2标签）</span>
      </div>
    </div>
  );
}
