/**
 * NoiseLayer - 宣纸噪点质感层
 *
 * 内联 SVG feTurbulence 生成噪点纹理，消除纯色背景的塑料感。
 * 挂在 BackgroundLayer 之上（z-index: -2），pointer-events: none。
 * opacity 极低（0.03/0.04），近乎不可见但增加纸张质感。
 */
export default function NoiseLayer() {
  // feTurbulence 生成 80x80 噪点单元，baseFrequency 越小颗粒越粗
  const noiseSvg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>
      <filter id='n'>
        <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
      </filter>
      <rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/>
    </svg>`;
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(noiseSvg)}")`;
  return (
    <div
      className="visual-noise-layer"
      aria-hidden="true"
      style={{ backgroundImage: dataUri }}
    />
  );
}
