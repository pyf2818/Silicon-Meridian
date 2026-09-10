/**
 * pixelArt.jsx - 像素美术共享件（v26 #15/#17/#18）
 * TeamOfficePanel（侧栏监控）与 OfficeGame（养成游戏大屏）共用：
 * - PixelPerson：像素小人（描边剪影 + 发型变体 + 领子/腰带 + 两帧腿臂走路）
 * - PixelDesk：像素工位（执行中屏幕闪烁）
 * - PixelFurniture：可摆放家具（绿植/落地灯/饮水机/文件柜/书架）
 * 状态语义见 domain/agent/officeScene.js；动画类名约定见 styles.css ofc-* 段。
 */

/** 像素小人：hue 决定服色/发色，variant 决定发型变体，pose 由 status 驱动 */
export function PixelPerson({ hue, status, variant = 0, width = 28 }) {
  const suit = `hsl(${hue} 60% 52%)`;
  const suitDark = `hsl(${hue} 55% 38%)`;
  const hair = `hsl(${hue} 42% 26%)`;
  const skin = '#e8b88d';
  const skinDark = '#d3a077';
  const ink = '#20242e';
  const pants = '#39415a';
  const shoe = '#232833';
  const working = status === 'working';
  const claiming = status === 'claiming';
  const v = variant % 3;
  return (
    <svg
      className="ofc-person-svg"
      viewBox="0 0 14 18"
      width={width}
      height={Math.round(width * (18 / 14))}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* 描边剪影（比填充大一圈的深色底） */}
      <rect x="3" y="1" width="8" height="7" fill={ink} />
      <rect x="2" y="7" width="10" height="7" fill={ink} />
      <rect x="4" y="13" width="6" height="5" fill={ink} />
      {/* 头发（三种发型随 variant） */}
      {v === 0 && <><rect x="3" y="1" width="8" height="2" fill={hair} /><rect x="3" y="3" width="1" height="2" fill={hair} /></>}
      {v === 1 && <rect x="3" y="1" width="8" height="3" fill={hair} />}
      {v === 2 && <><rect x="4" y="0" width="6" height="1" fill={hair} /><rect x="3" y="1" width="8" height="2" fill={hair} /></>}
      {/* 脸 */}
      <rect x="4" y="3" width="6" height="4" fill={skin} />
      <rect x="4" y="3" width="6" height="1" fill={skinDark} opacity="0.35" />
      {working
        ? <><rect x="5" y="4" width="2" height="1" fill={ink} /><rect x="8" y="4" width="1" height="1" fill={ink} /></>
        : <><rect x="5" y="4" width="1" height="1" fill={ink} /><rect x="8" y="4" width="1" height="1" fill={ink} /></>}
      {/* 身体：衬衫 + 领子 + 腰带 */}
      <rect x="3" y="8" width="8" height="4" fill={suit} />
      <rect x="6" y="7" width="2" height="2" fill={`hsl(${hue} 60% 68%)`} />
      <rect x="3" y="11" width="8" height="1" fill={ink} />
      {/* 手臂 */}
      {working || claiming ? (
        claiming
          ? <><rect x="1" y="5" width="1" height="3" fill={suitDark} /><rect x="1" y="4" width="1" height="1" fill={skin} /><rect x="12" y="8" width="1" height="4" fill={suitDark} /></>
          : <><rect x="1" y="9" width="2" height="1" fill={suitDark} /><rect x="0" y="9" width="1" height="1" fill={skin} /><rect x="11" y="9" width="2" height="1" fill={suitDark} /><rect x="13" y="9" width="1" height="1" fill={skin} /></>
      ) : (
        <>
          <g className="ofc-arm-a"><rect x="2" y="8" width="1" height="4" fill={suitDark} /><rect x="2" y="12" width="1" height="1" fill={skin} /></g>
          <g className="ofc-arm-b"><rect x="1" y="8" width="1" height="4" fill={suitDark} /><rect x="1" y="12" width="1" height="1" fill={skin} /><rect x="12" y="8" width="1" height="4" fill={suitDark} /><rect x="12" y="12" width="1" height="1" fill={skin} /></g>
        </>
      )}
      {/* 腿（两帧交替） */}
      <g className="ofc-legs-a">
        <rect x="5" y="12" width="2" height="4" fill={pants} />
        <rect x="8" y="12" width="2" height="4" fill={pants} />
        <rect x="5" y="16" width="2" height="1" fill={shoe} />
        <rect x="8" y="16" width="2" height="1" fill={shoe} />
      </g>
      <g className="ofc-legs-b">
        <rect x="4" y="12" width="2" height="4" fill={pants} />
        <rect x="9" y="12" width="2" height="4" fill={pants} />
        <rect x="4" y="16" width="2" height="1" fill={shoe} />
        <rect x="9" y="16" width="2" height="1" fill={shoe} />
      </g>
    </svg>
  );
}

/** 像素工位：显示器（执行中屏幕闪烁）+ 键盘 + 马克杯（成员色） */
export function PixelDesk({ working, hue, width = 40 }) {
  return (
    <svg className="ofc-desk-svg" viewBox="0 0 20 12" width={width} height={Math.round(width * 0.6)} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="0" width="9" height="7" fill="#1c2230" />
      <rect x="7" y="1" width="7" height="5" fill={working ? '#57d0ff' : '#2b3a4d'} />
      {working && <><rect x="8" y="2" width="4" height="1" fill="#b7ecff" className="ofc-screen-flicker" /><rect x="8" y="4" width="5" height="1" fill="#8fd8ff" className="ofc-screen-flicker2" /></>}
      <rect x="9" y="7" width="3" height="1" fill="#1c2230" />
      <rect x="8" y="8" width="5" height="1" fill="#1c2230" />
      <rect x="12" y="9" width="5" height="1" fill="#39415a" />
      <rect x="2" y="8" width="2" height="2" fill={`hsl(${hue} 50% 55%)`} />
      <rect x="4" y="8" width="1" height="1" fill={`hsl(${hue} 50% 55%)`} />
      <rect x="0" y="10" width="20" height="2" fill="#6b4a2b" />
      <rect x="0" y="11" width="20" height="1" fill="#54391f" />
    </svg>
  );
}

/** 像素家具：kind 见 officeGame.js FURNITURE 目录（crispEdges 像素风） */
export function PixelFurniture({ kind, width = 34 }) {
  const ink = '#20242e';
  const wood = '#6b4a2b';
  const woodDark = '#54391f';
  const leaf = '#4f9e58';
  const leafDark = '#3c7a44';
  const metal = '#8a94a8';
  const common = {
    className: 'ogame-furn-svg',
    viewBox: '0 0 20 24',
    width,
    height: Math.round(width * (24 / 20)),
    shapeRendering: 'crispEdges',
    'aria-hidden': true,
  };
  if (kind === 'plant') {
    return (
      <svg {...common}>
        <rect x="9" y="2" width="2" height="3" fill={leafDark} />
        <rect x="5" y="4" width="4" height="2" fill={leaf} />
        <rect x="11" y="4" width="4" height="2" fill={leaf} />
        <rect x="7" y="6" width="6" height="2" fill={leafDark} />
        <rect x="9" y="8" width="2" height="4" fill="#3f6b34" />
        <rect x="6" y="12" width="8" height="7" fill="#b06a3a" />
        <rect x="6" y="12" width="8" height="1" fill={ink} />
        <rect x="5" y="19" width="10" height="2" fill="#8f5227" />
      </svg>
    );
  }
  if (kind === 'lamp') {
    return (
      <svg {...common}>
        <rect x="6" y="1" width="8" height="4" fill="#e8c46a" />
        <rect x="6" y="1" width="8" height="1" fill={ink} />
        <rect x="5" y="5" width="10" height="1" fill={ink} />
        <rect x="9" y="6" width="2" height="13" fill={metal} />
        <rect x="4" y="19" width="12" height="3" fill="#39415a" />
        <rect x="4" y="19" width="12" height="1" fill={ink} />
        <rect x="8" y="8" width="4" height="2" fill="#f7e6a8" opacity="0.55" />
      </svg>
    );
  }
  if (kind === 'cooler') {
    return (
      <svg {...common}>
        <rect x="5" y="1" width="10" height="7" fill="#7ec9e8" />
        <rect x="5" y="1" width="10" height="1" fill={ink} />
        <rect x="5" y="7" width="10" height="1" fill="#5aa8c4" />
        <rect x="4" y="8" width="12" height="11" fill="#e2e6ee" />
        <rect x="4" y="8" width="12" height="1" fill={ink} />
        <rect x="4" y="18" width="12" height="1" fill={ink} />
        <rect x="8" y="11" width="1" height="2" fill="#39415a" />
        <rect x="11" y="11" width="1" height="2" fill="#39415a" />
        <rect x="4" y="19" width="12" height="2" fill="#39415a" />
      </svg>
    );
  }
  if (kind === 'cabinet') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="14" height="17" fill="#9aa2b4" />
        <rect x="3" y="3" width="14" height="1" fill={ink} />
        <rect x="3" y="19" width="14" height="1" fill={ink} />
        <rect x="3" y="9" width="14" height="1" fill={ink} />
        <rect x="3" y="14" width="14" height="1" fill={ink} />
        <rect x="8" y="6" width="4" height="1" fill="#39415a" />
        <rect x="8" y="11" width="4" height="1" fill="#39415a" />
        <rect x="8" y="16" width="4" height="1" fill="#39415a" />
        <rect x="2" y="20" width="16" height="2" fill="#39415a" />
      </svg>
    );
  }
  // bookshelf
  return (
    <svg {...common}>
      <rect x="2" y="1" width="16" height="20" fill={wood} />
      <rect x="2" y="1" width="16" height="1" fill={ink} />
      <rect x="2" y="20" width="16" height="1" fill={ink} />
      <rect x="3" y="6" width="14" height="1" fill={woodDark} />
      <rect x="3" y="13" width="14" height="1" fill={woodDark} />
      <rect x="4" y="2" width="2" height="4" fill="#c95c5c" />
      <rect x="6" y="3" width="2" height="3" fill="#5c8ac9" />
      <rect x="8" y="2" width="2" height="4" fill="#5cb87a" />
      <rect x="4" y="8" width="2" height="5" fill="#c9a95c" />
      <rect x="6" y="9" width="2" height="4" fill="#8a5cc9" />
      <rect x="4" y="15" width="2" height="5" fill="#5cc9c9" />
      <rect x="6" y="16" width="2" height="4" fill="#c95c9a" />
      <rect x="2" y="21" width="16" height="2" fill={woodDark} />
    </svg>
  );
}
